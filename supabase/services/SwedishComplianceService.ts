/// <reference path="../functions/types/deno.d.ts" />

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { createLogger } from './LoggerService.ts';

const logger = createLogger('swedish-compliance');

export type CompanyForm = 'ab' | 'enskild';
export type RuleLegalStatus = 'proposed' | 'active' | 'sunset';
export type ComplianceSeverity = 'critical' | 'warning' | 'info';

export interface RegulatoryRule {
    id: string;
    rule_key: string;
    domain: string;
    company_form: CompanyForm | 'all';
    effective_from: string;
    effective_to: string | null;
    legal_status: RuleLegalStatus;
    payload: Record<string, unknown>;
    source_urls: string[];
    last_verified_at: string | null;
}

export interface ComplianceAlert {
    code: string;
    severity: ComplianceSeverity;
    title: string;
    description: string;
    actionTarget?: string;
    payload?: Record<string, unknown>;
}

export interface AgiDraftInput {
    userId: string;
    companyId: string;
    period: string; // YYYY-MM
    companyForm: CompanyForm;
    payrollEnabled: boolean;
    totals: Record<string, unknown>;
}

export interface AgiDraftEvaluation {
    status: 'draft' | 'review_required';
    controls: {
        hasPayrollTotals: boolean;
        hasProposedRules: boolean;
        missingRuleCoverage: boolean;
        dueDate: string;
    };
    alerts: ComplianceAlert[];
}

export interface AutoPostPolicy {
    enabled: boolean;
    minConfidence: number;
    maxAmountSek: number;
    requireKnownCounterparty: boolean;
    allowWithActiveRuleOnly: boolean;
    requireManualForNewSupplier: boolean;
    requireManualForDeviatingVat: boolean;
    requireManualForLockedPeriod: boolean;
}

export interface AutoPostInput {
    confidence: number;
    amountSek: number;
    knownCounterparty: boolean;
    hasActiveRule: boolean;
    isNewSupplier: boolean;
    deviatingVat: boolean;
    periodLocked: boolean;
}

const DEFAULT_POLICY: AutoPostPolicy = {
    enabled: true,
    minConfidence: 0.88,
    maxAmountSek: 25000,
    requireKnownCounterparty: true,
    allowWithActiveRuleOnly: true,
    requireManualForNewSupplier: true,
    requireManualForDeviatingVat: true,
    requireManualForLockedPeriod: true,
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function todayIsoDate(): string {
    return new Date().toISOString().slice(0, 10);
}

function parseDate(value: string | null | undefined): Date | null {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function parseNumber(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const normalized = value.replace(/\s+/g, '').replace(',', '.');
        const parsed = Number(normalized);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
}

function addMonthsToPeriod(period: string, months: number): string {
    const [yearStr, monthStr] = period.split('-');
    const year = Number.parseInt(yearStr, 10);
    const month = Number.parseInt(monthStr, 10);
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
        return period;
    }
    const base = new Date(year, month - 1 + months, 1);
    return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}`;
}

function toDueDate(period: string): string {
    // Conservative default used in product today: 12th of next month
    const nextPeriod = addMonthsToPeriod(period, 1);
    return `${nextPeriod}-12`;
}

export class SwedishComplianceService {
    constructor(private supabase: SupabaseClient) {}

    async getApplicableRules(
        domain: string,
        companyForm: CompanyForm | 'all'
    ): Promise<RegulatoryRule[]> {
        const today = todayIsoDate();
        const { data, error } = await this.supabase
            .from('regulatory_rules')
            .select('id, rule_key, domain, company_form, effective_from, effective_to, legal_status, payload, source_urls, last_verified_at')
            .eq('domain', domain)
            .in('company_form', [companyForm, 'all'])
            .lte('effective_from', today)
            .or(`effective_to.is.null,effective_to.gte.${today}`)
            .order('effective_from', { ascending: false });

        if (error) {
            logger.warn('Failed to read regulatory rules', { domain, companyForm, error });
            return [];
        }
        return (data || []) as RegulatoryRule[];
    }

    async listStaleRules(maxAgeDays = 45): Promise<RegulatoryRule[]> {
        const { data, error } = await this.supabase
            .from('regulatory_rules')
            .select('id, rule_key, domain, company_form, effective_from, effective_to, legal_status, payload, source_urls, last_verified_at');

        if (error) {
            logger.warn('Failed to read regulatory rules for stale-check', { error });
            return [];
        }

        const now = Date.now();
        const staleMs = maxAgeDays * 24 * 60 * 60 * 1000;
        return ((data || []) as RegulatoryRule[]).filter((rule) => {
            const verifiedAt = parseDate(rule.last_verified_at);
            if (!verifiedAt) return true;
            return now - verifiedAt.getTime() > staleMs;
        });
    }

    async evaluateAgiDraft(input: AgiDraftInput): Promise<AgiDraftEvaluation> {
        const rules = await this.getApplicableRules('agi', input.companyForm);
        const activeRules = rules.filter((rule) => rule.legal_status === 'active');
        const proposedRules = rules.filter((rule) => rule.legal_status === 'proposed');

        const grossSalary = parseNumber(input.totals.grossSalary);
        const employerFees = parseNumber(input.totals.employerFees);
        const taxWithheld = parseNumber(input.totals.taxWithheld);
        const hasPayrollTotals = grossSalary > 0 || employerFees > 0 || taxWithheld > 0;

        const alerts: ComplianceAlert[] = [];
        if (input.payrollEnabled && !hasPayrollTotals) {
            alerts.push({
                code: 'agi_missing_totals',
                severity: 'warning',
                title: 'AGI-underlag saknar lönebelopp',
                description: 'Kontrollera löneunderlag innan AGI-utkast godkänns.',
                actionTarget: 'dashboard',
            });
        }

        if (proposedRules.length > 0) {
            alerts.push({
                code: 'agi_proposed_rules_present',
                severity: 'info',
                title: 'Föreslagna regler upptäckta',
                description: 'Föreslagna regler påverkar endast varningar, inte automatisk bokning.',
                actionTarget: 'dashboard',
                payload: { count: proposedRules.length },
            });
        }

        const missingRuleCoverage = activeRules.length === 0;
        if (missingRuleCoverage) {
            alerts.push({
                code: 'agi_missing_active_rules',
                severity: 'warning',
                title: 'Aktiva AGI-regler saknas',
                description: 'Lägg till verifierade AGI-regler för full compliance-kontroll.',
                actionTarget: 'dashboard',
            });
        }

        const status: 'draft' | 'review_required' =
            alerts.some((a) => a.severity === 'warning' || a.severity === 'critical')
                ? 'review_required'
                : 'draft';

        return {
            status,
            controls: {
                hasPayrollTotals,
                hasProposedRules: proposedRules.length > 0,
                missingRuleCoverage,
                dueDate: toDueDate(input.period),
            },
            alerts,
        };
    }

    evaluateAutoPost(
        policy: Partial<AutoPostPolicy> | null | undefined,
        input: AutoPostInput
    ): { allowed: boolean; reasons: string[]; appliedPolicy: AutoPostPolicy } {
        const appliedPolicy: AutoPostPolicy = {
            ...DEFAULT_POLICY,
            ...(policy || {}),
        };

        const reasons: string[] = [];
        if (!appliedPolicy.enabled) reasons.push('Autobokning är avstängd.');
        if (input.confidence < appliedPolicy.minConfidence) reasons.push('AI-konfidens under gränsvärde.');
        if (input.amountSek > appliedPolicy.maxAmountSek) reasons.push('Belopp över maxgräns för autobokning.');
        if (appliedPolicy.requireKnownCounterparty && !input.knownCounterparty) reasons.push('Okänd motpart kräver manuell granskning.');
        if (appliedPolicy.allowWithActiveRuleOnly && !input.hasActiveRule) reasons.push('Ingen aktiv regel matchad.');
        if (appliedPolicy.requireManualForNewSupplier && input.isNewSupplier) reasons.push('Ny leverantör kräver manuell attest.');
        if (appliedPolicy.requireManualForDeviatingVat && input.deviatingVat) reasons.push('Avvikande momssats kräver manuell attest.');
        if (appliedPolicy.requireManualForLockedPeriod && input.periodLocked) reasons.push('Period är låst.');

        return {
            allowed: reasons.length === 0,
            reasons,
            appliedPolicy,
        };
    }

    async buildCompanyComplianceAlerts(
        companyForm: CompanyForm
    ): Promise<ComplianceAlert[]> {
        const alerts: ComplianceAlert[] = [];
        const staleRules = await this.listStaleRules(45);
        const scopedStale = staleRules.filter((rule) => rule.company_form === 'all' || rule.company_form === companyForm);
        if (scopedStale.length > 0) {
            alerts.push({
                code: 'stale_regulatory_rules',
                severity: 'warning',
                title: 'Regelunderlag behöver verifieras',
                description: `${scopedStale.length} regelposter saknar färsk verifiering.`,
                actionTarget: 'dashboard',
                payload: { stale_count: scopedStale.length },
            });
        }

        const vatRules = await this.getApplicableRules('vat', companyForm);
        if (vatRules.length === 0) {
            alerts.push({
                code: 'missing_vat_rules',
                severity: 'warning',
                title: 'Momsregler saknas',
                description: 'Inga aktiva momsregler hittades för bolagsformen.',
                actionTarget: 'vat-report',
            });
        } else if (vatRules.some((rule) => rule.legal_status === 'proposed')) {
            alerts.push({
                code: 'vat_rules_proposed_only',
                severity: 'info',
                title: 'Momsregler innehåller förslag',
                description: 'Regler markerade som proposed används endast för varning.',
                actionTarget: 'vat-report',
            });
        }

        return alerts;
    }
}

export function createSwedishComplianceService(supabase: SupabaseClient): SwedishComplianceService {
    return new SwedishComplianceService(supabase);
}


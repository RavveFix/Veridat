/// <reference path="../types/deno.d.ts" />

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
    getCorsHeaders,
    createOptionsResponse,
    isOriginAllowed,
    createForbiddenOriginResponse
} from '../../services/CorsService.ts';
import { createLogger } from '../../services/LoggerService.ts';
import { FortnoxService } from '../../services/FortnoxService.ts';
import { getUserPlan } from '../../services/PlanService.ts';
import { createSwedishComplianceService, type CompanyForm } from '../../services/SwedishComplianceService.ts';

const logger = createLogger('fortnox-guardian');
type AdminClient = any;

type GuardianSeverity = 'critical' | 'warning' | 'info';
type GuardianStatus = 'open' | 'acknowledged' | 'resolved';

type GuardianAlertInput = {
    fingerprint: string;
    severity: GuardianSeverity;
    title: string;
    description: string;
    actionTarget?: string;
    payload?: Record<string, unknown>;
};

type GuardianSummary = {
    processedUsers: number;
    alertsCreated: number;
    alertsUpdated: number;
    alertsResolved: number;
    errors: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getPositiveInt(value: unknown, fallback: number, max = 100): number {
    if (value === undefined || value === null) return fallback;
    const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return Math.min(parsed, max);
}

function toNumber(value: unknown): number {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value === 'string') {
        const parsed = Number(value.replace(/\s+/g, '').replace(',', '.'));
        return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
}

function todayIso(): string {
    return new Date().toISOString().slice(0, 10);
}

async function hashFingerprint(parts: string[]): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(parts.join('|'));
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function upsertOpenAlert(
    supabaseAdmin: AdminClient,
    userId: string,
    companyId: string,
    alert: GuardianAlertInput
): Promise<'created' | 'updated'> {
    const now = new Date().toISOString();
    const payload = {
        source: 'fortnox_guardian',
        ...(alert.payload || {}),
    };

    const { data: existing } = await supabaseAdmin
        .from('guardian_alerts')
        .select('id, occurrences')
        .eq('user_id', userId)
        .eq('company_id', companyId)
        .eq('fingerprint', alert.fingerprint)
        .eq('status', 'open')
        .maybeSingle();

    if (existing?.id) {
        const occurrences = Number(existing.occurrences || 0) + 1;
        const { error } = await supabaseAdmin
            .from('guardian_alerts')
            .update({
                severity: alert.severity,
                title: alert.title,
                description: alert.description,
                action_target: alert.actionTarget || null,
                payload,
                occurrences,
                last_seen_at: now,
            })
            .eq('id', existing.id);

        if (error) throw error;
        return 'updated';
    }

    const { error } = await supabaseAdmin
        .from('guardian_alerts')
        .insert({
            user_id: userId,
            company_id: companyId,
            fingerprint: alert.fingerprint,
            severity: alert.severity,
            status: 'open',
            title: alert.title,
            description: alert.description,
            action_target: alert.actionTarget || null,
            payload,
            occurrences: 1,
            first_seen_at: now,
            last_seen_at: now,
        });

    if (error) throw error;
    return 'created';
}

async function resolveStaleAlerts(
    supabaseAdmin: AdminClient,
    userId: string,
    companyId: string,
    activeFingerprints: Set<string>
): Promise<number> {
    const { data, error } = await supabaseAdmin
        .from('guardian_alerts')
        .select('id, fingerprint, payload')
        .eq('user_id', userId)
        .eq('company_id', companyId)
        .eq('status', 'open');

    if (error || !data) return 0;

    const now = new Date().toISOString();
    let resolved = 0;

    for (const row of data) {
        const payload = isRecord(row.payload) ? row.payload : {};
        const source = typeof payload.source === 'string' ? payload.source : '';
        if (source !== 'fortnox_guardian') continue;
        if (activeFingerprints.has(String(row.fingerprint))) continue;

        const { error: updateError } = await supabaseAdmin
            .from('guardian_alerts')
            .update({
                status: 'resolved',
                resolved_at: now,
                last_seen_at: now,
            })
            .eq('id', row.id)
            .eq('status', 'open');

        if (!updateError) resolved += 1;
    }

    return resolved;
}

function getInvoiceAmount(invoice: Record<string, unknown>): number {
    const balance = toNumber(invoice.Balance);
    if (balance > 0) return balance;
    return toNumber(invoice.Total);
}

async function runChecksForUser(
    supabaseAdmin: AdminClient,
    userId: string,
    expiresAtIso: string,
    companyId: string
): Promise<{ created: number; updated: number; resolved: number }> {
    const fortnoxConfig = {
        clientId: Deno.env.get('FORTNOX_CLIENT_ID') ?? '',
        clientSecret: Deno.env.get('FORTNOX_CLIENT_SECRET') ?? '',
        redirectUri: '',
    };

    const fortnox = new FortnoxService(fortnoxConfig, supabaseAdmin, userId, companyId);
    const complianceService = createSwedishComplianceService(supabaseAdmin);
    const activeFingerprints = new Set<string>();
    let created = 0;
    let updated = 0;

    const registerAlert = async (checkKey: string, alert: Omit<GuardianAlertInput, 'fingerprint' | 'payload'> & { payload?: Record<string, unknown> }) => {
        const fingerprint = await hashFingerprint([userId, companyId, checkKey, alert.title]);
        activeFingerprints.add(fingerprint);
        const status = await upsertOpenAlert(supabaseAdmin, userId, companyId, {
            fingerprint,
            severity: alert.severity,
            title: alert.title,
            description: alert.description,
            actionTarget: alert.actionTarget,
            payload: {
                check: checkKey,
                ...(alert.payload || {}),
            },
        });
        if (status === 'created') created += 1;
        if (status === 'updated') updated += 1;
    };

    // 1) Token expiry check
    const expiresAtMs = new Date(expiresAtIso).getTime();
    if (!Number.isFinite(expiresAtMs)) {
        await registerAlert('token_invalid_expiry', {
            severity: 'critical',
            title: 'Fortnox-token saknar giltigt utgångsdatum',
            description: 'Anslutningen behöver kopplas om för att säkerställa synk.',
            actionTarget: 'fortnox-panel',
            payload: { expires_at: expiresAtIso },
        });
    } else {
        const hoursLeft = (expiresAtMs - Date.now()) / (1000 * 60 * 60);
        if (hoursLeft <= 72) {
            await registerAlert('token_expiring', {
                severity: hoursLeft <= 24 ? 'critical' : 'warning',
                title: 'Fortnox-token löper ut snart',
                description: `Token löper ut om cirka ${Math.max(0, Math.round(hoursLeft))} timmar. Koppla om integrationen i tid.`,
                actionTarget: 'fortnox-panel',
                payload: { hours_left: hoursLeft },
            });
        }
    }

    // 2) Failed sync logs
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: failedSyncs } = await supabaseAdmin
        .from('fortnox_sync_log')
        .select('id, operation, error_code, error_message, created_at')
        .eq('user_id', userId)
        .eq('company_id', companyId)
        .eq('status', 'failed')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(25);

    const failedCount = failedSyncs?.length || 0;
    if (failedCount > 0) {
        const latest = failedSyncs?.[0];
        await registerAlert('failed_syncs', {
            severity: failedCount >= 3 ? 'critical' : 'warning',
            title: `${failedCount} misslyckade Fortnox-synkar senaste dygnet`,
            description: latest?.error_message
                ? `Senaste fel: ${latest.error_message}`
                : 'Kontrollera Fortnox-panelen och synkloggen.',
            actionTarget: 'fortnox-panel',
            payload: { count: failedCount, latest_error_code: latest?.error_code || null },
        });
    }

    // 3) Supplier invoice checks + anomaly checks
    let supplierInvoices: Record<string, unknown>[] = [];
    try {
        const supplierResponse = await fortnox.getSupplierInvoices({ allPages: true, limit: 100 });
        supplierInvoices = (supplierResponse.SupplierInvoices || []) as unknown as Record<string, unknown>[];
    } catch (error) {
        await registerAlert('supplier_invoice_fetch_failed', {
            severity: 'warning',
            title: 'Kunde inte hämta leverantörsfakturor',
            description: 'Guardian kunde inte läsa leverantörsfakturor från Fortnox. Kontrollera behörighet och anslutning.',
            actionTarget: 'fortnox-panel',
            payload: { error: error instanceof Error ? error.message : String(error) },
        });
    }

    if (supplierInvoices.length > 0) {
        const today = todayIso();
        const overdue = supplierInvoices.filter((inv) => {
            const dueDate = typeof inv.DueDate === 'string' ? inv.DueDate : '';
            return dueDate && dueDate < today && getInvoiceAmount(inv) > 0;
        });

        const unbooked = supplierInvoices.filter((inv) => {
            const booked = inv.Booked === true;
            return !booked && getInvoiceAmount(inv) > 0;
        });

        if (overdue.length > 0) {
            const overdueTotal = overdue.reduce((sum, inv) => sum + getInvoiceAmount(inv), 0);
            await registerAlert('overdue_supplier_invoices', {
                severity: overdue.length >= 5 ? 'critical' : 'warning',
                title: `${overdue.length} förfallna leverantörsfakturor`,
                description: `Obetalt belopp cirka ${Math.round(overdueTotal).toLocaleString('sv-SE')} kr.`,
                actionTarget: 'invoice-inbox',
                payload: { overdue_count: overdue.length, overdue_total: overdueTotal },
            });
        }

        if (unbooked.length > 0) {
            await registerAlert('unbooked_supplier_invoices', {
                severity: unbooked.length >= 10 ? 'warning' : 'info',
                title: `${unbooked.length} obokförda leverantörsfakturor`,
                description: 'Fakturor väntar fortfarande på bokföring i Fortnox.',
                actionTarget: 'fortnox-panel',
                payload: { unbooked_count: unbooked.length },
            });
        }

        const seen = new Map<string, number>();
        let duplicates = 0;
        for (const inv of supplierInvoices) {
            const supplierNr = typeof inv.SupplierNumber === 'string' ? inv.SupplierNumber : '';
            const invoiceNumber = typeof inv.InvoiceNumber === 'string' ? inv.InvoiceNumber : '';
            if (!supplierNr || !invoiceNumber) continue;
            const key = `${supplierNr}|${invoiceNumber}`;
            const count = (seen.get(key) || 0) + 1;
            seen.set(key, count);
            if (count === 2) duplicates += 1;
        }

        if (duplicates > 0) {
            await registerAlert('duplicate_supplier_invoices', {
                severity: duplicates >= 3 ? 'warning' : 'info',
                title: `${duplicates} möjlig(a) dubblettfakturor`,
                description: 'Minst ett fakturanummer förekommer flera gånger per leverantör.',
                actionTarget: 'fortnox-panel',
                payload: { duplicate_pairs: duplicates },
            });
        }

        const bySupplier = new Map<string, Record<string, unknown>[]>();
        for (const inv of supplierInvoices) {
            const supplierNr = typeof inv.SupplierNumber === 'string' ? inv.SupplierNumber : '';
            if (!supplierNr) continue;
            const list = bySupplier.get(supplierNr) || [];
            list.push(inv);
            bySupplier.set(supplierNr, list);
        }

        let unusualCount = 0;
        for (const invoices of bySupplier.values()) {
            if (invoices.length < 3) continue;
            const sorted = [...invoices].sort((a, b) => {
                const dateA = typeof a.InvoiceDate === 'string' ? a.InvoiceDate : '';
                const dateB = typeof b.InvoiceDate === 'string' ? b.InvoiceDate : '';
                return dateB.localeCompare(dateA);
            });
            const latest = sorted[0];
            const historic = sorted.slice(1);
            const avg = historic.reduce((sum, inv) => sum + toNumber(inv.Total), 0) / historic.length;
            if (avg <= 0) continue;
            const latestAmount = toNumber(latest.Total);
            if (latestAmount > avg * 3) {
                unusualCount += 1;
            }
        }

        if (unusualCount > 0) {
            await registerAlert('unusual_supplier_amounts', {
                severity: unusualCount >= 3 ? 'warning' : 'info',
                title: `${unusualCount} leverantör(er) med ovanliga belopp`,
                description: 'Senaste faktura avviker kraftigt från historiska nivåer.',
                actionTarget: 'fortnox-panel',
                payload: { supplier_count: unusualCount },
            });
        }
    }

    // 4) VAT warning check (unbooked customer invoices)
    try {
        const year = new Date().getFullYear();
        const invoices = await fortnox.getInvoices({
            fromDate: `${year}-01-01`,
            toDate: `${year}-12-31`,
            allPages: true,
            limit: 100,
        });
        const customerInvoices = (invoices.Invoices || []) as unknown as Record<string, unknown>[];
        const unbookedCustomer = customerInvoices.filter((inv) => inv.Booked !== true && inv.Cancelled !== true);
        if (unbookedCustomer.length > 0) {
            await registerAlert('vat_unbooked_customer_invoices', {
                severity: unbookedCustomer.length >= 10 ? 'warning' : 'info',
                title: 'Momsunderlag har obokförda kundfakturor',
                description: `${unbookedCustomer.length} kundfakturor är ej bokförda och kan påverka momsunderlag.`,
                actionTarget: 'vat-report',
                payload: { unbooked_customer_invoices: unbookedCustomer.length },
            });
        }
    } catch (error) {
        await registerAlert('vat_check_failed', {
            severity: 'info',
            title: 'VAT-kontroll kunde inte slutföras',
            description: 'Guardian kunde inte verifiera momsunderlag fullt ut denna körning.',
            actionTarget: 'vat-report',
            payload: { error: error instanceof Error ? error.message : String(error) },
        });
    }

    // 5) Compliance engine checks (rule freshness + legal status)
    try {
        const { data: profile } = await supabaseAdmin
            .from('accounting_profiles')
            .select('company_form')
            .eq('user_id', userId)
            .eq('company_id', companyId)
            .maybeSingle();

        const companyForm: CompanyForm = profile?.company_form === 'enskild' ? 'enskild' : 'ab';
        const complianceAlerts = await complianceService.buildCompanyComplianceAlerts(companyForm);

        for (const alert of complianceAlerts) {
            await registerAlert(`compliance_${alert.code}`, {
                severity: alert.severity,
                title: alert.title,
                description: alert.description,
                actionTarget: alert.actionTarget || 'dashboard',
                payload: alert.payload,
            });
        }
    } catch (error) {
        await registerAlert('compliance_check_failed', {
            severity: 'info',
            title: 'Compliance-kontroll kunde inte slutföras',
            description: 'Guardian kunde inte verifiera regelunderlag i denna körning.',
            actionTarget: 'dashboard',
            payload: { error: error instanceof Error ? error.message : String(error) },
        });
    }

    // 6) Agent swarm: permanently failed tasks
    try {
        const { data: failedTasks } = await supabaseAdmin
            .from('agent_tasks')
            .select('id, agent_type, error_message')
            .eq('user_id', userId)
            .eq('company_id', companyId)
            .eq('status', 'failed')
            .limit(50);

        const permFailed = (failedTasks || []).filter(
            (t: Record<string, unknown>) => typeof t.id === 'string'
        );

        if (permFailed.length > 0) {
            const agentTypes = [...new Set(permFailed.map((t: Record<string, unknown>) => t.agent_type))];
            await registerAlert('agent_tasks_permanently_failed', {
                severity: permFailed.length >= 5 ? 'critical' : 'warning',
                title: `${permFailed.length} agent-task(s) permanent misslyckade`,
                description: `Agenttyper: ${agentTypes.join(', ')}. Kontrollera task-kön.`,
                actionTarget: 'agent-dashboard',
                payload: { failed_count: permFailed.length, agent_types: agentTypes },
            });
        }
    } catch (error) {
        logger.warn('Agent task failed-check skipped', { error });
    }

    // 7) Agent swarm: stale open reconciliation periods
    try {
        const now = new Date();
        const twoMonthsAgo = `${now.getFullYear()}-${String(Math.max(1, now.getMonth() - 1)).padStart(2, '0')}`;

        const { data: stalePeriods } = await supabaseAdmin
            .from('reconciliation_periods')
            .select('id, period')
            .eq('user_id', userId)
            .eq('company_id', companyId)
            .eq('status', 'open')
            .lt('period', twoMonthsAgo)
            .limit(20);

        if (stalePeriods && stalePeriods.length > 0) {
            const oldest = stalePeriods[stalePeriods.length - 1]?.period || '';
            await registerAlert('stale_open_reconciliation', {
                severity: stalePeriods.length >= 3 ? 'warning' : 'info',
                title: `${stalePeriods.length} öppna avstämningsperiod(er) äldre än 2 månader`,
                description: `Äldsta: ${oldest}. Stäng eller lås perioderna.`,
                actionTarget: 'reconciliation',
                payload: { stale_count: stalePeriods.length, oldest_period: oldest },
            });
        }
    } catch (error) {
        logger.warn('Reconciliation stale-check skipped', { error });
    }

    // 8) Agent swarm: unprocessed invoices older than 14 days
    try {
        const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

        const { data: staleInvoices } = await supabaseAdmin
            .from('invoice_inbox_items')
            .select('id, supplier_name, uploaded_at')
            .eq('user_id', userId)
            .eq('company_id', companyId)
            .eq('status', 'ny')
            .lt('uploaded_at', fourteenDaysAgo)
            .limit(20);

        if (staleInvoices && staleInvoices.length > 0) {
            await registerAlert('stale_unprocessed_invoices', {
                severity: staleInvoices.length >= 5 ? 'warning' : 'info',
                title: `${staleInvoices.length} faktura(or) obehandlade > 14 dagar`,
                description: 'Fakturor i inkorgen har legat obearbetade länge. Granska eller kör fakturaagenten.',
                actionTarget: 'invoice-inbox',
                payload: { stale_count: staleInvoices.length },
            });
        }
    } catch (error) {
        logger.warn('Invoice stale-check skipped', { error });
    }

    const resolved = await resolveStaleAlerts(supabaseAdmin, userId, companyId, activeFingerprints);
    return { created, updated, resolved };
}

async function runGuardianChecks(
    supabaseAdmin: AdminClient,
    options: { userId?: string; companyId?: string; limit: number }
): Promise<GuardianSummary> {
    const summary: GuardianSummary = {
        processedUsers: 0,
        alertsCreated: 0,
        alertsUpdated: 0,
        alertsResolved: 0,
        errors: 0,
    };

    let query = supabaseAdmin
        .from('fortnox_tokens')
        .select('user_id, company_id, expires_at, updated_at')
        .order('updated_at', { ascending: false })
        .limit(options.limit);

    if (options.userId) {
        query = query.eq('user_id', options.userId);
    }
    if (options.companyId) {
        query = query.eq('company_id', options.companyId);
    }

    const { data: tokenRows, error } = await query;
    if (error) {
        throw error;
    }

    const rows = tokenRows || [];
    for (const row of rows) {
        const userId = String(row.user_id || '');
        const companyId = String(row.company_id || '');
        const expiresAt = String(row.expires_at || '');
        if (!userId || !companyId) continue;

        try {
            const plan = await getUserPlan(supabaseAdmin, userId);
            if (plan === 'free') {
                continue;
            }
            const outcome = await runChecksForUser(supabaseAdmin, userId, expiresAt, companyId);
            summary.processedUsers += 1;
            summary.alertsCreated += outcome.created;
            summary.alertsUpdated += outcome.updated;
            summary.alertsResolved += outcome.resolved;
        } catch (runError) {
            summary.errors += 1;
            logger.error('Guardian check failed for user', { userId, error: runError });
        }
    }

    return summary;
}

async function verifyUser(
    supabaseAdmin: AdminClient,
    req: Request
): Promise<{ userId: string; isAdmin: boolean } | null> {
    const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
    if (!authHeader) return null;

    const token = authHeader.replace(/^Bearer\s+/i, '');
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) return null;

    const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('is_admin')
        .eq('id', user.id)
        .maybeSingle();

    return {
        userId: user.id,
        isAdmin: Boolean(profile?.is_admin),
    };
}

Deno.serve(async (req: Request) => {
    const requestOrigin = req.headers.get('origin') || req.headers.get('Origin');
    const corsHeaders = getCorsHeaders(requestOrigin);

    function jsonResponse(status: number, body: Record<string, unknown>, extraHeaders: Record<string, string> = {}) {
        return new Response(JSON.stringify(body), {
            status,
            headers: { ...corsHeaders, ...extraHeaders, 'Content-Type': 'application/json' },
        });
    }

    if (req.method === 'OPTIONS') {
        return createOptionsResponse(req);
    }

    if (requestOrigin && !isOriginAllowed(requestOrigin)) {
        return createForbiddenOriginResponse(requestOrigin);
    }

    if (req.method !== 'POST') {
        return jsonResponse(405, { error: 'Method not allowed' });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!supabaseUrl || !supabaseServiceKey) {
        return jsonResponse(500, { error: 'Server configuration error' });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const payload = isRecord(body.payload) ? body.payload : {};
    const action = typeof body.action === 'string' ? body.action : '';

    const user = await verifyUser(supabaseAdmin, req);
    const cronSecret = Deno.env.get('FORTNOX_GUARDIAN_CRON_SECRET');
    const cronHeader = req.headers.get('x-cron-secret') || req.headers.get('X-Cron-Secret');
    const isCron = !user && cronSecret && cronHeader === cronSecret;

    try {
        switch (action) {
            case 'run_checks': {
                if (!isCron && !user?.isAdmin) {
                    return jsonResponse(user ? 403 : 401, { error: user ? 'Admin access required' : 'Unauthorized' });
                }

                const limit = getPositiveInt(payload.limit, 25, 200);
                const targetUserId = typeof payload.userId === 'string' ? payload.userId : undefined;
                const targetCompanyId = typeof payload.companyId === 'string' ? payload.companyId : undefined;

                const summary = await runGuardianChecks(supabaseAdmin, {
                    userId: targetUserId,
                    companyId: targetCompanyId,
                    limit,
                });

                return jsonResponse(200, {
                    ok: true,
                    mode: isCron ? 'cron' : 'admin',
                    summary,
                });
            }

            case 'list_alerts': {
                if (!user?.userId) {
                    return jsonResponse(401, { error: 'Unauthorized' });
                }

                const limit = getPositiveInt(payload.limit, 25, 100);
                const companyId = typeof payload.companyId === 'string' ? payload.companyId : undefined;
                const status = typeof payload.status === 'string' ? payload.status as GuardianStatus : 'open';

                let query = supabaseAdmin
                    .from('guardian_alerts')
                    .select('id, company_id, title, description, severity, status, action_target, payload, created_at, last_seen_at, updated_at')
                    .eq('user_id', user.userId)
                    .eq('status', status)
                    .order('created_at', { ascending: false })
                    .limit(limit);

                if (companyId) {
                    query = query.eq('company_id', companyId);
                }

                const { data, error } = await query;
                if (error) {
                    throw error;
                }

                return jsonResponse(200, {
                    alerts: data || [],
                });
            }

            case 'acknowledge_alert':
            case 'resolve_alert': {
                if (!user?.userId) {
                    return jsonResponse(401, { error: 'Unauthorized' });
                }

                const alertId = typeof payload.alertId === 'string' ? payload.alertId : '';
                if (!alertId) {
                    return jsonResponse(400, {
                        error: 'Missing required field: payload.alertId',
                        errorCode: 'INVALID_PAYLOAD',
                    });
                }

                const nextStatus: GuardianStatus = action === 'acknowledge_alert' ? 'acknowledged' : 'resolved';
                const now = new Date().toISOString();
                const patch: Record<string, unknown> = {
                    status: nextStatus,
                    last_seen_at: now,
                };
                if (nextStatus === 'resolved') {
                    patch.resolved_at = now;
                }

                const { data, error } = await supabaseAdmin
                    .from('guardian_alerts')
                    .update(patch)
                    .eq('id', alertId)
                    .eq('user_id', user.userId)
                    .select('id, status')
                    .maybeSingle();

                if (error) throw error;
                if (!data) {
                    return jsonResponse(404, { error: 'Alert not found' });
                }

                return jsonResponse(200, { ok: true, alert: data });
            }

            default:
                return jsonResponse(400, {
                    error: `Unknown action: ${action}`,
                    errorCode: 'UNKNOWN_ACTION',
                });
        }
    } catch (error) {
        logger.error('fortnox-guardian error', { action, error });
        return jsonResponse(500, {
            error: error instanceof Error ? error.message : 'Unexpected error',
        });
    }
});

import { supabase } from '../lib/supabase';
import { logger } from './LoggerService';
import { STORAGE_KEYS } from '../constants/storageKeys';
import type {
    AgiRunRecord,
    AutoPostPolicy,
    BankImportRecord,
    InvoiceInboxRecord,
    ReconciliationPeriodRecord,
} from '../types/finance';

const FINANCE_ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/finance-agent`;
const MIGRATION_FLAG_KEY = 'finance_storage_migrated';

type FinanceAction =
    | 'migrateClientStorage'
    | 'importBankTransactions'
    | 'listBankTransactions'
    | 'setReconciliationStatus'
    | 'listReconciliationStatuses'
    | 'upsertInvoiceInboxItem'
    | 'deleteInvoiceInboxItem'
    | 'listInvoiceInboxItems'
    | 'runAgiDraft'
    | 'approveAgiDraft'
    | 'listComplianceAlerts';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readStore<T>(key: string): Record<string, T[]> {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return isRecord(parsed) ? parsed as Record<string, T[]> : {};
    } catch {
        return {};
    }
}

class FinanceAgentServiceClass {
    private bankImportsCache = new Map<string, BankImportRecord[]>();
    private invoiceCache = new Map<string, InvoiceInboxRecord[]>();
    private reconciliationCache = new Map<string, ReconciliationPeriodRecord[]>();
    private migrationPromises = new Map<string, Promise<void>>();

    private migrationFlagKey(companyId: string): string {
        return `${MIGRATION_FLAG_KEY}:${companyId}`;
    }

    private async invoke<T>(
        action: FinanceAction,
        companyId: string,
        payload: Record<string, unknown> = {}
    ): Promise<T> {
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData.session?.access_token;
        if (!accessToken) {
            throw new Error('Du måste vara inloggad.');
        }

        const response = await fetch(FINANCE_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
                action,
                companyId,
                payload,
            }),
        });

        const body = await response.json().catch(() => ({})) as Record<string, unknown>;
        if (!response.ok) {
            const errorMessage = typeof body.error === 'string'
                ? body.error
                : typeof body.message === 'string'
                    ? body.message
                    : `Finance-agent error (${response.status})`;
            throw new Error(errorMessage);
        }
        return body as T;
    }

    private async migrateIfNeeded(companyId: string): Promise<void> {
        const migrationFlag = localStorage.getItem(this.migrationFlagKey(companyId));
        if (migrationFlag === 'true') return;

        const existing = this.migrationPromises.get(companyId);
        if (existing) {
            await existing;
            return;
        }

        const migrationPromise = (async () => {
            const bankStore = readStore<BankImportRecord>(STORAGE_KEYS.bankImports);
            const legacyBankStore = readStore<BankImportRecord>(STORAGE_KEYS.bankImportsLegacy);
            const invoiceStore = readStore<InvoiceInboxRecord>(STORAGE_KEYS.invoiceInbox);
            const reconciledStore = readStore<string>(STORAGE_KEYS.reconciledPeriods);

            const bankImports = [
                ...(bankStore[companyId] || []),
                ...(legacyBankStore[companyId] || []),
            ];
            const invoiceInbox = invoiceStore[companyId] || [];
            const reconciledPeriods = reconciledStore[companyId] || [];

            if (bankImports.length === 0 && invoiceInbox.length === 0 && reconciledPeriods.length === 0) {
                localStorage.setItem(this.migrationFlagKey(companyId), 'true');
                localStorage.setItem(MIGRATION_FLAG_KEY, 'true');
                return;
            }

            await this.invoke<{ migrated: boolean }>('migrateClientStorage', companyId, {
                bankImports,
                invoiceInbox,
                reconciledPeriods,
            });

            localStorage.setItem(this.migrationFlagKey(companyId), 'true');
            localStorage.setItem(MIGRATION_FLAG_KEY, 'true');
        })();

        this.migrationPromises.set(companyId, migrationPromise);
        try {
            await migrationPromise;
        } finally {
            this.migrationPromises.delete(companyId);
        }
    }

    getCachedBankImports(companyId: string): BankImportRecord[] {
        return this.bankImportsCache.get(companyId) || [];
    }

    getCachedInvoiceInbox(companyId: string): InvoiceInboxRecord[] {
        return this.invoiceCache.get(companyId) || [];
    }

    getCachedReconciliation(companyId: string): ReconciliationPeriodRecord[] {
        return this.reconciliationCache.get(companyId) || [];
    }

    async refreshBankImports(companyId: string): Promise<BankImportRecord[]> {
        await this.migrateIfNeeded(companyId);
        const result = await this.invoke<{ imports: BankImportRecord[] }>('listBankTransactions', companyId, {});
        const imports = Array.isArray(result.imports) ? result.imports : [];
        this.bankImportsCache.set(companyId, imports);
        return imports;
    }

    async importBankTransactions(companyId: string, bankImport: BankImportRecord): Promise<void> {
        await this.migrateIfNeeded(companyId);
        await this.invoke('importBankTransactions', companyId, { import: bankImport });
        await this.refreshBankImports(companyId);
    }

    async refreshReconciliation(companyId: string): Promise<ReconciliationPeriodRecord[]> {
        await this.migrateIfNeeded(companyId);
        const result = await this.invoke<{ periods: ReconciliationPeriodRecord[] }>('listReconciliationStatuses', companyId, {});
        const periods = Array.isArray(result.periods) ? result.periods : [];
        this.reconciliationCache.set(companyId, periods);
        return periods;
    }

    async setReconciliationStatus(
        companyId: string,
        period: string,
        status: ReconciliationPeriodRecord['status'],
        notes = ''
    ): Promise<void> {
        await this.migrateIfNeeded(companyId);
        await this.invoke('setReconciliationStatus', companyId, { period, status, notes });
        await this.refreshReconciliation(companyId);
    }

    async refreshInvoiceInbox(companyId: string): Promise<InvoiceInboxRecord[]> {
        await this.migrateIfNeeded(companyId);
        const result = await this.invoke<{ items: InvoiceInboxRecord[] }>('listInvoiceInboxItems', companyId, {});
        const items = Array.isArray(result.items) ? result.items : [];
        this.invoiceCache.set(companyId, items);
        return items;
    }

    async upsertInvoiceInboxItem(
        companyId: string,
        item: InvoiceInboxRecord,
        options?: {
            eventType?: string;
            previousStatus?: string;
            idempotencyKey?: string;
            fingerprint?: string;
            aiDecisionId?: string;
            eventPayload?: Record<string, unknown>;
        }
    ): Promise<InvoiceInboxRecord> {
        await this.migrateIfNeeded(companyId);
        const result = await this.invoke<{ item: InvoiceInboxRecord }>('upsertInvoiceInboxItem', companyId, {
            item,
            eventType: options?.eventType,
            previousStatus: options?.previousStatus,
            idempotencyKey: options?.idempotencyKey,
            fingerprint: options?.fingerprint,
            aiDecisionId: options?.aiDecisionId,
            eventPayload: options?.eventPayload || {},
        });
        await this.refreshInvoiceInbox(companyId);
        return result.item;
    }

    async deleteInvoiceInboxItem(
        companyId: string,
        itemId: string,
        options?: {
            idempotencyKey?: string;
            fingerprint?: string;
            eventPayload?: Record<string, unknown>;
        }
    ): Promise<void> {
        await this.migrateIfNeeded(companyId);
        await this.invoke('deleteInvoiceInboxItem', companyId, {
            itemId,
            idempotencyKey: options?.idempotencyKey,
            fingerprint: options?.fingerprint,
            eventPayload: options?.eventPayload || {},
        });
        await this.refreshInvoiceInbox(companyId);
    }

    async runAgiDraft(
        companyId: string,
        period: string,
        totals: Record<string, unknown>
    ): Promise<{ run: AgiRunRecord; alerts: Array<Record<string, unknown>> }> {
        await this.migrateIfNeeded(companyId);
        return await this.invoke('runAgiDraft', companyId, { period, totals });
    }

    async approveAgiDraft(companyId: string, runId: string): Promise<{ run: AgiRunRecord }> {
        await this.migrateIfNeeded(companyId);
        return await this.invoke('approveAgiDraft', companyId, { runId });
    }

    async listComplianceAlerts(companyId: string): Promise<Array<Record<string, unknown>>> {
        await this.migrateIfNeeded(companyId);
        const result = await this.invoke<{ alerts: Array<Record<string, unknown>> }>('listComplianceAlerts', companyId, {});
        return Array.isArray(result.alerts) ? result.alerts : [];
    }

    async preloadCompany(companyId: string): Promise<void> {
        try {
            await Promise.all([
                this.refreshBankImports(companyId),
                this.refreshReconciliation(companyId),
                this.refreshInvoiceInbox(companyId),
            ]);
        } catch (error) {
            logger.warn('Finance preload failed', error);
        }
    }

    async getAutoPostPolicy(companyId: string): Promise<AutoPostPolicy | null> {
        try {
            type LooseSupabase = {
                from: (relation: string) => {
                    select: (columns: string) => {
                        eq: (column: string, value: string) => {
                            maybeSingle: () => Promise<{
                                data: Record<string, unknown> | null;
                                error: { message?: string } | null;
                            }>;
                        };
                    };
                };
            };

            const { data, error } = await (supabase as unknown as LooseSupabase)
                .from('auto_post_policies')
                .select('*')
                .eq('company_id', companyId)
                .maybeSingle();
            if (error || !data) return null;
            return {
                enabled: data.enabled === true,
                minConfidence: Number(data.min_confidence ?? 0.88),
                maxAmountSek: Number(data.max_amount_sek ?? 25000),
                requireKnownCounterparty: data.require_known_counterparty !== false,
                allowWithActiveRuleOnly: data.allow_with_active_rule_only !== false,
                requireManualForNewSupplier: data.require_manual_for_new_supplier !== false,
                requireManualForDeviatingVat: data.require_manual_for_deviating_vat !== false,
                requireManualForLockedPeriod: data.require_manual_for_locked_period !== false,
            };
        } catch (error) {
            logger.warn('Failed to read auto-post policy', error);
            return null;
        }
    }
}

export const financeAgentService = new FinanceAgentServiceClass();

import { supabase } from '../lib/supabase';
import { logger } from './LoggerService';

export type InvoicePostingType = 'supplier' | 'customer';
export type PostingSeverity = 'info' | 'warning' | 'critical';
export type PostingStatus = 'booked' | 'unbooked' | 'unknown';
export type PostingSource = 'explicit' | 'heuristic' | 'none';
export type PostingMatchPath = 'explicit_vouchers' | 'explicit_single' | 'reference' | 'heuristic' | 'none';
export type CheckStatus = 'ok' | 'warning' | 'critical';

export interface InvoicePostingRow {
    account: number;
    debit: number;
    credit: number;
    description: string;
}

export interface InvoicePostingTotals {
    debit: number;
    credit: number;
    balanced: boolean;
}

export interface PostingCheckResult {
    balanced: boolean;
    total_match: boolean;
    vat_match: boolean;
    control_account_present: boolean;
    row_account_consistency: boolean;
}

export interface PostingIssue {
    code: string;
    severity: PostingSeverity;
    message: string;
    suggestion: string;
}

export interface PostingVoucherRef {
    series: string;
    number: number;
    year?: number;
}

export interface PostingReferenceEvidence {
    referenceType?: string;
    referenceNumber?: string;
}

export interface InvoicePostingTrace {
    invoice: {
        type: InvoicePostingType;
        id: string;
        invoiceNumber: string;
        counterpartyNumber: string;
        counterpartyName: string;
        invoiceDate: string;
        dueDate: string;
        total: number;
        vat: number;
        balance: number;
        currency: string;
        booked: boolean | null;
    };
    expectedPosting: {
        rows: InvoicePostingRow[];
        totals: InvoicePostingTotals;
    };
    posting: {
        status: PostingStatus;
        source: PostingSource;
        confidence: number;
        voucherRef: PostingVoucherRef | null;
        matchPath?: PostingMatchPath;
        referenceEvidence?: PostingReferenceEvidence;
        rows: InvoicePostingRow[];
        totals: InvoicePostingTotals;
    };
    checks: PostingCheckResult;
    issues: PostingIssue[];
}

export interface PostingCheckBadge {
    key: keyof PostingCheckResult;
    label: string;
    status: CheckStatus;
}

interface FetchPostingTraceParams {
    companyId: string;
    invoiceType: InvoicePostingType;
    invoiceId: string | number;
    forceRefresh?: boolean;
}

interface CacheEntry {
    expiresAt: number;
    value: InvoicePostingTrace;
}

const FORTNOX_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fortnox`;
const CACHE_TTL_MS = 10 * 60 * 1000;

function getFunctionErrorMessage(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') return null;
    const error = (payload as Record<string, unknown>).error;
    if (typeof error === 'string' && error.trim()) return error;
    const message = (payload as Record<string, unknown>).message;
    if (typeof message === 'string' && message.trim()) return message;
    return null;
}

function getFunctionErrorCode(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') return null;
    const errorCode = (payload as Record<string, unknown>).errorCode;
    if (typeof errorCode === 'string' && errorCode.trim()) return errorCode;
    return null;
}

export function getPostingTraceErrorMessage(payload: unknown, statusCode: number): string {
    const errorCode = getFunctionErrorCode(payload);
    if (errorCode === 'FortnoxClientError') {
        return 'Faktisk kontering kunde inte hämtas för den här fakturan just nu. Kontrollera fakturan i Fortnox och försök igen.';
    }
    return getFunctionErrorMessage(payload) || `Kunde inte hamta kontering (${statusCode}).`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}

function asPostingTrace(value: unknown): InvoicePostingTrace {
    const record = asRecord(value);
    if (!record) {
        throw new Error('Invalid posting trace response');
    }
    return record as unknown as InvoicePostingTrace;
}

export function parseBooleanEnvFlag(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'on';
}

export function getInvoicePostingReviewEnabled(): boolean {
    return parseBooleanEnvFlag(import.meta.env.VITE_INVOICE_POSTING_REVIEW_ENABLED);
}

export function getCheckBadges(checks: PostingCheckResult): PostingCheckBadge[] {
    const toStatus = (key: keyof PostingCheckResult, value: boolean): CheckStatus => {
        if (value) return 'ok';
        if (key === 'balanced') return 'critical';
        return 'warning';
    };

    return [
        { key: 'balanced', label: 'Balanskontroll', status: toStatus('balanced', checks.balanced) },
        { key: 'total_match', label: 'Totalmatch', status: toStatus('total_match', checks.total_match) },
        { key: 'vat_match', label: 'Momsmatch', status: toStatus('vat_match', checks.vat_match) },
        { key: 'control_account_present', label: 'Kontrollkonto', status: toStatus('control_account_present', checks.control_account_present) },
        { key: 'row_account_consistency', label: 'Kontokonsistens', status: toStatus('row_account_consistency', checks.row_account_consistency) },
    ];
}

export function getHighestIssueSeverity(issues: PostingIssue[]): PostingSeverity {
    if (issues.some((issue) => issue.severity === 'critical')) return 'critical';
    if (issues.some((issue) => issue.severity === 'warning')) return 'warning';
    return 'info';
}

class InvoicePostingReviewService {
    private readonly cache = new Map<string, CacheEntry>();

    private buildCacheKey(companyId: string, invoiceType: InvoicePostingType, invoiceId: string | number): string {
        return `${companyId}:${invoiceType}:${String(invoiceId)}`;
    }

    invalidateCompany(companyId: string): void {
        for (const key of this.cache.keys()) {
            if (key.startsWith(`${companyId}:`)) {
                this.cache.delete(key);
            }
        }
    }

    invalidateInvoice(companyId: string, invoiceType: InvoicePostingType, invoiceId: string | number): void {
        this.cache.delete(this.buildCacheKey(companyId, invoiceType, invoiceId));
    }

    async fetchPostingTrace(params: FetchPostingTraceParams): Promise<InvoicePostingTrace> {
        const cacheKey = this.buildCacheKey(params.companyId, params.invoiceType, params.invoiceId);
        const now = Date.now();
        const cached = this.cache.get(cacheKey);
        if (!params.forceRefresh && cached && cached.expiresAt > now) {
            return cached.value;
        }

        const { data: { session } } = await supabase.auth.getSession();
        const accessToken = session?.access_token;
        if (!accessToken) {
            throw new Error('Du maste vara inloggad for att visa kontering.');
        }

        const response = await fetch(FORTNOX_FUNCTION_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
                action: 'getInvoicePostingTrace',
                companyId: params.companyId,
                payload: {
                    invoiceType: params.invoiceType,
                    invoiceId: params.invoiceId,
                },
            }),
        });

        const body = await response.json().catch(() => null);
        if (!response.ok) {
            const message = getPostingTraceErrorMessage(body, response.status);
            throw new Error(message);
        }

        const trace = asPostingTrace(body);
        this.cache.set(cacheKey, {
            value: trace,
            expiresAt: now + CACHE_TTL_MS,
        });

        logger.debug('invoice-posting-trace cached', {
            cacheKey,
            status: trace.posting?.status,
            source: trace.posting?.source,
            confidence: trace.posting?.confidence,
        });

        return trace;
    }
}

export const invoicePostingReviewService = new InvoicePostingReviewService();

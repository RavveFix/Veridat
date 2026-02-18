/// <reference path="../types/deno.d.ts" />

import { createClient } from "npm:@supabase/supabase-js@2";
import { FortnoxService } from "../../services/FortnoxService.ts";
import { FortnoxInvoice, FortnoxVoucher, FortnoxSupplierInvoice, FortnoxSupplier, FortnoxInvoicePayment, FortnoxSupplierInvoicePayment } from "./types.ts";
import {
    getCorsHeaders,
    createOptionsResponse,
    isOriginAllowed,
    createForbiddenOriginResponse
} from "../../services/CorsService.ts";
import { RateLimiterService } from "../../services/RateLimiterService.ts";
import { createLogger } from "../../services/LoggerService.ts";
import { FortnoxApiError } from "../../services/FortnoxErrors.ts";
import { AuditService, type FortnoxOperation } from "../../services/AuditService.ts";
import { CompanyMemoryService, mergeCompanyMemory } from "../../services/CompanyMemoryService.ts";
import { getUserPlan } from "../../services/PlanService.ts";
import {
    getFortnoxStatusCode,
    shouldPropagatePostingTraceError,
} from "./posting-trace-fallback.ts";
import {
    buildExplicitSingleVoucherCandidate,
    buildSupplierExplicitVoucherCandidates,
    resolveExplicitVoucherMatch,
    resolveReferenceVoucherMatch as resolveReferenceVoucherMatchV2,
    resolveHeuristicVoucherMatch as resolveHeuristicVoucherMatchV2,
    type PostingMatchPath,
} from "./posting-trace-matcher.ts";
import { buildPostingIssues } from "./posting-trace-issues.ts";
import { normalizeCustomerInvoiceListResponse } from "./customer-invoice-normalization.ts";
import {
    buildPostingCorrectionVoucher,
    normalizePostingCorrectionRequest,
    PostingCorrectionValidationError,
} from "./posting-correction.ts";

const logger = createLogger('fortnox');

const JSON_HEADERS = { 'Content-Type': 'application/json' };

const WRITE_ACTIONS_TO_OPERATION: Partial<Record<string, FortnoxOperation>> = {
    createInvoice: 'create_invoice',
    registerInvoicePayment: 'register_invoice_payment',
    exportVoucher: 'export_voucher',
    createPostingCorrectionVoucher: 'export_voucher',
    registerSupplierInvoicePayment: 'register_supplier_invoice_payment',
    exportSupplierInvoice: 'export_supplier_invoice',
    bookSupplierInvoice: 'book_supplier_invoice',
    approveSupplierInvoiceBookkeep: 'approve_supplier_invoice_bookkeep',
    approveSupplierInvoicePayment: 'approve_supplier_invoice_payment',
    createSupplier: 'create_supplier',
    findOrCreateSupplier: 'create_supplier',
};

const FAIL_CLOSED_RATE_LIMIT_ACTIONS = new Set<string>([
    ...Object.keys(WRITE_ACTIONS_TO_OPERATION),
    'findOrCreateSupplier',
    'sync_profile',
]);

const ACTIONS_REQUIRING_COMPANY_ID = new Set<string>([
    'createInvoice',
    'getCustomers',
    'getArticles',
    'getInvoices',
    'getInvoice',
    'registerInvoicePayment',
    'getVouchers',
    'getVoucher',
    'exportVoucher',
    'createPostingCorrectionVoucher',
    'getSupplierInvoices',
    'getSupplierInvoice',
    'getInvoicePostingTrace',
    'registerSupplierInvoicePayment',
    'exportSupplierInvoice',
    'bookSupplierInvoice',
    'approveSupplierInvoiceBookkeep',
    'approveSupplierInvoicePayment',
    'getSuppliers',
    'getSupplier',
    'createSupplier',
    'findOrCreateSupplier',
    'sync_profile',
    'getVATReport',
]);

function shouldFailClosedOnRateLimiterError(action: string): boolean {
    return FAIL_CLOSED_RATE_LIMIT_ACTIONS.has(action);
}

class RequestValidationError extends Error {
    code: string;
    status: number;
    details?: Record<string, unknown>;

    constructor(code: string, message: string, details?: Record<string, unknown>, status = 400) {
        super(message);
        this.code = code;
        this.status = status;
        this.details = details;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
    if (!isRecord(value)) {
        throw new RequestValidationError(
            'INVALID_PAYLOAD',
            `Missing or invalid object: ${field}`,
            { field }
        );
    }
    return value;
}

function requireString(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new RequestValidationError(
            'INVALID_PAYLOAD',
            `Missing or invalid string: ${field}`,
            { field }
        );
    }
    return value;
}

function requireNumber(value: unknown, field: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new RequestValidationError(
            'INVALID_PAYLOAD',
            `Missing or invalid number: ${field}`,
            { field }
        );
    }
    return value;
}

function optionalPositiveInt(value: unknown): number | undefined {
    if (value === undefined || value === null) return undefined;
    const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
        throw new RequestValidationError(
            'INVALID_PAGINATION',
            'Pagination values must be positive integers',
            { value }
        );
    }
    return parsed;
}

function parsePagination(payload: Record<string, unknown> | undefined): {
    page?: number;
    limit?: number;
    allPages?: boolean;
} {
    if (!payload) return {};
    const page = optionalPositiveInt(payload.page);
    const limit = optionalPositiveInt(payload.limit);
    const allPages = typeof payload.allPages === 'boolean' ? payload.allPages : undefined;
    return { page, limit, allPages };
}

type InvoiceType = 'supplier' | 'customer';
type PostingSource = 'explicit' | 'heuristic' | 'none';
type PostingStatus = 'booked' | 'unbooked' | 'unknown';
type PostingIssueSeverity = 'info' | 'warning' | 'critical';

interface PostingRow {
    account: number;
    debit: number;
    credit: number;
    description: string;
}

interface PostingTotals {
    debit: number;
    credit: number;
    balanced: boolean;
}

interface PostingCheckResult {
    balanced: boolean;
    total_match: boolean;
    vat_match: boolean;
    control_account_present: boolean;
    row_account_consistency: boolean;
}

interface PostingIssue {
    code: string;
    severity: PostingIssueSeverity;
    message: string;
    suggestion: string;
}

interface VoucherRef {
    series: string;
    number: number;
    year?: number;
}

interface ReferenceEvidence {
    referenceType?: string;
    referenceNumber?: string;
}

interface NormalizedInvoiceTrace {
    type: InvoiceType;
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
}

interface InvoicePostingTraceResponse {
    invoice: NormalizedInvoiceTrace;
    expectedPosting: {
        rows: PostingRow[];
        totals: PostingTotals;
    };
    posting: {
        status: PostingStatus;
        source: PostingSource;
        confidence: number;
        voucherRef: VoucherRef | null;
        matchPath?: PostingMatchPath;
        referenceEvidence?: ReferenceEvidence;
        rows: PostingRow[];
        totals: PostingTotals;
    };
    checks: PostingCheckResult;
    issues: PostingIssue[];
}

interface VoucherMatchResult {
    score: number;
    voucherRef: VoucherRef;
    rows: PostingRow[];
    totals: PostingTotals;
    transactionDate: string;
    referenceEvidence?: ReferenceEvidence;
    referenceScore?: number;
    acceptedByReference?: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function toText(value: unknown): string {
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return '';
}

function toNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const normalized = value.replace(/\s+/g, '').replace(',', '.');
        if (!normalized) return null;
        const parsed = Number(normalized);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function toInteger(value: unknown): number | null {
    const parsed = toNumber(value);
    if (parsed === null) return null;
    const rounded = Math.round(parsed);
    return Number.isFinite(rounded) ? rounded : null;
}

function roundMoney(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}

function moneyEquals(a: number, b: number, tolerance = 0.5): boolean {
    return Math.abs(roundMoney(a - b)) <= tolerance;
}

function parseDate(value: string): number | null {
    if (!value) return null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
}

function normalizePostingRows(rows: unknown[]): PostingRow[] {
    const normalized: PostingRow[] = [];
    for (const row of rows) {
        const record = asRecord(row);
        if (!record) continue;
        const accountRaw = record.Account ?? record.account;
        const account = toInteger(accountRaw);
        if (account === null) continue;
        const debit = roundMoney(toNumber(record.Debit ?? record.debit) ?? 0);
        const credit = roundMoney(toNumber(record.Credit ?? record.credit) ?? 0);
        if (debit === 0 && credit === 0) continue;
        const description = toText(
            record.TransactionInformation
                ?? record.Description
                ?? record.description
                ?? ''
        );
        normalized.push({
            account,
            debit,
            credit,
            description,
        });
    }
    return normalized;
}

function buildPostingTotals(rows: PostingRow[]): PostingTotals {
    const debit = roundMoney(rows.reduce((sum, row) => sum + row.debit, 0));
    const credit = roundMoney(rows.reduce((sum, row) => sum + row.credit, 0));
    return {
        debit,
        credit,
        balanced: moneyEquals(debit, credit, 0.01),
    };
}

function getValueFromKeys(record: Record<string, unknown>, keys: string[]): unknown {
    for (const key of keys) {
        if (key in record) {
            return record[key];
        }
    }
    return undefined;
}

function normalizeInvoiceType(value: unknown): InvoiceType {
    const normalized = toText(value).toLowerCase();
    if (normalized === 'supplier' || normalized === 'customer') {
        return normalized;
    }
    throw new RequestValidationError(
        'INVALID_PAYLOAD',
        'payload.invoiceType måste vara supplier eller customer',
        { field: 'payload.invoiceType' }
    );
}

function normalizeInvoiceId(invoiceId: unknown): number {
    const parsed = toInteger(invoiceId);
    if (parsed === null || parsed < 1) {
        throw new RequestValidationError(
            'INVALID_PAYLOAD',
            'payload.invoiceId måste vara ett positivt nummer',
            { field: 'payload.invoiceId' }
        );
    }
    return parsed;
}

function inferVatRate(vat: number, net: number): number {
    if (vat <= 0 || net <= 0) return 25;
    const ratio = Math.round((vat / net) * 100);
    if (Math.abs(ratio - 25) <= 2) return 25;
    if (Math.abs(ratio - 12) <= 2) return 12;
    if (Math.abs(ratio - 6) <= 2) return 6;
    return 25;
}

function getVatAccountByRate(rate: number): number {
    if (rate <= 7) return 2631;
    if (rate <= 13) return 2621;
    return 2611;
}

function extractNumeric(
    record: Record<string, unknown>,
    keys: string[],
    fallback = 0
): number {
    const value = getValueFromKeys(record, keys);
    return roundMoney(toNumber(value) ?? fallback);
}

function buildExpectedSupplierPosting(invoiceRecord: Record<string, unknown>, normalized: NormalizedInvoiceTrace): PostingRow[] {
    const rowsRaw = asArray(invoiceRecord.SupplierInvoiceRows);
    const rows = normalizePostingRows(rowsRaw.map((row) => {
        const rec = asRecord(row);
        if (!rec) return row;
        return {
            Account: rec.Account,
            Debit: rec.Debit,
            Credit: rec.Credit,
            Description: rec.TransactionInformation ?? rec.Description ?? normalized.counterpartyName,
        };
    }));

    const expectedRows: PostingRow[] = [...rows];
    const total = normalized.total;
    const vat = normalized.vat > 0 ? normalized.vat : 0;
    const net = roundMoney(Math.max(total - vat, 0));

    if (expectedRows.length === 0) {
        const firstAccount = toInteger(getValueFromKeys(invoiceRecord, ['Account', 'CostAccount'])) ?? 6540;
        if (net > 0) {
            expectedRows.push({
                account: firstAccount,
                debit: net,
                credit: 0,
                description: normalized.counterpartyName || 'Kostnad',
            });
        }
        if (vat > 0) {
            expectedRows.push({
                account: 2641,
                debit: vat,
                credit: 0,
                description: 'Ingaende moms',
            });
        }
    }

    const hasControlAccount = expectedRows.some((row) => row.account === 2440);
    const totalsBeforeControl = buildPostingTotals(expectedRows);
    if (!hasControlAccount || !totalsBeforeControl.balanced) {
        const diff = roundMoney(totalsBeforeControl.debit - totalsBeforeControl.credit);
        if (Math.abs(diff) > 0.01) {
            expectedRows.push({
                account: 2440,
                debit: diff < 0 ? Math.abs(diff) : 0,
                credit: diff > 0 ? diff : 0,
                description: normalized.counterpartyName || 'Leverantorsskuld',
            });
        } else if (!hasControlAccount && total > 0) {
            expectedRows.push({
                account: 2440,
                debit: 0,
                credit: total,
                description: normalized.counterpartyName || 'Leverantorsskuld',
            });
        }
    }

    return expectedRows;
}

function buildExpectedCustomerPosting(invoiceRecord: Record<string, unknown>, normalized: NormalizedInvoiceTrace): PostingRow[] {
    const invoiceRows = asArray(invoiceRecord.InvoiceRows);
    const revenueByAccount = new Map<number, number>();
    const total = normalized.total;
    const vat = normalized.vat > 0 ? normalized.vat : 0;
    const net = roundMoney(Math.max(total - vat, 0));

    for (const row of invoiceRows) {
        const rec = asRecord(row);
        if (!rec) continue;
        const account = toInteger(rec.AccountNumber ?? rec.Account);
        if (account === null) continue;
        const explicitTotal = toNumber(rec.Total);
        const price = toNumber(rec.Price) ?? 0;
        const quantity = toNumber(rec.DeliveredQuantity) ?? 1;
        const rowTotal = roundMoney(explicitTotal ?? (price * quantity));
        if (rowTotal <= 0) continue;
        revenueByAccount.set(account, roundMoney((revenueByAccount.get(account) ?? 0) + rowTotal));
    }

    if (revenueByAccount.size === 0 && net > 0) {
        revenueByAccount.set(3001, net);
    }

    const assignedNet = roundMoney(Array.from(revenueByAccount.values()).reduce((sum, value) => sum + value, 0));
    if (Math.abs(net - assignedNet) > 0.5) {
        const fallbackAccount = revenueByAccount.keys().next().value as number | undefined;
        const targetAccount = fallbackAccount ?? 3001;
        revenueByAccount.set(targetAccount, roundMoney((revenueByAccount.get(targetAccount) ?? 0) + (net - assignedNet)));
    }

    const rows: PostingRow[] = [];
    for (const [account, amount] of revenueByAccount.entries()) {
        if (amount <= 0) continue;
        rows.push({
            account,
            debit: 0,
            credit: roundMoney(amount),
            description: normalized.counterpartyName || 'Forsaljning',
        });
    }

    if (vat > 0) {
        const vatRate = inferVatRate(vat, net);
        rows.push({
            account: getVatAccountByRate(vatRate),
            debit: 0,
            credit: vat,
            description: `Utgaende moms ${vatRate}%`,
        });
    }

    const controlAccount = normalized.balance <= 0 ? 1930 : 1510;
    rows.unshift({
        account: controlAccount,
        debit: total,
        credit: 0,
        description: controlAccount === 1930 ? 'Bank' : 'Kundfordran',
    });

    return rows;
}

function extractVatAmountFromPostingRows(rows: PostingRow[]): number {
    let vatTotal = 0;
    for (const row of rows) {
        const accountCode = String(row.account);
        if (!/^26(1|2|3|4)/.test(accountCode)) continue;
        const rowAmount = Math.abs(row.credit > 0 ? row.credit : row.debit);
        vatTotal += rowAmount;
    }
    return roundMoney(vatTotal);
}

function calculateOverlapScore(expectedRows: PostingRow[], candidateRows: PostingRow[]): number {
    const expectedAccounts = new Set(
        expectedRows
            .map((row) => row.account)
            .filter((account) => account !== 2440 && account !== 1510 && account !== 1930)
    );
    if (expectedAccounts.size === 0) return 0.5;
    const candidateAccounts = new Set(candidateRows.map((row) => row.account));
    let overlap = 0;
    for (const account of expectedAccounts) {
        if (candidateAccounts.has(account)) {
            overlap += 1;
        }
    }
    return overlap / expectedAccounts.size;
}

function hasControlAccount(rows: PostingRow[], invoiceType: InvoiceType): boolean {
    const accountSet = new Set(rows.map((row) => row.account));
    if (invoiceType === 'supplier') {
        return accountSet.has(2440);
    }
    return accountSet.has(1510) || accountSet.has(1930);
}

function normalizeInvoiceTrace(
    invoiceType: InvoiceType,
    invoiceId: number,
    invoiceRecord: Record<string, unknown>
): NormalizedInvoiceTrace {
    const total = extractNumeric(invoiceRecord, ['Total', 'TotalAmount', 'Gross']);
    const vat = extractNumeric(invoiceRecord, ['VAT', 'TotalVAT', 'VatAmount']);
    const balance = extractNumeric(invoiceRecord, ['Balance'], 0);
    const bookedValue = getValueFromKeys(invoiceRecord, ['Booked']);
    const booked = typeof bookedValue === 'boolean' ? bookedValue : null;

    const invoiceNumberRaw = getValueFromKeys(invoiceRecord, ['InvoiceNumber', 'DocumentNumber', 'GivenNumber']);
    const counterpartyNumber = toText(getValueFromKeys(invoiceRecord, [
        invoiceType === 'supplier' ? 'SupplierNumber' : 'CustomerNumber',
    ]));
    const counterpartyName = toText(getValueFromKeys(invoiceRecord, [
        invoiceType === 'supplier' ? 'SupplierName' : 'CustomerName',
    ]));

    return {
        type: invoiceType,
        id: String(invoiceId),
        invoiceNumber: toText(invoiceNumberRaw) || String(invoiceId),
        counterpartyNumber,
        counterpartyName,
        invoiceDate: toText(getValueFromKeys(invoiceRecord, ['InvoiceDate', 'TransactionDate'])),
        dueDate: toText(getValueFromKeys(invoiceRecord, ['DueDate', 'FinalPayDate'])),
        total,
        vat,
        balance,
        currency: toText(getValueFromKeys(invoiceRecord, ['Currency'])) || 'SEK',
        booked,
    };
}

function buildPostingChecks(
    invoiceType: InvoiceType,
    invoice: NormalizedInvoiceTrace,
    expectedRows: PostingRow[],
    actualRows: PostingRow[]
): PostingCheckResult {
    const baselineRows = actualRows.length > 0 ? actualRows : expectedRows;
    const totals = buildPostingTotals(baselineRows);
    const vatInPosting = extractVatAmountFromPostingRows(baselineRows);
    const totalForComparison = Math.max(totals.debit, totals.credit);

    const rowConsistency = actualRows.length === 0
        ? true
        : calculateOverlapScore(expectedRows, actualRows) >= 0.5;

    return {
        balanced: totals.balanced,
        total_match: invoice.total > 0 ? moneyEquals(totalForComparison, invoice.total, 0.5) : true,
        vat_match: invoice.vat > 0 ? moneyEquals(vatInPosting, invoice.vat, 0.5) : true,
        control_account_present: hasControlAccount(baselineRows, invoiceType),
        row_account_consistency: rowConsistency,
    };
}

async function resolveHeuristicVoucherMatch(
    fortnoxService: FortnoxService,
    invoiceType: InvoiceType,
    invoice: NormalizedInvoiceTrace,
    expectedRows: PostingRow[],
    invoiceRecord: Record<string, unknown>
): Promise<{ match: VoucherMatchResult | null; diagnostics: Record<string, unknown> }> {
    const result = await resolveHeuristicVoucherMatchV2({
        fortnoxService,
        invoiceType,
        invoice: {
            id: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            invoiceDate: invoice.invoiceDate,
            dueDate: invoice.dueDate,
            total: invoice.total,
            booked: invoice.booked,
        },
        expectedRows,
        invoiceRecord,
        logger,
        runtimeBudgetMs: 5000,
        detailConcurrency: 6,
        maxDetailFetches: 80,
        dateWindowDaysForBooked: 180,
    });

    return {
        match: result.match,
        diagnostics: {
            candidateCount: result.diagnostics.candidateCount,
            referenceCandidateCount: result.diagnostics.referenceCandidateCount,
            filteredCandidateCount: result.diagnostics.filteredCandidateCount,
            detailFetchCount: result.diagnostics.detailFetchCount,
            bestScore: result.diagnostics.bestScore,
            bestReferenceScore: result.diagnostics.bestReferenceScore,
            elapsedMs: result.diagnostics.elapsedMs,
            timedOut: result.diagnostics.timedOut,
            usedListFallback: result.diagnostics.usedListFallback,
            usedDetailFallback: result.diagnostics.usedDetailFallback,
            yearsSearched: result.diagnostics.yearsSearched,
        },
    };
}

async function resolveReferenceVoucherMatch(
    fortnoxService: FortnoxService,
    invoiceType: InvoiceType,
    invoice: NormalizedInvoiceTrace,
    expectedRows: PostingRow[],
    invoiceRecord: Record<string, unknown>
): Promise<{ match: VoucherMatchResult | null; diagnostics: Record<string, unknown> }> {
    const result = await resolveReferenceVoucherMatchV2({
        fortnoxService,
        invoiceType,
        invoice: {
            id: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            invoiceDate: invoice.invoiceDate,
            dueDate: invoice.dueDate,
            total: invoice.total,
            booked: invoice.booked,
        },
        expectedRows,
        invoiceRecord,
        logger,
        runtimeBudgetMs: 5000,
        detailConcurrency: 6,
        maxDetailFetches: 80,
        dateWindowDaysForBooked: 180,
    });

    return {
        match: result.match,
        diagnostics: {
            candidateCount: result.diagnostics.candidateCount,
            referenceCandidateCount: result.diagnostics.referenceCandidateCount,
            filteredCandidateCount: result.diagnostics.filteredCandidateCount,
            detailFetchCount: result.diagnostics.detailFetchCount,
            bestScore: result.diagnostics.bestScore,
            bestReferenceScore: result.diagnostics.bestReferenceScore,
            elapsedMs: result.diagnostics.elapsedMs,
            timedOut: result.diagnostics.timedOut,
            usedListFallback: result.diagnostics.usedListFallback,
            usedDetailFallback: result.diagnostics.usedDetailFallback,
            yearsSearched: result.diagnostics.yearsSearched,
        },
    };
}

async function buildInvoicePostingTrace(
    fortnoxService: FortnoxService,
    invoiceType: InvoiceType,
    invoiceId: number
): Promise<InvoicePostingTraceResponse> {
    const traceStartedAt = Date.now();
    const invoiceRecord = invoiceType === 'supplier'
        ? asRecord((await fortnoxService.getSupplierInvoice(invoiceId)).SupplierInvoice) ?? {}
        : asRecord((await fortnoxService.getInvoice(invoiceId)).Invoice) ?? {};

    const normalizedInvoice = normalizeInvoiceTrace(invoiceType, invoiceId, invoiceRecord);
    const expectedRows = invoiceType === 'supplier'
        ? buildExpectedSupplierPosting(invoiceRecord, normalizedInvoice)
        : buildExpectedCustomerPosting(invoiceRecord, normalizedInvoice);
    const expectedTotals = buildPostingTotals(expectedRows);

    let postingRows: PostingRow[] = [];
    let postingTotals: PostingTotals = { debit: 0, credit: 0, balanced: true };
    let postingStatus: PostingStatus = normalizedInvoice.booked === true
        ? 'booked'
        : normalizedInvoice.booked === false
            ? 'unbooked'
            : 'unknown';
    let postingSource: PostingSource = 'none';
    let confidence = 0;
    let voucherRef: VoucherRef | null = null;
    let matchPath: PostingMatchPath = 'none';
    let referenceEvidence: ReferenceEvidence | undefined;
    let searchDiagnostics: Record<string, unknown> | null = null;

    const applyMatch = (
        match: VoucherMatchResult,
        source: PostingSource,
        selectedPath: PostingMatchPath,
        confidenceFloor = 0
    ) => {
        postingRows = match.rows;
        postingTotals = match.totals;
        postingSource = source;
        confidence = Math.max(match.score, confidenceFloor);
        voucherRef = match.voucherRef;
        matchPath = selectedPath;
        referenceEvidence = match.referenceEvidence;
    };

    const supplierExplicitCandidates = invoiceType === 'supplier'
        ? buildSupplierExplicitVoucherCandidates(invoiceRecord)
        : [];
    const explicitSingleCandidate = buildExplicitSingleVoucherCandidate(invoiceRecord);
    const explicitRefFound = supplierExplicitCandidates.length > 0 || explicitSingleCandidate !== null;

    if (postingRows.length === 0 && supplierExplicitCandidates.length > 0) {
        try {
            const explicitVouchersMatch = await resolveExplicitVoucherMatch({
                fortnoxService,
                invoiceType,
                invoice: {
                    id: normalizedInvoice.id,
                    invoiceNumber: normalizedInvoice.invoiceNumber,
                    invoiceDate: normalizedInvoice.invoiceDate,
                    dueDate: normalizedInvoice.dueDate,
                    total: normalizedInvoice.total,
                    booked: normalizedInvoice.booked,
                },
                expectedRows,
                invoiceRecord,
                candidates: supplierExplicitCandidates,
                logger,
            });
            if (explicitVouchersMatch && explicitVouchersMatch.rows.length > 0) {
                applyMatch(explicitVouchersMatch, 'explicit', 'explicit_vouchers', 0.98);
            }
        } catch (error) {
            logger.warn('Explicit supplier vouchers lookup failed for posting trace', {
                invoiceType,
                invoiceId,
                candidateCount: supplierExplicitCandidates.length,
                fortnoxStatusCode: getFortnoxStatusCode(error),
            });
            if (shouldPropagatePostingTraceError(error)) {
                throw error;
            }
        }
    }

    if (postingRows.length === 0 && explicitSingleCandidate) {
        try {
            const explicitSingleMatch = await resolveExplicitVoucherMatch({
                fortnoxService,
                invoiceType,
                invoice: {
                    id: normalizedInvoice.id,
                    invoiceNumber: normalizedInvoice.invoiceNumber,
                    invoiceDate: normalizedInvoice.invoiceDate,
                    dueDate: normalizedInvoice.dueDate,
                    total: normalizedInvoice.total,
                    booked: normalizedInvoice.booked,
                },
                expectedRows,
                invoiceRecord,
                candidates: [explicitSingleCandidate],
                logger,
            });
            if (explicitSingleMatch && explicitSingleMatch.rows.length > 0) {
                applyMatch(explicitSingleMatch, 'explicit', 'explicit_single', 0.98);
            }
        } catch (error) {
            logger.warn('Explicit single voucher lookup failed for posting trace', {
                invoiceType,
                invoiceId,
                voucherSeries: explicitSingleCandidate.series,
                voucherNumber: explicitSingleCandidate.number,
                voucherYear: explicitSingleCandidate.year,
                fortnoxStatusCode: getFortnoxStatusCode(error),
            });
            if (shouldPropagatePostingTraceError(error)) {
                throw error;
            }
        }
    }

    if (postingRows.length === 0 && normalizedInvoice.booked === true) {
        try {
            const referenceResult = await resolveReferenceVoucherMatch(
                fortnoxService,
                invoiceType,
                normalizedInvoice,
                expectedRows,
                invoiceRecord
            );
            searchDiagnostics = referenceResult.diagnostics;
            const referenceMatch = referenceResult.match;
            if (referenceMatch && (referenceMatch.score >= 0.45 || referenceMatch.acceptedByReference === true)) {
                const floor = referenceMatch.acceptedByReference === true ? 0.9 : 0;
                applyMatch(referenceMatch, 'explicit', 'reference', floor);
            } else {
                postingSource = 'none';
                confidence = referenceMatch?.score
                    ?? (typeof referenceResult.diagnostics.bestScore === 'number'
                        ? referenceResult.diagnostics.bestScore
                        : 0);
            }
        } catch (error) {
            logger.warn('Reference voucher lookup failed for posting trace', {
                invoiceType,
                invoiceId,
                fortnoxStatusCode: getFortnoxStatusCode(error),
            });
            if (shouldPropagatePostingTraceError(error)) {
                throw error;
            }
        }
    }

    if (postingRows.length === 0 && normalizedInvoice.booked === true) {
        try {
            const heuristicResult = await resolveHeuristicVoucherMatch(
                fortnoxService,
                invoiceType,
                normalizedInvoice,
                expectedRows,
                invoiceRecord
            );
            searchDiagnostics = heuristicResult.diagnostics;
            const heuristicMatch = heuristicResult.match;
            if (heuristicMatch && (heuristicMatch.score >= 0.6 || heuristicMatch.acceptedByReference === true)) {
                const confidenceFloor = heuristicMatch.acceptedByReference === true ? 0.82 : 0;
                applyMatch(heuristicMatch, 'heuristic', 'heuristic', confidenceFloor);
            } else {
                postingSource = 'none';
                confidence = heuristicMatch?.score
                    ?? (typeof heuristicResult.diagnostics.bestScore === 'number'
                        ? heuristicResult.diagnostics.bestScore
                        : 0);
                if (heuristicMatch && heuristicMatch.score >= 0.45 && heuristicMatch.score < 0.6) {
                    logger.warn('Heuristic voucher match below acceptance threshold', {
                        invoiceType,
                        invoiceId,
                        bestScore: heuristicMatch.score,
                        acceptanceThreshold: 0.6,
                    });
                }
            }
        } catch (error) {
            logger.warn('Heuristic voucher lookup failed for posting trace', {
                invoiceType,
                invoiceId,
                fortnoxStatusCode: getFortnoxStatusCode(error),
            });
            if (shouldPropagatePostingTraceError(error)) {
                throw error;
            }
            postingSource = 'none';
            confidence = 0;
        }
    }

    const checks = buildPostingChecks(invoiceType, normalizedInvoice, expectedRows, postingRows);
    const issues = buildPostingIssues(invoiceType, normalizedInvoice, checks, postingStatus, postingSource, confidence);
    const elapsedMs = Date.now() - traceStartedAt;

    logger.info('Invoice posting trace resolved', {
        invoiceType,
        invoiceId,
        booked: normalizedInvoice.booked,
        explicitRefFound,
        matchPath,
        referenceType: referenceEvidence?.referenceType ?? null,
        candidateCount: searchDiagnostics?.candidateCount ?? 0,
        referenceCandidateCount: searchDiagnostics?.referenceCandidateCount ?? 0,
        filteredCandidateCount: searchDiagnostics?.filteredCandidateCount ?? 0,
        detailFetchCount: searchDiagnostics?.detailFetchCount ?? 0,
        bestScore: searchDiagnostics?.bestScore ?? confidence,
        bestReferenceScore: searchDiagnostics?.bestReferenceScore ?? (typeof confidence === 'number' ? confidence : 0),
        selectedSource: postingSource,
        usedListFallback: searchDiagnostics?.usedListFallback ?? false,
        usedDetailFallback: searchDiagnostics?.usedDetailFallback ?? false,
        timedOut: searchDiagnostics?.timedOut ?? false,
        elapsedMs,
    });

    return {
        invoice: normalizedInvoice,
        expectedPosting: {
            rows: expectedRows,
            totals: expectedTotals,
        },
        posting: {
            status: postingStatus,
            source: postingSource,
            confidence: roundMoney(confidence),
            voucherRef,
            matchPath,
            referenceEvidence,
            rows: postingRows,
            totals: postingTotals,
        },
        checks,
        issues,
    };
}

function getClientMetadata(req: Request): { ipAddress?: string; userAgent?: string } {
    const forwardedFor = req.headers.get('x-forwarded-for') || req.headers.get('X-Forwarded-For');
    const realIp = req.headers.get('x-real-ip') || req.headers.get('X-Real-IP');
    const ipAddressRaw = forwardedFor?.split(',')[0]?.trim() || realIp || undefined;
    const userAgent = req.headers.get('user-agent') || req.headers.get('User-Agent') || undefined;
    return {
        ipAddress: ipAddressRaw || undefined,
        userAgent,
    };
}

function getWriteRequestMetadata(
    actionName: string,
    requestPayload: Record<string, unknown> | undefined
): { idempotencyKey: string; sourceContext: string; aiDecisionId?: string } {
    const payloadRecord = requireRecord(requestPayload, 'payload');
    const idempotencyKey = requireString(payloadRecord.idempotencyKey, 'payload.idempotencyKey').trim();
    if (idempotencyKey.length < 8) {
        throw new RequestValidationError(
            'INVALID_PAYLOAD',
            'payload.idempotencyKey måste vara minst 8 tecken',
            { action: actionName, field: 'payload.idempotencyKey' }
        );
    }
    const sourceContext = requireString(payloadRecord.sourceContext, 'payload.sourceContext').trim();
    const aiDecisionId = typeof payloadRecord.aiDecisionId === 'string' && payloadRecord.aiDecisionId.trim().length > 0
        ? payloadRecord.aiDecisionId.trim()
        : undefined;

    return { idempotencyKey, sourceContext, aiDecisionId };
}

function requireCompanyId(action: string, companyId: string | undefined): string {
    if (companyId && companyId.trim().length > 0) {
        return companyId.trim();
    }
    throw new RequestValidationError(
        'MISSING_COMPANY_ID',
        'Missing required field: companyId',
        { action, field: 'companyId' }
    );
}

function requireCompanyIdForWrite(action: string, companyId: string | undefined): string {
    return requireCompanyId(action, companyId);
}

function validationResponse(
    corsHeaders: Record<string, string>,
    error: RequestValidationError
): Response {
    return new Response(
        JSON.stringify({
            error: error.message,
            errorCode: error.code,
            details: error.details ?? null,
        }),
        {
            status: error.status,
            headers: { ...corsHeaders, ...JSON_HEADERS },
        }
    );
}

Deno.serve(async (req: Request) => {
    const requestOrigin = req.headers.get('origin') || req.headers.get('Origin');
    const corsHeaders = getCorsHeaders(requestOrigin);

    // Handle CORS preflight request
    if (req.method === 'OPTIONS') {
        return createOptionsResponse(req);
    }

    if (requestOrigin && !isOriginAllowed(requestOrigin)) {
        return createForbiddenOriginResponse(requestOrigin);
    }

    try {
        if (req.method !== 'POST') {
            return new Response(
                JSON.stringify({ error: 'Method not allowed' }),
                { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
        if (!authHeader) {
            return new Response(
                JSON.stringify({ error: 'Unauthorized' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

        if (!supabaseUrl || !supabaseServiceKey) {
            return new Response(
                JSON.stringify({ error: 'Server configuration error' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const token = authHeader.replace(/^Bearer\s+/i, '');

        // Verify token and rate limit using service role client
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
        const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
        if (userError || !user) {
            return new Response(
                JSON.stringify({ error: 'Unauthorized' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const userId = user.id;
        const plan = await getUserPlan(supabaseAdmin, userId);
        if (plan === 'free') {
            return new Response(
                JSON.stringify({
                    error: 'plan_required',
                    errorCode: 'PLAN_REQUIRED',
                    message: 'Fortnox kräver Veridat Pro eller Trial.'
                }),
                { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Parse request body early so we can fail closed for state-changing actions
        // if the rate limiter backend is unavailable.
        const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
        const action = typeof body['action'] === 'string' ? body['action'] : '';
        const payload = isRecord(body['payload']) ? body['payload'] : undefined;
        const companyId = typeof body['companyId'] === 'string' && body['companyId'].trim().length > 0
            ? body['companyId'].trim()
            : undefined;
        const resolvedCompanyId = ACTIONS_REQUIRING_COMPANY_ID.has(action)
            ? requireCompanyId(action, companyId)
            : undefined;

        if (resolvedCompanyId) {
            const { data: companyRow, error: companyError } = await supabaseAdmin
                .from('companies')
                .select('id')
                .eq('user_id', userId)
                .eq('id', resolvedCompanyId)
                .maybeSingle();

            if (companyError || !companyRow) {
                throw new RequestValidationError(
                    'INVALID_COMPANY_ID',
                    'Invalid companyId for current user',
                    { action, field: 'companyId' }
                );
            }
        }

        const isLocal = supabaseUrl.includes('127.0.0.1') || supabaseUrl.includes('localhost');
        const rateLimiter = new RateLimiterService(
            supabaseAdmin,
            isLocal
                ? { requestsPerHour: 1000, requestsPerDay: 10000 }
                : { requestsPerHour: 200, requestsPerDay: 2000 }
        );
        try {
            const rateLimit = await rateLimiter.checkAndIncrement(userId, 'fortnox');
            if (!rateLimit.allowed) {
                return new Response(
                    JSON.stringify({
                        error: 'rate_limit_exceeded',
                        message: rateLimit.message,
                        remaining: rateLimit.remaining,
                        resetAt: rateLimit.resetAt.toISOString()
                    }),
                    {
                        status: 429,
                        headers: {
                            ...corsHeaders,
                            'Content-Type': 'application/json',
                            'X-RateLimit-Remaining': String(rateLimit.remaining),
                            'X-RateLimit-Reset': rateLimit.resetAt.toISOString()
                        }
                    }
                );
            }
        } catch (rateLimitErr) {
            if (shouldFailClosedOnRateLimiterError(action)) {
                logger.error('Rate limiter unavailable for state-changing Fortnox action', {
                    action,
                    error: rateLimitErr instanceof Error ? rateLimitErr.message : String(rateLimitErr),
                });
                return new Response(
                    JSON.stringify({
                        error: 'rate_limiter_unavailable',
                        message: 'Rate limiting är tillfälligt otillgänglig. Försök igen om en stund.',
                        action,
                    }),
                    {
                        status: 503,
                        headers: {
                            ...corsHeaders,
                            'Content-Type': 'application/json',
                            'Retry-After': '60',
                        },
                    }
                );
            }
            logger.error('Rate limiter unavailable for read-only Fortnox action (continuing)', {
                action,
                error: rateLimitErr instanceof Error ? rateLimitErr.message : String(rateLimitErr),
            });
        }

        // Create Supabase client (service role) to access Fortnox tokens table
        const supabaseClient = createClient(supabaseUrl, supabaseServiceKey);

        // Initialize services
        const fortnoxConfig = {
            clientId: Deno.env.get('FORTNOX_CLIENT_ID') ?? '',
            clientSecret: Deno.env.get('FORTNOX_CLIENT_SECRET') ?? '',
            redirectUri: '', // Not needed for refresh flow
        };

        const fortnoxService = resolvedCompanyId
            ? new FortnoxService(fortnoxConfig, supabaseClient, userId, resolvedCompanyId)
            : null;
        const requireFortnoxService = (): FortnoxService => {
            if (!fortnoxService) {
                throw new RequestValidationError(
                    'MISSING_COMPANY_ID',
                    'Missing required field: companyId',
                    { action, field: 'companyId' }
                );
            }
            return fortnoxService;
        };
        const auditService = new AuditService(supabaseClient);

        const requestMeta = getClientMetadata(req);

        let result;
        let syncId: string | undefined;

        logger.info('Fortnox action requested', { userId, action });

        const prepareWriteAction = async (
            operation: FortnoxOperation,
            requestPayload: Record<string, unknown>,
            actionName: string,
            options?: {
                companyId?: string;
                vatReportId?: string;
                transactionId?: string;
                aiDecisionId?: string;
            }
        ): Promise<{
            companyId: string;
            idempotencyKey: string;
            syncId?: string;
            cachedResult?: Record<string, unknown>;
        }> => {
            const resolvedCompanyId = requireCompanyIdForWrite(actionName, options?.companyId ?? companyId);
            const writeMeta = getWriteRequestMetadata(actionName, payload);
            const idempotencyKey = writeMeta.idempotencyKey;
            const tracedRequestPayload = {
                ...requestPayload,
                sourceContext: writeMeta.sourceContext,
            };

            const existing = await auditService.findIdempotentFortnoxSync(
                userId,
                resolvedCompanyId,
                operation,
                idempotencyKey
            );

            if (existing) {
                if (existing.status === 'success') {
                    return {
                        companyId: resolvedCompanyId,
                        idempotencyKey,
                        cachedResult: existing.responsePayload ?? {
                            idempotent: true,
                            operation,
                        },
                    };
                }
                throw new RequestValidationError(
                    'IDEMPOTENCY_IN_PROGRESS',
                    `Action is already ${existing.status} for this idempotency key`,
                    { action: actionName, operation, idempotencyKey, status: existing.status },
                    409
                );
            }

            const startedSyncId = await auditService.startFortnoxSync({
                userId,
                companyId: resolvedCompanyId,
                operation,
                actionName,
                idempotencyKey,
                vatReportId: options?.vatReportId,
                transactionId: options?.transactionId,
                aiDecisionId: options?.aiDecisionId ?? writeMeta.aiDecisionId,
                requestPayload: tracedRequestPayload,
                ipAddress: requestMeta.ipAddress,
                userAgent: requestMeta.userAgent,
            });

            if (!startedSyncId) {
                throw new Error('Could not start Fortnox sync log');
            }

            await auditService.updateFortnoxSyncInProgress(startedSyncId);

            return {
                companyId: resolvedCompanyId,
                idempotencyKey,
                syncId: startedSyncId,
            };
        };

        switch (action) {
            // ================================================================
            // EXISTING ACTIONS
            // ================================================================
            case 'createInvoice': {
                const invoiceData = requireRecord(
                    isRecord(payload?.invoice) ? payload.invoice : payload,
                    'payload'
                );
                requireString(invoiceData.CustomerNumber, 'payload.CustomerNumber');
                if (!Array.isArray(invoiceData.InvoiceRows) || invoiceData.InvoiceRows.length === 0) {
                    throw new RequestValidationError(
                        'INVALID_PAYLOAD',
                        'Missing or invalid array: payload.InvoiceRows',
                        { field: 'payload.InvoiceRows' }
                    );
                }

                const write = await prepareWriteAction(
                    'create_invoice',
                    { invoice: invoiceData },
                    action
                );
                if (write.cachedResult) {
                    result = write.cachedResult;
                    break;
                }

                syncId = write.syncId;
                try {
                    result = await requireFortnoxService().createInvoiceDraft(invoiceData as unknown as FortnoxInvoice);
                    await auditService.completeFortnoxSync(syncId!, {
                        fortnoxDocumentNumber: String((result as { Invoice?: { InvoiceNumber?: number } }).Invoice?.InvoiceNumber ?? ''),
                        responsePayload: result as unknown as Record<string, unknown>,
                    }, requestMeta);
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    if (syncId) {
                        await auditService.failFortnoxSync(syncId!, 'CREATE_INVOICE_ERROR', errorMessage, undefined, requestMeta);
                    }
                    throw error;
                }
                break;
            }

            case 'getCustomers':
                result = await requireFortnoxService().getCustomers();
                break;

            case 'getArticles':
                result = await requireFortnoxService().getArticles();
                break;

            case 'getInvoices': {
                const fromDate = payload?.fromDate as string | undefined;
                const toDate = payload?.toDate as string | undefined;
                const customerNumber = payload?.customerNumber as string | undefined;
                const pagination = parsePagination(payload);
                const invoicesResponse = await requireFortnoxService().getInvoices({
                    fromDate,
                    toDate,
                    customerNumber,
                    ...pagination,
                });
                const normalized = normalizeCustomerInvoiceListResponse(invoicesResponse);
                if (normalized.diagnostics.missingInvoiceIdCount > 0) {
                    logger.warn('Fortnox getInvoices returned customer invoices without InvoiceNumber/DocumentNumber', {
                        userId,
                        companyId: resolvedCompanyId,
                        missingInvoiceIdCount: normalized.diagnostics.missingInvoiceIdCount,
                        filledFromDocumentNumber: normalized.diagnostics.filledFromDocumentNumber,
                    });
                }
                result = normalized.response;
                break;
            }

            case 'getInvoice': {
                const invoiceNumber = requireNumber(payload?.invoiceNumber, 'payload.invoiceNumber');
                result = await requireFortnoxService().getInvoice(invoiceNumber);
                break;
            }

            case 'registerInvoicePayment': {
                const paymentPayload = requireRecord(payload?.payment, 'payload.payment');
                requireNumber(paymentPayload.InvoiceNumber, 'payload.payment.InvoiceNumber');
                requireNumber(paymentPayload.Amount, 'payload.payment.Amount');
                requireString(paymentPayload.PaymentDate, 'payload.payment.PaymentDate');
                const payment = paymentPayload as unknown as FortnoxInvoicePayment;
                const meta = payload?.meta as unknown as Record<string, unknown> | undefined;
                const transactionId = typeof meta?.transactionId === 'string' ? meta.transactionId : undefined;
                const resourceId = transactionId || String(payment.InvoiceNumber ?? 'unknown');
                const matchMeta = (meta?.match ?? {}) as unknown as Record<string, unknown>;
                const customerNumberRaw = matchMeta.customerNumber as string | number | undefined;
                const customerNumber = customerNumberRaw !== undefined ? String(customerNumberRaw) : undefined;
                const write = await prepareWriteAction(
                    'register_invoice_payment',
                    { payment: paymentPayload, meta: meta || null },
                    action
                );

                if (write.cachedResult) {
                    result = write.cachedResult;
                    break;
                }

                syncId = write.syncId;

                try {
                    const created = await requireFortnoxService().createInvoicePayment(payment);
                    const number = created?.InvoicePayment?.Number;
                    if (number) {
                        const bookkept = await requireFortnoxService().bookkeepInvoicePayment(number);
                        result = { payment: created, bookkeep: bookkept };
                    } else {
                        result = created;
                    }

                    await auditService.log({
                        userId,
                        actorType: 'user',
                        action: 'bank_match_approved_customer_payment',
                        resourceType: 'bank_match',
                        resourceId,
                        companyId: write.companyId,
                        previousState: meta,
                        newState: {
                            paymentRequest: payment,
                            paymentResult: result as unknown as Record<string, unknown>
                        },
                        ipAddress: requestMeta.ipAddress,
                        userAgent: requestMeta.userAgent,
                    });

                    if (syncId) {
                        await auditService.completeFortnoxSync(syncId!, {
                            fortnoxDocumentNumber: number ? String(number) : undefined,
                            responsePayload: result as unknown as Record<string, unknown>,
                        }, requestMeta);
                    }

                    if (write.companyId && customerNumber) {
                        const { error: policyError } = await supabaseClient.rpc('increment_bank_match_policy', {
                            p_user_id: userId,
                            p_company_id: write.companyId,
                            p_counterparty_type: 'customer',
                            p_counterparty_number: customerNumber
                        });
                        if (policyError) {
                            logger.warn('Failed to update bank match policy (customer)', {
                                message: policyError.message,
                                details: policyError.details,
                                hint: policyError.hint,
                                code: policyError.code,
                            });
                        }
                    }
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    if (syncId) {
                        await auditService.failFortnoxSync(syncId!, 'REGISTER_INVOICE_PAYMENT_ERROR', errorMessage, undefined, requestMeta);
                    }
                    await auditService.log({
                        userId,
                        actorType: 'user',
                        action: 'bank_match_customer_payment_failed',
                        resourceType: 'bank_match',
                        resourceId,
                        companyId: write.companyId,
                        previousState: meta,
                        newState: {
                            paymentRequest: payment,
                            error: errorMessage
                        },
                        ipAddress: requestMeta.ipAddress,
                        userAgent: requestMeta.userAgent,
                    });
                    throw error;
                }
                break;
            }

            // ================================================================
            // VOUCHER ACTIONS (Verifikationer)
            // ================================================================
            case 'getVouchers': {
                const financialYear = payload?.financialYear as number | undefined;
                const voucherSeries = payload?.voucherSeries as string | undefined;
                const fromDate = payload?.fromDate as string | undefined;
                const toDate = payload?.toDate as string | undefined;
                const pagination = parsePagination(payload);
                result = await requireFortnoxService().getVouchers(
                    financialYear,
                    voucherSeries,
                    pagination,
                    { fromDate, toDate }
                );
                break;
            }

            case 'getVoucher': {
                const series = requireString(payload?.voucherSeries, 'payload.voucherSeries');
                const number = requireNumber(payload?.voucherNumber, 'payload.voucherNumber');
                const year = payload?.financialYear as number | undefined;
                result = await requireFortnoxService().getVoucher(series, number, year);
                break;
            }

            case 'exportVoucher': {
                // Create voucher for VAT report export
                const voucherDataRaw = requireRecord(payload?.voucher, 'payload.voucher');
                const vatReportId = payload?.vatReportId as string | undefined;
                requireString(voucherDataRaw.Description, 'payload.voucher.Description');
                requireString(voucherDataRaw.TransactionDate, 'payload.voucher.TransactionDate');
                requireString(voucherDataRaw.VoucherSeries, 'payload.voucher.VoucherSeries');
                if (!Array.isArray(voucherDataRaw.VoucherRows) || voucherDataRaw.VoucherRows.length === 0) {
                    throw new RequestValidationError(
                        'INVALID_PAYLOAD',
                        'Missing or invalid array: payload.voucher.VoucherRows',
                        { field: 'payload.voucher.VoucherRows' }
                    );
                }
                const voucherData = voucherDataRaw as unknown as FortnoxVoucher;
                const write = await prepareWriteAction(
                    'export_voucher',
                    { voucher: voucherDataRaw, vatReportId: vatReportId ?? null },
                    action,
                    { vatReportId }
                );

                if (write.cachedResult) {
                    result = write.cachedResult;
                    break;
                }

                syncId = write.syncId;

                try {
                    result = await requireFortnoxService().createVoucher(voucherData);

                    // Complete sync with success
                    await auditService.completeFortnoxSync(syncId!, {
                        fortnoxDocumentNumber: String(result.Voucher.VoucherNumber),
                        fortnoxVoucherSeries: result.Voucher.VoucherSeries,
                        responsePayload: result as unknown as Record<string, unknown>,
                    }, requestMeta);

                    logger.info('Voucher exported successfully', {
                        voucherNumber: result.Voucher.VoucherNumber,
                        series: result.Voucher.VoucherSeries,
                    });
                } catch (error) {
                    // Log failure
                    if (syncId) {
                        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                        await auditService.failFortnoxSync(syncId!, 'VOUCHER_CREATE_ERROR', errorMessage, undefined, requestMeta);
                    }
                    throw error;
                }
                break;
            }

            case 'createPostingCorrectionVoucher': {
                let correctionRequest;
                try {
                    correctionRequest = normalizePostingCorrectionRequest(payload);
                } catch (error) {
                    if (error instanceof PostingCorrectionValidationError) {
                        throw new RequestValidationError(
                            'INVALID_PAYLOAD',
                            error.message,
                            { field: error.field }
                        );
                    }
                    throw error;
                }

                const writePayload = {
                    invoiceType: correctionRequest.invoiceType,
                    invoiceId: correctionRequest.invoiceId,
                    correction: correctionRequest.correction,
                    idempotencyKey: correctionRequest.idempotencyKey,
                    sourceContext: correctionRequest.sourceContext,
                    aiDecisionId: correctionRequest.aiDecisionId,
                };

                const write = await prepareWriteAction(
                    'export_voucher',
                    writePayload,
                    action
                );

                if (write.cachedResult) {
                    result = write.cachedResult;
                    break;
                }

                syncId = write.syncId;
                const voucherData = buildPostingCorrectionVoucher(correctionRequest);

                try {
                    const createdVoucher = await requireFortnoxService().createVoucher(voucherData);
                    const voucherRecord = createdVoucher?.Voucher;
                    result = {
                        Voucher: voucherRecord ? {
                            VoucherSeries: voucherRecord.VoucherSeries,
                            VoucherNumber: voucherRecord.VoucherNumber,
                            Year: voucherRecord.Year,
                        } : null,
                        correction: {
                            invoiceType: correctionRequest.invoiceType,
                            invoiceId: correctionRequest.invoiceId,
                            side: correctionRequest.correction.side,
                            fromAccount: correctionRequest.correction.fromAccount,
                            toAccount: correctionRequest.correction.toAccount,
                            amount: correctionRequest.correction.amount,
                        },
                    };

                    if (syncId) {
                        await auditService.completeFortnoxSync(syncId, {
                            fortnoxDocumentNumber: String(voucherRecord?.VoucherNumber ?? ''),
                            fortnoxVoucherSeries: voucherRecord?.VoucherSeries,
                            responsePayload: result as Record<string, unknown>,
                        }, requestMeta);
                    }
                } catch (error) {
                    if (syncId) {
                        const message = error instanceof Error ? error.message : 'Unknown error';
                        await auditService.failFortnoxSync(
                            syncId,
                            'POSTING_CORRECTION_CREATE_ERROR',
                            message,
                            undefined,
                            requestMeta
                        );
                    }
                    throw error;
                }
                break;
            }

            // ================================================================
            // SUPPLIER INVOICE ACTIONS (Leverantörsfakturor)
            // ================================================================
            case 'getSupplierInvoices': {
                const fromDate = payload?.fromDate as string | undefined;
                const toDate = payload?.toDate as string | undefined;
                const supplierNumber = payload?.supplierNumber as string | undefined;
                const filter = payload?.filter as string | undefined;
                const pagination = parsePagination(payload);
                result = await requireFortnoxService().getSupplierInvoices({
                    fromDate,
                    toDate,
                    supplierNumber,
                    filter,
                    ...pagination,
                });
                break;
            }

            case 'getSupplierInvoice': {
                const givenNumber = requireNumber(payload?.givenNumber, 'payload.givenNumber');
                result = await requireFortnoxService().getSupplierInvoice(givenNumber);
                break;
            }

            case 'getInvoicePostingTrace': {
                const invoiceType = normalizeInvoiceType(payload?.invoiceType);
                const invoiceId = normalizeInvoiceId(payload?.invoiceId);
                result = await buildInvoicePostingTrace(
                    requireFortnoxService(),
                    invoiceType,
                    invoiceId
                );
                break;
            }

            case 'registerSupplierInvoicePayment': {
                const paymentPayload = requireRecord(payload?.payment, 'payload.payment');
                requireString(paymentPayload.InvoiceNumber, 'payload.payment.InvoiceNumber');
                requireNumber(paymentPayload.Amount, 'payload.payment.Amount');
                requireString(paymentPayload.PaymentDate, 'payload.payment.PaymentDate');
                const payment = paymentPayload as unknown as FortnoxSupplierInvoicePayment;
                const meta = payload?.meta as unknown as Record<string, unknown> | undefined;
                const transactionId = typeof meta?.transactionId === 'string' ? meta.transactionId : undefined;
                const resourceId = transactionId || String(payment.InvoiceNumber ?? 'unknown');
                const matchMeta = (meta?.match ?? {}) as unknown as Record<string, unknown>;
                const supplierNumberRaw = matchMeta.supplierNumber as string | number | undefined;
                const supplierNumber = supplierNumberRaw !== undefined ? String(supplierNumberRaw) : undefined;
                const write = await prepareWriteAction(
                    'register_supplier_invoice_payment',
                    { payment: paymentPayload, meta: meta || null },
                    action,
                    { transactionId }
                );
                if (write.cachedResult) {
                    result = write.cachedResult;
                    break;
                }

                syncId = write.syncId;

                try {
                    const created = await requireFortnoxService().createSupplierInvoicePayment(payment);
                    const number = created?.SupplierInvoicePayment?.Number;
                    if (number !== undefined) {
                        const bookkept = await requireFortnoxService().bookkeepSupplierInvoicePayment(number);
                        result = { payment: created, bookkeep: bookkept };
                    } else {
                        result = created;
                    }

                    await auditService.log({
                        userId,
                        actorType: 'user',
                        action: 'bank_match_approved_supplier_payment',
                        resourceType: 'bank_match',
                        resourceId,
                        companyId: write.companyId,
                        previousState: meta,
                        newState: {
                            paymentRequest: payment,
                            paymentResult: result as unknown as Record<string, unknown>
                        },
                        ipAddress: requestMeta.ipAddress,
                        userAgent: requestMeta.userAgent,
                    });

                    if (syncId) {
                        await auditService.completeFortnoxSync(syncId!, {
                            fortnoxDocumentNumber: number !== undefined ? String(number) : undefined,
                            responsePayload: result as unknown as Record<string, unknown>,
                        }, requestMeta);
                    }

                    if (write.companyId && supplierNumber) {
                        const { error: policyError } = await supabaseClient.rpc('increment_bank_match_policy', {
                            p_user_id: userId,
                            p_company_id: write.companyId,
                            p_counterparty_type: 'supplier',
                            p_counterparty_number: supplierNumber
                        });
                        if (policyError) {
                            logger.warn('Failed to update bank match policy (supplier)', {
                                message: policyError.message,
                                details: policyError.details,
                                hint: policyError.hint,
                                code: policyError.code,
                            });
                        }
                    }
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    if (syncId) {
                        await auditService.failFortnoxSync(syncId!, 'REGISTER_SUPPLIER_INVOICE_PAYMENT_ERROR', errorMessage, undefined, requestMeta);
                    }
                    await auditService.log({
                        userId,
                        actorType: 'user',
                        action: 'bank_match_supplier_payment_failed',
                        resourceType: 'bank_match',
                        resourceId,
                        companyId: write.companyId,
                        previousState: meta,
                        newState: {
                            paymentRequest: payment,
                            error: errorMessage
                        },
                        ipAddress: requestMeta.ipAddress,
                        userAgent: requestMeta.userAgent,
                    });
                    throw error;
                }
                break;
            }

            case 'exportSupplierInvoice': {
                // Create supplier invoice for transaction export
                const invoiceDataRaw = requireRecord(payload?.invoice, 'payload.invoice');
                const transactionId = payload?.transactionId as string | undefined;
                const aiDecisionId = payload?.aiDecisionId as string | undefined;
                requireString(invoiceDataRaw.SupplierNumber, 'payload.invoice.SupplierNumber');
                requireString(invoiceDataRaw.InvoiceNumber, 'payload.invoice.InvoiceNumber');
                requireString(invoiceDataRaw.InvoiceDate, 'payload.invoice.InvoiceDate');
                requireString(invoiceDataRaw.DueDate, 'payload.invoice.DueDate');
                requireNumber(invoiceDataRaw.Total, 'payload.invoice.Total');
                const invoiceData = invoiceDataRaw as unknown as FortnoxSupplierInvoice;
                const write = await prepareWriteAction(
                    'export_supplier_invoice',
                    { invoice: invoiceDataRaw, transactionId: transactionId ?? null, aiDecisionId: aiDecisionId ?? null },
                    action,
                    { transactionId, aiDecisionId }
                );

                if (write.cachedResult) {
                    result = write.cachedResult;
                    break;
                }

                syncId = write.syncId;

                try {
                    result = await requireFortnoxService().createSupplierInvoice(invoiceData);

                    // Complete sync with success
                    await auditService.completeFortnoxSync(syncId!, {
                        fortnoxDocumentNumber: String(result.SupplierInvoice.GivenNumber),
                        fortnoxInvoiceNumber: invoiceData.InvoiceNumber,
                        fortnoxSupplierNumber: invoiceData.SupplierNumber,
                        responsePayload: result as unknown as Record<string, unknown>,
                    }, requestMeta);

                    logger.info('Supplier invoice exported successfully', {
                        givenNumber: result.SupplierInvoice.GivenNumber,
                        supplierNumber: invoiceData.SupplierNumber,
                    });
                } catch (error) {
                    // Log failure
                    if (syncId) {
                        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                        await auditService.failFortnoxSync(syncId!, 'SUPPLIER_INVOICE_CREATE_ERROR', errorMessage, undefined, requestMeta);
                    }
                    throw error;
                }
                break;
            }

            case 'bookSupplierInvoice': {
                const givenNumber = requireNumber(payload?.givenNumber, 'payload.givenNumber');
                const write = await prepareWriteAction(
                    'book_supplier_invoice',
                    { givenNumber },
                    action
                );

                if (write.cachedResult) {
                    result = write.cachedResult;
                    break;
                }

                syncId = write.syncId;
                try {
                    result = await requireFortnoxService().bookSupplierInvoice(givenNumber);
                    await auditService.completeFortnoxSync(syncId!, {
                        fortnoxDocumentNumber: String(givenNumber),
                        responsePayload: result as unknown as Record<string, unknown>,
                    }, requestMeta);
                } catch (error) {
                    if (syncId) {
                        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                        await auditService.failFortnoxSync(syncId!, 'SUPPLIER_INVOICE_BOOKKEEP_ERROR', errorMessage, undefined, requestMeta);
                    }
                    throw error;
                }
                break;
            }

            case 'approveSupplierInvoiceBookkeep': {
                const givenNumber = requireNumber(payload?.givenNumber, 'payload.givenNumber');
                const write = await prepareWriteAction(
                    'approve_supplier_invoice_bookkeep',
                    { givenNumber },
                    action
                );

                if (write.cachedResult) {
                    result = write.cachedResult;
                    break;
                }

                syncId = write.syncId;
                try {
                    result = await requireFortnoxService().approveSupplierInvoiceBookkeep(givenNumber);
                    await auditService.completeFortnoxSync(syncId!, {
                        fortnoxDocumentNumber: String(givenNumber),
                        responsePayload: result as unknown as Record<string, unknown>,
                    }, requestMeta);
                } catch (error) {
                    if (syncId) {
                        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                        await auditService.failFortnoxSync(syncId!, 'SUPPLIER_INVOICE_APPROVAL_BOOKKEEP_ERROR', errorMessage, undefined, requestMeta);
                    }
                    throw error;
                }
                break;
            }

            case 'approveSupplierInvoicePayment': {
                const givenNumber = requireNumber(payload?.givenNumber, 'payload.givenNumber');
                const write = await prepareWriteAction(
                    'approve_supplier_invoice_payment',
                    { givenNumber },
                    action
                );

                if (write.cachedResult) {
                    result = write.cachedResult;
                    break;
                }

                syncId = write.syncId;
                try {
                    result = await requireFortnoxService().approveSupplierInvoicePayment(givenNumber);
                    await auditService.completeFortnoxSync(syncId!, {
                        fortnoxDocumentNumber: String(givenNumber),
                        responsePayload: result as unknown as Record<string, unknown>,
                    }, requestMeta);
                } catch (error) {
                    if (syncId) {
                        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                        await auditService.failFortnoxSync(syncId!, 'SUPPLIER_INVOICE_APPROVAL_PAYMENT_ERROR', errorMessage, undefined, requestMeta);
                    }
                    throw error;
                }
                break;
            }

            // ================================================================
            // SUPPLIER ACTIONS (Leverantörer)
            // ================================================================
            case 'getSuppliers':
                result = await requireFortnoxService().getSuppliers();
                break;

            case 'getSupplier': {
                const supplierNumber = requireString(payload?.supplierNumber, 'payload.supplierNumber');
                result = await requireFortnoxService().getSupplier(supplierNumber);
                break;
            }

            case 'createSupplier': {
                const supplierDataRaw = requireRecord(payload?.supplier, 'payload.supplier');
                requireString(supplierDataRaw.Name, 'payload.supplier.Name');
                const supplierData = supplierDataRaw as unknown as FortnoxSupplier;
                const write = await prepareWriteAction(
                    'create_supplier',
                    { supplier: supplierDataRaw },
                    action
                );

                if (write.cachedResult) {
                    result = write.cachedResult;
                    break;
                }

                syncId = write.syncId;

                try {
                    result = await requireFortnoxService().createSupplier(supplierData);

                    // Complete sync with success
                    await auditService.completeFortnoxSync(syncId!, {
                        fortnoxSupplierNumber: result.Supplier.SupplierNumber,
                        responsePayload: result as unknown as Record<string, unknown>,
                    }, requestMeta);

                    logger.info('Supplier created successfully', {
                        supplierNumber: result.Supplier.SupplierNumber,
                    });
                } catch (error) {
                    // Log failure
                    if (syncId) {
                        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                        await auditService.failFortnoxSync(syncId!, 'SUPPLIER_CREATE_ERROR', errorMessage, undefined, requestMeta);
                    }
                    throw error;
                }
                break;
            }

            case 'findOrCreateSupplier': {
                const supplierDataRaw = requireRecord(payload?.supplier, 'payload.supplier');
                requireString(supplierDataRaw.Name, 'payload.supplier.Name');
                const supplierData = supplierDataRaw as unknown as FortnoxSupplier;
                const write = await prepareWriteAction(
                    'create_supplier',
                    { supplier: supplierDataRaw },
                    action
                );

                if (write.cachedResult) {
                    result = write.cachedResult;
                    break;
                }

                syncId = write.syncId;
                try {
                    result = await requireFortnoxService().findOrCreateSupplier(supplierData);
                    await auditService.completeFortnoxSync(syncId!, {
                        fortnoxSupplierNumber: (result as { Supplier?: { SupplierNumber?: string } })?.Supplier?.SupplierNumber,
                        responsePayload: result as unknown as Record<string, unknown>,
                    }, requestMeta);
                } catch (error) {
                    if (syncId) {
                        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                        await auditService.failFortnoxSync(syncId!, 'SUPPLIER_CREATE_ERROR', errorMessage, undefined, requestMeta);
                    }
                    throw error;
                }
                break;
            }

            // ================================================================
            // SYNC STATUS ACTIONS
            // ================================================================
            case 'getVATReportSyncStatus': {
                const vatReportId = requireString(payload?.vatReportId, 'payload.vatReportId');
                result = await auditService.getVATReportSyncStatus(vatReportId);
                break;
            }

            // ================================================================
            // PROFILE SYNC (auto-populate memory from Fortnox)
            // ================================================================
            case 'sync_profile': {
                if (!companyId) {
                    throw new RequestValidationError(
                        'MISSING_COMPANY_ID',
                        'Missing required field: companyId',
                        { field: 'companyId' }
                    );
                }

                // 1. Fetch company info from Fortnox
                const companyInfo = await requireFortnoxService().getCompanyInfo();
                const info = companyInfo.CompanyInformation;

                // 2. Fetch financial years
                const years = await requireFortnoxService().getFinancialYears();
                const latestYear = years.FinancialYears?.[0];

                // 3. Fetch suppliers
                const suppliers = await requireFortnoxService().getSuppliers();

                // 4. Build accounting_memories records
                const accountingMemories: Record<string, unknown>[] = [];

                // Company profile
                accountingMemories.push({
                    user_id: userId,
                    company_id: companyId,
                    entity_type: 'company_profile',
                    entity_key: info.OrganizationNumber || 'company',
                    label: `${info.CompanyName} (${info.OrganizationNumber})`,
                    payload: {
                        name: info.CompanyName,
                        org_number: info.OrganizationNumber,
                        address: `${info.Address}, ${info.ZipCode} ${info.City}`,
                        company_form: info.CompanyForm,
                        email: info.Email,
                        phone: info.Phone,
                    },
                    source_type: 'fortnox',
                    source_reliability: 1.0,
                    confidence: 1.0,
                    review_status: 'confirmed'
                });

                // Fiscal year
                if (latestYear) {
                    accountingMemories.push({
                        user_id: userId,
                        company_id: companyId,
                        entity_type: 'company_profile',
                        entity_key: 'fiscal_year',
                        label: `Räkenskapsår: ${latestYear.FromDate} – ${latestYear.ToDate}`,
                        payload: {
                            from: latestYear.FromDate,
                            to: latestYear.ToDate,
                            accounting_method: latestYear.AccountingMethod,
                            chart: latestYear.AccountCharts
                        },
                        source_type: 'fortnox',
                        source_reliability: 1.0,
                        confidence: 1.0,
                        review_status: 'confirmed',
                        fiscal_year: latestYear.FromDate.slice(0, 4)
                    });
                }

                // Top suppliers (max 10)
                const topSuppliers = (suppliers.Suppliers || []).slice(0, 10);
                for (const supplier of topSuppliers) {
                    accountingMemories.push({
                        user_id: userId,
                        company_id: companyId,
                        entity_type: 'supplier_profile',
                        entity_key: supplier.SupplierNumber,
                        label: `${supplier.Name} (#${supplier.SupplierNumber})`,
                        payload: { name: supplier.Name, number: supplier.SupplierNumber },
                        source_type: 'fortnox',
                        source_reliability: 1.0,
                        confidence: 1.0,
                        review_status: 'auto'
                    });
                }

                // 5. Upsert accounting memories
                for (const mem of accountingMemories) {
                    const { error: upsertError } = await supabaseClient
                        .from('accounting_memories')
                        .upsert(mem, { onConflict: 'user_id,company_id,entity_type,entity_key' });
                    if (upsertError) {
                        logger.warn('Failed to upsert accounting memory', { entityKey: mem.entity_key, error: upsertError });
                    }
                }

                // 6. Update company_memory
                const companyMemoryService = new CompanyMemoryService(supabaseClient);
                const existingMemory = await companyMemoryService.get(userId, companyId);
                const merged = mergeCompanyMemory(existingMemory, {
                    company_name: info.CompanyName,
                    org_number: info.OrganizationNumber,
                });
                await companyMemoryService.upsert(userId, companyId, merged);

                result = {
                    synced: true,
                    company_name: info.CompanyName,
                    org_number: info.OrganizationNumber,
                    memories_created: accountingMemories.length,
                    suppliers_synced: topSuppliers.length
                };

                logger.info('Fortnox profile synced', { companyId, memoriesCreated: accountingMemories.length });
                break;
            }

            // ================================================================
            // VAT REPORT — fetches individual invoices for exact VAT breakdown
            // ================================================================
            case 'getVATReport': {
                // 1. Fetch company info + financial years + invoice lists in parallel
                type InvList = { Invoices: Array<{ DocumentNumber: number; CustomerName?: string; CustomerNumber: string; InvoiceDate?: string; Total?: number; Booked?: boolean; Cancelled?: boolean }> };
                type SuppInvList = { SupplierInvoices: Array<{ GivenNumber: number; SupplierNumber: string; InvoiceDate: string; Total: number; VAT?: number; Booked: boolean }> };

                const [vatCompanyResp, vatYearsResp] = await Promise.all([
                    requireFortnoxService().getCompanyInfo(),
                    requireFortnoxService().getFinancialYears(),
                ]);
                const vatCompany = vatCompanyResp.CompanyInformation;
                const currentFY = vatYearsResp.FinancialYears?.[0];
                const fyFrom = currentFY?.FromDate || `${new Date().getFullYear()}-01-01`;
                const fyTo = currentFY?.ToDate || `${new Date().getFullYear()}-12-31`;

                // 2. Fetch invoice lists + supplier invoices with full pagination
                const [invoicesResp, suppInvResp] = await Promise.all([
                    requireFortnoxService().getInvoices({
                        fromDate: fyFrom,
                        toDate: fyTo,
                        allPages: true,
                        limit: 100,
                    }).catch(() => ({ Invoices: [] as InvList['Invoices'] })),
                    requireFortnoxService().getSupplierInvoices({
                        fromDate: fyFrom,
                        toDate: fyTo,
                        allPages: true,
                        limit: 100,
                    }).catch(() => ({ SupplierInvoices: [] as SuppInvList['SupplierInvoices'] })),
                ]);

                const allInvoices = (invoicesResp?.Invoices || []).filter(inv => !inv.Cancelled);
                const suppInvoices = suppInvResp?.SupplierInvoices || [];

                // 3. Fetch each invoice individually for exact Net/VAT/Total breakdown
                type InvDetail = { Invoice: { DocumentNumber: number; CustomerName?: string; InvoiceDate?: string; Net?: number; Total?: number; TotalVAT?: number; VATIncluded?: boolean; Booked?: boolean; InvoiceRows?: Array<{ AccountNumber?: number; Price?: number; VAT?: number }> } };
                type SuppInvDetail = { SupplierInvoice: { GivenNumber: number; SupplierName?: string; InvoiceDate?: string; Total: number; VAT?: number; Booked: boolean } };

                const invDetails: Array<{ nr: number; customer: string; date: string; net: number; vat: number; total: number; booked: boolean }> = [];
                for (let i = 0; i < allInvoices.length; i += 4) {
                    const batch = allInvoices.slice(i, i + 4);
                    const results = await Promise.all(
                        batch.map(inv => {
                            const invRecord = inv as Record<string, unknown>;
                            const invoiceNo = Number(invRecord.DocumentNumber ?? invRecord.InvoiceNumber ?? 0);
                            return requireFortnoxService().request<InvDetail>(`/invoices/${invoiceNo}`).catch(() => null);
                        })
                    );
                    for (const r of results) {
                        if (r?.Invoice) {
                            const inv = r.Invoice;
                            invDetails.push({
                                nr: inv.DocumentNumber,
                                customer: inv.CustomerName || '',
                                date: inv.InvoiceDate || '',
                                net: Number(inv.Net) || 0,
                                vat: Number(inv.TotalVAT) || 0,
                                total: Number(inv.Total) || 0,
                                booked: inv.Booked || false,
                            });
                        }
                    }
                }

                // Fetch supplier invoice details
                const suppDetails: Array<{ nr: number; supplier: string; date: string; net: number; vat: number; total: number; booked: boolean }> = [];
                for (let i = 0; i < suppInvoices.length; i += 4) {
                    const batch = suppInvoices.slice(i, i + 4);
                    const results = await Promise.all(
                        batch.map(inv =>
                            requireFortnoxService().request<SuppInvDetail>(`/supplierinvoices/${inv.GivenNumber}`).catch(() => null)
                        )
                    );
                    for (const r of results) {
                        if (r?.SupplierInvoice) {
                            const inv = r.SupplierInvoice;
                            const vatAmt = Number(inv.VAT) || 0;
                            const total = Number(inv.Total) || 0;
                            suppDetails.push({
                                nr: inv.GivenNumber,
                                supplier: inv.SupplierName || '',
                                date: inv.InvoiceDate || '',
                                net: total - vatAmt,
                                vat: vatAmt,
                                total,
                                booked: inv.Booked || false,
                            });
                        }
                    }
                }

                // 4. Calculate totals from invoice data (ALL invoices, not just booked)
                const totalRevNet = invDetails.reduce((s, inv) => s + inv.net, 0);
                const totalRevVat = invDetails.reduce((s, inv) => s + inv.vat, 0);
                const totalCostNet = suppDetails.reduce((s, inv) => s + inv.net, 0);
                const totalCostVat = suppDetails.reduce((s, inv) => s + inv.vat, 0);

                // 5. Group revenue by VAT rate (derive rate from vat/net ratio)
                const revenueByRate: Record<number, { net: number; vat: number }> = {};
                for (const inv of invDetails) {
                    const rate = inv.net > 0 ? Math.round((inv.vat / inv.net) * 100) : 0;
                    if (!revenueByRate[rate]) revenueByRate[rate] = { net: 0, vat: 0 };
                    revenueByRate[rate].net += inv.net;
                    revenueByRate[rate].vat += inv.vat;
                }

                const vatSales: Array<{ description: string; net: number; vat: number; rate: number }> = [];
                for (const [rateStr, amounts] of Object.entries(revenueByRate)) {
                    const rate = Number(rateStr);
                    const label = rate === 0 ? 'Momsfri försäljning' : `Försäljning ${rate}% moms`;
                    vatSales.push({ description: label, net: amounts.net, vat: amounts.vat, rate });
                }
                vatSales.sort((a, b) => b.rate - a.rate);

                // 6. Group costs by VAT rate
                const costsByRate: Record<number, { net: number; vat: number }> = {};
                for (const inv of suppDetails) {
                    const rate = inv.net > 0 ? Math.round((inv.vat / inv.net) * 100) : 0;
                    if (!costsByRate[rate]) costsByRate[rate] = { net: 0, vat: 0 };
                    costsByRate[rate].net += inv.net;
                    costsByRate[rate].vat += inv.vat;
                }

                const vatCosts: Array<{ description: string; net: number; vat: number; rate: number }> = [];
                for (const [rateStr, amounts] of Object.entries(costsByRate)) {
                    const rate = Number(rateStr);
                    const label = rate === 0 ? 'Momsfria kostnader' : `Inköp med ${rate}% moms`;
                    vatCosts.push({ description: label, net: amounts.net, vat: amounts.vat, rate });
                }
                vatCosts.sort((a, b) => b.rate - a.rate);

                // 7. VAT summary
                const outgoing25 = revenueByRate[25]?.vat || 0;
                const outgoing12 = revenueByRate[12]?.vat || 0;
                const outgoing6 = revenueByRate[6]?.vat || 0;
                const incomingVat = totalCostVat;
                const netVat = totalRevVat - incomingVat;

                const vatSummaryData = {
                    outgoing_25: outgoing25, outgoing_12: outgoing12, outgoing_6: outgoing6,
                    incoming: incomingVat, net: netVat,
                    ...(netVat >= 0 ? { to_pay: netVat } : { to_refund: Math.abs(netVat) }),
                };

                // 8. Journal entries (momsavräkningsverifikat)
                const vatJournal: Array<{ account: string; name: string; debit: number; credit: number }> = [];
                if (outgoing25 > 0) vatJournal.push({ account: '2611', name: 'Utgående moms 25%', debit: outgoing25, credit: 0 });
                if (outgoing12 > 0) vatJournal.push({ account: '2621', name: 'Utgående moms 12%', debit: outgoing12, credit: 0 });
                if (outgoing6 > 0) vatJournal.push({ account: '2631', name: 'Utgående moms 6%', debit: outgoing6, credit: 0 });
                if (incomingVat > 0) vatJournal.push({ account: '2641', name: 'Ingående moms', debit: 0, credit: incomingVat });
                vatJournal.push({ account: '2650', name: 'Momsredovisning', debit: netVat < 0 ? Math.abs(netVat) : 0, credit: netVat >= 0 ? netVat : 0 });

                const debitSum = vatJournal.reduce((s, j) => s + j.debit, 0);
                const creditSum = vatJournal.reduce((s, j) => s + j.credit, 0);
                const balanced = Math.abs(debitSum - creditSum) < 0.01;

                // 9. Warnings
                const warnings: string[] = [];
                const unbookedCount = invDetails.filter(i => !i.booked).length;
                if (unbookedCount > 0) warnings.push(`${unbookedCount} faktura(or) är ännu inte bokförda`);
                if (invDetails.length === 0 && suppDetails.length === 0) warnings.push('Inga fakturor hittades i perioden');

                result = {
                    type: 'vat_report',
                    data: {
                        type: 'vat_report',
                        period: `${fyFrom} – ${fyTo}`,
                        company: { name: vatCompany.CompanyName, org_number: vatCompany.OrganizationNumber },
                        summary: { total_income: totalRevNet, total_costs: totalCostNet, result: totalRevNet - totalCostNet },
                        sales: vatSales, costs: vatCosts, vat: vatSummaryData,
                        journal_entries: vatJournal,
                        validation: {
                            is_valid: balanced && unbookedCount === 0,
                            errors: balanced ? [] : ['Momsavräkning är inte balanserad'],
                            warnings,
                        },
                    },
                    invoices: invDetails,
                    supplierInvoices: suppDetails,
                };

                logger.info('VAT report generated', {
                    company: vatCompany.CompanyName,
                    invoices: invDetails.length, unbookedCount,
                    suppInvoices: suppDetails.length,
                    totalRevNet, totalRevVat, totalCostNet, totalCostVat,
                });
                break;
            }

            default:
                throw new RequestValidationError(
                    'UNKNOWN_ACTION',
                    `Unknown action: ${action}`,
                    { action }
                );
        }

        return new Response(
            JSON.stringify(result),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200
            }
        );

    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error('Fortnox Function Error', error);

        if (error instanceof RequestValidationError) {
            return validationResponse(corsHeaders, error);
        }

        if (error instanceof FortnoxApiError) {
            return new Response(
                JSON.stringify({
                    error: error.userMessage,
                    errorCode: error.name,
                    retryable: error.retryable,
                }),
                {
                    headers: { ...corsHeaders, ...JSON_HEADERS },
                    status: error.statusCode || 400,
                }
            );
        }

        return new Response(
            JSON.stringify({ error: errorMessage, errorCode: 'FORTNOX_ACTION_FAILED' }),
            {
                headers: { ...corsHeaders, ...JSON_HEADERS },
                status: 400
            }
        );
    }
});

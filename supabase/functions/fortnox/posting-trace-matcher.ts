import type {
    FortnoxVoucherListResponse,
    FortnoxVoucherResponse,
} from "./types.ts";
import {
    getFortnoxStatusCode,
    getVoucherWithYearFallback,
    getVouchersWithYearFallback,
    shouldPropagatePostingTraceError,
} from "./posting-trace-fallback.ts";

export type InvoiceType = "supplier" | "customer";
export type PostingMatchPath = "explicit_vouchers" | "explicit_single" | "reference" | "heuristic" | "none";

export interface PostingRow {
    account: number;
    debit: number;
    credit: number;
    description: string;
}

export interface PostingTotals {
    debit: number;
    credit: number;
    balanced: boolean;
}

export interface VoucherRef {
    series: string;
    number: number;
    year?: number;
}

export interface ReferenceEvidence {
    referenceType?: string;
    referenceNumber?: string;
}

export interface VoucherMatchResult {
    score: number;
    voucherRef: VoucherRef;
    rows: PostingRow[];
    totals: PostingTotals;
    transactionDate: string;
    referenceEvidence?: ReferenceEvidence;
    referenceScore?: number;
    acceptedByReference?: boolean;
}

export interface MatcherInvoice {
    id: string;
    invoiceNumber?: string;
    invoiceDate: string;
    dueDate: string;
    total: number;
    booked: boolean | null;
}

type VoucherLookupService = {
    getVouchers(
        financialYear?: number,
        voucherSeries?: string,
        pagination?: { page?: number; limit?: number; allPages?: boolean }
    ): Promise<FortnoxVoucherListResponse>;
    getVoucher(
        voucherSeries: string,
        voucherNumber: number,
        financialYear?: number
    ): Promise<FortnoxVoucherResponse>;
};

type MatcherLogger = {
    warn: (message: string, meta?: Record<string, unknown>) => void;
    info: (message: string, meta?: Record<string, unknown>) => void;
};

interface ReferenceMatchResult {
    score: number;
    exact: boolean;
    matchedType?: string;
    matchedNumber?: string;
}

interface InternalVoucherCandidate {
    series: string;
    number: number;
    year?: number;
    transactionDate: string;
    referenceType?: string;
    referenceNumber?: string;
    referenceScoreHint?: number;
    referenceExact?: boolean;
    matchedReferenceType?: string;
    matchedReferenceNumber?: string;
}

export interface InvoiceReferenceSignal {
    referenceType: string;
    referenceNumbers: string[];
    priority: number;
}

export interface ExplicitVoucherCandidate {
    series: string;
    number: number;
    year?: number;
    referenceType?: string;
    referenceNumber?: string;
}

export interface HeuristicMatchDiagnostics {
    candidateCount: number;
    referenceCandidateCount: number;
    filteredCandidateCount: number;
    detailFetchCount: number;
    bestScore: number;
    bestReferenceScore: number;
    elapsedMs: number;
    timedOut: boolean;
    usedListFallback: boolean;
    usedDetailFallback: boolean;
    yearsSearched: Array<number | "unscoped">;
}

export interface HeuristicMatchOutput {
    match: VoucherMatchResult | null;
    diagnostics: HeuristicMatchDiagnostics;
}

export interface ResolveHeuristicVoucherMatchOptions {
    fortnoxService: VoucherLookupService;
    invoiceType: InvoiceType;
    invoice: MatcherInvoice;
    expectedRows: PostingRow[];
    invoiceRecord: Record<string, unknown>;
    logger: MatcherLogger;
    runtimeBudgetMs?: number;
    detailConcurrency?: number;
    maxDetailFetches?: number;
    dateWindowDaysForBooked?: number;
    nowMs?: () => number;
}

export interface ResolveReferenceVoucherMatchOptions extends ResolveHeuristicVoucherMatchOptions {
    minReferenceScore?: number;
}

export interface ResolveExplicitVoucherMatchOptions {
    fortnoxService: VoucherLookupService;
    invoiceType: InvoiceType;
    invoice: MatcherInvoice;
    expectedRows: PostingRow[];
    invoiceRecord: Record<string, unknown>;
    candidates: ExplicitVoucherCandidate[];
    logger: MatcherLogger;
}

const DEFAULT_RUNTIME_BUDGET_MS = 5000;
const DEFAULT_DETAIL_CONCURRENCY = 6;
const DEFAULT_MAX_DETAIL_FETCHES = 80;
const DEFAULT_BOOKED_DATE_WINDOW_DAYS = 180;
const VOUCHER_PAGE_LIMIT = 150;
const VOUCHER_MAX_PAGES_PER_YEAR = 3;

const SUPPLIER_REFERENCE_PRIORITY = [
    "SUPPLIERINVOICE",
    "SUPPLIERPAYMENT",
    "ACCRUAL",
    "MANUAL",
];

const CUSTOMER_REFERENCE_PRIORITY = [
    "INVOICE",
    "INVOICEPAYMENT",
    "ACCRUAL",
    "MANUAL",
];

function asRecord(value: unknown): Record<string, unknown> | null {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function toText(value: unknown): string {
    if (typeof value === "string") return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    return "";
}

function toNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
        const normalized = value.replace(/\s+/g, "").replace(",", ".");
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

function getValueFromKeys(record: Record<string, unknown>, keys: string[]): unknown {
    for (const key of keys) {
        if (key in record) return record[key];
    }
    return undefined;
}

function parseYearFromIsoDate(value: string): number | null {
    if (!value || value.length < 4) return null;
    const year = Number.parseInt(value.slice(0, 4), 10);
    if (!Number.isFinite(year) || year < 1900 || year > 9999) return null;
    return year;
}

function normalizePostingRows(rows: unknown[]): PostingRow[] {
    const normalized: PostingRow[] = [];
    for (const row of rows) {
        const record = asRecord(row);
        if (!record) continue;
        const account = toInteger(record.Account ?? record.account);
        if (account === null) continue;
        const debit = roundMoney(toNumber(record.Debit ?? record.debit) ?? 0);
        const credit = roundMoney(toNumber(record.Credit ?? record.credit) ?? 0);
        if (debit === 0 && credit === 0) continue;
        normalized.push({
            account,
            debit,
            credit,
            description: toText(record.TransactionInformation ?? record.Description ?? record.description ?? ""),
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

function calculateDateScore(invoiceDate: string, voucherDate: string): number {
    const invoiceMs = parseDate(invoiceDate);
    const voucherMs = parseDate(voucherDate);
    if (invoiceMs === null || voucherMs === null) return 0.5;
    const diffDays = Math.abs(invoiceMs - voucherMs) / (1000 * 60 * 60 * 24);
    if (diffDays <= 2) return 1;
    if (diffDays <= 7) return 0.9;
    if (diffDays <= 14) return 0.75;
    if (diffDays <= 30) return 0.6;
    if (diffDays <= 60) return 0.45;
    if (diffDays <= 120) return 0.3;
    return 0.1;
}

function calculateAmountScore(invoiceTotal: number, totals: PostingTotals): number {
    if (invoiceTotal <= 0) return 0.5;
    const postingTotal = Math.max(totals.debit, totals.credit);
    if (postingTotal <= 0) return 0;
    const diff = Math.abs(postingTotal - invoiceTotal);
    const ratio = diff / Math.max(invoiceTotal, postingTotal);
    if (ratio <= 0.001) return 1;
    if (ratio <= 0.01) return 0.85;
    if (ratio <= 0.05) return 0.6;
    if (ratio <= 0.1) return 0.4;
    return 0.1;
}

function hasControlAccount(rows: PostingRow[], invoiceType: InvoiceType): boolean {
    const accounts = new Set(rows.map((row) => row.account));
    if (invoiceType === "supplier") return accounts.has(2440);
    return accounts.has(1510) || accounts.has(1930);
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
        if (candidateAccounts.has(account)) overlap += 1;
    }
    return overlap / expectedAccounts.size;
}

function normalizeReferenceType(value: unknown): string {
    return toText(value).toUpperCase();
}

function normalizeReferenceNumber(value: unknown): string {
    return toText(value).replace(/\s+/g, "").toUpperCase();
}

function buildReferenceNumberVariants(value: string): string[] {
    if (!value) return [];
    const variants = new Set<string>([value]);
    if (/^\d+$/.test(value)) {
        const numeric = String(Number.parseInt(value, 10));
        if (numeric && numeric !== "NaN") {
            variants.add(numeric);
            variants.add(value.replace(/^0+/, "") || "0");
        }
    }
    return Array.from(variants).filter((entry) => entry.length > 0);
}

function collectReferenceNumbersFromKeys(record: Record<string, unknown>, keys: string[]): string[] {
    const values = new Set<string>();
    for (const key of keys) {
        const value = getValueFromKeys(record, [key]);
        const normalized = normalizeReferenceNumber(value);
        if (!normalized) continue;
        for (const variant of buildReferenceNumberVariants(normalized)) {
            values.add(variant);
        }
    }
    return Array.from(values);
}

export function getReferenceTypePriority(invoiceType: InvoiceType, referenceTypeRaw: string): number {
    const referenceType = normalizeReferenceType(referenceTypeRaw);
    if (!referenceType) return 99;
    const priorities = invoiceType === "supplier"
        ? SUPPLIER_REFERENCE_PRIORITY
        : CUSTOMER_REFERENCE_PRIORITY;
    const index = priorities.indexOf(referenceType);
    return index >= 0 ? index : 99;
}

export function buildSupplierExplicitVoucherCandidates(
    invoiceRecord: Record<string, unknown>
): ExplicitVoucherCandidate[] {
    const parsed: ExplicitVoucherCandidate[] = [];
    for (const entry of asArray(invoiceRecord.Vouchers)) {
        const record = asRecord(entry);
        if (!record) continue;
        const series = toText(record.Series ?? record.VoucherSeries);
        const number = toInteger(record.Number ?? record.VoucherNumber);
        const year = toInteger(record.Year ?? record.VoucherYear);
        if (!series || number === null || number < 1) continue;
        parsed.push({
            series,
            number,
            year: year ?? undefined,
            referenceType: normalizeReferenceType(record.ReferenceType) || undefined,
            referenceNumber: normalizeReferenceNumber(record.ReferenceNumber) || undefined,
        });
    }

    const deduped = new Map<string, ExplicitVoucherCandidate>();
    for (const candidate of parsed) {
        const key = `${candidate.series}:${candidate.number}:${candidate.year ?? "na"}`;
        if (!deduped.has(key)) {
            deduped.set(key, candidate);
        }
    }

    return Array.from(deduped.values());
}

export function buildExplicitSingleVoucherCandidate(
    invoiceRecord: Record<string, unknown>
): ExplicitVoucherCandidate | null {
    const series = toText(getValueFromKeys(invoiceRecord, [
        "VoucherSeries",
        "BookkeepVoucherSeries",
        "PaymentVoucherSeries",
    ]));
    const number = toInteger(getValueFromKeys(invoiceRecord, [
        "VoucherNumber",
        "BookkeepVoucherNumber",
        "PaymentVoucherNumber",
    ]));
    const year = toInteger(getValueFromKeys(invoiceRecord, [
        "VoucherYear",
        "BookkeepVoucherYear",
        "PaymentVoucherYear",
    ]));

    if (!series || number === null || number < 1) {
        return null;
    }

    return {
        series,
        number,
        year: year ?? undefined,
        referenceType: normalizeReferenceType(getValueFromKeys(invoiceRecord, [
            "ReferenceType",
            "VoucherReferenceType",
            "BookkeepReferenceType",
            "PaymentReferenceType",
        ])) || undefined,
        referenceNumber: normalizeReferenceNumber(getValueFromKeys(invoiceRecord, [
            "ReferenceNumber",
            "VoucherReferenceNumber",
            "BookkeepReferenceNumber",
            "PaymentReferenceNumber",
            "DocumentNumber",
            "InvoiceNumber",
            "GivenNumber",
        ])) || undefined,
    };
}

export function buildInvoiceReferenceSignals(
    invoiceType: InvoiceType,
    invoice: MatcherInvoice,
    invoiceRecord: Record<string, unknown>
): InvoiceReferenceSignal[] {
    const signalMap = new Map<string, Set<string>>();

    const pushSignal = (referenceTypeRaw: string, numbers: string[]) => {
        const referenceType = normalizeReferenceType(referenceTypeRaw);
        if (!referenceType || numbers.length === 0) return;
        const target = signalMap.get(referenceType) ?? new Set<string>();
        for (const number of numbers) {
            const normalized = normalizeReferenceNumber(number);
            if (!normalized) continue;
            for (const variant of buildReferenceNumberVariants(normalized)) {
                target.add(variant);
            }
        }
        if (target.size > 0) {
            signalMap.set(referenceType, target);
        }
    };

    const explicitReferenceType = normalizeReferenceType(getValueFromKeys(invoiceRecord, ["ReferenceType"]));
    const explicitReferenceNumber = normalizeReferenceNumber(getValueFromKeys(invoiceRecord, ["ReferenceNumber"]));
    if (explicitReferenceType && explicitReferenceNumber) {
        pushSignal(explicitReferenceType, [explicitReferenceNumber]);
    }

    const invoiceIdentityNumbers = [
        invoice.id,
        invoice.invoiceNumber ?? "",
    ];

    if (invoiceType === "supplier") {
        pushSignal("SUPPLIERINVOICE", [
            ...invoiceIdentityNumbers,
            toText(getValueFromKeys(invoiceRecord, ["GivenNumber"])),
            toText(getValueFromKeys(invoiceRecord, ["InvoiceNumber"])),
        ]);
        pushSignal("SUPPLIERPAYMENT", [
            ...collectReferenceNumbersFromKeys(invoiceRecord, [
                "SupplierInvoicePaymentNumber",
                "SupplierPaymentNumber",
                "PaymentNumber",
                "PaymentId",
            ]),
        ]);
    } else {
        pushSignal("INVOICE", [
            ...invoiceIdentityNumbers,
            toText(getValueFromKeys(invoiceRecord, ["DocumentNumber"])),
            toText(getValueFromKeys(invoiceRecord, ["InvoiceNumber"])),
        ]);
        pushSignal("INVOICEPAYMENT", [
            ...collectReferenceNumbersFromKeys(invoiceRecord, [
                "InvoicePaymentNumber",
                "PaymentNumber",
                "PaymentId",
            ]),
        ]);
    }

    pushSignal("ACCRUAL", [
        ...collectReferenceNumbersFromKeys(invoiceRecord, [
            "AccrualNumber",
            "AccrualId",
        ]),
    ]);

    const signals: InvoiceReferenceSignal[] = [];
    for (const [referenceType, numberSet] of signalMap.entries()) {
        signals.push({
            referenceType,
            referenceNumbers: Array.from(numberSet),
            priority: getReferenceTypePriority(invoiceType, referenceType),
        });
    }

    return signals.sort((a, b) => a.priority - b.priority);
}

function evaluateReferenceMatch(
    invoiceType: InvoiceType,
    candidateReferenceTypeRaw: string | undefined,
    candidateReferenceNumberRaw: string | undefined,
    referenceSignals: InvoiceReferenceSignal[]
): ReferenceMatchResult {
    const candidateReferenceType = normalizeReferenceType(candidateReferenceTypeRaw);
    const candidateReferenceNumber = normalizeReferenceNumber(candidateReferenceNumberRaw);

    if (referenceSignals.length === 0) {
        return {
            score: candidateReferenceType && candidateReferenceNumber ? 0.6 : 0.5,
            exact: false,
            matchedType: candidateReferenceType || undefined,
            matchedNumber: candidateReferenceNumber || undefined,
        };
    }

    if (!candidateReferenceType || !candidateReferenceNumber) {
        return { score: 0, exact: false };
    }

    const candidateVariants = new Set(buildReferenceNumberVariants(candidateReferenceNumber));
    let best: ReferenceMatchResult = { score: 0, exact: false };

    for (const signal of referenceSignals) {
        const overlap = signal.referenceNumbers.find((value) => candidateVariants.has(value));
        const typeMatches = signal.referenceType === candidateReferenceType;

        if (typeMatches && overlap) {
            const byPriority = signal.priority === 0
                ? 1
                : signal.priority === 1
                    ? 0.92
                    : signal.priority === 2
                        ? 0.84
                        : 0.72;
            const score = candidateReferenceType === "MANUAL"
                ? Math.min(byPriority, 0.72)
                : byPriority;
            if (score > best.score) {
                best = {
                    score,
                    exact: true,
                    matchedType: signal.referenceType,
                    matchedNumber: overlap,
                };
            }
            continue;
        }

        if (overlap && !typeMatches) {
            const partialScore = 0.45;
            if (partialScore > best.score) {
                best = {
                    score: partialScore,
                    exact: false,
                    matchedType: signal.referenceType,
                    matchedNumber: overlap,
                };
            }
        }
    }

    if (best.score > 0) {
        return best;
    }

    const weakPriority = getReferenceTypePriority(invoiceType, candidateReferenceType);
    return {
        score: weakPriority < 99 ? 0.15 : 0.05,
        exact: false,
        matchedType: candidateReferenceType,
        matchedNumber: candidateReferenceNumber,
    };
}

function calculateCompositeScore(params: {
    referenceScore: number;
    amountScore: number;
    dateScore: number;
    controlScore: number;
    overlapScore: number;
}): number {
    return clamp01(
        (params.referenceScore * 0.45)
        + (params.amountScore * 0.25)
        + (params.dateScore * 0.15)
        + (params.controlScore * 0.1)
        + (params.overlapScore * 0.05)
    );
}

function buildScoredVoucherMatch(
    invoiceType: InvoiceType,
    invoice: MatcherInvoice,
    expectedRows: PostingRow[],
    candidate: InternalVoucherCandidate,
    voucherRecord: Record<string, unknown>,
    referenceSignals: InvoiceReferenceSignal[]
): VoucherMatchResult | null {
    const rows = normalizePostingRows(asArray(voucherRecord.VoucherRows));
    if (rows.length === 0) return null;

    const totals = buildPostingTotals(rows);
    const dateScore = calculateDateScore(
        invoice.invoiceDate,
        candidate.transactionDate || toText(voucherRecord.TransactionDate)
    );
    const amountScore = calculateAmountScore(invoice.total, totals);
    const controlScore = hasControlAccount(rows, invoiceType) ? 1 : 0;
    const overlapScore = calculateOverlapScore(expectedRows, rows);

    const candidateReferenceType = candidate.referenceType || normalizeReferenceType(voucherRecord.ReferenceType);
    const candidateReferenceNumber = candidate.referenceNumber || normalizeReferenceNumber(voucherRecord.ReferenceNumber);
    const referenceMatch = evaluateReferenceMatch(
        invoiceType,
        candidateReferenceType,
        candidateReferenceNumber,
        referenceSignals
    );

    const referenceScore = Math.max(
        candidate.referenceScoreHint ?? 0,
        referenceMatch.score
    );
    const acceptedByReference = referenceMatch.exact || candidate.referenceExact === true;

    const score = calculateCompositeScore({
        referenceScore,
        amountScore,
        dateScore,
        controlScore,
        overlapScore,
    });

    return {
        score: roundMoney(score),
        voucherRef: {
            series: candidate.series,
            number: candidate.number,
            year: candidate.year,
        },
        rows,
        totals,
        transactionDate: candidate.transactionDate || toText(voucherRecord.TransactionDate),
        referenceEvidence: {
            referenceType: referenceMatch.matchedType
                ?? candidate.matchedReferenceType
                ?? candidateReferenceType
                ?? undefined,
            referenceNumber: referenceMatch.matchedNumber
                ?? candidate.matchedReferenceNumber
                ?? candidateReferenceNumber
                ?? undefined,
        },
        referenceScore: roundMoney(referenceScore),
        acceptedByReference,
    };
}

function shouldPreferMatch(nextMatch: VoucherMatchResult, currentMatch: VoucherMatchResult | null): boolean {
    if (!currentMatch) return true;

    const nextReferenceExact = nextMatch.acceptedByReference === true;
    const currentReferenceExact = currentMatch.acceptedByReference === true;
    if (nextReferenceExact !== currentReferenceExact) {
        return nextReferenceExact;
    }

    const nextReferenceScore = nextMatch.referenceScore ?? 0;
    const currentReferenceScore = currentMatch.referenceScore ?? 0;
    if (nextReferenceScore !== currentReferenceScore) {
        return nextReferenceScore > currentReferenceScore;
    }

    return nextMatch.score > currentMatch.score;
}

export async function resolveExplicitVoucherMatch(
    options: ResolveExplicitVoucherMatchOptions
): Promise<VoucherMatchResult | null> {
    if (options.candidates.length === 0) {
        return null;
    }

    const referenceSignals = buildInvoiceReferenceSignals(
        options.invoiceType,
        options.invoice,
        options.invoiceRecord
    );

    const sortedCandidates = options.candidates
        .map((candidate): InternalVoucherCandidate => {
            const referenceMatch = evaluateReferenceMatch(
                options.invoiceType,
                candidate.referenceType,
                candidate.referenceNumber,
                referenceSignals
            );
            return {
                series: candidate.series,
                number: candidate.number,
                year: candidate.year,
                transactionDate: "",
                referenceType: candidate.referenceType,
                referenceNumber: candidate.referenceNumber,
                referenceScoreHint: referenceMatch.score,
                referenceExact: referenceMatch.exact,
                matchedReferenceType: referenceMatch.matchedType,
                matchedReferenceNumber: referenceMatch.matchedNumber,
            };
        })
        .sort((a, b) => {
            const aExact = a.referenceExact ? 1 : 0;
            const bExact = b.referenceExact ? 1 : 0;
            if (aExact !== bExact) return bExact - aExact;

            const aReferenceScore = a.referenceScoreHint ?? 0;
            const bReferenceScore = b.referenceScoreHint ?? 0;
            if (aReferenceScore !== bReferenceScore) return bReferenceScore - aReferenceScore;

            const aPriority = getReferenceTypePriority(options.invoiceType, a.referenceType ?? "");
            const bPriority = getReferenceTypePriority(options.invoiceType, b.referenceType ?? "");
            if (aPriority !== bPriority) return aPriority - bPriority;

            const aYear = a.year ?? 0;
            const bYear = b.year ?? 0;
            if (aYear !== bYear) return bYear - aYear;

            return b.number - a.number;
        });

    let bestMatch: VoucherMatchResult | null = null;

    for (const candidate of sortedCandidates) {
        let voucherDetailResult;
        try {
            voucherDetailResult = await getVoucherWithYearFallback(
                options.fortnoxService,
                candidate.series,
                candidate.number,
                candidate.year
            );
        } catch (error) {
            if (shouldPropagatePostingTraceError(error)) {
                throw error;
            }
            options.logger.warn("Explicit voucher detail lookup failed", {
                invoiceType: options.invoiceType,
                invoiceId: options.invoice.id,
                voucherSeries: candidate.series,
                voucherNumber: candidate.number,
                voucherYear: candidate.year,
                fortnoxStatusCode: getFortnoxStatusCode(error),
            });
            continue;
        }

        const voucherRecord = asRecord(voucherDetailResult.response.Voucher);
        if (!voucherRecord) continue;

        const scored = buildScoredVoucherMatch(
            options.invoiceType,
            options.invoice,
            options.expectedRows,
            candidate,
            voucherRecord,
            referenceSignals
        );
        if (!scored) continue;

        if (shouldPreferMatch(scored, bestMatch)) {
            bestMatch = scored;
        }
    }

    return bestMatch;
}

export function buildVoucherYearCandidates(
    invoiceRecord: Record<string, unknown>,
    invoiceDate: string,
    dueDate: string
): number[] {
    const seedYears = new Set<number>();
    const explicitKeys = [
        "VoucherYear",
        "BookkeepVoucherYear",
        "PaymentVoucherYear",
        "FinancialYear",
    ];
    for (const key of explicitKeys) {
        const year = toInteger(getValueFromKeys(invoiceRecord, [key]));
        if (year && year > 1900 && year < 9999) {
            seedYears.add(year);
        }
    }

    const invoiceYear = parseYearFromIsoDate(invoiceDate);
    const dueYear = parseYearFromIsoDate(dueDate);
    if (invoiceYear) seedYears.add(invoiceYear);
    if (dueYear) seedYears.add(dueYear);

    const expandedYears = new Set<number>();
    for (const year of seedYears) {
        expandedYears.add(year - 1);
        expandedYears.add(year);
        expandedYears.add(year + 1);
    }

    if (expandedYears.size === 0) {
        const currentYear = new Date().getUTCFullYear();
        expandedYears.add(currentYear - 1);
        expandedYears.add(currentYear);
        expandedYears.add(currentYear + 1);
    }

    const anchorYear = invoiceYear ?? dueYear ?? Math.max(...expandedYears);
    return Array.from(expandedYears)
        .filter((year) => year > 1900 && year < 9999)
        .sort((a, b) => {
            const aDiff = Math.abs(a - anchorYear);
            const bDiff = Math.abs(b - anchorYear);
            if (aDiff !== bDiff) return aDiff - bDiff;
            return b - a;
        });
}

function candidateKey(candidate: InternalVoucherCandidate): string {
    const yearPart = candidate.year ?? "na";
    return `${candidate.series}:${candidate.number}:${yearPart}`;
}

function parseTotalPages(metaInformation: unknown): number | null {
    const meta = asRecord(metaInformation);
    if (!meta) return null;
    const totalPages = toInteger(meta["@TotalPages"]);
    if (!totalPages || totalPages < 1) return null;
    return totalPages;
}

function buildPageProbeOrder(
    totalPages: number | null,
    maxPages: number
): number[] {
    const probes: number[] = [];
    const seen = new Set<number>();

    const pushPage = (page: number) => {
        if (!Number.isFinite(page) || page < 1) return;
        if (seen.has(page)) return;
        seen.add(page);
        probes.push(page);
    };

    // Always sample page 1 first so we can derive total pages when available.
    pushPage(1);

    if (maxPages <= 1) {
        return probes;
    }

    if (totalPages === null) {
        // Fall back to linear probing when Fortnox omits pagination metadata.
        for (let page = 2; page <= maxPages; page += 1) {
            pushPage(page);
        }
        return probes;
    }

    // Probe from the tail next; booked invoices are typically in recent vouchers.
    for (let offset = 0; probes.length < maxPages; offset += 1) {
        const tailPage = totalPages - offset;
        if (tailPage < 1) break;
        pushPage(tailPage);
    }

    // Fill any remaining slots from low pages to keep backward compatibility.
    for (let page = 2; probes.length < maxPages && page <= totalPages; page += 1) {
        pushPage(page);
    }

    return probes;
}

function parseVoucherCandidates(
    voucherList: FortnoxVoucherListResponse,
    fallbackYear?: number
): InternalVoucherCandidate[] {
    const parsed: InternalVoucherCandidate[] = [];
    for (const voucher of voucherList.Vouchers || []) {
        const record = asRecord(voucher);
        if (!record) continue;
        const series = toText(record.VoucherSeries);
        const number = toInteger(record.VoucherNumber);
        if (!series || number === null || number < 1) continue;
        parsed.push({
            series,
            number,
            year: toInteger(record.Year) ?? fallbackYear,
            transactionDate: toText(record.TransactionDate),
            referenceType: normalizeReferenceType(record.ReferenceType) || undefined,
            referenceNumber: normalizeReferenceNumber(record.ReferenceNumber) || undefined,
        });
    }
    return parsed;
}

function buildSortedCandidates(
    dedupedCandidates: InternalVoucherCandidate[],
    invoiceType: InvoiceType,
    invoiceDate: string,
    dateWindowDays: number,
    prioritizeReference: boolean
): InternalVoucherCandidate[] {
    const invoiceDateMs = parseDate(invoiceDate);
    const hardDateFilter = !prioritizeReference && dedupedCandidates.length > 24 && invoiceDateMs !== null;

    const filtered = dedupedCandidates.filter((candidate) => {
        if (!hardDateFilter) return true;
        const candidateMs = parseDate(candidate.transactionDate);
        if (candidateMs === null || invoiceDateMs === null) return true;
        const diffDays = Math.abs(invoiceDateMs - candidateMs) / (1000 * 60 * 60 * 24);
        return diffDays <= dateWindowDays;
    });

    return filtered.sort((a, b) => {
        if (prioritizeReference) {
            const aExact = a.referenceExact ? 1 : 0;
            const bExact = b.referenceExact ? 1 : 0;
            if (aExact !== bExact) return bExact - aExact;

            const aReferenceScore = a.referenceScoreHint ?? 0;
            const bReferenceScore = b.referenceScoreHint ?? 0;
            if (aReferenceScore !== bReferenceScore) return bReferenceScore - aReferenceScore;

            const aPriority = getReferenceTypePriority(invoiceType, a.referenceType ?? "");
            const bPriority = getReferenceTypePriority(invoiceType, b.referenceType ?? "");
            if (aPriority !== bPriority) return aPriority - bPriority;
        }

        const aDiff = (() => {
            const aMs = parseDate(a.transactionDate);
            if (aMs === null || invoiceDateMs === null) return Number.MAX_SAFE_INTEGER;
            return Math.abs(invoiceDateMs - aMs);
        })();
        const bDiff = (() => {
            const bMs = parseDate(b.transactionDate);
            if (bMs === null || invoiceDateMs === null) return Number.MAX_SAFE_INTEGER;
            return Math.abs(invoiceDateMs - bMs);
        })();
        if (aDiff !== bDiff) return aDiff - bDiff;

        const aYear = a.year ?? 0;
        const bYear = b.year ?? 0;
        if (aYear !== bYear) return bYear - aYear;

        return a.number - b.number;
    });
}

interface ResolveVoucherSearchMatchOptions extends ResolveHeuristicVoucherMatchOptions {
    strictReferenceMatch: boolean;
    minReferenceScore?: number;
}

async function resolveVoucherSearchMatch(
    options: ResolveVoucherSearchMatchOptions
): Promise<HeuristicMatchOutput> {
    const runtimeBudgetMs = options.runtimeBudgetMs ?? DEFAULT_RUNTIME_BUDGET_MS;
    const detailConcurrency = options.detailConcurrency ?? DEFAULT_DETAIL_CONCURRENCY;
    const maxDetailFetches = options.maxDetailFetches ?? DEFAULT_MAX_DETAIL_FETCHES;
    const dateWindowDaysForBooked = options.dateWindowDaysForBooked ?? DEFAULT_BOOKED_DATE_WINDOW_DAYS;
    const nowMs = options.nowMs ?? (() => Date.now());
    const startedAt = nowMs();

    const diagnostics: HeuristicMatchDiagnostics = {
        candidateCount: 0,
        referenceCandidateCount: 0,
        filteredCandidateCount: 0,
        detailFetchCount: 0,
        bestScore: 0,
        bestReferenceScore: 0,
        elapsedMs: 0,
        timedOut: false,
        usedListFallback: false,
        usedDetailFallback: false,
        yearsSearched: [],
    };

    const isTimedOut = (): boolean => {
        const elapsed = nowMs() - startedAt;
        if (elapsed >= runtimeBudgetMs) {
            diagnostics.timedOut = true;
            return true;
        }
        return false;
    };

    const referenceSignals = buildInvoiceReferenceSignals(
        options.invoiceType,
        options.invoice,
        options.invoiceRecord
    );

    const yearCandidates = buildVoucherYearCandidates(
        options.invoiceRecord,
        options.invoice.invoiceDate,
        options.invoice.dueDate
    );
    const scopedYears: Array<number | undefined> = [...yearCandidates, undefined];

    const deduped = new Map<string, InternalVoucherCandidate>();
    const minReferenceScore = options.minReferenceScore ?? 0.68;

    for (const financialYear of scopedYears) {
        if (isTimedOut()) break;
        diagnostics.yearsSearched.push(financialYear ?? "unscoped");

        let totalPagesForYear: number | null = null;
        const pageOrder: number[] = [1];

        for (let pageIndex = 0; pageIndex < pageOrder.length; pageIndex += 1) {
            const page = pageOrder[pageIndex];
            if (isTimedOut()) break;

            let voucherListResult;
            try {
                voucherListResult = await getVouchersWithYearFallback(
                    options.fortnoxService,
                    financialYear,
                    {
                        page,
                        limit: VOUCHER_PAGE_LIMIT,
                        allPages: false,
                    }
                );
            } catch (error) {
                options.logger.warn("Voucher list lookup failed", {
                    mode: options.strictReferenceMatch ? "reference" : "heuristic",
                    invoiceType: options.invoiceType,
                    invoiceId: options.invoice.id,
                    financialYear,
                    page,
                    fortnoxStatusCode: getFortnoxStatusCode(error),
                });
                if (shouldPropagatePostingTraceError(error)) {
                    throw error;
                }
                break;
            }

            diagnostics.usedListFallback = diagnostics.usedListFallback || voucherListResult.usedFallback;

            const candidates = parseVoucherCandidates(voucherListResult.response, financialYear);
            for (const candidate of candidates) {
                const referenceMatch = evaluateReferenceMatch(
                    options.invoiceType,
                    candidate.referenceType,
                    candidate.referenceNumber,
                    referenceSignals
                );

                candidate.referenceScoreHint = referenceMatch.score;
                candidate.referenceExact = referenceMatch.exact;
                candidate.matchedReferenceType = referenceMatch.matchedType;
                candidate.matchedReferenceNumber = referenceMatch.matchedNumber;

                if (options.strictReferenceMatch) {
                    if (!referenceMatch.exact || referenceMatch.score < minReferenceScore) {
                        continue;
                    }
                }

                const key = candidateKey(candidate);
                const existing = deduped.get(key);
                if (!existing || (candidate.referenceScoreHint ?? 0) > (existing.referenceScoreHint ?? 0)) {
                    deduped.set(key, candidate);
                }
            }

            const listLength = (voucherListResult.response.Vouchers || []).length;
            const totalPages = parseTotalPages(voucherListResult.response.MetaInformation);
            if (pageIndex === 0 && totalPagesForYear === null) {
                totalPagesForYear = totalPages;
                const expanded = buildPageProbeOrder(totalPagesForYear, VOUCHER_MAX_PAGES_PER_YEAR);
                for (const extraPage of expanded) {
                    if (!pageOrder.includes(extraPage)) {
                        pageOrder.push(extraPage);
                    }
                }
            }
            if (listLength === 0) break;
            if (totalPages !== null && page >= totalPages) break;
            if (totalPagesForYear === null && listLength < VOUCHER_PAGE_LIMIT) break;
        }
    }

    diagnostics.candidateCount = deduped.size;
    diagnostics.referenceCandidateCount = Array.from(deduped.values())
        .filter((candidate) => candidate.referenceExact)
        .length;

    const dateWindowDays = options.invoice.booked === true ? dateWindowDaysForBooked : 45;
    const sortedCandidates = buildSortedCandidates(
        Array.from(deduped.values()),
        options.invoiceType,
        options.invoice.invoiceDate,
        dateWindowDays,
        options.strictReferenceMatch
    );
    diagnostics.filteredCandidateCount = sortedCandidates.length;

    let bestMatch: VoucherMatchResult | null = null;
    let index = 0;
    let detailReservations = 0;

    const reserveCandidate = (): InternalVoucherCandidate | null => {
        if (isTimedOut()) return null;
        if (detailReservations >= maxDetailFetches) return null;
        if (index >= sortedCandidates.length) return null;
        const candidate = sortedCandidates[index];
        index += 1;
        detailReservations += 1;
        diagnostics.detailFetchCount = detailReservations;
        return candidate;
    };

    const workers = Array.from({ length: Math.max(1, detailConcurrency) }, async () => {
        while (true) {
            const candidate = reserveCandidate();
            if (!candidate) return;

            let voucherDetailResult;
            try {
                voucherDetailResult = await getVoucherWithYearFallback(
                    options.fortnoxService,
                    candidate.series,
                    candidate.number,
                    candidate.year
                );
            } catch (error) {
                if (shouldPropagatePostingTraceError(error)) {
                    throw error;
                }
                options.logger.warn("Voucher detail lookup failed", {
                    mode: options.strictReferenceMatch ? "reference" : "heuristic",
                    invoiceType: options.invoiceType,
                    invoiceId: options.invoice.id,
                    voucherSeries: candidate.series,
                    voucherNumber: candidate.number,
                    voucherYear: candidate.year,
                    fortnoxStatusCode: getFortnoxStatusCode(error),
                });
                continue;
            }

            diagnostics.usedDetailFallback = diagnostics.usedDetailFallback || voucherDetailResult.usedFallback;

            const voucherRecord = asRecord(voucherDetailResult.response.Voucher);
            if (!voucherRecord) continue;

            const scoredMatch = buildScoredVoucherMatch(
                options.invoiceType,
                options.invoice,
                options.expectedRows,
                candidate,
                voucherRecord,
                referenceSignals
            );
            if (!scoredMatch) continue;

            if (options.strictReferenceMatch && scoredMatch.acceptedByReference !== true) {
                continue;
            }

            if (scoredMatch.score > diagnostics.bestScore) {
                diagnostics.bestScore = roundMoney(scoredMatch.score);
            }
            if ((scoredMatch.referenceScore ?? 0) > diagnostics.bestReferenceScore) {
                diagnostics.bestReferenceScore = roundMoney(scoredMatch.referenceScore ?? 0);
            }

            if (shouldPreferMatch(scoredMatch, bestMatch)) {
                bestMatch = scoredMatch;
            }
        }
    });

    try {
        await Promise.all(workers);
    } catch (error) {
        if (shouldPropagatePostingTraceError(error)) {
            throw error;
        }
        options.logger.warn("Voucher detail worker failed", {
            mode: options.strictReferenceMatch ? "reference" : "heuristic",
            invoiceType: options.invoiceType,
            invoiceId: options.invoice.id,
            fortnoxStatusCode: getFortnoxStatusCode(error),
        });
    }

    diagnostics.elapsedMs = Math.max(0, nowMs() - startedAt);

    return {
        match: bestMatch,
        diagnostics,
    };
}

export async function resolveReferenceVoucherMatch(
    options: ResolveReferenceVoucherMatchOptions
): Promise<HeuristicMatchOutput> {
    return await resolveVoucherSearchMatch({
        ...options,
        strictReferenceMatch: true,
        minReferenceScore: options.minReferenceScore ?? 0.68,
    });
}

export async function resolveHeuristicVoucherMatch(
    options: ResolveHeuristicVoucherMatchOptions
): Promise<HeuristicMatchOutput> {
    return await resolveVoucherSearchMatch({
        ...options,
        strictReferenceMatch: false,
    });
}

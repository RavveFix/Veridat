export type TriageBucket = 'working' | 'improve' | 'add';

export interface TrendDelta {
    current: number;
    previous: number;
    delta: number;
    direction: 'up' | 'down' | 'flat';
    percentChange: number | null;
}

export interface OperationalScoreInput {
    fortnoxConnected: boolean;
    criticalAlerts: number;
    warningAlerts: number;
    overdueInvoices: number;
    unbookedInvoices: number;
    quotaRatio: number | null;
}

export interface OperationalScoreResult {
    score: number;
    quotaPenalty: number;
}

export interface AdoptionScoreInput {
    importsLast7: number;
    invoiceItemsLast7: number;
    invoiceCompletedLast7: number;
    activePeriods: number;
    reconciledPeriods: number;
    vatReportAgeDays: number | null;
}

export interface AdoptionScoreResult {
    score: number;
    bankCadenceScore: number;
    invoiceFlowScore: number;
    reconciliationScore: number;
    vatFreshnessScore: number;
}

export interface TriageClassificationInput {
    score: number;
    hasBlocker?: boolean;
    hasWarning?: boolean;
    missingCapability?: boolean;
}

export interface TimeWindows {
    now: Date;
    currentStart: Date;
    previousStart: Date;
    previousEnd: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function normalizeNonNegative(value: number): number {
    if (!Number.isFinite(value) || value < 0) return 0;
    return value;
}

export function computeOperationalScore(input: OperationalScoreInput): OperationalScoreResult {
    const criticalAlerts = normalizeNonNegative(input.criticalAlerts);
    const warningAlerts = normalizeNonNegative(input.warningAlerts);
    const overdueInvoices = normalizeNonNegative(input.overdueInvoices);
    const unbookedInvoices = normalizeNonNegative(input.unbookedInvoices);

    let score = 100;

    if (!input.fortnoxConnected) {
        score -= 30;
    }

    score -= Math.min(35, criticalAlerts * 15 + warningAlerts * 8);
    score -= Math.min(15, overdueInvoices * 5);
    score -= Math.min(10, unbookedInvoices * 2);

    let quotaPenalty = 0;
    if (typeof input.quotaRatio === 'number' && Number.isFinite(input.quotaRatio)) {
        if (input.quotaRatio >= 0.95) {
            quotaPenalty = 15;
        } else if (input.quotaRatio >= 0.8) {
            quotaPenalty = 8;
        }
        score -= quotaPenalty;
    }

    return {
        score: clamp(Math.round(score), 0, 100),
        quotaPenalty,
    };
}

export function computeAdoptionScore(input: AdoptionScoreInput): AdoptionScoreResult {
    const importsLast7 = normalizeNonNegative(input.importsLast7);
    const invoiceItemsLast7 = normalizeNonNegative(input.invoiceItemsLast7);
    const invoiceCompletedLast7 = normalizeNonNegative(input.invoiceCompletedLast7);
    const activePeriods = normalizeNonNegative(input.activePeriods);
    const reconciledPeriods = normalizeNonNegative(input.reconciledPeriods);

    const bankCadenceScore = importsLast7 >= 2
        ? 100
        : importsLast7 === 1
            ? 70
            : 25;

    const invoiceFlowScore = invoiceItemsLast7 === 0
        ? 20
        : clamp(Math.round((invoiceCompletedLast7 / invoiceItemsLast7) * 100), 0, 100);

    const reconciliationScore = activePeriods === 0
        ? 40
        : clamp(Math.round((reconciledPeriods / activePeriods) * 100), 0, 100);

    let vatFreshnessScore = 25;
    if (input.vatReportAgeDays !== null && Number.isFinite(input.vatReportAgeDays)) {
        if (input.vatReportAgeDays <= 31) {
            vatFreshnessScore = 100;
        } else if (input.vatReportAgeDays <= 62) {
            vatFreshnessScore = 65;
        } else {
            vatFreshnessScore = 25;
        }
    }

    const score = clamp(
        Math.round(
            bankCadenceScore * 0.30 +
            invoiceFlowScore * 0.30 +
            reconciliationScore * 0.25 +
            vatFreshnessScore * 0.15
        ),
        0,
        100
    );

    return {
        score,
        bankCadenceScore,
        invoiceFlowScore,
        reconciliationScore,
        vatFreshnessScore,
    };
}

export function computePlatformScore(operationalScore: number, adoptionScore: number): number {
    return clamp(
        Math.round(operationalScore * 0.65 + adoptionScore * 0.35),
        0,
        100
    );
}

export function classifyTriageBucket(input: TriageClassificationInput): TriageBucket {
    const score = clamp(Math.round(input.score), 0, 100);
    const hasBlocker = Boolean(input.hasBlocker);
    const hasWarning = Boolean(input.hasWarning);
    const missingCapability = Boolean(input.missingCapability);

    if (missingCapability || score < 45) {
        return 'add';
    }

    if (score >= 75 && !hasBlocker) {
        return 'working';
    }

    if ((score >= 45 && score <= 74) || hasWarning || hasBlocker) {
        return 'improve';
    }

    return 'improve';
}

export function buildTimeWindows(now: Date, windowDays: number): TimeWindows {
    const safeWindowDays = Math.max(1, Math.floor(windowDays));
    const nowMs = now.getTime();
    const windowMs = safeWindowDays * DAY_MS;

    return {
        now: new Date(nowMs),
        currentStart: new Date(nowMs - windowMs),
        previousStart: new Date(nowMs - (windowMs * 2)),
        previousEnd: new Date(nowMs - windowMs),
    };
}

function parseTimestampMs(value: string | null | undefined): number | null {
    if (!value) return null;
    const ms = new Date(value).getTime();
    if (!Number.isFinite(ms)) return null;
    return ms;
}

export function countIsoTimestampsInRange(
    timestamps: Array<string | null | undefined>,
    startInclusive: Date,
    endExclusive: Date
): number {
    const startMs = startInclusive.getTime();
    const endMs = endExclusive.getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
        return 0;
    }

    let count = 0;
    for (const timestamp of timestamps) {
        const ts = parseTimestampMs(timestamp);
        if (ts === null) continue;
        if (ts >= startMs && ts < endMs) {
            count += 1;
        }
    }
    return count;
}

export function calcTrendDelta(current: number, previous: number): TrendDelta {
    const safeCurrent = Number.isFinite(current) ? current : 0;
    const safePrevious = Number.isFinite(previous) ? previous : 0;
    const delta = safeCurrent - safePrevious;

    let percentChange: number | null;
    if (safePrevious === 0) {
        percentChange = safeCurrent === 0 ? 0 : null;
    } else {
        percentChange = Math.round((delta / safePrevious) * 100);
    }

    return {
        current: safeCurrent,
        previous: safePrevious,
        delta,
        direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat',
        percentChange,
    };
}

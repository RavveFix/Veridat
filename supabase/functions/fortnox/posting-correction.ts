import type { FortnoxVoucher } from "./types.ts";

export type PostingCorrectionSide = "debit" | "credit";

export interface PostingCorrectionRequest {
    invoiceType: "customer";
    invoiceId: number;
    correction: {
        side: PostingCorrectionSide;
        fromAccount: number;
        toAccount: number;
        amount: number;
        voucherSeries: string;
        transactionDate: string;
        reason: string;
    };
    idempotencyKey: string;
    sourceContext: string;
    aiDecisionId?: string;
}

export class PostingCorrectionValidationError extends Error {
    field: string;

    constructor(field: string, message: string) {
        super(message);
        this.field = field;
    }
}

const DEFAULT_SOURCE_CONTEXT = "invoice-posting-review";

function asRecord(value: unknown): Record<string, unknown> | null {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}

function toTrimmedString(value: unknown): string {
    if (typeof value !== "string") return "";
    return value.trim();
}

function toFiniteNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
        const parsed = Number(value.trim().replace(",", "."));
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function toPositiveInteger(value: unknown): number | null {
    const parsed = toFiniteNumber(value);
    if (parsed === null) return null;
    const rounded = Math.round(parsed);
    if (!Number.isFinite(rounded) || rounded < 1) return null;
    return rounded;
}

function assertInvoiceType(value: unknown): "customer" {
    if (value !== "customer") {
        throw new PostingCorrectionValidationError(
            "payload.invoiceType",
            "Only customer invoice corrections are supported in v1."
        );
    }
    return "customer";
}

function assertInvoiceId(value: unknown): number {
    const invoiceId = toPositiveInteger(value);
    if (invoiceId === null) {
        throw new PostingCorrectionValidationError(
            "payload.invoiceId",
            "payload.invoiceId must be a positive integer."
        );
    }
    return invoiceId;
}

function assertCorrectionSide(value: unknown): PostingCorrectionSide {
    const side = toTrimmedString(value).toLowerCase();
    if (side !== "debit" && side !== "credit") {
        throw new PostingCorrectionValidationError(
            "payload.correction.side",
            "payload.correction.side must be debit or credit."
        );
    }
    return side;
}

function assertAccountNumber(value: unknown, field: string): number {
    const account = toPositiveInteger(value);
    if (account === null || account < 1000 || account > 9999) {
        throw new PostingCorrectionValidationError(
            field,
            `${field} must be a 4-digit BAS account number.`
        );
    }
    return account;
}

function assertAmount(value: unknown): number {
    const amount = toFiniteNumber(value);
    if (amount === null || amount <= 0) {
        throw new PostingCorrectionValidationError(
            "payload.correction.amount",
            "payload.correction.amount must be greater than zero."
        );
    }
    return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function assertVoucherSeries(value: unknown): string {
    const series = toTrimmedString(value) || "A";
    if (!/^[A-Za-z0-9]{1,6}$/.test(series)) {
        throw new PostingCorrectionValidationError(
            "payload.correction.voucherSeries",
            "payload.correction.voucherSeries must be 1-6 alphanumeric characters."
        );
    }
    return series.toUpperCase();
}

function assertTransactionDate(value: unknown): string {
    const date = toTrimmedString(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new PostingCorrectionValidationError(
            "payload.correction.transactionDate",
            "payload.correction.transactionDate must be an ISO date (YYYY-MM-DD)."
        );
    }
    const parsed = Date.parse(`${date}T00:00:00Z`);
    if (!Number.isFinite(parsed)) {
        throw new PostingCorrectionValidationError(
            "payload.correction.transactionDate",
            "payload.correction.transactionDate is invalid."
        );
    }
    return date;
}

function buildDefaultReason(invoiceId: number): string {
    return `Korrigering avvikelse kundfaktura ${invoiceId}`;
}

function normalizeReason(value: unknown, invoiceId: number): string {
    const reason = toTrimmedString(value) || buildDefaultReason(invoiceId);
    return reason.slice(0, 200);
}

function normalizeSourceContext(value: unknown): string {
    const sourceContext = toTrimmedString(value) || DEFAULT_SOURCE_CONTEXT;
    return sourceContext.slice(0, 64);
}

export function buildPostingCorrectionIdempotencyKey(payload: {
    invoiceType: "customer";
    invoiceId: number;
    correction: {
        side: PostingCorrectionSide;
        fromAccount: number;
        toAccount: number;
        amount: number;
        voucherSeries: string;
        transactionDate: string;
    };
}): string {
    const amountToken = payload.correction.amount.toFixed(2);
    return [
        "posting_correction_v1",
        payload.invoiceType,
        String(payload.invoiceId),
        payload.correction.side,
        String(payload.correction.fromAccount),
        String(payload.correction.toAccount),
        amountToken,
        payload.correction.voucherSeries,
        payload.correction.transactionDate,
    ].join(":");
}

export function normalizePostingCorrectionRequest(payload: unknown): PostingCorrectionRequest {
    const payloadRecord = asRecord(payload);
    if (!payloadRecord) {
        throw new PostingCorrectionValidationError("payload", "payload must be an object.");
    }

    const correctionRecord = asRecord(payloadRecord.correction);
    if (!correctionRecord) {
        throw new PostingCorrectionValidationError(
            "payload.correction",
            "payload.correction must be an object."
        );
    }

    const invoiceType = assertInvoiceType(payloadRecord.invoiceType);
    const invoiceId = assertInvoiceId(payloadRecord.invoiceId);
    const side = assertCorrectionSide(correctionRecord.side);
    const fromAccount = assertAccountNumber(
        correctionRecord.fromAccount,
        "payload.correction.fromAccount"
    );
    const toAccount = assertAccountNumber(
        correctionRecord.toAccount,
        "payload.correction.toAccount"
    );

    if (fromAccount === toAccount) {
        throw new PostingCorrectionValidationError(
            "payload.correction.toAccount",
            "payload.correction.toAccount must differ from fromAccount."
        );
    }

    const amount = assertAmount(correctionRecord.amount);
    const voucherSeries = assertVoucherSeries(correctionRecord.voucherSeries);
    const transactionDate = assertTransactionDate(correctionRecord.transactionDate);
    const reason = normalizeReason(correctionRecord.reason, invoiceId);
    const sourceContext = normalizeSourceContext(payloadRecord.sourceContext);
    const aiDecisionId = toTrimmedString(payloadRecord.aiDecisionId) || undefined;

    const base = {
        invoiceType,
        invoiceId,
        correction: {
            side,
            fromAccount,
            toAccount,
            amount,
            voucherSeries,
            transactionDate,
        },
    } as const;

    const idempotencyKey = toTrimmedString(payloadRecord.idempotencyKey)
        || buildPostingCorrectionIdempotencyKey(base);

    return {
        ...base,
        correction: {
            ...base.correction,
            reason,
        },
        idempotencyKey,
        sourceContext,
        aiDecisionId,
    };
}

export function buildPostingCorrectionVoucher(
    request: PostingCorrectionRequest
): FortnoxVoucher {
    const { correction, invoiceId } = request;
    const debitRow = correction.side === "debit"
        ? { account: correction.toAccount, debit: correction.amount, credit: 0 }
        : { account: correction.fromAccount, debit: correction.amount, credit: 0 };
    const creditRow = correction.side === "debit"
        ? { account: correction.fromAccount, debit: 0, credit: correction.amount }
        : { account: correction.toAccount, debit: 0, credit: correction.amount };

    return {
        Description: correction.reason,
        TransactionDate: correction.transactionDate,
        VoucherSeries: correction.voucherSeries,
        ReferenceType: "INVOICE",
        ReferenceNumber: String(invoiceId),
        VoucherRows: [
            {
                Account: debitRow.account,
                Debit: debitRow.debit,
                Credit: debitRow.credit,
                TransactionInformation: correction.reason,
            },
            {
                Account: creditRow.account,
                Debit: creditRow.debit,
                Credit: creditRow.credit,
                TransactionInformation: correction.reason,
            },
        ],
    };
}

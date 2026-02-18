import { assertEquals, assertThrows } from "jsr:@std/assert";
import {
    buildPostingCorrectionIdempotencyKey,
    buildPostingCorrectionVoucher,
    normalizePostingCorrectionRequest,
    PostingCorrectionValidationError,
} from "./posting-correction.ts";

Deno.test("normalizePostingCorrectionRequest accepterar kundfaktura och skapar defaults", () => {
    const parsed = normalizePostingCorrectionRequest({
        invoiceType: "customer",
        invoiceId: 12345,
        correction: {
            side: "debit",
            fromAccount: 3001,
            toAccount: 3041,
            amount: 1000,
            voucherSeries: "A",
            transactionDate: "2026-02-18",
            reason: "AI-korrigering av konto",
        },
    });

    assertEquals(parsed.invoiceType, "customer");
    assertEquals(parsed.invoiceId, 12345);
    assertEquals(parsed.correction.side, "debit");
    assertEquals(parsed.correction.fromAccount, 3001);
    assertEquals(parsed.correction.toAccount, 3041);
    assertEquals(parsed.correction.amount, 1000);
    assertEquals(parsed.sourceContext, "invoice-posting-review");
    assertEquals(parsed.idempotencyKey.includes("posting_correction_v1"), true);
});

Deno.test("normalizePostingCorrectionRequest blockerar invoiceType != customer i v1", () => {
    assertThrows(
        () => normalizePostingCorrectionRequest({
            invoiceType: "supplier",
            invoiceId: 99,
            correction: {
                side: "debit",
                fromAccount: 3001,
                toAccount: 3041,
                amount: 1,
                voucherSeries: "A",
                transactionDate: "2026-02-18",
            },
        }),
        PostingCorrectionValidationError
    );
});

Deno.test("normalizePostingCorrectionRequest blockerar ogiltiga konton/belopp", () => {
    assertThrows(
        () => normalizePostingCorrectionRequest({
            invoiceType: "customer",
            invoiceId: 10,
            correction: {
                side: "debit",
                fromAccount: 244,
                toAccount: 3041,
                amount: 1,
                voucherSeries: "A",
                transactionDate: "2026-02-18",
            },
        }),
        PostingCorrectionValidationError
    );

    assertThrows(
        () => normalizePostingCorrectionRequest({
            invoiceType: "customer",
            invoiceId: 10,
            correction: {
                side: "debit",
                fromAccount: 3001,
                toAccount: 3001,
                amount: 0,
                voucherSeries: "A",
                transactionDate: "2026-02-18",
            },
        }),
        PostingCorrectionValidationError
    );
});

Deno.test("buildPostingCorrectionIdempotencyKey är deterministisk", () => {
    const keyA = buildPostingCorrectionIdempotencyKey({
        invoiceType: "customer",
        invoiceId: 991,
        correction: {
            side: "credit",
            fromAccount: 1510,
            toAccount: 1930,
            amount: 2500,
            voucherSeries: "A",
            transactionDate: "2026-02-18",
        },
    });
    const keyB = buildPostingCorrectionIdempotencyKey({
        invoiceType: "customer",
        invoiceId: 991,
        correction: {
            side: "credit",
            fromAccount: 1510,
            toAccount: 1930,
            amount: 2500,
            voucherSeries: "A",
            transactionDate: "2026-02-18",
        },
    });

    assertEquals(keyA, keyB);
});

Deno.test("buildPostingCorrectionVoucher skapar balanserad voucher med INVOICE-referens", () => {
    const request = normalizePostingCorrectionRequest({
        invoiceType: "customer",
        invoiceId: 555,
        correction: {
            side: "debit",
            fromAccount: 3001,
            toAccount: 3041,
            amount: 400,
            voucherSeries: "B",
            transactionDate: "2026-02-18",
            reason: "Kontojustering",
        },
    });

    const voucher = buildPostingCorrectionVoucher(request);

    assertEquals(voucher.ReferenceType, "INVOICE");
    assertEquals(voucher.ReferenceNumber, "555");
    assertEquals(voucher.VoucherRows.length, 2);
    assertEquals(voucher.VoucherRows[0].Account, 3041);
    assertEquals(voucher.VoucherRows[0].Debit, 400);
    assertEquals(voucher.VoucherRows[1].Account, 3001);
    assertEquals(voucher.VoucherRows[1].Credit, 400);
});

import {
    assert,
    assertEquals,
} from "jsr:@std/assert";

import {
    getReferenceTypePriority,
    resolveHeuristicVoucherMatch,
    type PostingRow,
} from "./posting-trace-matcher.ts";

Deno.test("getReferenceTypePriority använder korrekt ordning per fakturatyp", () => {
    assert(
        getReferenceTypePriority("supplier", "SUPPLIERINVOICE")
        < getReferenceTypePriority("supplier", "SUPPLIERPAYMENT")
    );
    assert(
        getReferenceTypePriority("supplier", "SUPPLIERPAYMENT")
        < getReferenceTypePriority("supplier", "ACCRUAL")
    );
    assert(
        getReferenceTypePriority("supplier", "ACCRUAL")
        < getReferenceTypePriority("supplier", "MANUAL")
    );

    assert(
        getReferenceTypePriority("customer", "INVOICE")
        < getReferenceTypePriority("customer", "INVOICEPAYMENT")
    );
    assert(
        getReferenceTypePriority("customer", "INVOICEPAYMENT")
        < getReferenceTypePriority("customer", "ACCRUAL")
    );
    assert(
        getReferenceTypePriority("customer", "ACCRUAL")
        < getReferenceTypePriority("customer", "MANUAL")
    );
});

Deno.test("resolveHeuristicVoucherMatch låter exakt referensmatch väga tyngre än svag datumsignal", async () => {
    const expectedRows: PostingRow[] = [
        { account: 2440, debit: 0, credit: 1250, description: "" },
        { account: 2641, debit: 250, credit: 0, description: "" },
        { account: 6110, debit: 1000, credit: 0, description: "" },
    ];

    const service = {
        async getVouchers(financialYear?: number, _voucherSeries?: string, pagination?: { page?: number }) {
            if (financialYear !== 2026 || (pagination?.page ?? 1) > 1) {
                return { Vouchers: [], MetaInformation: { "@TotalPages": 1 } };
            }
            return {
                Vouchers: [
                    {
                        Description: "Reference-backed candidate",
                        VoucherRows: [],
                        VoucherSeries: "A",
                        VoucherNumber: 10,
                        Year: 2026,
                        TransactionDate: "2025-01-01",
                        ReferenceType: "SUPPLIERINVOICE",
                        ReferenceNumber: "29",
                    },
                    {
                        Description: "Date-close candidate without reference",
                        VoucherRows: [],
                        VoucherSeries: "B",
                        VoucherNumber: 20,
                        Year: 2026,
                        TransactionDate: "2026-01-15",
                    },
                ],
                MetaInformation: { "@TotalPages": 1 },
            };
        },
        async getVoucher(series: string, number: number) {
            if (series === "A" && number === 10) {
                return {
                    Voucher: {
                        Description: "Reference-backed candidate",
                        VoucherSeries: "A",
                        VoucherNumber: 10,
                        Year: 2026,
                        TransactionDate: "2025-01-01",
                        ReferenceType: "SUPPLIERINVOICE",
                        ReferenceNumber: "29",
                        VoucherRows: [
                            { Account: 2440, Debit: 0, Credit: 1250, TransactionInformation: "" },
                            { Account: 2641, Debit: 250, Credit: 0, TransactionInformation: "" },
                            { Account: 6110, Debit: 1000, Credit: 0, TransactionInformation: "" },
                        ],
                    },
                };
            }

            return {
                Voucher: {
                    Description: "Date-close candidate without reference",
                    VoucherSeries: "B",
                    VoucherNumber: 20,
                    Year: 2026,
                    TransactionDate: "2026-01-15",
                    VoucherRows: [
                        { Account: 2440, Debit: 0, Credit: 1250, TransactionInformation: "" },
                        { Account: 2641, Debit: 250, Credit: 0, TransactionInformation: "" },
                        { Account: 6110, Debit: 1000, Credit: 0, TransactionInformation: "" },
                    ],
                },
            };
        },
    };

    const output = await resolveHeuristicVoucherMatch({
        fortnoxService: service,
        invoiceType: "supplier",
        invoice: {
            id: "29",
            invoiceNumber: "49173621",
            invoiceDate: "2026-01-15",
            dueDate: "2026-02-14",
            total: 1250,
            booked: true,
        },
        expectedRows,
        invoiceRecord: {
            GivenNumber: 29,
            InvoiceNumber: "49173621",
        },
        logger: {
            warn: () => undefined,
            info: () => undefined,
        },
        runtimeBudgetMs: 5000,
        detailConcurrency: 2,
        maxDetailFetches: 20,
        dateWindowDaysForBooked: 180,
    });

    assert(output.match !== null);
    assertEquals(output.match?.voucherRef.series, "A");
    assertEquals(output.match?.voucherRef.number, 10);
    assert((output.match?.referenceScore ?? 0) > 0.8);
});

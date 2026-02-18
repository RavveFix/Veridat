import {
    assert,
    assertEquals,
    assertRejects,
} from "jsr:@std/assert";

import { FortnoxClientError } from "../../services/FortnoxErrors.ts";
import {
    getVoucherWithYearFallback,
    getVouchersWithYearFallback,
    shouldPropagatePostingTraceError,
} from "./posting-trace-fallback.ts";
import { buildPostingIssues } from "./posting-trace-issues.ts";
import {
    buildExplicitSingleVoucherCandidate,
    buildSupplierExplicitVoucherCandidates,
    buildVoucherYearCandidates,
    resolveExplicitVoucherMatch,
    resolveReferenceVoucherMatch,
    resolveHeuristicVoucherMatch,
    type PostingRow,
} from "./posting-trace-matcher.ts";

Deno.test("getVouchersWithYearFallback använder fallback utan financialYear vid FortnoxClientError", async () => {
    const calls: Array<number | undefined> = [];

    const service = {
        async getVouchers(financialYear?: number) {
            calls.push(financialYear);
            if (financialYear !== undefined) {
                throw new FortnoxClientError("invalid financial year", 400);
            }
            return { Vouchers: [] };
        },
    };

    const result = await getVouchersWithYearFallback(service, 2026, {
        page: 1,
        limit: 120,
        allPages: false,
    });

    assertEquals(calls, [2026, undefined]);
    assertEquals(result.usedFallback, true);
    assertEquals(result.initialStatusCode, 400);
});

Deno.test("getVoucherWithYearFallback retryar utan year när year-variant ger FortnoxClientError", async () => {
    const calls: Array<number | undefined> = [];

    const service = {
        async getVoucher(_series: string, _number: number, financialYear?: number) {
            calls.push(financialYear);
            if (financialYear !== undefined) {
                throw new FortnoxClientError("invalid year", 400);
            }
            return {
                Voucher: {
                    Description: "Voucher",
                    TransactionDate: "2026-01-15",
                    VoucherSeries: "A",
                    VoucherRows: [],
                    VoucherNumber: 123,
                    Year: 2026,
                },
            };
        },
    };

    const result = await getVoucherWithYearFallback(service, "A", 123, 2025);

    assertEquals(calls, [2025, undefined]);
    assertEquals(result.usedFallback, true);
    assertEquals(result.initialStatusCode, 400);
});

Deno.test("getVouchersWithYearFallback kastar vidare när både primary och fallback misslyckas", async () => {
    const service = {
        async getVouchers(financialYear?: number) {
            if (financialYear !== undefined) {
                throw new FortnoxClientError("invalid financial year", 400);
            }
            throw new FortnoxClientError("fallback failed", 400);
        },
    };

    await assertRejects(
        () =>
            getVouchersWithYearFallback(service, 2026, {
                page: 1,
                limit: 120,
                allPages: false,
            }),
        FortnoxClientError
    );

    assertEquals(
        shouldPropagatePostingTraceError(new FortnoxClientError("recoverable", 400)),
        false
    );
});

Deno.test("getVouchersWithYearFallback gör ett anrop när financialYear saknas", async () => {
    let callCount = 0;

    const service = {
        async getVouchers(_financialYear?: number) {
            callCount += 1;
            return { Vouchers: [] };
        },
    };

    const result = await getVouchersWithYearFallback(service, undefined, {
        page: 1,
        limit: 120,
        allPages: false,
    });

    assertEquals(callCount, 1);
    assertEquals(result.usedFallback, false);
});

Deno.test("buildPostingIssues visar endast VOUCHER_LINK_MISSING för bokförd faktura utan matchad verifikation", () => {
    const issues = buildPostingIssues(
        "supplier",
        { booked: true },
        {
            balanced: true,
            total_match: true,
            vat_match: true,
            control_account_present: true,
            row_account_consistency: true,
        },
        "booked",
        "none",
        0
    );

    assertEquals(issues.map((issue) => issue.code), ["VOUCHER_LINK_MISSING"]);
});

Deno.test("buildPostingIssues visar ACTUAL_POSTING_UNAVAILABLE för obokförd faktura", () => {
    const issues = buildPostingIssues(
        "supplier",
        { booked: false },
        {
            balanced: true,
            total_match: true,
            vat_match: true,
            control_account_present: true,
            row_account_consistency: true,
        },
        "unbooked",
        "none",
        0
    );

    assertEquals(issues.map((issue) => issue.code), ["ACTUAL_POSTING_UNAVAILABLE"]);
});

Deno.test("buildVoucherYearCandidates inkluderar datumår samt ±1 år", () => {
    const years = buildVoucherYearCandidates(
        {
            VoucherYear: 2024,
            FinancialYear: 2026,
        },
        "2025-12-30",
        "2026-01-10"
    );

    assert(years.includes(2023));
    assert(years.includes(2024));
    assert(years.includes(2025));
    assert(years.includes(2026));
    assert(years.includes(2027));
});

Deno.test("resolveExplicitVoucherMatch hittar supplier-verifikation via Vouchers[]", async () => {
    const invoiceRecord = {
        GivenNumber: 29,
        InvoiceNumber: "49173621",
        Vouchers: [
            { Series: "A", Number: 7001, Year: 2026, ReferenceType: "SUPPLIERINVOICE", ReferenceNumber: "29" },
        ],
    };

    const candidates = buildSupplierExplicitVoucherCandidates(invoiceRecord);
    assertEquals(candidates.length, 1);

    const service = {
        async getVouchers() {
            return { Vouchers: [], MetaInformation: { "@TotalPages": 0 } };
        },
        async getVoucher(series: string, number: number) {
            assertEquals(series, "A");
            assertEquals(number, 7001);
            return {
                Voucher: {
                    Description: "Supplier voucher",
                    VoucherSeries: "A",
                    VoucherNumber: 7001,
                    Year: 2026,
                    ReferenceType: "SUPPLIERINVOICE",
                    ReferenceNumber: "29",
                    TransactionDate: "2026-01-20",
                    VoucherRows: [
                        { Account: 2440, Debit: 0, Credit: 1250, TransactionInformation: "" },
                        { Account: 2641, Debit: 250, Credit: 0, TransactionInformation: "" },
                        { Account: 6110, Debit: 1000, Credit: 0, TransactionInformation: "" },
                    ],
                },
            };
        },
    };

    const match = await resolveExplicitVoucherMatch({
        fortnoxService: service,
        invoiceType: "supplier",
        invoice: {
            id: "29",
            invoiceNumber: "49173621",
            invoiceDate: "2026-01-19",
            dueDate: "2026-02-19",
            total: 1250,
            booked: true,
        },
        expectedRows: [
            { account: 2440, debit: 0, credit: 1250, description: "" },
            { account: 2641, debit: 250, credit: 0, description: "" },
            { account: 6110, debit: 1000, credit: 0, description: "" },
        ],
        invoiceRecord,
        candidates,
        logger: {
            warn: () => undefined,
            info: () => undefined,
        },
    });

    assert(match !== null);
    assertEquals(match?.voucherRef.series, "A");
    assertEquals(match?.voucherRef.number, 7001);
    assertEquals(match?.rows.length, 3);
});

Deno.test("resolveExplicitVoucherMatch hittar customer-verifikation via VoucherSeries/Number/Year", async () => {
    const invoiceRecord = {
        DocumentNumber: 1055,
        VoucherSeries: "B",
        VoucherNumber: 442,
        VoucherYear: 2026,
    };
    const explicitSingle = buildExplicitSingleVoucherCandidate(invoiceRecord);
    assert(explicitSingle !== null);

    const service = {
        async getVouchers() {
            return { Vouchers: [], MetaInformation: { "@TotalPages": 0 } };
        },
        async getVoucher(series: string, number: number) {
            assertEquals(series, "B");
            assertEquals(number, 442);
            return {
                Voucher: {
                    Description: "Customer voucher",
                    VoucherSeries: "B",
                    VoucherNumber: 442,
                    Year: 2026,
                    ReferenceType: "INVOICE",
                    ReferenceNumber: "1055",
                    TransactionDate: "2026-01-14",
                    VoucherRows: [
                        { Account: 1510, Debit: 625, Credit: 0, TransactionInformation: "" },
                        { Account: 3001, Debit: 0, Credit: 500, TransactionInformation: "" },
                        { Account: 2611, Debit: 0, Credit: 125, TransactionInformation: "" },
                    ],
                },
            };
        },
    };

    const match = await resolveExplicitVoucherMatch({
        fortnoxService: service,
        invoiceType: "customer",
        invoice: {
            id: "1055",
            invoiceNumber: "1055",
            invoiceDate: "2026-01-14",
            dueDate: "2026-02-13",
            total: 625,
            booked: true,
        },
        expectedRows: [
            { account: 1510, debit: 625, credit: 0, description: "" },
            { account: 3001, debit: 0, credit: 500, description: "" },
            { account: 2611, debit: 0, credit: 125, description: "" },
        ],
        invoiceRecord,
        candidates: [explicitSingle],
        logger: {
            warn: () => undefined,
            info: () => undefined,
        },
    });

    assert(match !== null);
    assertEquals(match?.voucherRef.series, "B");
    assertEquals(match?.voucherRef.number, 442);
    assertEquals(match?.rows.length, 3);
});

Deno.test("resolveReferenceVoucherMatch hittar match via ReferenceType/ReferenceNumber utan heuristikkrav", async () => {
    const expectedRows: PostingRow[] = [
        { account: 2440, debit: 0, credit: 1250, description: "" },
        { account: 2641, debit: 250, credit: 0, description: "" },
        { account: 6110, debit: 1000, credit: 0, description: "" },
    ];

    const service = {
        async getVouchers(financialYear?: number, _voucherSeries?: string, pagination?: { page?: number; limit?: number }) {
            if (financialYear !== 2026) {
                return { Vouchers: [], MetaInformation: { "@TotalPages": 0 } };
            }
            const page = pagination?.page ?? 1;
            if (page > 1) {
                return { Vouchers: [], MetaInformation: { "@TotalPages": 1 } };
            }
            return {
                Vouchers: [
                    {
                        Description: "Reference match candidate",
                        VoucherRows: [],
                        VoucherSeries: "A",
                        VoucherNumber: 900,
                        Year: 2026,
                        TransactionDate: "2026-01-15",
                        ReferenceType: "SUPPLIERINVOICE",
                        ReferenceNumber: "29",
                    },
                ],
                MetaInformation: { "@TotalPages": 1 },
            };
        },
        async getVoucher(series: string, number: number) {
            assertEquals(series, "A");
            assertEquals(number, 900);
            return {
                Voucher: {
                    Description: "Matched voucher",
                    VoucherSeries: "A",
                    VoucherNumber: 900,
                    Year: 2026,
                    TransactionDate: "2026-01-15",
                    ReferenceType: "SUPPLIERINVOICE",
                    ReferenceNumber: "29",
                    VoucherRows: [
                        { Account: 2440, Debit: 0, Credit: 1250, TransactionInformation: "" },
                        { Account: 2641, Debit: 250, Credit: 0, TransactionInformation: "" },
                        { Account: 6110, Debit: 1000, Credit: 0, TransactionInformation: "" },
                    ],
                },
            };
        },
    };

    const output = await resolveReferenceVoucherMatch({
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
    assertEquals(output.match?.voucherRef.number, 900);
    assertEquals(output.match?.acceptedByReference, true);
});

Deno.test("resolveHeuristicVoucherMatch hittar match från senare vouchersida", async () => {
    const expectedRows: PostingRow[] = [
        { account: 2440, debit: 0, credit: 1250, description: "" },
        { account: 2641, debit: 250, credit: 0, description: "" },
        { account: 6110, debit: 1000, credit: 0, description: "" },
    ];

    const fillerPage = (start: number, year: number) =>
        Array.from({ length: 150 }, (_, index) => ({
            Description: "Auto-generated",
            VoucherRows: [],
            VoucherSeries: "B",
            VoucherNumber: start + index,
            Year: year,
            TransactionDate: "2024-01-01",
        }));

    const service = {
        async getVouchers(financialYear?: number, _voucherSeries?: string, pagination?: { page?: number; limit?: number }) {
            const page = pagination?.page ?? 1;
            if (financialYear !== 2026) {
                return { Vouchers: [], MetaInformation: { "@TotalPages": 0 } };
            }
            if (page === 1) {
                return { Vouchers: fillerPage(1000, 2026), MetaInformation: { "@TotalPages": 3 } };
            }
            if (page === 2) {
                return { Vouchers: fillerPage(2000, 2026), MetaInformation: { "@TotalPages": 3 } };
            }
            return {
                Vouchers: [
                    {
                        Description: "Match candidate",
                        VoucherRows: [],
                        VoucherSeries: "A",
                        VoucherNumber: 777,
                        Year: 2026,
                        TransactionDate: "2026-01-15",
                    },
                ],
                MetaInformation: { "@TotalPages": 3 },
            };
        },
        async getVoucher(series: string, number: number, _financialYear?: number) {
            if (series === "A" && number === 777) {
                return {
                    Voucher: {
                        Description: "Matched voucher",
                        VoucherSeries: "A",
                        VoucherRows: [
                            { Account: 2440, Debit: 0, Credit: 1250, TransactionInformation: "" },
                            { Account: 2641, Debit: 250, Credit: 0, TransactionInformation: "" },
                            { Account: 6110, Debit: 1000, Credit: 0, TransactionInformation: "" },
                        ],
                        VoucherNumber: 777,
                        Year: 2026,
                        TransactionDate: "2026-01-15",
                    },
                };
            }
            return {
                Voucher: {
                    Description: "Filler voucher",
                    VoucherSeries: series,
                    VoucherNumber: number,
                    Year: 2026,
                    VoucherRows: [],
                    TransactionDate: "2024-01-01",
                },
            };
        },
    };

    const output = await resolveHeuristicVoucherMatch({
        fortnoxService: service,
        invoiceType: "supplier",
        invoice: {
            id: "29",
            invoiceDate: "2026-01-15",
            dueDate: "2026-02-14",
            total: 1250,
            booked: true,
        },
        expectedRows,
        invoiceRecord: {},
        logger: {
            warn: () => undefined,
            info: () => undefined,
        },
        runtimeBudgetMs: 5000,
        detailConcurrency: 4,
        maxDetailFetches: 80,
        dateWindowDaysForBooked: 180,
    });

    assert(output.match !== null);
    assertEquals(output.match?.voucherRef.series, "A");
    assertEquals(output.match?.voucherRef.number, 777);
    assert(output.diagnostics.candidateCount >= 301);
    assert(output.diagnostics.filteredCandidateCount >= 1);
    assert(output.diagnostics.detailFetchCount > 0);
});

Deno.test("resolveHeuristicVoucherMatch avbryter med runtime-guard utan att kasta", async () => {
    let getVoucherCalls = 0;
    let now = 0;
    const nowMs = () => {
        now += 10;
        return now;
    };

    const output = await resolveHeuristicVoucherMatch({
        fortnoxService: {
            async getVouchers() {
                return { Vouchers: [], MetaInformation: { "@TotalPages": 0 } };
            },
            async getVoucher() {
                getVoucherCalls += 1;
                return {
                    Voucher: {
                        Description: "No rows",
                        VoucherSeries: "A",
                        VoucherNumber: 1,
                        Year: 2026,
                        VoucherRows: [],
                        TransactionDate: "2026-01-01",
                    },
                };
            },
        },
        invoiceType: "supplier",
        invoice: {
            id: "1",
            invoiceDate: "2026-01-01",
            dueDate: "2026-01-31",
            total: 100,
            booked: true,
        },
        expectedRows: [],
        invoiceRecord: {},
        logger: {
            warn: () => undefined,
            info: () => undefined,
        },
        runtimeBudgetMs: 1,
        nowMs,
    });

    assertEquals(getVoucherCalls, 0);
    assertEquals(output.match, null);
    assertEquals(output.diagnostics.timedOut, true);
});

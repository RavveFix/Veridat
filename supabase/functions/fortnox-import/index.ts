/**
 * Fortnox Import Edge Function
 *
 * Imports data from Fortnox for comparison with AI categorization.
 * Used for import-test / stresstest validation (Fas 3).
 *
 * Actions:
 * - importVouchers: Fetch vouchers from Fortnox for a date range
 * - importSupplierInvoices: Fetch supplier invoices from Fortnox
 * - compare: Compare AI categorization with existing Fortnox data
 */

/// <reference path="../../types/deno.d.ts" />

import { createClient } from "npm:@supabase/supabase-js@2";
import { FortnoxService } from "../../services/FortnoxService.ts";
import { getCorsHeaders, createOptionsResponse } from "../../services/CorsService.ts";
import { RateLimiterService } from "../../services/RateLimiterService.ts";
import { createLogger } from "../../services/LoggerService.ts";
import { AuditService } from "../../services/AuditService.ts";

const logger = createLogger('fortnox-import');

interface ImportedVoucher {
    voucherNumber: number;
    voucherSeries: string;
    year: number;
    transactionDate: string;
    description: string;
    rows: Array<{
        account: number;
        debit: number;
        credit: number;
        description?: string;
    }>;
}

interface ImportedSupplierInvoice {
    givenNumber: number;
    supplierNumber: string;
    supplierName?: string;
    invoiceNumber: string;
    invoiceDate: string;
    dueDate: string;
    total: number;
    vat?: number;
    booked: boolean;
}

interface ComparisonResult {
    matched: number;
    mismatched: number;
    aiOnly: number;
    fortnoxOnly: number;
    details: Array<{
        aiTransaction?: {
            description: string;
            amount: number;
            vatRate: number;
            basAccount: string;
        };
        fortnoxEntry?: {
            description: string;
            amount: number;
            account: number;
        };
        match: boolean;
        difference?: string;
    }>;
}

Deno.serve(async (req: Request) => {
    const corsHeaders = getCorsHeaders();

    if (req.method === 'OPTIONS') {
        return createOptionsResponse();
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
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
        const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);

        if (userError || !user) {
            return new Response(
                JSON.stringify({ error: 'Unauthorized' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const userId = user.id;

        // Rate limiting
        const rateLimiter = new RateLimiterService(supabaseAdmin);
        const rateLimit = await rateLimiter.checkAndIncrement(userId, 'fortnox-import');
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

        // Initialize services
        const fortnoxConfig = {
            clientId: Deno.env.get('FORTNOX_CLIENT_ID') ?? '',
            clientSecret: Deno.env.get('FORTNOX_CLIENT_SECRET') ?? '',
            redirectUri: '',
        };

        const fortnoxService = new FortnoxService(fortnoxConfig, supabaseAdmin);
        const auditService = new AuditService(supabaseAdmin);

        // Parse request body
        const body = await req.json().catch(() => ({})) as Record<string, unknown>;
        const action = typeof body['action'] === 'string' ? body['action'] : '';
        const payload = body['payload'] as Record<string, unknown> | undefined;
        const companyId = typeof body['companyId'] === 'string' ? body['companyId'] : undefined;

        let result: unknown;

        logger.info('Fortnox import action requested', { userId, action });

        switch (action) {
            // ================================================================
            // IMPORT VOUCHERS
            // ================================================================
            case 'importVouchers': {
                const fromDate = payload?.fromDate as string | undefined;
                const toDate = payload?.toDate as string | undefined;
                const voucherSeries = payload?.voucherSeries as string | undefined;
                const financialYear = payload?.financialYear as number | undefined;

                if (!fromDate || !toDate) {
                    throw new Error('Missing required fields: fromDate, toDate');
                }

                // Start audit logging
                const syncId = await auditService.startFortnoxSync({
                    userId,
                    companyId: companyId || 'unknown',
                    operation: 'import_vouchers',
                    requestPayload: { fromDate, toDate, voucherSeries, financialYear },
                });

                try {
                    await auditService.updateFortnoxSyncInProgress(syncId);

                    // Fetch vouchers from Fortnox
                    const vouchersResponse = await fortnoxService.getVouchers(financialYear, voucherSeries);

                    // Filter by date range and transform
                    const importedVouchers: ImportedVoucher[] = [];
                    for (const voucher of vouchersResponse.Vouchers || []) {
                        const voucherDate = voucher.TransactionDate;
                        if (voucherDate >= fromDate && voucherDate <= toDate) {
                            // Fetch full voucher details
                            try {
                                const fullVoucher = await fortnoxService.getVoucher(
                                    voucher.VoucherSeries,
                                    voucher.VoucherNumber,
                                    voucher.Year
                                );

                                importedVouchers.push({
                                    voucherNumber: fullVoucher.Voucher.VoucherNumber,
                                    voucherSeries: fullVoucher.Voucher.VoucherSeries,
                                    year: fullVoucher.Voucher.Year,
                                    transactionDate: fullVoucher.Voucher.TransactionDate,
                                    description: fullVoucher.Voucher.Description,
                                    rows: fullVoucher.Voucher.VoucherRows?.map(row => ({
                                        account: row.Account,
                                        debit: row.Debit || 0,
                                        credit: row.Credit || 0,
                                        description: row.Description,
                                    })) || [],
                                });
                            } catch (voucherError) {
                                logger.warn('Failed to fetch voucher details', {
                                    voucherNumber: voucher.VoucherNumber,
                                    error: voucherError
                                });
                            }
                        }
                    }

                    await auditService.completeFortnoxSync(syncId, {
                        responsePayload: {
                            voucher_count: importedVouchers.length,
                            from_date: fromDate,
                            to_date: toDate,
                        },
                    });

                    result = {
                        success: true,
                        vouchers: importedVouchers,
                        count: importedVouchers.length,
                        dateRange: { fromDate, toDate },
                    };

                    logger.info('Vouchers imported successfully', {
                        count: importedVouchers.length,
                        fromDate,
                        toDate,
                    });
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    await auditService.failFortnoxSync(syncId, 'IMPORT_VOUCHERS_ERROR', errorMessage);
                    throw error;
                }
                break;
            }

            // ================================================================
            // IMPORT SUPPLIER INVOICES
            // ================================================================
            case 'importSupplierInvoices': {
                const fromDate = payload?.fromDate as string | undefined;
                const toDate = payload?.toDate as string | undefined;
                const supplierNumber = payload?.supplierNumber as string | undefined;

                if (!fromDate || !toDate) {
                    throw new Error('Missing required fields: fromDate, toDate');
                }

                // Start audit logging
                const syncId = await auditService.startFortnoxSync({
                    userId,
                    companyId: companyId || 'unknown',
                    operation: 'import_supplier_invoices',
                    requestPayload: { fromDate, toDate, supplierNumber },
                });

                try {
                    await auditService.updateFortnoxSyncInProgress(syncId);

                    // Fetch supplier invoices from Fortnox
                    const invoicesResponse = await fortnoxService.getSupplierInvoices({
                        fromDate,
                        toDate,
                        supplierNumber,
                    });

                    // Transform to our format
                    const importedInvoices: ImportedSupplierInvoice[] = (invoicesResponse.SupplierInvoices || []).map(invoice => ({
                        givenNumber: invoice.GivenNumber,
                        supplierNumber: invoice.SupplierNumber,
                        invoiceNumber: invoice.InvoiceNumber,
                        invoiceDate: invoice.InvoiceDate,
                        dueDate: invoice.DueDate,
                        total: invoice.Total,
                        vat: invoice.VAT,
                        booked: invoice.Booked,
                    }));

                    await auditService.completeFortnoxSync(syncId, {
                        responsePayload: {
                            invoice_count: importedInvoices.length,
                            from_date: fromDate,
                            to_date: toDate,
                        },
                    });

                    result = {
                        success: true,
                        supplierInvoices: importedInvoices,
                        count: importedInvoices.length,
                        dateRange: { fromDate, toDate },
                    };

                    logger.info('Supplier invoices imported successfully', {
                        count: importedInvoices.length,
                        fromDate,
                        toDate,
                    });
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    await auditService.failFortnoxSync(syncId, 'IMPORT_SUPPLIER_INVOICES_ERROR', errorMessage);
                    throw error;
                }
                break;
            }

            // ================================================================
            // COMPARE AI VS FORTNOX
            // ================================================================
            case 'compare': {
                const aiTransactions = payload?.aiTransactions as Array<{
                    description: string;
                    amount: number;
                    vatRate: number;
                    basAccount: string;
                    date?: string;
                }> | undefined;

                const fortnoxData = payload?.fortnoxData as {
                    vouchers?: ImportedVoucher[];
                    supplierInvoices?: ImportedSupplierInvoice[];
                } | undefined;

                if (!aiTransactions || !fortnoxData) {
                    throw new Error('Missing required fields: aiTransactions, fortnoxData');
                }

                // Compare AI categorization with Fortnox data
                const comparison: ComparisonResult = {
                    matched: 0,
                    mismatched: 0,
                    aiOnly: 0,
                    fortnoxOnly: 0,
                    details: [],
                };

                // Build a lookup from Fortnox data
                const fortnoxEntries: Array<{
                    description: string;
                    amount: number;
                    account: number;
                    matched: boolean;
                }> = [];

                // Extract from vouchers
                for (const voucher of fortnoxData.vouchers || []) {
                    for (const row of voucher.rows) {
                        const amount = row.debit > 0 ? row.debit : -row.credit;
                        fortnoxEntries.push({
                            description: row.description || voucher.description,
                            amount,
                            account: row.account,
                            matched: false,
                        });
                    }
                }

                // Extract from supplier invoices
                for (const invoice of fortnoxData.supplierInvoices || []) {
                    fortnoxEntries.push({
                        description: `Invoice ${invoice.invoiceNumber} from ${invoice.supplierNumber}`,
                        amount: -invoice.total, // Costs are negative
                        account: 0, // Would need to fetch account from voucher
                        matched: false,
                    });
                }

                // Compare each AI transaction
                for (const aiTx of aiTransactions) {
                    let bestMatch: typeof fortnoxEntries[0] | null = null;
                    let bestMatchScore = 0;

                    for (const fortnoxEntry of fortnoxEntries) {
                        if (fortnoxEntry.matched) continue;

                        // Simple matching by amount (within 1 SEK tolerance)
                        const amountMatch = Math.abs(Math.abs(aiTx.amount) - Math.abs(fortnoxEntry.amount)) < 1;

                        // Account matching
                        const accountMatch = parseInt(aiTx.basAccount) === fortnoxEntry.account;

                        const score = (amountMatch ? 2 : 0) + (accountMatch ? 1 : 0);

                        if (score > bestMatchScore) {
                            bestMatchScore = score;
                            bestMatch = fortnoxEntry;
                        }
                    }

                    if (bestMatch && bestMatchScore >= 2) {
                        // Found a match
                        bestMatch.matched = true;
                        comparison.matched++;

                        const accountMatches = parseInt(aiTx.basAccount) === bestMatch.account;
                        if (!accountMatches) {
                            comparison.mismatched++;
                            comparison.details.push({
                                aiTransaction: aiTx,
                                fortnoxEntry: bestMatch,
                                match: false,
                                difference: `Konto skiljer sig: AI=${aiTx.basAccount}, Fortnox=${bestMatch.account}`,
                            });
                        } else {
                            comparison.details.push({
                                aiTransaction: aiTx,
                                fortnoxEntry: bestMatch,
                                match: true,
                            });
                        }
                    } else {
                        // No match found
                        comparison.aiOnly++;
                        comparison.details.push({
                            aiTransaction: aiTx,
                            match: false,
                            difference: 'Ingen matchande post i Fortnox',
                        });
                    }
                }

                // Count unmatched Fortnox entries
                for (const entry of fortnoxEntries) {
                    if (!entry.matched) {
                        comparison.fortnoxOnly++;
                        comparison.details.push({
                            fortnoxEntry: entry,
                            match: false,
                            difference: 'Ingen matchande AI-kategorisering',
                        });
                    }
                }

                result = {
                    success: true,
                    comparison,
                    summary: {
                        total_ai: aiTransactions.length,
                        total_fortnox: fortnoxEntries.length,
                        match_rate: aiTransactions.length > 0
                            ? Math.round((comparison.matched / aiTransactions.length) * 100)
                            : 0,
                        account_accuracy: comparison.matched > 0
                            ? Math.round(((comparison.matched - comparison.mismatched) / comparison.matched) * 100)
                            : 0,
                    },
                };

                logger.info('Comparison completed', {
                    matched: comparison.matched,
                    mismatched: comparison.mismatched,
                    aiOnly: comparison.aiOnly,
                    fortnoxOnly: comparison.fortnoxOnly,
                });
                break;
            }

            default:
                throw new Error(`Unknown action: ${action}`);
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
        logger.error('Fortnox Import Function Error', error);
        return new Response(
            JSON.stringify({ error: errorMessage }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 400
            }
        );
    }
});

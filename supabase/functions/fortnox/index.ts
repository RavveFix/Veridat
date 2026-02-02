/// <reference path="../types/deno.d.ts" />

import { createClient } from "npm:@supabase/supabase-js@2";
import { FortnoxService } from "../../services/FortnoxService.ts";
import { FortnoxInvoice, FortnoxVoucher, FortnoxSupplierInvoice, FortnoxSupplier } from "./types.ts";
import { getCorsHeaders, createOptionsResponse } from "../../services/CorsService.ts";
import { RateLimiterService } from "../../services/RateLimiterService.ts";
import { createLogger } from "../../services/LoggerService.ts";
import { AuditService } from "../../services/AuditService.ts";

const logger = createLogger('fortnox');

Deno.serve(async (req: Request) => {
    const corsHeaders = getCorsHeaders();

    // Handle CORS preflight request
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

        const rateLimiter = new RateLimiterService(supabaseAdmin);
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

        // Create Supabase client (service role) to access Fortnox tokens table
        const supabaseClient = createClient(supabaseUrl, supabaseServiceKey);

        // Initialize services
        const fortnoxConfig = {
            clientId: Deno.env.get('FORTNOX_CLIENT_ID') ?? '',
            clientSecret: Deno.env.get('FORTNOX_CLIENT_SECRET') ?? '',
            redirectUri: '', // Not needed for refresh flow
        };

        const fortnoxService = new FortnoxService(fortnoxConfig, supabaseClient);
        const auditService = new AuditService(supabaseClient);

        // Parse request body
        const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
        const action = typeof body['action'] === 'string' ? body['action'] : '';
        const payload = body['payload'] as Record<string, unknown> | undefined;
        const companyId = typeof body['companyId'] === 'string' ? body['companyId'] : undefined;

        let result;
        let syncId: string | undefined;

        logger.info('Fortnox action requested', { userId, action });

        switch (action) {
            // ================================================================
            // EXISTING ACTIONS
            // ================================================================
            case 'createInvoice':
                result = await fortnoxService.createInvoiceDraft(payload as FortnoxInvoice);
                break;

            case 'getCustomers':
                result = await fortnoxService.getCustomers();
                break;

            case 'getArticles':
                result = await fortnoxService.getArticles();
                break;

            // ================================================================
            // VOUCHER ACTIONS (Verifikationer)
            // ================================================================
            case 'getVouchers': {
                const financialYear = payload?.financialYear as number | undefined;
                const voucherSeries = payload?.voucherSeries as string | undefined;
                result = await fortnoxService.getVouchers(financialYear, voucherSeries);
                break;
            }

            case 'getVoucher': {
                const series = payload?.voucherSeries as string;
                const number = payload?.voucherNumber as number;
                const year = payload?.financialYear as number | undefined;
                result = await fortnoxService.getVoucher(series, number, year);
                break;
            }

            case 'exportVoucher': {
                // Create voucher for VAT report export
                const voucherData = payload?.voucher as FortnoxVoucher;
                const vatReportId = payload?.vatReportId as string | undefined;

                if (!voucherData || !companyId) {
                    throw new Error('Missing required fields: voucher, companyId');
                }

                // Start sync logging
                syncId = await auditService.startFortnoxSync({
                    userId,
                    companyId,
                    operation: 'export_voucher',
                    vatReportId,
                    requestPayload: { voucher: voucherData },
                });

                try {
                    await auditService.updateFortnoxSyncInProgress(syncId);
                    result = await fortnoxService.createVoucher(voucherData);

                    // Complete sync with success
                    await auditService.completeFortnoxSync(syncId, {
                        fortnoxDocumentNumber: String(result.Voucher.VoucherNumber),
                        fortnoxVoucherSeries: result.Voucher.VoucherSeries,
                        responsePayload: result as unknown as Record<string, unknown>,
                    });

                    logger.info('Voucher exported successfully', {
                        voucherNumber: result.Voucher.VoucherNumber,
                        series: result.Voucher.VoucherSeries,
                    });
                } catch (error) {
                    // Log failure
                    if (syncId) {
                        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                        await auditService.failFortnoxSync(syncId, 'VOUCHER_CREATE_ERROR', errorMessage);
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
                result = await fortnoxService.getSupplierInvoices({ fromDate, toDate, supplierNumber });
                break;
            }

            case 'getSupplierInvoice': {
                const givenNumber = payload?.givenNumber as number;
                result = await fortnoxService.getSupplierInvoice(givenNumber);
                break;
            }

            case 'exportSupplierInvoice': {
                // Create supplier invoice for transaction export
                const invoiceData = payload?.invoice as FortnoxSupplierInvoice;
                const transactionId = payload?.transactionId as string | undefined;
                const aiDecisionId = payload?.aiDecisionId as string | undefined;

                if (!invoiceData || !companyId) {
                    throw new Error('Missing required fields: invoice, companyId');
                }

                // Start sync logging
                syncId = await auditService.startFortnoxSync({
                    userId,
                    companyId,
                    operation: 'export_supplier_invoice',
                    transactionId,
                    aiDecisionId,
                    requestPayload: { invoice: invoiceData },
                });

                try {
                    await auditService.updateFortnoxSyncInProgress(syncId);
                    result = await fortnoxService.createSupplierInvoice(invoiceData);

                    // Complete sync with success
                    await auditService.completeFortnoxSync(syncId, {
                        fortnoxDocumentNumber: String(result.SupplierInvoice.GivenNumber),
                        fortnoxInvoiceNumber: invoiceData.InvoiceNumber,
                        fortnoxSupplierNumber: invoiceData.SupplierNumber,
                        responsePayload: result as unknown as Record<string, unknown>,
                    });

                    logger.info('Supplier invoice exported successfully', {
                        givenNumber: result.SupplierInvoice.GivenNumber,
                        supplierNumber: invoiceData.SupplierNumber,
                    });
                } catch (error) {
                    // Log failure
                    if (syncId) {
                        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                        await auditService.failFortnoxSync(syncId, 'SUPPLIER_INVOICE_CREATE_ERROR', errorMessage);
                    }
                    throw error;
                }
                break;
            }

            case 'bookSupplierInvoice': {
                const givenNumber = payload?.givenNumber as number;
                result = await fortnoxService.bookSupplierInvoice(givenNumber);
                break;
            }

            // ================================================================
            // SUPPLIER ACTIONS (Leverantörer)
            // ================================================================
            case 'getSuppliers':
                result = await fortnoxService.getSuppliers();
                break;

            case 'getSupplier': {
                const supplierNumber = payload?.supplierNumber as string;
                result = await fortnoxService.getSupplier(supplierNumber);
                break;
            }

            case 'createSupplier': {
                const supplierData = payload?.supplier as FortnoxSupplier;

                if (!supplierData || !companyId) {
                    throw new Error('Missing required fields: supplier, companyId');
                }

                // Start sync logging
                syncId = await auditService.startFortnoxSync({
                    userId,
                    companyId,
                    operation: 'create_supplier',
                    requestPayload: { supplier: supplierData },
                });

                try {
                    await auditService.updateFortnoxSyncInProgress(syncId);
                    result = await fortnoxService.createSupplier(supplierData);

                    // Complete sync with success
                    await auditService.completeFortnoxSync(syncId, {
                        fortnoxSupplierNumber: result.Supplier.SupplierNumber,
                        responsePayload: result as unknown as Record<string, unknown>,
                    });

                    logger.info('Supplier created successfully', {
                        supplierNumber: result.Supplier.SupplierNumber,
                    });
                } catch (error) {
                    // Log failure
                    if (syncId) {
                        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                        await auditService.failFortnoxSync(syncId, 'SUPPLIER_CREATE_ERROR', errorMessage);
                    }
                    throw error;
                }
                break;
            }

            case 'findOrCreateSupplier': {
                const supplierData = payload?.supplier as FortnoxSupplier;

                if (!supplierData) {
                    throw new Error('Missing required field: supplier');
                }

                result = await fortnoxService.findOrCreateSupplier(supplierData);
                break;
            }

            // ================================================================
            // SYNC STATUS ACTIONS
            // ================================================================
            case 'getVATReportSyncStatus': {
                const vatReportId = payload?.vatReportId as string;
                if (!vatReportId) {
                    throw new Error('Missing required field: vatReportId');
                }
                result = await auditService.getVATReportSyncStatus(vatReportId);
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
        logger.error('Fortnox Function Error', error);
        return new Response(
            JSON.stringify({ error: errorMessage }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 400
            }
        );
    }
});

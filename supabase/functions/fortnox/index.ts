/// <reference path="../types/deno.d.ts" />

import { createClient } from "npm:@supabase/supabase-js@2";
import { FortnoxService } from "../../services/FortnoxService.ts";
import { FortnoxInvoice, FortnoxVoucher, FortnoxSupplierInvoice, FortnoxSupplier, FortnoxInvoicePayment, FortnoxSupplierInvoicePayment } from "./types.ts";
import { getCorsHeaders, createOptionsResponse } from "../../services/CorsService.ts";
import { RateLimiterService } from "../../services/RateLimiterService.ts";
import { createLogger } from "../../services/LoggerService.ts";
import { AuditService } from "../../services/AuditService.ts";
import { CompanyMemoryService, mergeCompanyMemory } from "../../services/CompanyMemoryService.ts";

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

        const isLocal = supabaseUrl.includes('127.0.0.1') || supabaseUrl.includes('localhost');
        const rateLimiter = new RateLimiterService(
            supabaseAdmin,
            isLocal
                ? { requestsPerHour: 1000, requestsPerDay: 10000 }
                : { requestsPerHour: 200, requestsPerDay: 2000 }
        );
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

        const fortnoxService = new FortnoxService(fortnoxConfig, supabaseClient, userId);
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

            case 'getInvoices': {
                const fromDate = payload?.fromDate as string | undefined;
                const toDate = payload?.toDate as string | undefined;
                const customerNumber = payload?.customerNumber as string | undefined;
                result = await fortnoxService.getInvoices({ fromDate, toDate, customerNumber });
                break;
            }

            case 'registerInvoicePayment': {
                const payment = payload?.payment as FortnoxInvoicePayment | undefined;
                if (!payment) {
                    throw new Error('Missing required field: payment');
                }
                const meta = payload?.meta as Record<string, unknown> | undefined;
                const transactionId = typeof meta?.transactionId === 'string' ? meta.transactionId : undefined;
                const resourceId = transactionId || String(payment.InvoiceNumber ?? 'unknown');
                const matchMeta = (meta?.match ?? {}) as Record<string, unknown>;
                const customerNumberRaw = matchMeta.customerNumber as string | number | undefined;
                const customerNumber = customerNumberRaw !== undefined ? String(customerNumberRaw) : undefined;

                try {
                    const created = await fortnoxService.createInvoicePayment(payment);
                    const number = created?.InvoicePayment?.Number;
                    if (number) {
                        const bookkept = await fortnoxService.bookkeepInvoicePayment(number);
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
                        companyId,
                        previousState: meta,
                        newState: {
                            paymentRequest: payment,
                            paymentResult: result as Record<string, unknown>
                        }
                    });

                    if (companyId && customerNumber) {
                        const { error: policyError } = await supabaseClient.rpc('increment_bank_match_policy', {
                            p_user_id: userId,
                            p_company_id: companyId,
                            p_counterparty_type: 'customer',
                            p_counterparty_number: customerNumber
                        });
                        if (policyError) {
                            logger.warn('Failed to update bank match policy (customer)', policyError);
                        }
                    }
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    await auditService.log({
                        userId,
                        actorType: 'user',
                        action: 'bank_match_customer_payment_failed',
                        resourceType: 'bank_match',
                        resourceId,
                        companyId,
                        previousState: meta,
                        newState: {
                            paymentRequest: payment,
                            error: errorMessage
                        }
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
                const filter = payload?.filter as string | undefined;
                result = await fortnoxService.getSupplierInvoices({ fromDate, toDate, supplierNumber, filter });
                break;
            }

            case 'getSupplierInvoice': {
                const givenNumber = payload?.givenNumber as number;
                result = await fortnoxService.getSupplierInvoice(givenNumber);
                break;
            }

            case 'registerSupplierInvoicePayment': {
                const payment = payload?.payment as FortnoxSupplierInvoicePayment | undefined;
                if (!payment) {
                    throw new Error('Missing required field: payment');
                }
                const meta = payload?.meta as Record<string, unknown> | undefined;
                const transactionId = typeof meta?.transactionId === 'string' ? meta.transactionId : undefined;
                const resourceId = transactionId || String(payment.InvoiceNumber ?? 'unknown');
                const matchMeta = (meta?.match ?? {}) as Record<string, unknown>;
                const supplierNumberRaw = matchMeta.supplierNumber as string | number | undefined;
                const supplierNumber = supplierNumberRaw !== undefined ? String(supplierNumberRaw) : undefined;

                try {
                    const created = await fortnoxService.createSupplierInvoicePayment(payment);
                    const number = created?.SupplierInvoicePayment?.Number;
                    if (number !== undefined) {
                        const bookkept = await fortnoxService.bookkeepSupplierInvoicePayment(number);
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
                        companyId,
                        previousState: meta,
                        newState: {
                            paymentRequest: payment,
                            paymentResult: result as Record<string, unknown>
                        }
                    });

                    if (companyId && supplierNumber) {
                        const { error: policyError } = await supabaseClient.rpc('increment_bank_match_policy', {
                            p_user_id: userId,
                            p_company_id: companyId,
                            p_counterparty_type: 'supplier',
                            p_counterparty_number: supplierNumber
                        });
                        if (policyError) {
                            logger.warn('Failed to update bank match policy (supplier)', policyError);
                        }
                    }
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    await auditService.log({
                        userId,
                        actorType: 'user',
                        action: 'bank_match_supplier_payment_failed',
                        resourceType: 'bank_match',
                        resourceId,
                        companyId,
                        previousState: meta,
                        newState: {
                            paymentRequest: payment,
                            error: errorMessage
                        }
                    });
                    throw error;
                }
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

            case 'approveSupplierInvoiceBookkeep': {
                const givenNumber = payload?.givenNumber as number;
                result = await fortnoxService.approveSupplierInvoiceBookkeep(givenNumber);
                break;
            }

            case 'approveSupplierInvoicePayment': {
                const givenNumber = payload?.givenNumber as number;
                result = await fortnoxService.approveSupplierInvoicePayment(givenNumber);
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

            // ================================================================
            // PROFILE SYNC (auto-populate memory from Fortnox)
            // ================================================================
            case 'sync_profile': {
                if (!companyId) {
                    throw new Error('Missing required field: companyId');
                }

                // 1. Fetch company info from Fortnox
                const companyInfo = await fortnoxService.getCompanyInfo();
                const info = companyInfo.CompanyInformation;

                // 2. Fetch financial years
                const years = await fortnoxService.getFinancialYears();
                const latestYear = years.FinancialYears?.[0];

                // 3. Fetch suppliers
                const suppliers = await fortnoxService.getSuppliers();

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

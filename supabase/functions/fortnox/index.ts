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

            // ================================================================
            // VAT REPORT — fetches individual invoices for exact VAT breakdown
            // ================================================================
            case 'getVATReport': {
                // 1. Fetch company info + financial years + invoice lists in parallel
                type InvList = { Invoices: Array<{ DocumentNumber: number; CustomerName?: string; CustomerNumber: string; InvoiceDate?: string; Total?: number; Booked?: boolean; Cancelled?: boolean }> };
                type SuppInvList = { SupplierInvoices: Array<{ GivenNumber: number; SupplierNumber: string; InvoiceDate: string; Total: number; VAT?: number; Booked: boolean }> };

                const [vatCompanyResp, vatYearsResp] = await Promise.all([
                    fortnoxService.getCompanyInfo(),
                    fortnoxService.getFinancialYears(),
                ]);
                const vatCompany = vatCompanyResp.CompanyInformation;
                const currentFY = vatYearsResp.FinancialYears?.[0];
                const fyFrom = currentFY?.FromDate || `${new Date().getFullYear()}-01-01`;
                const fyTo = currentFY?.ToDate || `${new Date().getFullYear()}-12-31`;

                // 2. Fetch invoice lists + supplier invoices
                const [invoicesResp, suppInvResp] = await Promise.all([
                    fortnoxService.request<InvList>(
                        `/invoices?fromdate=${fyFrom}&todate=${fyTo}&limit=500`
                    ).catch(() => ({ Invoices: [] as InvList['Invoices'] })),
                    fortnoxService.request<SuppInvList>(
                        `/supplierinvoices?fromdate=${fyFrom}&todate=${fyTo}&limit=500`
                    ).catch(() => ({ SupplierInvoices: [] as SuppInvList['SupplierInvoices'] })),
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
                        batch.map(inv =>
                            fortnoxService.request<InvDetail>(`/invoices/${inv.DocumentNumber}`).catch(() => null)
                        )
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
                            fortnoxService.request<SuppInvDetail>(`/supplierinvoices/${inv.GivenNumber}`).catch(() => null)
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

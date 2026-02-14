/// <reference path="../types/deno.d.ts" />

import { createClient } from "npm:@supabase/supabase-js@2";
import { FortnoxService } from "../../services/FortnoxService.ts";
import { FortnoxInvoice, FortnoxVoucher, FortnoxSupplierInvoice, FortnoxSupplier, FortnoxInvoicePayment, FortnoxSupplierInvoicePayment } from "./types.ts";
import {
    getCorsHeaders,
    createOptionsResponse,
    isOriginAllowed,
    createForbiddenOriginResponse
} from "../../services/CorsService.ts";
import { RateLimiterService } from "../../services/RateLimiterService.ts";
import { createLogger } from "../../services/LoggerService.ts";
import { FortnoxApiError } from "../../services/FortnoxErrors.ts";
import { AuditService, type FortnoxOperation } from "../../services/AuditService.ts";
import { CompanyMemoryService, mergeCompanyMemory } from "../../services/CompanyMemoryService.ts";
import { getUserPlan } from "../../services/PlanService.ts";

const logger = createLogger('fortnox');

const JSON_HEADERS = { 'Content-Type': 'application/json' };

const WRITE_ACTIONS_TO_OPERATION: Partial<Record<string, FortnoxOperation>> = {
    createInvoice: 'create_invoice',
    registerInvoicePayment: 'register_invoice_payment',
    exportVoucher: 'export_voucher',
    registerSupplierInvoicePayment: 'register_supplier_invoice_payment',
    exportSupplierInvoice: 'export_supplier_invoice',
    bookSupplierInvoice: 'book_supplier_invoice',
    approveSupplierInvoiceBookkeep: 'approve_supplier_invoice_bookkeep',
    approveSupplierInvoicePayment: 'approve_supplier_invoice_payment',
    createSupplier: 'create_supplier',
    findOrCreateSupplier: 'create_supplier',
};

const FAIL_CLOSED_RATE_LIMIT_ACTIONS = new Set<string>([
    ...Object.keys(WRITE_ACTIONS_TO_OPERATION),
    'findOrCreateSupplier',
    'sync_profile',
]);

function shouldFailClosedOnRateLimiterError(action: string): boolean {
    return FAIL_CLOSED_RATE_LIMIT_ACTIONS.has(action);
}

class RequestValidationError extends Error {
    code: string;
    status: number;
    details?: Record<string, unknown>;

    constructor(code: string, message: string, details?: Record<string, unknown>, status = 400) {
        super(message);
        this.code = code;
        this.status = status;
        this.details = details;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
    if (!isRecord(value)) {
        throw new RequestValidationError(
            'INVALID_PAYLOAD',
            `Missing or invalid object: ${field}`,
            { field }
        );
    }
    return value;
}

function requireString(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new RequestValidationError(
            'INVALID_PAYLOAD',
            `Missing or invalid string: ${field}`,
            { field }
        );
    }
    return value;
}

function requireNumber(value: unknown, field: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new RequestValidationError(
            'INVALID_PAYLOAD',
            `Missing or invalid number: ${field}`,
            { field }
        );
    }
    return value;
}

function optionalPositiveInt(value: unknown): number | undefined {
    if (value === undefined || value === null) return undefined;
    const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
        throw new RequestValidationError(
            'INVALID_PAGINATION',
            'Pagination values must be positive integers',
            { value }
        );
    }
    return parsed;
}

function parsePagination(payload: Record<string, unknown> | undefined): {
    page?: number;
    limit?: number;
    allPages?: boolean;
} {
    if (!payload) return {};
    const page = optionalPositiveInt(payload.page);
    const limit = optionalPositiveInt(payload.limit);
    const allPages = typeof payload.allPages === 'boolean' ? payload.allPages : undefined;
    return { page, limit, allPages };
}

function getClientMetadata(req: Request): { ipAddress?: string; userAgent?: string } {
    const forwardedFor = req.headers.get('x-forwarded-for') || req.headers.get('X-Forwarded-For');
    const realIp = req.headers.get('x-real-ip') || req.headers.get('X-Real-IP');
    const ipAddressRaw = forwardedFor?.split(',')[0]?.trim() || realIp || undefined;
    const userAgent = req.headers.get('user-agent') || req.headers.get('User-Agent') || undefined;
    return {
        ipAddress: ipAddressRaw || undefined,
        userAgent,
    };
}

function getWriteRequestMetadata(
    actionName: string,
    requestPayload: Record<string, unknown> | undefined
): { idempotencyKey: string; sourceContext: string; aiDecisionId?: string } {
    const payloadRecord = requireRecord(requestPayload, 'payload');
    const idempotencyKey = requireString(payloadRecord.idempotencyKey, 'payload.idempotencyKey').trim();
    if (idempotencyKey.length < 8) {
        throw new RequestValidationError(
            'INVALID_PAYLOAD',
            'payload.idempotencyKey måste vara minst 8 tecken',
            { action: actionName, field: 'payload.idempotencyKey' }
        );
    }
    const sourceContext = requireString(payloadRecord.sourceContext, 'payload.sourceContext').trim();
    const aiDecisionId = typeof payloadRecord.aiDecisionId === 'string' && payloadRecord.aiDecisionId.trim().length > 0
        ? payloadRecord.aiDecisionId.trim()
        : undefined;

    return { idempotencyKey, sourceContext, aiDecisionId };
}

function requireCompanyIdForWrite(action: string, companyId: string | undefined): string {
    const operation = WRITE_ACTIONS_TO_OPERATION[action];
    if (!operation) {
        return companyId && companyId.trim().length > 0 ? companyId : 'default';
    }
    if (companyId && companyId.trim().length > 0) {
        return companyId;
    }
    throw new RequestValidationError(
        'MISSING_COMPANY_ID',
        'Missing required field: companyId',
        { action, field: 'companyId' }
    );
}

function validationResponse(
    corsHeaders: Record<string, string>,
    error: RequestValidationError
): Response {
    return new Response(
        JSON.stringify({
            error: error.message,
            errorCode: error.code,
            details: error.details ?? null,
        }),
        {
            status: error.status,
            headers: { ...corsHeaders, ...JSON_HEADERS },
        }
    );
}

Deno.serve(async (req: Request) => {
    const requestOrigin = req.headers.get('origin') || req.headers.get('Origin');
    const corsHeaders = getCorsHeaders(requestOrigin);

    // Handle CORS preflight request
    if (req.method === 'OPTIONS') {
        return createOptionsResponse(req);
    }

    if (requestOrigin && !isOriginAllowed(requestOrigin)) {
        return createForbiddenOriginResponse(requestOrigin);
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
        const plan = await getUserPlan(supabaseAdmin, userId);
        if (plan === 'free') {
            return new Response(
                JSON.stringify({
                    error: 'plan_required',
                    errorCode: 'PLAN_REQUIRED',
                    message: 'Fortnox kräver Veridat Pro eller Trial.'
                }),
                { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Parse request body early so we can fail closed for state-changing actions
        // if the rate limiter backend is unavailable.
        const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
        const action = typeof body['action'] === 'string' ? body['action'] : '';
        const payload = isRecord(body['payload']) ? body['payload'] : undefined;
        const companyId = typeof body['companyId'] === 'string' ? body['companyId'] : undefined;

        const isLocal = supabaseUrl.includes('127.0.0.1') || supabaseUrl.includes('localhost');
        const rateLimiter = new RateLimiterService(
            supabaseAdmin,
            isLocal
                ? { requestsPerHour: 1000, requestsPerDay: 10000 }
                : { requestsPerHour: 200, requestsPerDay: 2000 }
        );
        try {
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
        } catch (rateLimitErr) {
            if (shouldFailClosedOnRateLimiterError(action)) {
                logger.error('Rate limiter unavailable for state-changing Fortnox action', {
                    action,
                    error: rateLimitErr instanceof Error ? rateLimitErr.message : String(rateLimitErr),
                });
                return new Response(
                    JSON.stringify({
                        error: 'rate_limiter_unavailable',
                        message: 'Rate limiting är tillfälligt otillgänglig. Försök igen om en stund.',
                        action,
                    }),
                    {
                        status: 503,
                        headers: {
                            ...corsHeaders,
                            'Content-Type': 'application/json',
                            'Retry-After': '60',
                        },
                    }
                );
            }
            logger.error('Rate limiter unavailable for read-only Fortnox action (continuing)', {
                action,
                error: rateLimitErr instanceof Error ? rateLimitErr.message : String(rateLimitErr),
            });
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

        const requestMeta = getClientMetadata(req);

        let result;
        let syncId: string | undefined;

        logger.info('Fortnox action requested', { userId, action });

        const prepareWriteAction = async (
            operation: FortnoxOperation,
            requestPayload: Record<string, unknown>,
            actionName: string,
            options?: {
                companyId?: string;
                vatReportId?: string;
                transactionId?: string;
                aiDecisionId?: string;
            }
        ): Promise<{
            companyId: string;
            idempotencyKey: string;
            syncId?: string;
            cachedResult?: Record<string, unknown>;
        }> => {
            const resolvedCompanyId = requireCompanyIdForWrite(actionName, options?.companyId ?? companyId);
            const writeMeta = getWriteRequestMetadata(actionName, payload);
            const idempotencyKey = writeMeta.idempotencyKey;
            const tracedRequestPayload = {
                ...requestPayload,
                sourceContext: writeMeta.sourceContext,
            };

            const existing = await auditService.findIdempotentFortnoxSync(
                userId,
                resolvedCompanyId,
                operation,
                idempotencyKey
            );

            if (existing) {
                if (existing.status === 'success') {
                    return {
                        companyId: resolvedCompanyId,
                        idempotencyKey,
                        cachedResult: existing.responsePayload ?? {
                            idempotent: true,
                            operation,
                        },
                    };
                }
                throw new RequestValidationError(
                    'IDEMPOTENCY_IN_PROGRESS',
                    `Action is already ${existing.status} for this idempotency key`,
                    { action: actionName, operation, idempotencyKey, status: existing.status },
                    409
                );
            }

            const startedSyncId = await auditService.startFortnoxSync({
                userId,
                companyId: resolvedCompanyId,
                operation,
                actionName,
                idempotencyKey,
                vatReportId: options?.vatReportId,
                transactionId: options?.transactionId,
                aiDecisionId: options?.aiDecisionId ?? writeMeta.aiDecisionId,
                requestPayload: tracedRequestPayload,
                ipAddress: requestMeta.ipAddress,
                userAgent: requestMeta.userAgent,
            });

            if (!startedSyncId) {
                throw new Error('Could not start Fortnox sync log');
            }

            await auditService.updateFortnoxSyncInProgress(startedSyncId);

            return {
                companyId: resolvedCompanyId,
                idempotencyKey,
                syncId: startedSyncId,
            };
        };

        switch (action) {
            // ================================================================
            // EXISTING ACTIONS
            // ================================================================
            case 'createInvoice': {
                const invoiceData = requireRecord(
                    isRecord(payload?.invoice) ? payload.invoice : payload,
                    'payload'
                );
                requireString(invoiceData.CustomerNumber, 'payload.CustomerNumber');
                if (!Array.isArray(invoiceData.InvoiceRows) || invoiceData.InvoiceRows.length === 0) {
                    throw new RequestValidationError(
                        'INVALID_PAYLOAD',
                        'Missing or invalid array: payload.InvoiceRows',
                        { field: 'payload.InvoiceRows' }
                    );
                }

                const write = await prepareWriteAction(
                    'create_invoice',
                    { invoice: invoiceData },
                    action
                );
                if (write.cachedResult) {
                    result = write.cachedResult;
                    break;
                }

                syncId = write.syncId;
                try {
                    result = await fortnoxService.createInvoiceDraft(invoiceData as unknown as FortnoxInvoice);
                    await auditService.completeFortnoxSync(syncId!, {
                        fortnoxDocumentNumber: String((result as { Invoice?: { InvoiceNumber?: number } }).Invoice?.InvoiceNumber ?? ''),
                        responsePayload: result as unknown as Record<string, unknown>,
                    }, requestMeta);
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    if (syncId) {
                        await auditService.failFortnoxSync(syncId!, 'CREATE_INVOICE_ERROR', errorMessage, undefined, requestMeta);
                    }
                    throw error;
                }
                break;
            }

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
                const pagination = parsePagination(payload);
                result = await fortnoxService.getInvoices({
                    fromDate,
                    toDate,
                    customerNumber,
                    ...pagination,
                });
                break;
            }

            case 'registerInvoicePayment': {
                const paymentPayload = requireRecord(payload?.payment, 'payload.payment');
                requireNumber(paymentPayload.InvoiceNumber, 'payload.payment.InvoiceNumber');
                requireNumber(paymentPayload.Amount, 'payload.payment.Amount');
                requireString(paymentPayload.PaymentDate, 'payload.payment.PaymentDate');
                const payment = paymentPayload as unknown as FortnoxInvoicePayment;
                const meta = payload?.meta as unknown as Record<string, unknown> | undefined;
                const transactionId = typeof meta?.transactionId === 'string' ? meta.transactionId : undefined;
                const resourceId = transactionId || String(payment.InvoiceNumber ?? 'unknown');
                const matchMeta = (meta?.match ?? {}) as unknown as Record<string, unknown>;
                const customerNumberRaw = matchMeta.customerNumber as string | number | undefined;
                const customerNumber = customerNumberRaw !== undefined ? String(customerNumberRaw) : undefined;
                const write = await prepareWriteAction(
                    'register_invoice_payment',
                    { payment: paymentPayload, meta: meta || null },
                    action
                );

                if (write.cachedResult) {
                    result = write.cachedResult;
                    break;
                }

                syncId = write.syncId;

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
                        companyId: write.companyId,
                        previousState: meta,
                        newState: {
                            paymentRequest: payment,
                            paymentResult: result as unknown as Record<string, unknown>
                        },
                        ipAddress: requestMeta.ipAddress,
                        userAgent: requestMeta.userAgent,
                    });

                    if (syncId) {
                        await auditService.completeFortnoxSync(syncId!, {
                            fortnoxDocumentNumber: number ? String(number) : undefined,
                            responsePayload: result as unknown as Record<string, unknown>,
                        }, requestMeta);
                    }

                    if (write.companyId && customerNumber) {
                        const { error: policyError } = await supabaseClient.rpc('increment_bank_match_policy', {
                            p_user_id: userId,
                            p_company_id: write.companyId,
                            p_counterparty_type: 'customer',
                            p_counterparty_number: customerNumber
                        });
                        if (policyError) {
                            logger.warn('Failed to update bank match policy (customer)', {
                                message: policyError.message,
                                details: policyError.details,
                                hint: policyError.hint,
                                code: policyError.code,
                            });
                        }
                    }
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    if (syncId) {
                        await auditService.failFortnoxSync(syncId!, 'REGISTER_INVOICE_PAYMENT_ERROR', errorMessage, undefined, requestMeta);
                    }
                    await auditService.log({
                        userId,
                        actorType: 'user',
                        action: 'bank_match_customer_payment_failed',
                        resourceType: 'bank_match',
                        resourceId,
                        companyId: write.companyId,
                        previousState: meta,
                        newState: {
                            paymentRequest: payment,
                            error: errorMessage
                        },
                        ipAddress: requestMeta.ipAddress,
                        userAgent: requestMeta.userAgent,
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
                const pagination = parsePagination(payload);
                result = await fortnoxService.getVouchers(financialYear, voucherSeries, pagination);
                break;
            }

            case 'getVoucher': {
                const series = requireString(payload?.voucherSeries, 'payload.voucherSeries');
                const number = requireNumber(payload?.voucherNumber, 'payload.voucherNumber');
                const year = payload?.financialYear as number | undefined;
                result = await fortnoxService.getVoucher(series, number, year);
                break;
            }

            case 'exportVoucher': {
                // Create voucher for VAT report export
                const voucherDataRaw = requireRecord(payload?.voucher, 'payload.voucher');
                const vatReportId = payload?.vatReportId as string | undefined;
                requireString(voucherDataRaw.Description, 'payload.voucher.Description');
                requireString(voucherDataRaw.TransactionDate, 'payload.voucher.TransactionDate');
                requireString(voucherDataRaw.VoucherSeries, 'payload.voucher.VoucherSeries');
                if (!Array.isArray(voucherDataRaw.VoucherRows) || voucherDataRaw.VoucherRows.length === 0) {
                    throw new RequestValidationError(
                        'INVALID_PAYLOAD',
                        'Missing or invalid array: payload.voucher.VoucherRows',
                        { field: 'payload.voucher.VoucherRows' }
                    );
                }
                const voucherData = voucherDataRaw as unknown as FortnoxVoucher;
                const write = await prepareWriteAction(
                    'export_voucher',
                    { voucher: voucherDataRaw, vatReportId: vatReportId ?? null },
                    action,
                    { vatReportId }
                );

                if (write.cachedResult) {
                    result = write.cachedResult;
                    break;
                }

                syncId = write.syncId;

                try {
                    result = await fortnoxService.createVoucher(voucherData);

                    // Complete sync with success
                    await auditService.completeFortnoxSync(syncId!, {
                        fortnoxDocumentNumber: String(result.Voucher.VoucherNumber),
                        fortnoxVoucherSeries: result.Voucher.VoucherSeries,
                        responsePayload: result as unknown as Record<string, unknown>,
                    }, requestMeta);

                    logger.info('Voucher exported successfully', {
                        voucherNumber: result.Voucher.VoucherNumber,
                        series: result.Voucher.VoucherSeries,
                    });
                } catch (error) {
                    // Log failure
                    if (syncId) {
                        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                        await auditService.failFortnoxSync(syncId!, 'VOUCHER_CREATE_ERROR', errorMessage, undefined, requestMeta);
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
                const pagination = parsePagination(payload);
                result = await fortnoxService.getSupplierInvoices({
                    fromDate,
                    toDate,
                    supplierNumber,
                    filter,
                    ...pagination,
                });
                break;
            }

            case 'getSupplierInvoice': {
                const givenNumber = requireNumber(payload?.givenNumber, 'payload.givenNumber');
                result = await fortnoxService.getSupplierInvoice(givenNumber);
                break;
            }

            case 'registerSupplierInvoicePayment': {
                const paymentPayload = requireRecord(payload?.payment, 'payload.payment');
                requireString(paymentPayload.InvoiceNumber, 'payload.payment.InvoiceNumber');
                requireNumber(paymentPayload.Amount, 'payload.payment.Amount');
                requireString(paymentPayload.PaymentDate, 'payload.payment.PaymentDate');
                const payment = paymentPayload as unknown as FortnoxSupplierInvoicePayment;
                const meta = payload?.meta as unknown as Record<string, unknown> | undefined;
                const transactionId = typeof meta?.transactionId === 'string' ? meta.transactionId : undefined;
                const resourceId = transactionId || String(payment.InvoiceNumber ?? 'unknown');
                const matchMeta = (meta?.match ?? {}) as unknown as Record<string, unknown>;
                const supplierNumberRaw = matchMeta.supplierNumber as string | number | undefined;
                const supplierNumber = supplierNumberRaw !== undefined ? String(supplierNumberRaw) : undefined;
                const write = await prepareWriteAction(
                    'register_supplier_invoice_payment',
                    { payment: paymentPayload, meta: meta || null },
                    action,
                    { transactionId }
                );
                if (write.cachedResult) {
                    result = write.cachedResult;
                    break;
                }

                syncId = write.syncId;

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
                        companyId: write.companyId,
                        previousState: meta,
                        newState: {
                            paymentRequest: payment,
                            paymentResult: result as unknown as Record<string, unknown>
                        },
                        ipAddress: requestMeta.ipAddress,
                        userAgent: requestMeta.userAgent,
                    });

                    if (syncId) {
                        await auditService.completeFortnoxSync(syncId!, {
                            fortnoxDocumentNumber: number !== undefined ? String(number) : undefined,
                            responsePayload: result as unknown as Record<string, unknown>,
                        }, requestMeta);
                    }

                    if (write.companyId && supplierNumber) {
                        const { error: policyError } = await supabaseClient.rpc('increment_bank_match_policy', {
                            p_user_id: userId,
                            p_company_id: write.companyId,
                            p_counterparty_type: 'supplier',
                            p_counterparty_number: supplierNumber
                        });
                        if (policyError) {
                            logger.warn('Failed to update bank match policy (supplier)', {
                                message: policyError.message,
                                details: policyError.details,
                                hint: policyError.hint,
                                code: policyError.code,
                            });
                        }
                    }
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    if (syncId) {
                        await auditService.failFortnoxSync(syncId!, 'REGISTER_SUPPLIER_INVOICE_PAYMENT_ERROR', errorMessage, undefined, requestMeta);
                    }
                    await auditService.log({
                        userId,
                        actorType: 'user',
                        action: 'bank_match_supplier_payment_failed',
                        resourceType: 'bank_match',
                        resourceId,
                        companyId: write.companyId,
                        previousState: meta,
                        newState: {
                            paymentRequest: payment,
                            error: errorMessage
                        },
                        ipAddress: requestMeta.ipAddress,
                        userAgent: requestMeta.userAgent,
                    });
                    throw error;
                }
                break;
            }

            case 'exportSupplierInvoice': {
                // Create supplier invoice for transaction export
                const invoiceDataRaw = requireRecord(payload?.invoice, 'payload.invoice');
                const transactionId = payload?.transactionId as string | undefined;
                const aiDecisionId = payload?.aiDecisionId as string | undefined;
                requireString(invoiceDataRaw.SupplierNumber, 'payload.invoice.SupplierNumber');
                requireString(invoiceDataRaw.InvoiceNumber, 'payload.invoice.InvoiceNumber');
                requireString(invoiceDataRaw.InvoiceDate, 'payload.invoice.InvoiceDate');
                requireString(invoiceDataRaw.DueDate, 'payload.invoice.DueDate');
                requireNumber(invoiceDataRaw.Total, 'payload.invoice.Total');
                const invoiceData = invoiceDataRaw as unknown as FortnoxSupplierInvoice;
                const write = await prepareWriteAction(
                    'export_supplier_invoice',
                    { invoice: invoiceDataRaw, transactionId: transactionId ?? null, aiDecisionId: aiDecisionId ?? null },
                    action,
                    { transactionId, aiDecisionId }
                );

                if (write.cachedResult) {
                    result = write.cachedResult;
                    break;
                }

                syncId = write.syncId;

                try {
                    result = await fortnoxService.createSupplierInvoice(invoiceData);

                    // Complete sync with success
                    await auditService.completeFortnoxSync(syncId!, {
                        fortnoxDocumentNumber: String(result.SupplierInvoice.GivenNumber),
                        fortnoxInvoiceNumber: invoiceData.InvoiceNumber,
                        fortnoxSupplierNumber: invoiceData.SupplierNumber,
                        responsePayload: result as unknown as Record<string, unknown>,
                    }, requestMeta);

                    logger.info('Supplier invoice exported successfully', {
                        givenNumber: result.SupplierInvoice.GivenNumber,
                        supplierNumber: invoiceData.SupplierNumber,
                    });
                } catch (error) {
                    // Log failure
                    if (syncId) {
                        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                        await auditService.failFortnoxSync(syncId!, 'SUPPLIER_INVOICE_CREATE_ERROR', errorMessage, undefined, requestMeta);
                    }
                    throw error;
                }
                break;
            }

            case 'bookSupplierInvoice': {
                const givenNumber = requireNumber(payload?.givenNumber, 'payload.givenNumber');
                const write = await prepareWriteAction(
                    'book_supplier_invoice',
                    { givenNumber },
                    action
                );

                if (write.cachedResult) {
                    result = write.cachedResult;
                    break;
                }

                syncId = write.syncId;
                try {
                    result = await fortnoxService.bookSupplierInvoice(givenNumber);
                    await auditService.completeFortnoxSync(syncId!, {
                        fortnoxDocumentNumber: String(givenNumber),
                        responsePayload: result as unknown as Record<string, unknown>,
                    }, requestMeta);
                } catch (error) {
                    if (syncId) {
                        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                        await auditService.failFortnoxSync(syncId!, 'SUPPLIER_INVOICE_BOOKKEEP_ERROR', errorMessage, undefined, requestMeta);
                    }
                    throw error;
                }
                break;
            }

            case 'approveSupplierInvoiceBookkeep': {
                const givenNumber = requireNumber(payload?.givenNumber, 'payload.givenNumber');
                const write = await prepareWriteAction(
                    'approve_supplier_invoice_bookkeep',
                    { givenNumber },
                    action
                );

                if (write.cachedResult) {
                    result = write.cachedResult;
                    break;
                }

                syncId = write.syncId;
                try {
                    result = await fortnoxService.approveSupplierInvoiceBookkeep(givenNumber);
                    await auditService.completeFortnoxSync(syncId!, {
                        fortnoxDocumentNumber: String(givenNumber),
                        responsePayload: result as unknown as Record<string, unknown>,
                    }, requestMeta);
                } catch (error) {
                    if (syncId) {
                        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                        await auditService.failFortnoxSync(syncId!, 'SUPPLIER_INVOICE_APPROVAL_BOOKKEEP_ERROR', errorMessage, undefined, requestMeta);
                    }
                    throw error;
                }
                break;
            }

            case 'approveSupplierInvoicePayment': {
                const givenNumber = requireNumber(payload?.givenNumber, 'payload.givenNumber');
                const write = await prepareWriteAction(
                    'approve_supplier_invoice_payment',
                    { givenNumber },
                    action
                );

                if (write.cachedResult) {
                    result = write.cachedResult;
                    break;
                }

                syncId = write.syncId;
                try {
                    result = await fortnoxService.approveSupplierInvoicePayment(givenNumber);
                    await auditService.completeFortnoxSync(syncId!, {
                        fortnoxDocumentNumber: String(givenNumber),
                        responsePayload: result as unknown as Record<string, unknown>,
                    }, requestMeta);
                } catch (error) {
                    if (syncId) {
                        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                        await auditService.failFortnoxSync(syncId!, 'SUPPLIER_INVOICE_APPROVAL_PAYMENT_ERROR', errorMessage, undefined, requestMeta);
                    }
                    throw error;
                }
                break;
            }

            // ================================================================
            // SUPPLIER ACTIONS (Leverantörer)
            // ================================================================
            case 'getSuppliers':
                result = await fortnoxService.getSuppliers();
                break;

            case 'getSupplier': {
                const supplierNumber = requireString(payload?.supplierNumber, 'payload.supplierNumber');
                result = await fortnoxService.getSupplier(supplierNumber);
                break;
            }

            case 'createSupplier': {
                const supplierDataRaw = requireRecord(payload?.supplier, 'payload.supplier');
                requireString(supplierDataRaw.Name, 'payload.supplier.Name');
                const supplierData = supplierDataRaw as unknown as FortnoxSupplier;
                const write = await prepareWriteAction(
                    'create_supplier',
                    { supplier: supplierDataRaw },
                    action
                );

                if (write.cachedResult) {
                    result = write.cachedResult;
                    break;
                }

                syncId = write.syncId;

                try {
                    result = await fortnoxService.createSupplier(supplierData);

                    // Complete sync with success
                    await auditService.completeFortnoxSync(syncId!, {
                        fortnoxSupplierNumber: result.Supplier.SupplierNumber,
                        responsePayload: result as unknown as Record<string, unknown>,
                    }, requestMeta);

                    logger.info('Supplier created successfully', {
                        supplierNumber: result.Supplier.SupplierNumber,
                    });
                } catch (error) {
                    // Log failure
                    if (syncId) {
                        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                        await auditService.failFortnoxSync(syncId!, 'SUPPLIER_CREATE_ERROR', errorMessage, undefined, requestMeta);
                    }
                    throw error;
                }
                break;
            }

            case 'findOrCreateSupplier': {
                const supplierDataRaw = requireRecord(payload?.supplier, 'payload.supplier');
                requireString(supplierDataRaw.Name, 'payload.supplier.Name');
                const supplierData = supplierDataRaw as unknown as FortnoxSupplier;
                const write = await prepareWriteAction(
                    'create_supplier',
                    { supplier: supplierDataRaw },
                    action
                );

                if (write.cachedResult) {
                    result = write.cachedResult;
                    break;
                }

                syncId = write.syncId;
                try {
                    result = await fortnoxService.findOrCreateSupplier(supplierData);
                    await auditService.completeFortnoxSync(syncId!, {
                        fortnoxSupplierNumber: (result as { Supplier?: { SupplierNumber?: string } })?.Supplier?.SupplierNumber,
                        responsePayload: result as unknown as Record<string, unknown>,
                    }, requestMeta);
                } catch (error) {
                    if (syncId) {
                        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                        await auditService.failFortnoxSync(syncId!, 'SUPPLIER_CREATE_ERROR', errorMessage, undefined, requestMeta);
                    }
                    throw error;
                }
                break;
            }

            // ================================================================
            // SYNC STATUS ACTIONS
            // ================================================================
            case 'getVATReportSyncStatus': {
                const vatReportId = requireString(payload?.vatReportId, 'payload.vatReportId');
                result = await auditService.getVATReportSyncStatus(vatReportId);
                break;
            }

            // ================================================================
            // PROFILE SYNC (auto-populate memory from Fortnox)
            // ================================================================
            case 'sync_profile': {
                if (!companyId) {
                    throw new RequestValidationError(
                        'MISSING_COMPANY_ID',
                        'Missing required field: companyId',
                        { field: 'companyId' }
                    );
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

                // 2. Fetch invoice lists + supplier invoices with full pagination
                const [invoicesResp, suppInvResp] = await Promise.all([
                    fortnoxService.getInvoices({
                        fromDate: fyFrom,
                        toDate: fyTo,
                        allPages: true,
                        limit: 100,
                    }).catch(() => ({ Invoices: [] as InvList['Invoices'] })),
                    fortnoxService.getSupplierInvoices({
                        fromDate: fyFrom,
                        toDate: fyTo,
                        allPages: true,
                        limit: 100,
                    }).catch(() => ({ SupplierInvoices: [] as SuppInvList['SupplierInvoices'] })),
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
                        batch.map(inv => {
                            const invRecord = inv as Record<string, unknown>;
                            const invoiceNo = Number(invRecord.DocumentNumber ?? invRecord.InvoiceNumber ?? 0);
                            return fortnoxService.request<InvDetail>(`/invoices/${invoiceNo}`).catch(() => null);
                        })
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
                throw new RequestValidationError(
                    'UNKNOWN_ACTION',
                    `Unknown action: ${action}`,
                    { action }
                );
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

        if (error instanceof RequestValidationError) {
            return validationResponse(corsHeaders, error);
        }

        if (error instanceof FortnoxApiError) {
            return new Response(
                JSON.stringify({
                    error: error.userMessage,
                    errorCode: error.name,
                    retryable: error.retryable,
                }),
                {
                    headers: { ...corsHeaders, ...JSON_HEADERS },
                    status: error.statusCode || 400,
                }
            );
        }

        return new Response(
            JSON.stringify({ error: errorMessage, errorCode: 'FORTNOX_ACTION_FAILED' }),
            {
                headers: { ...corsHeaders, ...JSON_HEADERS },
                status: 400
            }
        );
    }
});

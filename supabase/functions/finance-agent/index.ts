/// <reference path="../types/deno.d.ts" />

import { createClient } from "npm:@supabase/supabase-js@2";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
    getCorsHeaders,
    createOptionsResponse,
    isOriginAllowed,
    createForbiddenOriginResponse,
} from "../../services/CorsService.ts";
import { createLogger } from "../../services/LoggerService.ts";
import { AuditService } from "../../services/AuditService.ts";
import { createSwedishComplianceService, type CompanyForm } from "../../services/SwedishComplianceService.ts";
import { dispatchAgentAction, type HandlerContext } from "../../services/AgentHandlers.ts";

const logger = createLogger('finance-agent');
const JSON_HEADERS = { 'Content-Type': 'application/json' };

type FinanceAction =
    | 'migrateClientStorage'
    | 'importBankTransactions'
    | 'listBankTransactions'
    | 'setReconciliationStatus'
    | 'listReconciliationStatuses'
    | 'upsertInvoiceInboxItem'
    | 'deleteInvoiceInboxItem'
    | 'listInvoiceInboxItems'
    | 'upsertReceiptInboxItem'
    | 'deleteReceiptInboxItem'
    | 'listReceiptInboxItems'
    | 'runAgiDraft'
    | 'approveAgiDraft'
    | 'listComplianceAlerts'
    // Agent swarm actions (delegated to AgentHandlers)
    | 'processInvoice'
    | 'matchInvoiceToTransaction'
    | 'reconcileBankTransactions'
    | 'calculateVATReport'
    | 'exportVATToFortnox'
    | 'createJournalEntryFromInvoice'
    | 'autoPostTransaction';

type AdminClient = SupabaseClient<any, any, any, any, any>;

class ValidationError extends Error {
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
        throw new ValidationError('INVALID_PAYLOAD', `Missing or invalid object: ${field}`, { field });
    }
    return value;
}

function requireString(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new ValidationError('INVALID_PAYLOAD', `Missing or invalid string: ${field}`, { field });
    }
    return value;
}

function normalizeString(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function normalizeNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Number(value.replace(/\s+/g, '').replace(',', '.'));
        if (Number.isFinite(parsed)) return parsed;
    }
    return null;
}

function normalizeDate(value: unknown): string | null {
    if (typeof value !== 'string' || value.trim().length === 0) return null;
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) return null;
    return parsed.toISOString();
}

function toDateOnly(value: unknown): string | null {
    const iso = normalizeDate(value);
    return iso ? iso.slice(0, 10) : null;
}

function canonicalImportId(userId: string, companyId: string, rawId: unknown): string {
    const id = typeof rawId === 'string' && rawId.trim().length > 0
        ? rawId.trim()
        : crypto.randomUUID();
    return `imp:${userId}:${companyId}:${id}`;
}

function normalizeCompanyForm(value: unknown): CompanyForm {
    return value === 'enskild' ? 'enskild' : 'ab';
}

function jsonResponse(
    corsHeaders: Record<string, string>,
    status: number,
    body: Record<string, unknown>
): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, ...JSON_HEADERS },
    });
}

function validationResponse(corsHeaders: Record<string, string>, error: ValidationError): Response {
    return jsonResponse(corsHeaders, error.status, {
        error: error.message,
        errorCode: error.code,
        details: error.details ?? null,
    });
}

async function verifyUser(
    supabaseAdmin: AdminClient,
    authHeader: string | null
): Promise<{ userId: string; token: string }> {
    if (!authHeader) {
        throw new ValidationError('UNAUTHORIZED', 'Unauthorized', undefined, 401);
    }
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) {
        throw new ValidationError('UNAUTHORIZED', 'Unauthorized', undefined, 401);
    }
    return { userId: user.id, token };
}

async function upsertBankImport(
    supabaseAdmin: AdminClient,
    userId: string,
    companyId: string,
    bankImportRaw: Record<string, unknown>
): Promise<{ importId: string; txCount: number }> {
    const importId = canonicalImportId(userId, companyId, bankImportRaw.id);
    const importedAt = normalizeDate(bankImportRaw.importedAt) || new Date().toISOString();
    const filename = normalizeString(bankImportRaw.filename) || 'bankimport.csv';
    const mapping = isRecord(bankImportRaw.mapping) ? bankImportRaw.mapping : {};
    const providedRows = normalizeNumber(bankImportRaw.rowCount);
    const transactionsRaw = Array.isArray(bankImportRaw.transactions) ? bankImportRaw.transactions : [];

    const { error: importError } = await supabaseAdmin
        .from('bank_imports')
        .upsert({
            id: importId,
            user_id: userId,
            company_id: companyId,
            filename,
            imported_at: importedAt,
            row_count: providedRows ?? transactionsRaw.length,
            mapping,
        }, { onConflict: 'id' });

    if (importError) throw importError;

    const txRows = transactionsRaw
        .filter((tx): tx is Record<string, unknown> => isRecord(tx))
        .map((tx) => {
            const rawTxId = requireString(tx.id, 'payload.import.transactions[].id');
            const txDate = toDateOnly(tx.date) || new Date().toISOString().slice(0, 10);
            return {
                user_id: userId,
                company_id: companyId,
                id: rawTxId,
                import_id: importId,
                tx_date: txDate,
                description: normalizeString(tx.description),
                amount: normalizeNumber(tx.amount) ?? 0,
                currency: normalizeString(tx.currency) || 'SEK',
                counterparty: normalizeString(tx.counterparty) || null,
                reference: normalizeString(tx.reference) || null,
                ocr: normalizeString(tx.ocr) || null,
                account: normalizeString(tx.account) || null,
                raw: isRecord(tx.raw) ? tx.raw : {},
            };
        });

    if (txRows.length > 0) {
        const { error: txError } = await supabaseAdmin
            .from('bank_transactions')
            .upsert(txRows, { onConflict: 'user_id,company_id,id' });
        if (txError) throw txError;
    }

    return { importId, txCount: txRows.length };
}

async function listBankImportsWithTransactions(
    supabaseAdmin: AdminClient,
    userId: string,
    companyId: string
): Promise<Record<string, unknown>[]> {
    const { data: importRows, error: importsError } = await supabaseAdmin
        .from('bank_imports')
        .select('id, filename, imported_at, row_count, mapping')
        .eq('user_id', userId)
        .eq('company_id', companyId)
        .order('imported_at', { ascending: false })
        .limit(100);
    if (importsError) throw importsError;

    const importIds = (importRows || []).map((row) => row.id).filter((id): id is string => typeof id === 'string');
    const txByImport = new Map<string, Record<string, unknown>[]>();

    if (importIds.length > 0) {
        const { data: txRows, error: txError } = await supabaseAdmin
            .from('bank_transactions')
            .select('id, import_id, tx_date, description, amount, currency, counterparty, reference, ocr, account, raw, match_status, fortnox_ref, ai_decision_id')
            .eq('user_id', userId)
            .eq('company_id', companyId)
            .in('import_id', importIds)
            .order('tx_date', { ascending: false });
        if (txError) throw txError;

        for (const row of txRows || []) {
            const importId = String(row.import_id || '');
            const list = txByImport.get(importId) || [];
            list.push({
                id: row.id,
                date: row.tx_date,
                description: row.description || '',
                amount: typeof row.amount === 'number' ? row.amount : Number(row.amount || 0),
                currency: row.currency || 'SEK',
                counterparty: row.counterparty || undefined,
                reference: row.reference || undefined,
                ocr: row.ocr || undefined,
                account: row.account || undefined,
                raw: isRecord(row.raw) ? row.raw : {},
                matchStatus: row.match_status || 'unmatched',
                fortnoxRef: isRecord(row.fortnox_ref) ? row.fortnox_ref : {},
                aiDecisionId: row.ai_decision_id || null,
            });
            txByImport.set(importId, list);
        }
    }

    return (importRows || []).map((row) => ({
        id: row.id,
        filename: row.filename || '',
        importedAt: row.imported_at || new Date().toISOString(),
        rowCount: row.row_count || 0,
        mapping: isRecord(row.mapping) ? row.mapping : {},
        transactions: txByImport.get(String(row.id)) || [],
    }));
}

function mapInvoiceInboxRowToClient(row: Record<string, unknown>): Record<string, unknown> {
    return {
        id: row.id,
        fileName: row.file_name || '',
        fileUrl: row.file_url || '',
        filePath: row.file_path || '',
        fileBucket: row.file_bucket || '',
        uploadedAt: row.uploaded_at || new Date().toISOString(),
        status: row.status || 'ny',
        source: row.source || 'upload',
        supplierName: row.supplier_name || '',
        supplierOrgNr: row.supplier_org_nr || '',
        invoiceNumber: row.invoice_number || '',
        invoiceDate: row.invoice_date || '',
        dueDate: row.due_date || '',
        totalAmount: row.total_amount != null ? Number(row.total_amount) : null,
        vatAmount: row.vat_amount != null ? Number(row.vat_amount) : null,
        vatRate: row.vat_rate != null ? Number(row.vat_rate) : null,
        ocrNumber: row.ocr_number || '',
        basAccount: row.bas_account || '',
        basAccountName: row.bas_account_name || '',
        currency: row.currency || 'SEK',
        fortnoxSyncStatus: row.fortnox_sync_status || 'not_exported',
        fortnoxSupplierNumber: row.fortnox_supplier_number || '',
        fortnoxGivenNumber: row.fortnox_given_number != null ? Number(row.fortnox_given_number) : null,
        fortnoxBooked: row.fortnox_booked === true,
        fortnoxBalance: row.fortnox_balance != null ? Number(row.fortnox_balance) : null,
        aiExtracted: row.ai_extracted === true,
        aiRawResponse: row.ai_raw_response || '',
        aiReviewNote: row.ai_review_note || '',
        aiDecisionId: row.ai_decision_id || null,
    };
}

function mapReceiptInboxRowToClient(row: Record<string, unknown>): Record<string, unknown> {
    return {
        id: row.id,
        fileName: row.file_name || '',
        fileUrl: row.file_url || '',
        filePath: row.file_path || '',
        fileBucket: row.file_bucket || '',
        uploadedAt: row.uploaded_at || new Date().toISOString(),
        status: row.status || 'ny',
        source: row.source || 'upload',
        merchantName: row.merchant_name || '',
        transactionDate: row.transaction_date || '',
        transactionTime: row.transaction_time || '',
        totalAmount: row.total_amount != null ? Number(row.total_amount) : null,
        vatAmount: row.vat_amount != null ? Number(row.vat_amount) : null,
        vatRate: row.vat_rate != null ? Number(row.vat_rate) : null,
        paymentMethod: row.payment_method || '',
        category: row.category || '',
        description: row.description || '',
        receiptNumber: row.receipt_number || '',
        currency: row.currency || 'SEK',
        basAccount: row.bas_account || '',
        basAccountName: row.bas_account_name || '',
        fortnoxVoucherSeries: row.fortnox_voucher_series || '',
        fortnoxVoucherNumber: row.fortnox_voucher_number != null ? Number(row.fortnox_voucher_number) : null,
        fortnoxSyncStatus: row.fortnox_sync_status || 'not_exported',
        aiExtracted: row.ai_extracted === true,
        aiRawResponse: row.ai_raw_response || '',
        aiReviewNote: row.ai_review_note || '',
    };
}

Deno.serve(async (req: Request) => {
    const requestOrigin = req.headers.get('origin') || req.headers.get('Origin');
    const corsHeaders = getCorsHeaders(requestOrigin);

    if (req.method === 'OPTIONS') {
        return createOptionsResponse(req);
    }

    if (requestOrigin && !isOriginAllowed(requestOrigin)) {
        return createForbiddenOriginResponse(requestOrigin);
    }

    try {
        if (req.method !== 'POST') {
            return jsonResponse(corsHeaders, 405, { error: 'Method not allowed' });
        }

        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
        if (!supabaseUrl || !supabaseServiceKey) {
            return jsonResponse(corsHeaders, 500, { error: 'Server configuration error' });
        }

        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
        const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
        const { userId } = await verifyUser(supabaseAdmin, authHeader);
        const auditService = new AuditService(supabaseAdmin);
        const complianceService = createSwedishComplianceService(supabaseAdmin);

        const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
        const action = typeof body.action === 'string' ? body.action as FinanceAction : '';
        const payload = isRecord(body.payload) ? body.payload : {};
        const companyId = typeof body.companyId === 'string' && body.companyId.trim().length > 0
            ? body.companyId.trim()
            : (typeof payload.companyId === 'string' ? payload.companyId.trim() : '');

        if (!action) {
            throw new ValidationError('INVALID_ACTION', 'Missing required field: action');
        }

        const requireCompanyId = (): string => {
            if (!companyId) {
                throw new ValidationError('MISSING_COMPANY_ID', 'Missing required field: companyId', { field: 'companyId' });
            }
            return companyId;
        };

        switch (action) {
            case 'migrateClientStorage': {
                const resolvedCompanyId = requireCompanyId();
                const bankImportsRaw = Array.isArray(payload.bankImports) ? payload.bankImports : [];
                const invoiceItemsRaw = Array.isArray(payload.invoiceInbox) ? payload.invoiceInbox : [];
                const reconciledRaw = Array.isArray(payload.reconciledPeriods) ? payload.reconciledPeriods : [];

                let importsUpserted = 0;
                let transactionsUpserted = 0;
                for (const entry of bankImportsRaw) {
                    if (!isRecord(entry)) continue;
                    const out = await upsertBankImport(supabaseAdmin, userId, resolvedCompanyId, entry);
                    importsUpserted += 1;
                    transactionsUpserted += out.txCount;
                }

                let invoiceItemsUpserted = 0;
                for (const itemRaw of invoiceItemsRaw) {
                    if (!isRecord(itemRaw)) continue;
                    const itemId = requireString(itemRaw.id, 'payload.invoiceInbox[].id');
                    const row = {
                        user_id: userId,
                        company_id: resolvedCompanyId,
                        id: itemId,
                        file_name: normalizeString(itemRaw.fileName),
                        file_url: normalizeString(itemRaw.fileUrl),
                        file_path: normalizeString(itemRaw.filePath),
                        file_bucket: normalizeString(itemRaw.fileBucket),
                        uploaded_at: normalizeDate(itemRaw.uploadedAt) || new Date().toISOString(),
                        status: normalizeString(itemRaw.status) || 'ny',
                        source: normalizeString(itemRaw.source) || 'upload',
                        supplier_name: normalizeString(itemRaw.supplierName),
                        supplier_org_nr: normalizeString(itemRaw.supplierOrgNr),
                        invoice_number: normalizeString(itemRaw.invoiceNumber),
                        invoice_date: toDateOnly(itemRaw.invoiceDate),
                        due_date: toDateOnly(itemRaw.dueDate),
                        total_amount: normalizeNumber(itemRaw.totalAmount),
                        vat_amount: normalizeNumber(itemRaw.vatAmount),
                        vat_rate: normalizeNumber(itemRaw.vatRate),
                        ocr_number: normalizeString(itemRaw.ocrNumber),
                        bas_account: normalizeString(itemRaw.basAccount),
                        bas_account_name: normalizeString(itemRaw.basAccountName),
                        currency: normalizeString(itemRaw.currency) || 'SEK',
                        fortnox_sync_status: normalizeString(itemRaw.fortnoxSyncStatus) || 'not_exported',
                        fortnox_supplier_number: normalizeString(itemRaw.fortnoxSupplierNumber),
                        fortnox_given_number: normalizeNumber(itemRaw.fortnoxGivenNumber),
                        fortnox_booked: itemRaw.fortnoxBooked === true,
                        fortnox_balance: normalizeNumber(itemRaw.fortnoxBalance),
                        ai_extracted: itemRaw.aiExtracted === true,
                        ai_raw_response: normalizeString(itemRaw.aiRawResponse),
                        ai_review_note: normalizeString(itemRaw.aiReviewNote),
                    };
                    const { error } = await supabaseAdmin
                        .from('invoice_inbox_items')
                        .upsert(row, { onConflict: 'user_id,company_id,id' });
                    if (error) throw error;
                    invoiceItemsUpserted += 1;
                }

                let reconciliationUpserted = 0;
                for (const periodRaw of reconciledRaw) {
                    if (typeof periodRaw !== 'string' || !periodRaw.match(/^\d{4}-\d{2}$/)) continue;
                    const { error } = await supabaseAdmin
                        .from('reconciliation_periods')
                        .upsert({
                            user_id: userId,
                            company_id: resolvedCompanyId,
                            period: periodRaw,
                            status: 'reconciled',
                            reconciled_at: new Date().toISOString(),
                            reconciled_by: userId,
                        }, { onConflict: 'user_id,company_id,period' });
                    if (error) throw error;
                    reconciliationUpserted += 1;
                }

                await auditService.log({
                    userId,
                    companyId: resolvedCompanyId,
                    actorType: 'system',
                    action: 'finance_storage_migrated',
                    resourceType: 'finance_storage',
                    resourceId: resolvedCompanyId,
                    newState: {
                        importsUpserted,
                        transactionsUpserted,
                        invoiceItemsUpserted,
                        reconciliationUpserted,
                    },
                });

                return jsonResponse(corsHeaders, 200, {
                    ok: true,
                    migrated: true,
                    importsUpserted,
                    transactionsUpserted,
                    invoiceItemsUpserted,
                    reconciliationUpserted,
                });
            }

            case 'importBankTransactions': {
                const resolvedCompanyId = requireCompanyId();
                const bankImport = requireRecord(payload.import, 'payload.import');
                const out = await upsertBankImport(supabaseAdmin, userId, resolvedCompanyId, bankImport);

                await auditService.log({
                    userId,
                    companyId: resolvedCompanyId,
                    actorType: 'user',
                    action: 'import_bank_transactions',
                    resourceType: 'bank_import',
                    resourceId: out.importId,
                    newState: { transactionCount: out.txCount },
                });

                return jsonResponse(corsHeaders, 200, {
                    ok: true,
                    importId: out.importId,
                    transactionCount: out.txCount,
                });
            }

            case 'listBankTransactions': {
                const resolvedCompanyId = requireCompanyId();
                const imports = await listBankImportsWithTransactions(supabaseAdmin, userId, resolvedCompanyId);
                return jsonResponse(corsHeaders, 200, {
                    imports,
                });
            }

            case 'setReconciliationStatus': {
                const resolvedCompanyId = requireCompanyId();
                const period = requireString(payload.period, 'payload.period');
                const requestedStatus = normalizeString(payload.status);
                const status = requestedStatus || (payload.reconciled === true ? 'reconciled' : 'open');
                if (!['open', 'reconciled', 'locked'].includes(status)) {
                    throw new ValidationError('INVALID_PAYLOAD', 'Invalid status. Allowed: open|reconciled|locked', { status });
                }

                const now = new Date().toISOString();
                const patch: Record<string, unknown> = {
                    user_id: userId,
                    company_id: resolvedCompanyId,
                    period,
                    status,
                    notes: normalizeString(payload.notes),
                };
                if (status === 'reconciled') {
                    patch.reconciled_at = now;
                    patch.reconciled_by = userId;
                    patch.locked_at = null;
                } else if (status === 'locked') {
                    patch.locked_at = now;
                } else {
                    patch.reconciled_at = null;
                    patch.reconciled_by = null;
                    patch.locked_at = null;
                }

                const { data, error } = await supabaseAdmin
                    .from('reconciliation_periods')
                    .upsert(patch, { onConflict: 'user_id,company_id,period' })
                    .select('id, period, status, reconciled_at, locked_at, notes')
                    .single();
                if (error) throw error;

                await auditService.log({
                    userId,
                    companyId: resolvedCompanyId,
                    actorType: 'user',
                    action: `set_reconciliation_${status}`,
                    resourceType: 'reconciliation_period',
                    resourceId: period,
                    newState: data as unknown as Record<string, unknown>,
                });

                return jsonResponse(corsHeaders, 200, {
                    ok: true,
                    period: data,
                });
            }

            case 'listReconciliationStatuses': {
                const resolvedCompanyId = requireCompanyId();
                const { data, error } = await supabaseAdmin
                    .from('reconciliation_periods')
                    .select('id, period, status, reconciled_at, locked_at, notes')
                    .eq('user_id', userId)
                    .eq('company_id', resolvedCompanyId)
                    .order('period', { ascending: false });
                if (error) throw error;

                return jsonResponse(corsHeaders, 200, {
                    periods: data || [],
                });
            }

            case 'upsertInvoiceInboxItem': {
                const resolvedCompanyId = requireCompanyId();
                const item = requireRecord(payload.item, 'payload.item');
                const itemId = requireString(item.id, 'payload.item.id');
                const now = new Date().toISOString();

                const row = {
                    user_id: userId,
                    company_id: resolvedCompanyId,
                    id: itemId,
                    file_name: normalizeString(item.fileName),
                    file_url: normalizeString(item.fileUrl),
                    file_path: normalizeString(item.filePath),
                    file_bucket: normalizeString(item.fileBucket),
                    uploaded_at: normalizeDate(item.uploadedAt) || now,
                    status: normalizeString(item.status) || 'ny',
                    source: normalizeString(item.source) || 'upload',
                    supplier_name: normalizeString(item.supplierName),
                    supplier_org_nr: normalizeString(item.supplierOrgNr),
                    invoice_number: normalizeString(item.invoiceNumber),
                    invoice_date: toDateOnly(item.invoiceDate),
                    due_date: toDateOnly(item.dueDate),
                    total_amount: normalizeNumber(item.totalAmount),
                    vat_amount: normalizeNumber(item.vatAmount),
                    vat_rate: normalizeNumber(item.vatRate),
                    ocr_number: normalizeString(item.ocrNumber),
                    bas_account: normalizeString(item.basAccount),
                    bas_account_name: normalizeString(item.basAccountName),
                    currency: normalizeString(item.currency) || 'SEK',
                    fortnox_sync_status: normalizeString(item.fortnoxSyncStatus) || 'not_exported',
                    fortnox_supplier_number: normalizeString(item.fortnoxSupplierNumber),
                    fortnox_given_number: normalizeNumber(item.fortnoxGivenNumber),
                    fortnox_booked: item.fortnoxBooked === true,
                    fortnox_balance: normalizeNumber(item.fortnoxBalance),
                    ai_extracted: item.aiExtracted === true,
                    ai_raw_response: normalizeString(item.aiRawResponse),
                    ai_review_note: normalizeString(item.aiReviewNote),
                    ai_decision_id: typeof item.aiDecisionId === 'string' ? item.aiDecisionId : null,
                };

                const { data, error } = await supabaseAdmin
                    .from('invoice_inbox_items')
                    .upsert(row, { onConflict: 'user_id,company_id,id' })
                    .select('*')
                    .single();
                if (error) throw error;

                const eventType = normalizeString(payload.eventType);
                if (eventType) {
                    const eventPayload = isRecord(payload.eventPayload) ? payload.eventPayload : {};
                    const { error: eventError } = await supabaseAdmin
                        .from('invoice_inbox_events')
                        .insert({
                            user_id: userId,
                            company_id: resolvedCompanyId,
                            item_id: itemId,
                            event_type: eventType,
                            previous_status: normalizeString(payload.previousStatus) || null,
                            new_status: normalizeString(row.status) || null,
                            payload: eventPayload,
                            ai_decision_id: typeof payload.aiDecisionId === 'string' ? payload.aiDecisionId : null,
                            idempotency_key: typeof payload.idempotencyKey === 'string' ? payload.idempotencyKey : null,
                            fingerprint: typeof payload.fingerprint === 'string' ? payload.fingerprint : null,
                        });
                    if (eventError) {
                        console.error('[finance-agent] invoice event insert failed (non-fatal):', eventError.message);
                    }
                }

                return jsonResponse(corsHeaders, 200, {
                    ok: true,
                    item: mapInvoiceInboxRowToClient(data as unknown as Record<string, unknown>),
                });
            }

            case 'listInvoiceInboxItems': {
                const resolvedCompanyId = requireCompanyId();
                const { data, error } = await supabaseAdmin
                    .from('invoice_inbox_items')
                    .select('*')
                    .eq('user_id', userId)
                    .eq('company_id', resolvedCompanyId)
                    .order('uploaded_at', { ascending: false });
                if (error) throw error;

                return jsonResponse(corsHeaders, 200, {
                    items: (data || []).map((row) => mapInvoiceInboxRowToClient(row as unknown as Record<string, unknown>)),
                });
            }

            case 'deleteInvoiceInboxItem': {
                const resolvedCompanyId = requireCompanyId();
                const itemId = requireString(payload.itemId, 'payload.itemId');

                const { error } = await supabaseAdmin
                    .from('invoice_inbox_items')
                    .delete()
                    .eq('user_id', userId)
                    .eq('company_id', resolvedCompanyId)
                    .eq('id', itemId);
                if (error) throw error;

                const eventPayload = isRecord(payload.eventPayload) ? payload.eventPayload : {};
                await supabaseAdmin.from('invoice_inbox_events').insert({
                    user_id: userId,
                    company_id: resolvedCompanyId,
                    item_id: itemId,
                    event_type: 'deleted',
                    payload: eventPayload,
                    idempotency_key: typeof payload.idempotencyKey === 'string' ? payload.idempotencyKey : null,
                    fingerprint: typeof payload.fingerprint === 'string' ? payload.fingerprint : null,
                });

                return jsonResponse(corsHeaders, 200, { ok: true });
            }

            // =================================================================
            // RECEIPT INBOX
            // =================================================================

            case 'upsertReceiptInboxItem': {
                const resolvedCompanyId = requireCompanyId();
                const item = requireRecord(payload.item, 'payload.item');
                const itemId = requireString(item.id, 'payload.item.id');
                const now = new Date().toISOString();

                const row = {
                    user_id: userId,
                    company_id: resolvedCompanyId,
                    id: itemId,
                    file_name: normalizeString(item.fileName),
                    file_url: normalizeString(item.fileUrl),
                    file_path: normalizeString(item.filePath),
                    file_bucket: normalizeString(item.fileBucket),
                    uploaded_at: normalizeDate(item.uploadedAt) || now,
                    status: normalizeString(item.status) || 'ny',
                    source: normalizeString(item.source) || 'upload',
                    merchant_name: normalizeString(item.merchantName),
                    transaction_date: toDateOnly(item.transactionDate),
                    transaction_time: normalizeString(item.transactionTime),
                    total_amount: normalizeNumber(item.totalAmount),
                    vat_amount: normalizeNumber(item.vatAmount),
                    vat_rate: normalizeNumber(item.vatRate),
                    payment_method: normalizeString(item.paymentMethod),
                    category: normalizeString(item.category),
                    description: normalizeString(item.description),
                    receipt_number: normalizeString(item.receiptNumber),
                    currency: normalizeString(item.currency) || 'SEK',
                    bas_account: normalizeString(item.basAccount),
                    bas_account_name: normalizeString(item.basAccountName),
                    fortnox_voucher_series: normalizeString(item.fortnoxVoucherSeries),
                    fortnox_voucher_number: normalizeNumber(item.fortnoxVoucherNumber),
                    fortnox_sync_status: normalizeString(item.fortnoxSyncStatus) || 'not_exported',
                    ai_extracted: item.aiExtracted === true,
                    ai_raw_response: normalizeString(item.aiRawResponse),
                    ai_review_note: normalizeString(item.aiReviewNote),
                };

                const { data, error } = await supabaseAdmin
                    .from('receipt_inbox_items')
                    .upsert(row, { onConflict: 'user_id,company_id,id' })
                    .select('*')
                    .single();
                if (error) throw error;

                const eventType = normalizeString(payload.eventType);
                if (eventType) {
                    const eventPayload = isRecord(payload.eventPayload) ? payload.eventPayload : {};
                    const { error: eventError } = await supabaseAdmin
                        .from('receipt_inbox_events')
                        .insert({
                            user_id: userId,
                            company_id: resolvedCompanyId,
                            item_id: itemId,
                            event_type: eventType,
                            previous_status: normalizeString(payload.previousStatus) || null,
                            new_status: normalizeString(row.status) || null,
                            payload: eventPayload,
                            idempotency_key: typeof payload.idempotencyKey === 'string' ? payload.idempotencyKey : null,
                            fingerprint: typeof payload.fingerprint === 'string' ? payload.fingerprint : null,
                        });
                    if (eventError) {
                        console.error('[finance-agent] receipt event insert failed (non-fatal):', eventError.message);
                    }
                }

                return jsonResponse(corsHeaders, 200, {
                    ok: true,
                    item: mapReceiptInboxRowToClient(data as unknown as Record<string, unknown>),
                });
            }

            case 'listReceiptInboxItems': {
                const resolvedCompanyId = requireCompanyId();
                const { data, error } = await supabaseAdmin
                    .from('receipt_inbox_items')
                    .select('*')
                    .eq('user_id', userId)
                    .eq('company_id', resolvedCompanyId)
                    .order('uploaded_at', { ascending: false });
                if (error) throw error;

                return jsonResponse(corsHeaders, 200, {
                    items: (data || []).map((row) => mapReceiptInboxRowToClient(row as unknown as Record<string, unknown>)),
                });
            }

            case 'deleteReceiptInboxItem': {
                const resolvedCompanyId = requireCompanyId();
                const itemId = requireString(payload.itemId, 'payload.itemId');

                const { error } = await supabaseAdmin
                    .from('receipt_inbox_items')
                    .delete()
                    .eq('user_id', userId)
                    .eq('company_id', resolvedCompanyId)
                    .eq('id', itemId);
                if (error) throw error;

                const eventPayload = isRecord(payload.eventPayload) ? payload.eventPayload : {};
                await supabaseAdmin.from('receipt_inbox_events').insert({
                    user_id: userId,
                    company_id: resolvedCompanyId,
                    item_id: itemId,
                    event_type: 'deleted',
                    payload: eventPayload,
                    idempotency_key: typeof payload.idempotencyKey === 'string' ? payload.idempotencyKey : null,
                    fingerprint: typeof payload.fingerprint === 'string' ? payload.fingerprint : null,
                });

                return jsonResponse(corsHeaders, 200, { ok: true });
            }

            case 'runAgiDraft': {
                const resolvedCompanyId = requireCompanyId();
                const period = requireString(payload.period, 'payload.period');
                const totals = isRecord(payload.totals) ? payload.totals : {};

                const { data: profileRow } = await supabaseAdmin
                    .from('accounting_profiles')
                    .select('company_form, payroll_enabled')
                    .eq('user_id', userId)
                    .eq('company_id', resolvedCompanyId)
                    .maybeSingle();

                const companyForm = normalizeCompanyForm(profileRow?.company_form);
                const payrollEnabled = profileRow?.payroll_enabled === true;

                const evaluation = await complianceService.evaluateAgiDraft({
                    userId,
                    companyId: resolvedCompanyId,
                    period,
                    companyForm,
                    payrollEnabled,
                    totals,
                });

                const { data, error } = await supabaseAdmin
                    .from('agi_runs')
                    .insert({
                        user_id: userId,
                        company_id: resolvedCompanyId,
                        period,
                        status: evaluation.status,
                        source_type: 'system',
                        totals,
                        control_results: {
                            controls: evaluation.controls,
                            alerts: evaluation.alerts,
                        },
                    })
                    .select('id, period, status, totals, control_results, created_at')
                    .single();
                if (error) throw error;

                await auditService.log({
                    userId,
                    companyId: resolvedCompanyId,
                    actorType: 'ai',
                    action: 'run_agi_draft',
                    resourceType: 'agi_run',
                    resourceId: String(data.id),
                    newState: data as unknown as Record<string, unknown>,
                });

                return jsonResponse(corsHeaders, 200, {
                    ok: true,
                    run: data,
                    alerts: evaluation.alerts,
                });
            }

            case 'approveAgiDraft': {
                const resolvedCompanyId = requireCompanyId();
                const runId = requireString(payload.runId, 'payload.runId');
                const now = new Date().toISOString();

                const { data, error } = await supabaseAdmin
                    .from('agi_runs')
                    .update({
                        status: 'approved',
                        approved_by: userId,
                        approved_at: now,
                    })
                    .eq('id', runId)
                    .eq('user_id', userId)
                    .eq('company_id', resolvedCompanyId)
                    .select('id, period, status, approved_by, approved_at, updated_at')
                    .maybeSingle();
                if (error) throw error;
                if (!data) {
                    throw new ValidationError('NOT_FOUND', 'AGI run not found', { runId }, 404);
                }

                await auditService.log({
                    userId,
                    companyId: resolvedCompanyId,
                    actorType: 'user',
                    action: 'approve_agi_draft',
                    resourceType: 'agi_run',
                    resourceId: runId,
                    newState: data as unknown as Record<string, unknown>,
                });

                return jsonResponse(corsHeaders, 200, {
                    ok: true,
                    run: data,
                });
            }

            case 'listComplianceAlerts': {
                const resolvedCompanyId = requireCompanyId();
                const { data: profileRow } = await supabaseAdmin
                    .from('accounting_profiles')
                    .select('company_form')
                    .eq('user_id', userId)
                    .eq('company_id', resolvedCompanyId)
                    .maybeSingle();
                const companyForm = normalizeCompanyForm(profileRow?.company_form);

                const [ruleAlerts, guardianAlertsResult] = await Promise.all([
                    complianceService.buildCompanyComplianceAlerts(companyForm),
                    supabaseAdmin
                        .from('guardian_alerts')
                        .select('id, title, description, severity, status, action_target, payload, created_at')
                        .eq('user_id', userId)
                        .eq('company_id', resolvedCompanyId)
                        .eq('status', 'open')
                        .order('created_at', { ascending: false })
                        .limit(25),
                ]);

                if (guardianAlertsResult.error) throw guardianAlertsResult.error;
                const guardianAlerts = (guardianAlertsResult.data || []).map((row) => ({
                    code: `guardian_${row.id}`,
                    severity: row.severity,
                    title: row.title,
                    description: row.description,
                    actionTarget: row.action_target || undefined,
                    payload: isRecord(row.payload) ? row.payload : {},
                }));

                return jsonResponse(corsHeaders, 200, {
                    alerts: [...ruleAlerts, ...guardianAlerts],
                });
            }

            // Agent swarm actions — delegated to AgentHandlers
            case 'processInvoice':
            case 'matchInvoiceToTransaction':
            case 'reconcileBankTransactions':
            case 'calculateVATReport':
            case 'exportVATToFortnox':
            case 'createJournalEntryFromInvoice':
            case 'autoPostTransaction': {
                const resolvedCompanyId = requireCompanyId();
                const agentTaskId = typeof payload._agentTaskId === 'string' ? payload._agentTaskId : '';
                const handlerCtx: HandlerContext = {
                    supabase: supabaseAdmin,
                    userId,
                    companyId: resolvedCompanyId,
                    taskId: agentTaskId,
                };
                const result = await dispatchAgentAction(handlerCtx, action, payload);
                return jsonResponse(corsHeaders, 200, { ok: true, ...result });
            }

            default:
                throw new ValidationError('UNKNOWN_ACTION', `Unknown action: ${action}`, { action });
        }
    } catch (error) {
        if (error instanceof ValidationError) {
            return validationResponse(corsHeaders, error);
        }

        logger.error('finance-agent error', error);
        return jsonResponse(corsHeaders, 500, {
            error: error instanceof Error ? error.message : 'Unexpected error',
            errorCode: 'UNEXPECTED_ERROR',
        });
    }
});

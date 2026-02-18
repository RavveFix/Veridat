/// <reference path="../functions/types/deno.d.ts" />

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { createLogger } from './LoggerService.ts';
import { classifyFortnoxError, FortnoxTimeoutError, FortnoxApiError } from './FortnoxErrors.ts';
import { retryWithBackoff } from './RetryService.ts';
import { FortnoxRateLimitService } from './FortnoxRateLimitService.ts';
import type {
    FortnoxCustomerListResponse,
    FortnoxArticleListResponse,
    FortnoxInvoice,
    FortnoxInvoiceResponse,
    FortnoxInvoiceListResponse,
    FortnoxInvoicePayment,
    FortnoxInvoicePaymentResponse,
    FortnoxVoucher,
    FortnoxVoucherResponse,
    FortnoxVoucherListResponse,
    FortnoxSupplierInvoice,
    FortnoxSupplierInvoiceResponse,
    FortnoxSupplierInvoiceListResponse,
    FortnoxSupplierInvoicePayment,
    FortnoxSupplierInvoicePaymentResponse,
    FortnoxSupplier,
    FortnoxSupplierResponse,
    FortnoxSupplierListResponse,
    FortnoxAccountListResponse,
    FortnoxFinancialYearListResponse,
    FortnoxCompanyInfoResponse,
} from '../functions/fortnox/types.ts';

export interface FortnoxConfig {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
}

interface FortnoxTokenRecord {
    id: string;
    access_token: string;
    refresh_token: string;
    expires_at: string;
    company_id?: string | null;
    created_at?: string;
    updated_at?: string;
    refresh_count?: number;
}

type FortnoxMetaInformation = {
    "@TotalResources"?: number | string;
    "@TotalPages"?: number | string;
    "@CurrentPage"?: number | string;
};

interface PaginationOptions {
    page?: number;
    limit?: number;
    allPages?: boolean;
}

const logger = createLogger('fortnox');

export class FortnoxService {
    private clientId: string;
    private clientSecret: string;
    private baseUrl: string = 'https://api.fortnox.se/3';
    private authUrl: string = 'https://apps.fortnox.se/oauth-v1/token';
    private supabase: SupabaseClient;
    private userId: string;
    private companyId: string;
    private rateLimiter = new FortnoxRateLimitService();

    constructor(config: FortnoxConfig, supabaseClient: SupabaseClient, userId: string, companyId: string) {
        this.clientId = config.clientId;
        this.clientSecret = config.clientSecret;
        this.supabase = supabaseClient;
        this.userId = userId;
        this.companyId = companyId;
    }

    private toPositiveInt(value: number | string | undefined): number | null {
        if (value === undefined || value === null) return null;
        const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10);
        if (!Number.isFinite(parsed) || parsed < 1) return null;
        return parsed;
    }

    private normalizeLimit(limit: number | undefined): number {
        const parsed = this.toPositiveInt(limit);
        if (!parsed) return 100;
        return Math.min(parsed, 500);
    }

    private normalizePage(page: number | undefined): number {
        return this.toPositiveInt(page) ?? 1;
    }

    private buildEndpoint(path: string, params: Record<string, string | number | undefined>): string {
        const query = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
            if (value === undefined || value === null || value === '') continue;
            query.set(key, String(value));
        }
        const qs = query.toString();
        return qs ? `${path}?${qs}` : path;
    }

    private async requestPaginatedList<TItem>(
        path: string,
        listKey: string,
        params: Record<string, string | number | undefined>,
        options?: PaginationOptions
    ): Promise<{ items: TItem[]; meta?: FortnoxMetaInformation }> {
        const limit = this.normalizeLimit(options?.limit);
        const allPages = options?.allPages ?? true;
        let page = this.normalizePage(options?.page);
        let totalPages = 1;
        let guard = 0;
        const items: TItem[] = [];
        let lastMeta: FortnoxMetaInformation | undefined;

        while (guard < 200) {
            guard += 1;
            const endpoint = this.buildEndpoint(path, { ...params, page, limit });
            const response = await this.request<Record<string, unknown>>(endpoint);
            const pageItems = Array.isArray(response[listKey]) ? (response[listKey] as TItem[]) : [];
            items.push(...pageItems);

            const maybeMeta = response.MetaInformation;
            const meta = (maybeMeta && typeof maybeMeta === 'object')
                ? (maybeMeta as FortnoxMetaInformation)
                : undefined;
            lastMeta = meta;

            if (!allPages) {
                break;
            }

            const currentPage = this.toPositiveInt(meta?.["@CurrentPage"]) ?? page;
            const metaTotalPages = this.toPositiveInt(meta?.["@TotalPages"]);
            if (metaTotalPages) {
                totalPages = metaTotalPages;
            } else if (pageItems.length < limit) {
                break;
            } else {
                totalPages = Math.max(totalPages, currentPage + 1);
            }

            if (currentPage >= totalPages || pageItems.length === 0) {
                break;
            }

            page = currentPage + 1;
        }

        if (guard >= 200) {
            logger.warn('Stopped Fortnox pagination early due to guard limit', { path, listKey });
        }

        return { items, meta: lastMeta };
    }

    /**
     * Retrieves the current access token from the database.
     * If expired, it attempts to refresh it.
     */
    async getAccessToken(): Promise<string> {
        // Fetch scoped token first
        const { data: scopedToken, error: scopedError } = await this.supabase
            .from('fortnox_tokens')
            .select('*')
            .eq('user_id', this.userId)
            .eq('company_id', this.companyId)
            .limit(1)
            .maybeSingle();

        if (scopedError) {
            logger.error("Error fetching scoped Fortnox tokens", scopedError);
            throw new Error("Could not retrieve Fortnox credentials.");
        }

        let tokenRow = scopedToken as FortnoxTokenRecord | null;

        // Backward compatibility: adopt legacy token rows without company scope
        if (!tokenRow) {
            const { data: legacyToken, error: legacyError } = await this.supabase
                .from('fortnox_tokens')
                .select('*')
                .eq('user_id', this.userId)
                .is('company_id', null)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (legacyError) {
                logger.error("Error fetching legacy Fortnox tokens", legacyError);
                throw new Error("Could not retrieve Fortnox credentials.");
            }

            if (legacyToken) {
                logger.warn('Using legacy Fortnox token row without company_id, attempting migration', {
                    userId: this.userId,
                    companyId: this.companyId,
                    rowId: legacyToken.id,
                });

                const { data: migratedToken, error: migrateError } = await this.supabase
                    .from('fortnox_tokens')
                    .update({
                        company_id: this.companyId,
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', legacyToken.id)
                    .eq('user_id', this.userId)
                    .is('company_id', null)
                    .select('*')
                    .maybeSingle();

                if (migrateError) {
                    logger.warn('Failed to migrate legacy Fortnox token row to company scope', {
                        userId: this.userId,
                        companyId: this.companyId,
                        rowId: legacyToken.id,
                        error: migrateError,
                    });
                    tokenRow = legacyToken as FortnoxTokenRecord;
                } else {
                    tokenRow = (migratedToken ?? legacyToken) as FortnoxTokenRecord;
                }
            }
        }

        if (!tokenRow) {
            throw new Error("Could not retrieve Fortnox credentials.");
        }

        // Check if token is expired (or close to expiring)
        // Assuming 'expires_at' is a timestamp in the DB
        const expiresAt = new Date(tokenRow.expires_at).getTime();
        const now = Date.now();

        // Refresh if expired or expiring in less than 5 minutes
        if (now >= expiresAt - 5 * 60 * 1000) {
            logger.info("Token expired or expiring soon, refreshing");
            return await this.refreshAccessToken(tokenRow.refresh_token, tokenRow.id);
        }

        return tokenRow.access_token;
    }

    /**
     * Refreshes the access token using the refresh token.
     * Uses optimistic locking (updated_at check) to prevent race conditions
     * when multiple concurrent requests trigger a refresh simultaneously.
     */
    async refreshAccessToken(refreshToken: string, rowId: string): Promise<string> {
        try {
            // 1. Read current updated_at for optimistic lock
            const { data: scopedCurrentRow } = await this.supabase
                .from('fortnox_tokens')
                .select('updated_at, refresh_count')
                .eq('id', rowId)
                .eq('user_id', this.userId)
                .eq('company_id', this.companyId)
                .maybeSingle();

            let currentRow = scopedCurrentRow as { updated_at?: string; refresh_count?: number } | null;
            let legacyRow = false;

            if (!currentRow) {
                const { data: legacyCurrentRow } = await this.supabase
                    .from('fortnox_tokens')
                    .select('updated_at, refresh_count')
                    .eq('id', rowId)
                    .eq('user_id', this.userId)
                    .is('company_id', null)
                    .maybeSingle();

                if (legacyCurrentRow) {
                    legacyRow = true;
                    currentRow = legacyCurrentRow as { updated_at?: string; refresh_count?: number };
                    logger.warn('Refreshing legacy Fortnox token row without company_id', {
                        userId: this.userId,
                        companyId: this.companyId,
                        rowId,
                    });
                }
            }

            const previousUpdatedAt = currentRow?.updated_at;
            const refreshCount = (currentRow?.refresh_count ?? 0) + 1;

            // 2. Exchange refresh token with Fortnox
            const credentials = btoa(`${this.clientId}:${this.clientSecret}`);

            const params = new URLSearchParams();
            params.append('grant_type', 'refresh_token');
            params.append('refresh_token', refreshToken);

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30_000);

            let response: Response;
            try {
                response = await fetch(this.authUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Authorization': `Basic ${credentials}`
                    },
                    body: params,
                    signal: controller.signal,
                });
                clearTimeout(timeoutId);
            } catch (fetchError) {
                clearTimeout(timeoutId);
                if (fetchError instanceof Error && fetchError.name === 'AbortError') {
                    throw new FortnoxTimeoutError();
                }
                throw fetchError;
            }

            if (!response.ok) {
                const errorText = await response.text();

                // If invalid_grant, another concurrent request may have already refreshed.
                // Re-read the DB — if a newer token exists, use it instead of failing.
                if (response.status === 400 && errorText.includes('invalid_grant')) {
                    logger.info('invalid_grant — checking if another process already refreshed');
                    const { data: scopedLatestRow } = await this.supabase
                        .from('fortnox_tokens')
                        .select('access_token, expires_at')
                        .eq('user_id', this.userId)
                        .eq('company_id', this.companyId)
                        .maybeSingle();

                    const latestRow = scopedLatestRow ?? (
                        legacyRow
                            ? (await this.supabase
                                .from('fortnox_tokens')
                                .select('access_token, expires_at')
                                .eq('user_id', this.userId)
                                .is('company_id', null)
                                .maybeSingle()).data
                            : null
                    );

                    if (latestRow) {
                        const latestExpiry = new Date(latestRow.expires_at).getTime();
                        if (latestExpiry > Date.now() + 60_000) {
                            // Another process already refreshed — use the new token
                            logger.info('Found valid token from concurrent refresh');
                            return latestRow.access_token;
                        }
                    }

                    // Token is truly invalid — user needs to re-authenticate
                    throw new Error('Din Fortnox-anslutning har gått ut. Gå till Integrationer och anslut Fortnox igen.');
                }

                throw new Error(`Failed to refresh token: ${response.status} ${errorText}`);
            }

            const data = await response.json();
            const { access_token, refresh_token, expires_in } = data;

            // Calculate new expiration time
            const now = new Date().toISOString();
            const newExpiresAt = new Date(Date.now() + expires_in * 1000).toISOString();

            // 3. Update DB with optimistic lock (only if no concurrent refresh)
            const primaryUpdate = await this.supabase
                .from('fortnox_tokens')
                .update({
                    access_token: access_token,
                    refresh_token: refresh_token, // Fortnox rotates refresh tokens!
                    expires_at: newExpiresAt,
                    last_refresh_at: now,
                    refresh_count: refreshCount,
                    company_id: this.companyId,
                    updated_at: now,
                })
                .eq('id', rowId)
                .eq('user_id', this.userId)
                .eq('company_id', this.companyId)
                .eq('updated_at', previousUpdatedAt) // Optimistic lock
                .select('access_token')
                .maybeSingle();

            let updateResult = primaryUpdate.data;
            let updateError = primaryUpdate.error;

            if ((!updateResult || updateError) && legacyRow) {
                const legacyUpdate = await this.supabase
                    .from('fortnox_tokens')
                    .update({
                        access_token: access_token,
                        refresh_token: refresh_token,
                        expires_at: newExpiresAt,
                        last_refresh_at: now,
                        refresh_count: refreshCount,
                        company_id: this.companyId,
                        updated_at: now,
                    })
                    .eq('id', rowId)
                    .eq('user_id', this.userId)
                    .is('company_id', null)
                    .eq('updated_at', previousUpdatedAt)
                    .select('access_token')
                    .maybeSingle();
                updateResult = legacyUpdate.data;
                updateError = legacyUpdate.error;
            }

            if (updateError || !updateResult) {
                // Concurrent refresh detected — another process already updated the token.
                // Fetch the latest token from DB and use that instead.
                logger.info('Concurrent token refresh detected, using latest token');
                const { data: scopedLatestToken } = await this.supabase
                    .from('fortnox_tokens')
                    .select('access_token')
                    .eq('user_id', this.userId)
                    .eq('company_id', this.companyId)
                    .maybeSingle();

                const latestToken = scopedLatestToken ?? (
                    legacyRow
                        ? (await this.supabase
                            .from('fortnox_tokens')
                            .select('access_token')
                            .eq('user_id', this.userId)
                            .is('company_id', null)
                            .maybeSingle()).data
                        : null
                );

                return latestToken?.access_token ?? access_token;
            }

            logger.info('Token refreshed successfully', { refreshCount });
            return access_token;
        } catch (error) {
            logger.error("Error refreshing Fortnox token", error);
            throw error;
        }
    }

    /**
     * Generic method to make authenticated requests to Fortnox.
     * Includes 30 s timeout and automatic retry with exponential backoff
     * for transient errors (429, 500, 502, 503, 504).
     */
    async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
        await this.rateLimiter.waitIfNeeded();

        const token = await this.getAccessToken();

        const url = `${this.baseUrl}${endpoint}`;
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            ...options.headers
        };

        return retryWithBackoff(async () => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30_000);

            try {
                const response = await fetch(url, {
                    ...options,
                    headers,
                    signal: controller.signal,
                });
                clearTimeout(timeoutId);

                if (!response.ok) {
                    const errorText = await response.text();
                    throw classifyFortnoxError(new Error(errorText), response.status);
                }

                return await response.json();
            } catch (error) {
                clearTimeout(timeoutId);
                if (error instanceof FortnoxApiError) throw error;
                if (error instanceof Error && error.name === 'AbortError') {
                    throw new FortnoxTimeoutError();
                }
                throw classifyFortnoxError(
                    error instanceof Error ? error : new Error(String(error)),
                );
            }
        });
    }

    async getCustomers(): Promise<FortnoxCustomerListResponse> {
        return await this.request<FortnoxCustomerListResponse>('/customers');
    }

    async getArticles(): Promise<FortnoxArticleListResponse> {
        return await this.request<FortnoxArticleListResponse>('/articles');
    }

    async createInvoiceDraft(invoiceData: FortnoxInvoice): Promise<FortnoxInvoiceResponse> {
        return await this.request<FortnoxInvoiceResponse>('/invoices', {
            method: 'POST',
            body: JSON.stringify({ Invoice: invoiceData })
        });
    }

    /**
     * Register a payment for a customer invoice
     */
    async createInvoicePayment(payment: FortnoxInvoicePayment): Promise<FortnoxInvoicePaymentResponse> {
        return await this.request<FortnoxInvoicePaymentResponse>('/invoicepayments', {
            method: 'POST',
            body: JSON.stringify({ InvoicePayment: payment })
        });
    }

    /**
     * Bookkeep a customer invoice payment
     */
    async bookkeepInvoicePayment(number: string): Promise<FortnoxInvoicePaymentResponse> {
        return await this.request<FortnoxInvoicePaymentResponse>(`/invoicepayments/${number}/bookkeep`, {
            method: 'PUT'
        });
    }

    // ========================================================================
    // INVOICE METHODS (Kundfakturor)
    // ========================================================================

    /**
     * Get all invoices
     */
    async getInvoices(params?: {
        fromDate?: string;
        toDate?: string;
        customerNumber?: string;
        page?: number;
        limit?: number;
        allPages?: boolean;
    }): Promise<FortnoxInvoiceListResponse> {
        const paged = await this.requestPaginatedList<FortnoxInvoiceListResponse['Invoices'][number]>(
            '/invoices',
            'Invoices',
            {
                fromdate: params?.fromDate,
                todate: params?.toDate,
                customernumber: params?.customerNumber,
            },
            {
                page: params?.page,
                limit: params?.limit,
                allPages: params?.allPages,
            }
        );

        return {
            Invoices: paged.items,
            MetaInformation: paged.meta,
        };
    }

    /**
     * Get a specific customer invoice
     */
    async getInvoice(invoiceNumber: number): Promise<FortnoxInvoiceResponse> {
        return await this.request<FortnoxInvoiceResponse>(`/invoices/${invoiceNumber}`);
    }

    // ========================================================================
    // VOUCHER METHODS (Verifikationer)
    // ========================================================================

    /**
     * Get all vouchers for a specific financial year and series
     */
    async getVouchers(
        financialYear?: number,
        voucherSeries?: string,
        pagination?: PaginationOptions
    ): Promise<FortnoxVoucherListResponse> {
        const paged = await this.requestPaginatedList<FortnoxVoucherListResponse['Vouchers'][number]>(
            '/vouchers',
            'Vouchers',
            {
                financialyear: financialYear,
                voucherseries: voucherSeries,
            },
            pagination
        );

        return {
            Vouchers: paged.items,
            MetaInformation: paged.meta,
        };
    }

    /**
     * Get a specific voucher by series and number
     */
    async getVoucher(voucherSeries: string, voucherNumber: number, financialYear?: number): Promise<FortnoxVoucherResponse> {
        let endpoint = `/vouchers/${voucherSeries}/${voucherNumber}`;
        if (financialYear) {
            endpoint += `?financialyear=${financialYear}`;
        }
        return await this.request<FortnoxVoucherResponse>(endpoint);
    }

    /**
     * Create a new voucher (verifikation)
     * Used for exporting VAT reports to Fortnox
     */
    async createVoucher(voucherData: FortnoxVoucher): Promise<FortnoxVoucherResponse> {
        logger.info('Creating voucher in Fortnox', {
            series: voucherData.VoucherSeries,
            description: voucherData.Description,
            rowCount: voucherData.VoucherRows.length
        });

        return await this.request<FortnoxVoucherResponse>('/vouchers', {
            method: 'POST',
            body: JSON.stringify({ Voucher: voucherData })
        });
    }

    // ========================================================================
    // SUPPLIER INVOICE METHODS (Leverantörsfakturor)
    // ========================================================================

    /**
     * Get all supplier invoices
     */
    async getSupplierInvoices(params?: {
        fromDate?: string;
        toDate?: string;
        supplierNumber?: string;
        filter?: string;
        page?: number;
        limit?: number;
        allPages?: boolean;
    }): Promise<FortnoxSupplierInvoiceListResponse> {
        const paged = await this.requestPaginatedList<FortnoxSupplierInvoiceListResponse['SupplierInvoices'][number]>(
            '/supplierinvoices',
            'SupplierInvoices',
            {
                fromdate: params?.fromDate,
                todate: params?.toDate,
                suppliernumber: params?.supplierNumber,
                filter: params?.filter,
            },
            {
                page: params?.page,
                limit: params?.limit,
                allPages: params?.allPages,
            }
        );

        return {
            SupplierInvoices: paged.items,
            MetaInformation: paged.meta,
        };
    }

    /**
     * Get a specific supplier invoice
     */
    async getSupplierInvoice(givenNumber: number): Promise<FortnoxSupplierInvoiceResponse> {
        return await this.request<FortnoxSupplierInvoiceResponse>(`/supplierinvoices/${givenNumber}`);
    }

    /**
     * Create a new supplier invoice (leverantörsfaktura)
     * Used for exporting analyzed transactions to Fortnox
     */
    async createSupplierInvoice(invoiceData: FortnoxSupplierInvoice): Promise<FortnoxSupplierInvoiceResponse> {
        logger.info('Creating supplier invoice in Fortnox', {
            supplierNumber: invoiceData.SupplierNumber,
            invoiceNumber: invoiceData.InvoiceNumber,
            total: invoiceData.Total
        });

        return await this.request<FortnoxSupplierInvoiceResponse>('/supplierinvoices', {
            method: 'POST',
            body: JSON.stringify({ SupplierInvoice: invoiceData })
        });
    }

    /**
     * Book a supplier invoice (bokför leverantörsfaktura)
     */
    async bookSupplierInvoice(givenNumber: number): Promise<FortnoxSupplierInvoiceResponse> {
        return await this.request<FortnoxSupplierInvoiceResponse>(`/supplierinvoices/${givenNumber}/bookkeep`, {
            method: 'PUT'
        });
    }

    /**
     * Register a payment for a supplier invoice
     */
    async createSupplierInvoicePayment(payment: FortnoxSupplierInvoicePayment): Promise<FortnoxSupplierInvoicePaymentResponse> {
        return await this.request<FortnoxSupplierInvoicePaymentResponse>('/supplierinvoicepayments', {
            method: 'POST',
            body: JSON.stringify({ SupplierInvoicePayment: payment })
        });
    }

    /**
     * Bookkeep a supplier invoice payment
     */
    async bookkeepSupplierInvoicePayment(number: number): Promise<FortnoxSupplierInvoicePaymentResponse> {
        return await this.request<FortnoxSupplierInvoicePaymentResponse>(`/supplierinvoicepayments/${number}/bookkeep`, {
            method: 'PUT'
        });
    }

    /**
     * Approve supplier invoice bookkeep (attest)
     */
    async approveSupplierInvoiceBookkeep(givenNumber: number): Promise<FortnoxSupplierInvoiceResponse> {
        return await this.request<FortnoxSupplierInvoiceResponse>(`/supplierinvoices/${givenNumber}/approvalbookkeep`, {
            method: 'PUT'
        });
    }

    /**
     * Approve supplier invoice payment
     */
    async approveSupplierInvoicePayment(givenNumber: number): Promise<FortnoxSupplierInvoiceResponse> {
        return await this.request<FortnoxSupplierInvoiceResponse>(`/supplierinvoices/${givenNumber}/approvalpayment`, {
            method: 'PUT'
        });
    }

    // ========================================================================
    // SUPPLIER METHODS (Leverantörer)
    // ========================================================================

    /**
     * Get all suppliers
     */
    async getSuppliers(): Promise<FortnoxSupplierListResponse> {
        return await this.request<FortnoxSupplierListResponse>('/suppliers');
    }

    /**
     * Get a specific supplier
     */
    async getSupplier(supplierNumber: string): Promise<FortnoxSupplierResponse> {
        return await this.request<FortnoxSupplierResponse>(`/suppliers/${supplierNumber}`);
    }

    /**
     * Create a new supplier (leverantör)
     */
    async createSupplier(supplierData: FortnoxSupplier): Promise<FortnoxSupplierResponse> {
        logger.info('Creating supplier in Fortnox', {
            name: supplierData.Name,
            orgNr: supplierData.OrganisationNumber
        });

        return await this.request<FortnoxSupplierResponse>('/suppliers', {
            method: 'POST',
            body: JSON.stringify({ Supplier: supplierData })
        });
    }

    /**
     * Update an existing supplier
     */
    async updateSupplier(supplierNumber: string, supplierData: Partial<FortnoxSupplier>): Promise<FortnoxSupplierResponse> {
        return await this.request<FortnoxSupplierResponse>(`/suppliers/${supplierNumber}`, {
            method: 'PUT',
            body: JSON.stringify({ Supplier: supplierData })
        });
    }

    /**
     * Find or create a supplier by organization number
     */
    async findOrCreateSupplier(supplierData: FortnoxSupplier): Promise<FortnoxSupplierResponse> {
        // Try to find by org number first
        if (supplierData.OrganisationNumber) {
            try {
                const suppliers = await this.getSuppliers();
                const existing = suppliers.Suppliers?.find(
                    s => s.OrganisationNumber === supplierData.OrganisationNumber
                );
                if (existing) {
                    logger.info('Found existing supplier', { supplierNumber: existing.SupplierNumber });
                    return { Supplier: existing };
                }
            } catch (error) {
                logger.warn('Could not search suppliers', {
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }

        // Create new supplier
        return await this.createSupplier(supplierData);
    }

    // ========================================================================
    // SIE EXPORT METHODS
    // ========================================================================

    /**
     * Export SIE file from Fortnox
     * @param sieType SIE type: 1=Årssaldon, 2=Periodsaldon, 3=Objektsaldon, 4=Transaktioner
     * @param financialYear Optional financial year
     */
    async exportSIE(sieType: number, financialYear?: number): Promise<{ content: string; filename: string }> {
        if (sieType < 1 || sieType > 4) {
            throw new Error('Invalid SIE type. Must be 1-4.');
        }

        let endpoint = `/sie/${sieType}`;
        if (financialYear) {
            endpoint += `?financialyear=${financialYear}`;
        }

        // SIE endpoint returns raw text, not JSON - use raw fetch with timeout
        const token = await this.getAccessToken();
        const url = `${this.baseUrl}${endpoint}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30_000);

        let response: Response;
        try {
            response = await fetch(url, {
                headers: { 'Authorization': `Bearer ${token}` },
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
        } catch (error) {
            clearTimeout(timeoutId);
            if (error instanceof Error && error.name === 'AbortError') {
                throw new FortnoxTimeoutError();
            }
            throw error;
        }

        if (!response.ok) {
            const errorText = await response.text();
            throw classifyFortnoxError(new Error(errorText), response.status);
        }

        const content = await response.text();
        const typeLabels: Record<number, string> = {
            1: 'Arssaldon',
            2: 'Periodsaldon',
            3: 'Objektsaldon',
            4: 'Transaktioner',
        };
        const filename = `SIE${sieType}_${typeLabels[sieType]}_${financialYear || 'current'}.se`;

        return { content, filename };
    }

    // ========================================================================
    // ACCOUNT & FINANCIAL YEAR METHODS (Fas B)
    // ========================================================================

    /**
     * Get all accounts with balances for a financial year
     */
    async getAccounts(financialYear?: number): Promise<FortnoxAccountListResponse> {
        let endpoint = '/accounts';
        if (financialYear) {
            endpoint += `?financialyear=${financialYear}`;
        }
        return await this.request<FortnoxAccountListResponse>(endpoint);
    }

    /**
     * Get all financial years
     */
    async getFinancialYears(): Promise<FortnoxFinancialYearListResponse> {
        return await this.request<FortnoxFinancialYearListResponse>('/financialyears');
    }

    /**
     * Get company information
     */
    async getCompanyInfo(): Promise<FortnoxCompanyInfoResponse> {
        return await this.request<FortnoxCompanyInfoResponse>('/companyinformation');
    }
}

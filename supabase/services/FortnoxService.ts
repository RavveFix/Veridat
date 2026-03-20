/// <reference path="../functions/types/deno.d.ts" />

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { createLogger } from './LoggerService.ts';
import { classifyFortnoxError, FortnoxTimeoutError, FortnoxApiError, FortnoxAuthError } from './FortnoxErrors.ts';
import { retryWithBackoff } from './RetryService.ts';
import { FortnoxRateLimitService } from './FortnoxRateLimitService.ts';
import type {
    FortnoxCustomer,
    FortnoxCustomerListResponse,
    FortnoxCustomerResponse,
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
    FortnoxVoucherFileConnectionResponse,
    FortnoxSupplierInvoiceFileConnectionResponse,
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

interface VoucherSearchOptions {
    fromDate?: string;
    toDate?: string;
}

const logger = createLogger('fortnox');

// ---------------------------------------------------------------------------
// CP-437 decoder — SIE files use IBM PC codepage 437
// TextDecoder doesn't support CP-437, so we map bytes 0x80-0xFF manually.
// ---------------------------------------------------------------------------
const CP437_HIGH: string[] = [
    'Ç','ü','é','â','ä','à','å','ç','ê','ë','è','ï','î','ì','Ä','Å', // 80-8F
    'É','æ','Æ','ô','ö','ò','û','ù','ÿ','Ö','Ü','¢','£','¥','₧','ƒ', // 90-9F
    'á','í','ó','ú','ñ','Ñ','ª','º','¿','⌐','¬','½','¼','¡','«','»', // A0-AF
    '░','▒','▓','│','┤','╡','╢','╖','╕','╣','║','╗','╝','╜','╛','┐', // B0-BF
    '└','┴','┬','├','─','┼','╞','╟','╚','╔','╩','╦','╠','═','╬','╧', // C0-CF
    '╨','╤','╥','╙','╘','╒','╓','╫','╪','┘','┌','█','▄','▌','▐','▀', // D0-DF
    'α','ß','Γ','π','Σ','σ','µ','τ','Φ','Θ','Ω','δ','∞','φ','ε','∩', // E0-EF
    '≡','±','≥','≤','⌠','⌡','÷','≈','°','∙','·','√','ⁿ','²','■','\u00A0', // F0-FF
];

function decodeCp437(bytes: Uint8Array): string {
    let result = '';
    for (let i = 0; i < bytes.length; i++) {
        const b = bytes[i];
        result += b < 0x80 ? String.fromCharCode(b) : CP437_HIGH[b - 0x80];
    }
    return result;
}

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
     * Re-reads the latest token from DB and returns it if still valid (>60s remaining).
     * Used to recover from race conditions where another process already refreshed.
     */
    private async readFreshTokenFromDb(legacyRow: boolean): Promise<string | null> {
        const { data: scopedRow } = await this.supabase
            .from('fortnox_tokens')
            .select('access_token, expires_at')
            .eq('user_id', this.userId)
            .eq('company_id', this.companyId)
            .maybeSingle();

        const row = scopedRow ?? (
            legacyRow
                ? (await this.supabase
                    .from('fortnox_tokens')
                    .select('access_token, expires_at')
                    .eq('user_id', this.userId)
                    .is('company_id', null)
                    .maybeSingle()).data
                : null
        );

        if (row && new Date(row.expires_at).getTime() > Date.now() + 60_000) {
            return row.access_token;
        }
        return null;
    }

    /**
     * Refreshes the access token using the refresh token.
     *
     * Race condition strategy: Fortnox refresh tokens are single-use. If two concurrent
     * requests both try to refresh, the second one will get "invalid_grant" because the
     * first already consumed the token.
     *
     * Fix: Claim a refresh lock (by atomically bumping updated_at) BEFORE calling Fortnox.
     * If the lock claim fails, another process already has it — wait briefly and reuse
     * whatever token they stored. Only call Fortnox if we successfully claimed the lock.
     */
    async refreshAccessToken(refreshToken: string, rowId: string): Promise<string> {
        try {
            // 1. Read current updated_at and refresh_count
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

            // 2. CLAIM REFRESH LOCK before calling Fortnox.
            // Atomically update updated_at so any concurrent request sees a changed
            // value and knows NOT to call Fortnox with the same single-use refresh token.
            const lockTimestamp = new Date().toISOString();
            let lockQuery = this.supabase
                .from('fortnox_tokens')
                .update({ updated_at: lockTimestamp })
                .eq('id', rowId)
                .eq('user_id', this.userId);

            if (legacyRow) {
                lockQuery = lockQuery.is('company_id', null);
            } else {
                lockQuery = lockQuery.eq('company_id', this.companyId);
            }

            if (previousUpdatedAt) {
                lockQuery = lockQuery.eq('updated_at', previousUpdatedAt);
            } else {
                lockQuery = lockQuery.is('updated_at', null);
            }

            const { data: lockResult } = await lockQuery.select('id').maybeSingle();

            if (!lockResult) {
                // Another process claimed the lock first.
                // Wait briefly for their Fortnox call + DB write to complete, then reuse their token.
                logger.info('Token refresh lock held by another process — waiting for result', {
                    userId: this.userId,
                    companyId: this.companyId,
                    rowId,
                });
                await new Promise(resolve => setTimeout(resolve, 700));

                const freshToken = await this.readFreshTokenFromDb(legacyRow);
                if (freshToken) {
                    logger.info('Reused token written by concurrent refresh');
                    return freshToken;
                }

                // Other process may have failed — fall through and attempt our own refresh.
                // Our Fortnox call may fail with invalid_grant if their refresh_token was consumed.
                logger.warn('Concurrent refresh may have failed, attempting own refresh anyway');
            }

            // 3. Call Fortnox to exchange the refresh token
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

                // If invalid_grant, the lock-claim fallback above may have timed out before the
                // other process finished writing. Give them more time and re-check DB.
                if (response.status === 400 && errorText.includes('invalid_grant')) {
                    logger.warn('invalid_grant received — waiting and checking for concurrent refresh result', {
                        userId: this.userId,
                        companyId: this.companyId,
                    });
                    await new Promise(resolve => setTimeout(resolve, 500));

                    const freshToken = await this.readFreshTokenFromDb(legacyRow);
                    if (freshToken) {
                        logger.info('Recovered from invalid_grant: found valid token from concurrent refresh');
                        return freshToken;
                    }

                    // Token is truly gone — user must reconnect Fortnox
                    throw new Error('Din Fortnox-anslutning har gått ut. Gå till Integrationer och anslut Fortnox igen.');
                }

                throw new Error(`Failed to refresh token: ${response.status} ${errorText}`);
            }

            const data = await response.json();
            const { access_token, refresh_token, expires_in } = data;

            // Calculate new expiration time
            const now = new Date().toISOString();
            const newExpiresAt = new Date(Date.now() + expires_in * 1000).toISOString();

            // 4. Write new tokens to DB.
            // We hold the lock (updated_at was bumped in step 2), so no extra optimistic check needed.
            const primaryUpdate = await this.supabase
                .from('fortnox_tokens')
                .update({
                    access_token: access_token,
                    refresh_token: refresh_token, // Fortnox rotates refresh tokens — must save!
                    expires_at: newExpiresAt,
                    last_refresh_at: now,
                    refresh_count: refreshCount,
                    company_id: this.companyId,
                    updated_at: now,
                })
                .eq('id', rowId)
                .eq('user_id', this.userId)
                .eq('company_id', this.companyId)
                .select('access_token')
                .maybeSingle();

            if ((!primaryUpdate.data || primaryUpdate.error) && legacyRow) {
                await this.supabase
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
                    .is('company_id', null);
            }

            logger.info('Token refreshed successfully', { refreshCount });
            return access_token;
        } catch (error) {
            logger.error("Error refreshing Fortnox token", error);
            throw error;
        }
    }

    /**
     * Upload a file to Fortnox Inbox via multipart/form-data.
     * Mirrors request()/authenticatedFetch() pattern but with FormData body.
     * Includes rate limiting, 30s timeout, error classification, and 401-retry.
     */
    async uploadToInbox(
        fileData: Uint8Array,
        fileName: string,
    ): Promise<{ Id: string; Name: string; Size: number }> {
        await this.rateLimiter.waitIfNeeded();

        const doUpload = async (token: string): Promise<{ Id: string; Name: string; Size: number }> => {
            const url = `${this.baseUrl}/inbox`;
            const formData = new FormData();
            const blob = new Blob([fileData], { type: 'application/octet-stream' });
            formData.append('file', blob, fileName);

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30_000);

            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        // Do NOT set Content-Type — fetch sets it automatically with boundary for FormData
                    },
                    body: formData,
                    signal: controller.signal,
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                    const errorText = await response.text();
                    throw classifyFortnoxError(new Error(errorText), response.status);
                }

                const result = await response.json();
                return result.File;
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
        };

        const token = await this.getAccessToken();

        try {
            return await retryWithBackoff(async () => {
                return await doUpload(token);
            });
        } catch (error) {
            // On 401: refresh token and retry exactly once (same pattern as request())
            if (error instanceof FortnoxAuthError) {
                logger.info('Got 401 from Fortnox inbox upload, attempting token refresh and retry');
                const freshToken = await this.forceRefreshToken();
                return await doUpload(freshToken);
            }
            throw error;
        }
    }

    /**
     * Create a connection between an uploaded file and a voucher.
     * Uses standard request() since this is a JSON POST.
     */
    async createVoucherFileConnection(
        fileId: string,
        voucherNumber: number,
        voucherSeries: string,
        financialYearDate: string,
    ): Promise<FortnoxVoucherFileConnectionResponse> {
        return await this.request(`/voucherfileconnections?financialyeardate=${encodeURIComponent(financialYearDate)}`, {
            method: 'POST',
            body: JSON.stringify({
                VoucherFileConnection: {
                    FileId: fileId,
                    VoucherNumber: voucherNumber,
                    VoucherSeries: voucherSeries,
                },
            }),
        });
    }

    /**
     * Create a connection between an uploaded file and a supplier invoice.
     * Uses standard request() since this is a JSON POST.
     */
    async createSupplierInvoiceFileConnection(
        fileId: string,
        supplierInvoiceNumber: string,
    ): Promise<FortnoxSupplierInvoiceFileConnectionResponse> {
        return await this.request('/supplierinvoicefileconnections', {
            method: 'POST',
            body: JSON.stringify({
                SupplierInvoiceFileConnection: {
                    FileId: fileId,
                    SupplierInvoiceNumber: supplierInvoiceNumber,
                },
            }),
        });
    }

    /**
     * Single authenticated fetch with 30 s timeout.
     * Separated from request() so the 401-retry can call it with a fresh token.
     */
    private async authenticatedFetch<T>(endpoint: string, token: string, options: RequestInit = {}): Promise<T> {
        const url = `${this.baseUrl}${endpoint}`;
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            ...options.headers
        };

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
    }

    /**
     * Force-refresh the token regardless of expires_at.
     * Used when Fortnox returns 401 despite our token not appearing expired.
     */
    private async forceRefreshToken(): Promise<string> {
        const { data: tokenRow } = await this.supabase
            .from('fortnox_tokens')
            .select('id, refresh_token')
            .eq('user_id', this.userId)
            .eq('company_id', this.companyId)
            .maybeSingle();

        if (tokenRow?.refresh_token) {
            return await this.refreshAccessToken(tokenRow.refresh_token, tokenRow.id);
        }

        // Fallback: try legacy token row without company_id
        const { data: legacyTokenRow } = await this.supabase
            .from('fortnox_tokens')
            .select('id, refresh_token')
            .eq('user_id', this.userId)
            .is('company_id', null)
            .maybeSingle();

        if (legacyTokenRow?.refresh_token) {
            logger.warn('forceRefreshToken: using legacy token row without company_id', {
                userId: this.userId,
                companyId: this.companyId,
                rowId: legacyTokenRow.id,
            });
            return await this.refreshAccessToken(legacyTokenRow.refresh_token, legacyTokenRow.id);
        }

        throw new FortnoxAuthError('Din Fortnox-anslutning har gått ut. Gå till Integrationer och anslut Fortnox igen.');
    }

    /**
     * Generic method to make authenticated requests to Fortnox.
     * Includes 30 s timeout and automatic retry with exponential backoff
     * for transient errors (429, 500, 502, 503, 504).
     *
     * On 401 (auth error): attempts one token refresh + retry before failing.
     */
    async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
        await this.rateLimiter.waitIfNeeded();

        const token = await this.getAccessToken();

        try {
            return await retryWithBackoff(async () => {
                return await this.authenticatedFetch<T>(endpoint, token, options);
            });
        } catch (error) {
            // On 401: refresh token and retry exactly once
            if (error instanceof FortnoxAuthError) {
                logger.info('Got 401 from Fortnox, attempting token refresh and retry', { endpoint });
                const freshToken = await this.forceRefreshToken();
                return await this.authenticatedFetch<T>(endpoint, freshToken, options);
            }
            throw error;
        }
    }

    async getCustomers(): Promise<FortnoxCustomerListResponse> {
        return await this.request<FortnoxCustomerListResponse>('/customers');
    }

    async createCustomer(customerData: FortnoxCustomer): Promise<FortnoxCustomerResponse> {
        logger.info('Creating customer in Fortnox', { name: customerData.Name });
        return await this.request<FortnoxCustomerResponse>('/customers', {
            method: 'POST',
            body: JSON.stringify({ Customer: customerData })
        });
    }

    async findOrCreateCustomer(customerData: FortnoxCustomer): Promise<FortnoxCustomerResponse> {
        const normalize = (s: string) => s.toLowerCase().replace(/[_\s-]+/g, '').replace(/\.$/, '');

        try {
            // Use Fortnox name filter to avoid pagination issues (max 100 per page)
            if (customerData.Name) {
                const encoded = encodeURIComponent(customerData.Name);
                const filtered = await this.request<FortnoxCustomerListResponse>(`/customers?name=${encoded}`);
                const needle = normalize(customerData.Name);
                const byName = (filtered.Customers || []).find(c => c.Name && normalize(c.Name) === needle);
                if (byName) {
                    logger.info('Found existing customer by name', { customerNumber: byName.CustomerNumber, name: byName.Name });
                    return { Customer: byName } as FortnoxCustomerResponse;
                }
            }
        } catch (error) {
            logger.warn('Could not search customers', {
                error: error instanceof Error ? error.message : String(error),
            });
        }
        return await this.createCustomer(customerData);
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

    /**
     * Update an existing customer invoice (must be unbooked/uncancelled)
     * IMPORTANT: When updating InvoiceRows, ALL rows must be provided.
     */
    async updateInvoice(documentNumber: number, invoiceData: Partial<FortnoxInvoice>): Promise<FortnoxInvoiceResponse> {
        return await this.request<FortnoxInvoiceResponse>(`/invoices/${documentNumber}`, {
            method: 'PUT',
            body: JSON.stringify({ Invoice: invoiceData }),
        });
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
        pagination?: PaginationOptions,
        search?: VoucherSearchOptions
    ): Promise<FortnoxVoucherListResponse> {
        const paged = await this.requestPaginatedList<FortnoxVoucherListResponse['Vouchers'][number]>(
            '/vouchers',
            'Vouchers',
            {
                financialyear: financialYear,
                voucherseries: voucherSeries,
                fromdate: search?.fromDate,
                todate: search?.toDate,
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
            method: 'PUT',
            body: JSON.stringify({ SupplierInvoice: {} })
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
            method: 'PUT',
            body: JSON.stringify({ SupplierInvoice: {} })
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
     * Find or create a supplier by organization number or name
     */
    async findOrCreateSupplier(supplierData: FortnoxSupplier): Promise<FortnoxSupplierResponse> {
        // Old normalize: collapse whitespace to empty (for exact match backward compat)
        const normalize = (s: string) => s.toLowerCase().replace(/[_\s-]+/g, '').replace(/\.$/, '');

        // New normalize: strip company suffixes at end-of-string only, keep spaces for word counting
        const normalizeCompany = (s: string) =>
            s.toLowerCase()
                .replace(/\s+(ab|ltd|limited|inc|incorporated|gmbh|emea|nordic|sweden|scandinavia|europe|oy|as|aps|sa|sas|bv|nv)\s*$/i, '')
                .replace(/[_\s-]+/g, ' ')
                .replace(/\.$/, '')
                .trim();

        try {
            // 1. Match by org number using Fortnox filter (exact — most reliable)
            if (supplierData.OrganisationNumber) {
                const encoded = encodeURIComponent(supplierData.OrganisationNumber);
                const filtered = await this.request<FortnoxSupplierListResponse>(`/suppliers?organisationnumber=${encoded}`);
                const byOrg = (filtered.Suppliers || []).find(
                    s => s.OrganisationNumber === supplierData.OrganisationNumber
                );
                if (byOrg) {
                    logger.info('Found existing supplier by org number', {
                        supplierNumber: byOrg.SupplierNumber,
                        name: byOrg.Name,
                    });
                    return { Supplier: byOrg };
                }
            }

            // 2. Match by name — exact normalized match (existing behavior)
            if (supplierData.Name) {
                const encoded = encodeURIComponent(supplierData.Name);
                const filtered = await this.request<FortnoxSupplierListResponse>(`/suppliers?name=${encoded}`);
                const needle = normalize(supplierData.Name);
                const byName = (filtered.Suppliers || []).find(s => s.Name && normalize(s.Name) === needle);
                if (byName) {
                    logger.info('Found existing supplier by name (exact)', {
                        supplierNumber: byName.SupplierNumber,
                        name: byName.Name,
                        searchedName: supplierData.Name,
                    });
                    return { Supplier: byName };
                }

                // 3. Match by normalized company name — substring fallback (>=2 words only)
                //    Safety: single-word names like "Google" won't trigger substring matching
                //    to avoid matching different legal entities (Google Ireland vs Google Cloud)
                const normalizedNeedle = normalizeCompany(supplierData.Name);
                const wordCount = normalizedNeedle.split(' ').filter(w => w.length > 0).length;
                if (wordCount >= 2) {
                    // Use Fortnox name= param with first two words for a broader but targeted search
                    const searchTerm = normalizedNeedle.split(' ').slice(0, 2).join(' ');
                    const broadFiltered = await this.request<FortnoxSupplierListResponse>(
                        `/suppliers?name=${encodeURIComponent(searchTerm)}`
                    );
                    const byNormalized = (broadFiltered.Suppliers || []).find(s => {
                        if (!s.Name) return false;
                        const normalizedExisting = normalizeCompany(s.Name);
                        return normalizedExisting === normalizedNeedle ||
                            normalizedExisting.includes(normalizedNeedle) ||
                            normalizedNeedle.includes(normalizedExisting);
                    });
                    if (byNormalized) {
                        logger.info('Found existing supplier by normalized name (substring)', {
                            supplierNumber: byNormalized.SupplierNumber,
                            name: byNormalized.Name,
                            searchedName: supplierData.Name,
                            normalizedNeedle,
                        });
                        return { Supplier: byNormalized };
                    }
                }
            }
        } catch (error) {
            logger.warn('Could not search suppliers', {
                error: error instanceof Error ? error.message : String(error),
            });
        }

        // No match found — create new supplier
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

        const fetchSIE = async (token: string): Promise<Response> => {
            const url = `${this.baseUrl}${endpoint}`;
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30_000);

            try {
                const response = await fetch(url, {
                    headers: { 'Authorization': `Bearer ${token}` },
                    signal: controller.signal,
                });
                clearTimeout(timeoutId);

                if (!response.ok) {
                    const errorText = await response.text();
                    throw classifyFortnoxError(new Error(errorText), response.status);
                }

                return response;
            } catch (error) {
                clearTimeout(timeoutId);
                if (error instanceof FortnoxApiError) throw error;
                if (error instanceof Error && error.name === 'AbortError') {
                    throw new FortnoxTimeoutError();
                }
                throw error;
            }
        };

        // SIE endpoint returns raw text, not JSON - use raw fetch with timeout
        let response: Response;
        const token = await this.getAccessToken();
        try {
            response = await fetchSIE(token);
        } catch (error) {
            if (error instanceof FortnoxAuthError) {
                logger.info('Got 401 from Fortnox SIE export, attempting token refresh and retry');
                const freshToken = await this.forceRefreshToken();
                response = await fetchSIE(freshToken);
            } else {
                throw error;
            }
        }

        // SIE files use CP-437 encoding per Swedish SIE standard.
        // TextDecoder doesn't support CP-437, so decode manually.
        const buffer = await response.arrayBuffer();
        const content = decodeCp437(new Uint8Array(buffer));
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

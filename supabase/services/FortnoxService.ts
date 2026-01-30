/// <reference path="../types/deno.d.ts" />

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { createLogger } from './LoggerService.ts';
import type {
    FortnoxCustomerListResponse,
    FortnoxArticleListResponse,
    FortnoxInvoice,
    FortnoxInvoiceResponse,
    FortnoxVoucher,
    FortnoxVoucherResponse,
    FortnoxVoucherListResponse,
    FortnoxSupplierInvoice,
    FortnoxSupplierInvoiceResponse,
    FortnoxSupplierInvoiceListResponse,
    FortnoxSupplier,
    FortnoxSupplierResponse,
    FortnoxSupplierListResponse
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
}

const logger = createLogger('fortnox');

export class FortnoxService {
    private clientId: string;
    private clientSecret: string;
    private baseUrl: string = 'https://api.fortnox.se/3';
    private authUrl: string = 'https://apps.fortnox.se/oauth-v1/token';
    private supabase: SupabaseClient;

    constructor(config: FortnoxConfig, supabaseClient: SupabaseClient) {
        this.clientId = config.clientId;
        this.clientSecret = config.clientSecret;
        this.supabase = supabaseClient;
    }

    /**
     * Retrieves the current access token from the database.
     * If expired, it attempts to refresh it.
     */
    async getAccessToken(): Promise<string> {
        // Fetch tokens from DB
        const { data, error } = await this.supabase
            .from('fortnox_tokens')
            .select('*')
            .limit(1)
            .single();

        if (error || !data) {
            logger.error("Error fetching Fortnox tokens", error);
            throw new Error("Could not retrieve Fortnox credentials.");
        }

        // Check if token is expired (or close to expiring)
        // Assuming 'expires_at' is a timestamp in the DB
        const expiresAt = new Date(data.expires_at).getTime();
        const now = Date.now();

        // Refresh if expired or expiring in less than 5 minutes
        if (now >= expiresAt - 5 * 60 * 1000) {
            logger.info("Token expired or expiring soon, refreshing");
            return await this.refreshAccessToken(data.refresh_token, data.id);
        }

        return data.access_token;
    }

    /**
     * Refreshes the access token using the refresh token.
     * Updates the database with the new tokens.
     */
    async refreshAccessToken(refreshToken: string, rowId: string): Promise<string> {
        try {
            const credentials = btoa(`${this.clientId}:${this.clientSecret}`);

            const params = new URLSearchParams();
            params.append('grant_type', 'refresh_token');
            params.append('refresh_token', refreshToken);

            const response = await fetch(this.authUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': `Basic ${credentials}`
                },
                body: params
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Failed to refresh token: ${response.status} ${errorText}`);
            }

            const data = await response.json();
            const { access_token, refresh_token, expires_in } = data;

            // Calculate new expiration time
            const newExpiresAt = new Date(Date.now() + expires_in * 1000).toISOString();

            // Update DB with new tokens
            const { error: updateError } = await this.supabase
                .from('fortnox_tokens')
                .update({
                    access_token: access_token,
                    refresh_token: refresh_token, // Fortnox rotates refresh tokens!
                    expires_at: newExpiresAt,
                    updated_at: new Date().toISOString()
                })
                .eq('id', rowId);

            if (updateError) {
                logger.error("Failed to update tokens in DB", updateError);
                // We still return the access token so the current request succeeds,
                // but the next one might fail if DB isn't updated.
            }

            return access_token;
        } catch (error) {
            logger.error("Error refreshing Fortnox token", error);
            throw error;
        }
    }

    /**
     * Generic method to make authenticated requests to Fortnox
     */
    async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
        const token = await this.getAccessToken();

        const url = `${this.baseUrl}${endpoint}`;
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            ...options.headers
        };

        const response = await fetch(url, {
            ...options,
            headers
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Fortnox API Error: ${response.status} ${errorText}`);
        }

        return await response.json();
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

    // ========================================================================
    // VOUCHER METHODS (Verifikationer)
    // ========================================================================

    /**
     * Get all vouchers for a specific financial year and series
     */
    async getVouchers(financialYear?: number, voucherSeries?: string): Promise<FortnoxVoucherListResponse> {
        let endpoint = '/vouchers';
        const params: string[] = [];

        if (financialYear) {
            params.push(`financialyear=${financialYear}`);
        }
        if (voucherSeries) {
            params.push(`voucherseries=${voucherSeries}`);
        }

        if (params.length > 0) {
            endpoint += `?${params.join('&')}`;
        }

        return await this.request<FortnoxVoucherListResponse>(endpoint);
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
    }): Promise<FortnoxSupplierInvoiceListResponse> {
        let endpoint = '/supplierinvoices';
        const queryParams: string[] = [];

        if (params?.fromDate) {
            queryParams.push(`fromdate=${params.fromDate}`);
        }
        if (params?.toDate) {
            queryParams.push(`todate=${params.toDate}`);
        }
        if (params?.supplierNumber) {
            queryParams.push(`suppliernumber=${params.supplierNumber}`);
        }

        if (queryParams.length > 0) {
            endpoint += `?${queryParams.join('&')}`;
        }

        return await this.request<FortnoxSupplierInvoiceListResponse>(endpoint);
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
                logger.warn('Could not search suppliers', error);
            }
        }

        // Create new supplier
        return await this.createSupplier(supplierData);
    }
}

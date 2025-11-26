/// <reference path="../types/deno.d.ts" />

// @ts-expect-error - Deno npm: specifier
import { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { CustomerResponse, ArticleResponse, InvoiceCreateRequest } from '../functions/fortnox/types.ts';

export interface FortnoxConfig {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
}

export class FortnoxService {
    private clientId: string;
    private clientSecret: string;
    private baseUrl: string = 'https://api.fortnox.se/3';
    private authUrl: string = 'https://apps.fortnox.se/oauth-v1/token';
    private supabase: any;

    constructor(config: FortnoxConfig, supabaseClient: any) {
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
            console.error("Error fetching Fortnox tokens:", error);
            throw new Error("Could not retrieve Fortnox credentials.");
        }

        // Check if token is expired (or close to expiring)
        // Assuming 'expires_at' is a timestamp in the DB
        const expiresAt = new Date(data.expires_at).getTime();
        const now = Date.now();

        // Refresh if expired or expiring in less than 5 minutes
        if (now >= expiresAt - 5 * 60 * 1000) {
            console.log("Token expired or expiring soon. Refreshing...");
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
                console.error("Failed to update tokens in DB:", updateError);
                // We still return the access token so the current request succeeds, 
                // but the next one might fail if DB isn't updated.
            }

            return access_token;
        } catch (error) {
            console.error("Error refreshing Fortnox token:", error);
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
}

/**
 * FortnoxContextService - Central Fortnox data cache and context management
 *
 * Provides cached Fortnox data (customers, suppliers, articles) and
 * manages the "active entity" shown in the Fortnox sidebar panel.
 * Uses EventTarget for reactive updates to the sidebar.
 */

import { supabase } from '../lib/supabase';
import { logger } from './LoggerService';

// --- Types ---

export type FortnoxEntityType = 'customer' | 'supplier' | 'invoice' | 'voucher' | 'article' | 'account';

export interface FortnoxEntity {
    type: FortnoxEntityType;
    id: string;
    name: string;
    data: Record<string, unknown>;
    confidence: number; // 0-1, how sure we are about the match
}

export interface FortnoxCustomer {
    CustomerNumber: string;
    Name: string;
    Email?: string;
    OrganisationNumber?: string;
    Active?: boolean;
}

export interface FortnoxSupplier {
    SupplierNumber: string;
    Name: string;
    Email?: string;
    OrganisationNumber?: string;
    Active?: boolean;
}

export interface FortnoxArticle {
    ArticleNumber: string;
    Description: string;
    SalesPrice?: number;
    Unit?: string;
}

interface CacheEntry<T> {
    data: T;
    expires: number;
}

export type FortnoxConnectionStatus = 'connected' | 'disconnected' | 'checking' | 'error';

// --- Events ---

export class FortnoxEntityChangedEvent extends CustomEvent<FortnoxEntity | null> {
    constructor(entity: FortnoxEntity | null) {
        super('entity-changed', { detail: entity });
    }
}

export class FortnoxDataRefreshedEvent extends CustomEvent<{ type: string }> {
    constructor(dataType: string) {
        super('data-refreshed', { detail: { type: dataType } });
    }
}

export class FortnoxConnectionChangedEvent extends CustomEvent<FortnoxConnectionStatus> {
    constructor(status: FortnoxConnectionStatus) {
        super('connection-changed', { detail: status });
    }
}

// --- Service ---

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

class FortnoxContextServiceClass extends EventTarget {
    private customers: CacheEntry<FortnoxCustomer[]> | null = null;
    private suppliers: CacheEntry<FortnoxSupplier[]> | null = null;
    private articles: CacheEntry<FortnoxArticle[]> | null = null;
    private connectionStatus: FortnoxConnectionStatus = 'checking';
    private activeEntity: FortnoxEntity | null = null;
    private supabaseUrl: string;

    constructor() {
        super();
        this.supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    }

    // --- Connection ---

    async checkConnection(): Promise<FortnoxConnectionStatus> {
        this.connectionStatus = 'checking';
        this.dispatchEvent(new FortnoxConnectionChangedEvent('checking'));

        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                this.setConnectionStatus('disconnected');
                return 'disconnected';
            }

            const { data, error } = await supabase
                .from('fortnox_tokens')
                .select('id')
                .eq('user_id', session.user.id)
                .maybeSingle();

            if (error || !data) {
                this.setConnectionStatus('disconnected');
                return 'disconnected';
            }

            this.setConnectionStatus('connected');
            return 'connected';
        } catch (err) {
            logger.error('Fortnox connection check failed', err);
            this.setConnectionStatus('error');
            return 'error';
        }
    }

    private setConnectionStatus(status: FortnoxConnectionStatus): void {
        this.connectionStatus = status;
        this.dispatchEvent(new FortnoxConnectionChangedEvent(status));
    }

    getConnectionStatus(): FortnoxConnectionStatus {
        return this.connectionStatus;
    }

    isConnected(): boolean {
        return this.connectionStatus === 'connected';
    }

    // --- Data Fetching ---

    async fetchCustomers(force = false): Promise<FortnoxCustomer[]> {
        if (!force && this.customers && this.customers.expires > Date.now()) {
            return this.customers.data;
        }

        if (!this.isConnected()) return [];

        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) return [];

            const response = await fetch(`${this.supabaseUrl}/functions/v1/fortnox`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.access_token}`
                },
                body: JSON.stringify({ action: 'getCustomers' })
            });

            if (!response.ok) return this.customers?.data || [];

            const result = await response.json();
            const customers: FortnoxCustomer[] = (result.data?.Customers ?? result.Customers) || [];

            this.customers = { data: customers, expires: Date.now() + CACHE_TTL_MS };
            this.dispatchEvent(new FortnoxDataRefreshedEvent('customers'));
            return customers;
        } catch (err) {
            logger.error('Failed to fetch customers', err);
            return this.customers?.data || [];
        }
    }

    async fetchSuppliers(force = false): Promise<FortnoxSupplier[]> {
        if (!force && this.suppliers && this.suppliers.expires > Date.now()) {
            return this.suppliers.data;
        }

        if (!this.isConnected()) return [];

        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) return [];

            const response = await fetch(`${this.supabaseUrl}/functions/v1/fortnox`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.access_token}`
                },
                body: JSON.stringify({ action: 'getSuppliers' })
            });

            if (!response.ok) return this.suppliers?.data || [];

            const result = await response.json();
            const suppliers: FortnoxSupplier[] = (result.data?.Suppliers ?? result.Suppliers) || [];

            this.suppliers = { data: suppliers, expires: Date.now() + CACHE_TTL_MS };
            this.dispatchEvent(new FortnoxDataRefreshedEvent('suppliers'));
            return suppliers;
        } catch (err) {
            logger.error('Failed to fetch suppliers', err);
            return this.suppliers?.data || [];
        }
    }

    async fetchArticles(force = false): Promise<FortnoxArticle[]> {
        if (!force && this.articles && this.articles.expires > Date.now()) {
            return this.articles.data;
        }

        if (!this.isConnected()) return [];

        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) return [];

            const response = await fetch(`${this.supabaseUrl}/functions/v1/fortnox`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.access_token}`
                },
                body: JSON.stringify({ action: 'getArticles' })
            });

            if (!response.ok) return this.articles?.data || [];

            const result = await response.json();
            const articles: FortnoxArticle[] = (result.data?.Articles ?? result.Articles) || [];

            this.articles = { data: articles, expires: Date.now() + CACHE_TTL_MS };
            this.dispatchEvent(new FortnoxDataRefreshedEvent('articles'));
            return articles;
        } catch (err) {
            logger.error('Failed to fetch articles', err);
            return this.articles?.data || [];
        }
    }

    // --- Entity Lookup ---

    findCustomerByName(name: string): FortnoxCustomer | null {
        if (!this.customers?.data) return null;
        const lower = name.toLowerCase();
        return this.customers.data.find(c => c.Name.toLowerCase().includes(lower)) || null;
    }

    findSupplierByName(name: string): FortnoxSupplier | null {
        if (!this.suppliers?.data) return null;
        const lower = name.toLowerCase();
        return this.suppliers.data.find(s => s.Name.toLowerCase().includes(lower)) || null;
    }

    getCachedCustomers(): FortnoxCustomer[] {
        return this.customers?.data || [];
    }

    getCachedSuppliers(): FortnoxSupplier[] {
        return this.suppliers?.data || [];
    }

    getCachedArticles(): FortnoxArticle[] {
        return this.articles?.data || [];
    }

    // --- Active Entity ---

    setActiveEntity(entity: FortnoxEntity | null): void {
        this.activeEntity = entity;
        this.dispatchEvent(new FortnoxEntityChangedEvent(entity));
    }

    getActiveEntity(): FortnoxEntity | null {
        return this.activeEntity;
    }

    clearActiveEntity(): void {
        this.setActiveEntity(null);
    }

    // --- Preload ---

    async preloadData(): Promise<void> {
        if (!this.isConnected()) return;
        await Promise.allSettled([
            this.fetchCustomers(),
            this.fetchSuppliers(),
            this.fetchArticles()
        ]);
    }

    // --- Cache management ---

    clearCache(): void {
        this.customers = null;
        this.suppliers = null;
        this.articles = null;
        this.activeEntity = null;
    }
}

export const fortnoxContextService = new FortnoxContextServiceClass();

/**
 * FortnoxContextService - Central Fortnox data cache and context management
 *
 * Provides cached Fortnox data (customers, suppliers, articles) and
 * manages the "active entity" shown in the Fortnox sidebar panel.
 * Uses EventTarget for reactive updates to the sidebar.
 */

import { supabase } from '../lib/supabase';
import { logger } from './LoggerService';
import { getFortnoxList } from '../utils/fortnoxResponse';
import { isFortnoxEligible, normalizeUserPlan } from './PlanGateService';
import { companyService } from './CompanyService';

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
    companyId: string;
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
        if (typeof window !== 'undefined') {
            window.addEventListener('company-changed', ((event: Event) => {
                const companyId = (event as CustomEvent<{ companyId?: string }>).detail?.companyId;
                this.handleCompanyChanged(companyId || null);
            }) as EventListener);
        }
    }

    private getCurrentCompanyId(): string | null {
        try {
            return companyService.getCurrentId();
        } catch {
            return null;
        }
    }

    private handleCompanyChanged(companyId: string | null): void {
        this.clearCache();
        if (!companyId) {
            this.setConnectionStatus('disconnected');
            return;
        }

        this.setConnectionStatus('checking');
        void this.checkConnection().then((status) => {
            if (status === 'connected') {
                return this.preloadData(true);
            }
            return undefined;
        }).catch((err) => {
            logger.warn('Fortnox company switch refresh failed', err);
        });
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
            const companyId = this.getCurrentCompanyId();
            if (!companyId) {
                this.setConnectionStatus('disconnected');
                return 'disconnected';
            }

            const { data: profile, error: profileError } = await supabase
                .from('profiles')
                .select('plan')
                .eq('id', session.user.id)
                .maybeSingle();

            if (profileError) {
                logger.warn('Fortnox connection check: failed to load plan', profileError);
                this.setConnectionStatus('disconnected');
                return 'disconnected';
            }

            const plan = normalizeUserPlan((profile as { plan?: unknown } | null)?.plan);
            if (!isFortnoxEligible(plan)) {
                this.setConnectionStatus('disconnected');
                return 'disconnected';
            }

            const { data, error } = await supabase
                .from('fortnox_tokens')
                .select('id')
                .eq('user_id', session.user.id)
                .eq('company_id', companyId)
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
        const companyId = this.getCurrentCompanyId();
        if (!companyId) return [];

        if (!force && this.customers && this.customers.companyId === companyId && this.customers.expires > Date.now()) {
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
                body: JSON.stringify({ action: 'getCustomers', companyId })
            });

            if (!response.ok) {
                return this.customers?.companyId === companyId ? this.customers.data : [];
            }

            const result = await response.json();
            const customers = getFortnoxList<FortnoxCustomer>(result, 'Customers');

            this.customers = { data: customers, expires: Date.now() + CACHE_TTL_MS, companyId };
            this.dispatchEvent(new FortnoxDataRefreshedEvent('customers'));
            return customers;
        } catch (err) {
            logger.error('Failed to fetch customers', err);
            return this.customers?.companyId === companyId ? this.customers.data : [];
        }
    }

    async fetchSuppliers(force = false): Promise<FortnoxSupplier[]> {
        const companyId = this.getCurrentCompanyId();
        if (!companyId) return [];

        if (!force && this.suppliers && this.suppliers.companyId === companyId && this.suppliers.expires > Date.now()) {
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
                body: JSON.stringify({ action: 'getSuppliers', companyId })
            });

            if (!response.ok) {
                return this.suppliers?.companyId === companyId ? this.suppliers.data : [];
            }

            const result = await response.json();
            const suppliers = getFortnoxList<FortnoxSupplier>(result, 'Suppliers');

            this.suppliers = { data: suppliers, expires: Date.now() + CACHE_TTL_MS, companyId };
            this.dispatchEvent(new FortnoxDataRefreshedEvent('suppliers'));
            return suppliers;
        } catch (err) {
            logger.error('Failed to fetch suppliers', err);
            return this.suppliers?.companyId === companyId ? this.suppliers.data : [];
        }
    }

    async fetchArticles(force = false): Promise<FortnoxArticle[]> {
        const companyId = this.getCurrentCompanyId();
        if (!companyId) return [];

        if (!force && this.articles && this.articles.companyId === companyId && this.articles.expires > Date.now()) {
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
                body: JSON.stringify({ action: 'getArticles', companyId })
            });

            if (!response.ok) {
                return this.articles?.companyId === companyId ? this.articles.data : [];
            }

            const result = await response.json();
            const articles = getFortnoxList<FortnoxArticle>(result, 'Articles');

            this.articles = { data: articles, expires: Date.now() + CACHE_TTL_MS, companyId };
            this.dispatchEvent(new FortnoxDataRefreshedEvent('articles'));
            return articles;
        } catch (err) {
            logger.error('Failed to fetch articles', err);
            return this.articles?.companyId === companyId ? this.articles.data : [];
        }
    }

    // --- Entity Lookup ---

    findCustomerByName(name: string): FortnoxCustomer | null {
        const companyId = this.getCurrentCompanyId();
        if (!companyId || !this.customers?.data || this.customers.companyId !== companyId) return null;
        const lower = name.toLowerCase();
        return this.customers.data.find(c => c.Name.toLowerCase().includes(lower)) || null;
    }

    findSupplierByName(name: string): FortnoxSupplier | null {
        const companyId = this.getCurrentCompanyId();
        if (!companyId || !this.suppliers?.data || this.suppliers.companyId !== companyId) return null;
        const lower = name.toLowerCase();
        return this.suppliers.data.find(s => s.Name.toLowerCase().includes(lower)) || null;
    }

    getCachedCustomers(): FortnoxCustomer[] {
        const companyId = this.getCurrentCompanyId();
        if (!companyId || this.customers?.companyId !== companyId) return [];
        return this.customers.data;
    }

    getCachedSuppliers(): FortnoxSupplier[] {
        const companyId = this.getCurrentCompanyId();
        if (!companyId || this.suppliers?.companyId !== companyId) return [];
        return this.suppliers.data;
    }

    getCachedArticles(): FortnoxArticle[] {
        const companyId = this.getCurrentCompanyId();
        if (!companyId || this.articles?.companyId !== companyId) return [];
        return this.articles.data;
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

    async preloadData(force = false): Promise<void> {
        if (!this.isConnected()) return;
        await Promise.allSettled([
            this.fetchCustomers(force),
            this.fetchSuppliers(force),
            this.fetchArticles(force)
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

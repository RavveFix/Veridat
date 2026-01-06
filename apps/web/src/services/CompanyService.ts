/**
 * CompanyService - Company management for Britta
 *
 * Handles:
 * - Company CRUD operations
 * - LocalStorage persistence
 * - Current company tracking
 */

import type { Company, CreateCompanyInput, UpdateCompanyInput } from '../types/company';
import { createEmptyCompany } from '../types/company';
import { supabase } from '../lib/supabase';
import { logger } from './LoggerService';

const STORAGE_KEYS = {
    COMPANIES: 'companies',
    CURRENT_COMPANY_ID: 'currentCompanyId',
    USER_ID: 'companiesUserId'
} as const;

class CompanyServiceClass {
    private companies: Company[] = [];
    private currentCompanyId: string | null = null;
    private initialized = false;
    private dbUserId: string | null = null;

    private normalizeCompany(company: Partial<Company>): Company {
        return {
            id: company.id || `company-${Date.now()}`,
            name: company.name || 'Mitt Företag AB',
            orgNumber: company.orgNumber || '',
            address: company.address || '',
            phone: company.phone || '',
            history: Array.isArray(company.history) ? company.history : [],
            invoices: Array.isArray(company.invoices) ? company.invoices : [],
            documents: Array.isArray(company.documents) ? company.documents : [],
            verificationCounter: typeof company.verificationCounter === 'number' ? company.verificationCounter : 1,
            conversationId: company.conversationId,
            createdAt: company.createdAt || new Date().toISOString(),
            updatedAt: company.updatedAt || new Date().toISOString()
        };
    }

    /**
     * Initialize the company manager (load from localStorage)
     */
    init(): void {
        if (this.initialized) return;

        this.loadFromStorage();

        // Create default company if none exist (skip DB sync - syncWithDatabase handles this)
        if (this.companies.length === 0) {
            const defaultCompany = this.create({
                name: 'Mitt Företag AB',
                orgNumber: ''
            }, true); // skipDbSync = true
            this.currentCompanyId = defaultCompany.id;
            this.saveToStorage();
            logger.info('Created default company (local only)', { id: defaultCompany.id });
        }

        this.initialized = true;
        logger.debug('CompanyService initialized', {
            companyCount: this.companies.length,
            currentCompanyId: this.currentCompanyId
        });
    }

    /**
     * Load companies from localStorage
     */
    private loadFromStorage(): void {
        try {
            const stored = localStorage.getItem(STORAGE_KEYS.COMPANIES);
            const parsed: unknown = stored ? JSON.parse(stored) : [];
            this.companies = Array.isArray(parsed)
                ? parsed.map((company) => this.normalizeCompany(company as Partial<Company>))
                : [];
            this.currentCompanyId = localStorage.getItem(STORAGE_KEYS.CURRENT_COMPANY_ID);
        } catch (e) {
            logger.error('Failed to load companies from storage', e);
            this.companies = [];
            this.currentCompanyId = null;
        }
    }

    /**
     * Save companies to localStorage
     */
    private saveToStorage(): void {
        try {
            localStorage.setItem(STORAGE_KEYS.COMPANIES, JSON.stringify(this.companies));
            if (this.currentCompanyId) {
                localStorage.setItem(STORAGE_KEYS.CURRENT_COMPANY_ID, this.currentCompanyId);
            }
            if (this.dbUserId) {
                localStorage.setItem(STORAGE_KEYS.USER_ID, this.dbUserId);
            }
        } catch (e) {
            logger.error('Failed to save companies to storage', e);
        }
    }

    /**
     * Get all companies
     */
    getAll(): Company[] {
        return [...this.companies];
    }

    /**
     * Get company by ID
     */
    getById(id: string): Company | undefined {
        return this.companies.find(c => c.id === id);
    }

    /**
     * Get current company
     */
    getCurrent(): Company {
        const current = this.companies.find(c => c.id === this.currentCompanyId);
        if (current) return current;

        // Fallback to first company
        if (this.companies.length > 0) {
            this.currentCompanyId = this.companies[0].id;
            this.saveToStorage();
            return this.companies[0];
        }

        // No companies - create default (skip DB sync - syncWithDatabase handles this)
        const defaultCompany = this.create({
            name: 'Mitt Företag AB',
            orgNumber: ''
        }, true); // skipDbSync = true
        this.currentCompanyId = defaultCompany.id;
        this.saveToStorage();
        return defaultCompany;
    }

    /**
     * Get current company ID
     */
    getCurrentId(): string {
        return this.getCurrent().id;
    }

    /**
     * Create a new company
     * @param input - Company data
     * @param skipDbSync - If true, don't immediately sync to DB (used for placeholder companies)
     */
    create(input: CreateCompanyInput, skipDbSync = false): Company {
        const company = createEmptyCompany(input);
        this.companies.push(company);
        this.saveToStorage();
        logger.info('Company created', { id: company.id, name: company.name, skipDbSync });
        if (!skipDbSync) {
            void this.upsertCompanyToDatabase(company);
        }
        return company;
    }

    /**
     * Update an existing company
     */
    update(id: string, input: UpdateCompanyInput): Company | null {
        const index = this.companies.findIndex(c => c.id === id);
        if (index === -1) {
            logger.warn('Company not found for update', { id });
            return null;
        }

        const updated: Company = {
            ...this.companies[index],
            ...input,
            updatedAt: new Date().toISOString()
        };

        this.companies[index] = updated;
        this.saveToStorage();
        logger.info('Company updated', { id, changes: Object.keys(input) });
        void this.upsertCompanyToDatabase(updated);
        return updated;
    }

    /**
     * Delete a company
     */
    delete(id: string): boolean {
        const index = this.companies.findIndex(c => c.id === id);
        if (index === -1) {
            logger.warn('Company not found for deletion', { id });
            return false;
        }

        // Don't allow deleting last company
        if (this.companies.length === 1) {
            logger.warn('Cannot delete last company');
            return false;
        }

        this.companies.splice(index, 1);

        // If deleting current company, switch to first available
        if (this.currentCompanyId === id) {
            this.currentCompanyId = this.companies[0]?.id || null;
        }

        this.saveToStorage();
        logger.info('Company deleted', { id });
        void this.deleteCompanyFromDatabase(id);
        return true;
    }

    /**
     * Switch to a different company
     */
    switchTo(id: string): Company | null {
        const company = this.getById(id);
        if (!company) {
            logger.warn('Company not found for switch', { id });
            return null;
        }

        this.currentCompanyId = id;
        this.saveToStorage();
        logger.info('Switched to company', { id, name: company.name });
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('company-changed', { detail: { companyId: id } }));
        }
        return company;
    }

    /**
     * Set conversation ID for current company
     */
    setConversationId(conversationId: string | null): void {
        const current = this.getCurrent();
        current.conversationId = conversationId ?? undefined; // Convert null to undefined if type expects optional string
        this.saveToStorage();
        logger.debug('Set conversation ID for company', {
            companyId: current.id,
            conversationId
        });
    }

    /**
     * Get conversation ID for current company
     */
    getConversationId(): string | undefined {
        return this.getCurrent().conversationId;
    }

    /**
     * Increment verification counter for current company
     */
    incrementVerificationCounter(): number {
        const current = this.getCurrent();
        current.verificationCounter = (current.verificationCounter || 0) + 1;
        this.saveToStorage();
        return current.verificationCounter;
    }

    /**
     * Get verification counter for current company
     */
    getVerificationCounter(): number {
        return this.getCurrent().verificationCounter || 1;
    }

    /**
     * Check if company name already exists
     */
    nameExists(name: string, excludeId?: string): boolean {
        return this.companies.some(c =>
            c.name.toLowerCase() === name.toLowerCase() && c.id !== excludeId
        );
    }

    /**
     * Get company count
     */
    getCount(): number {
        return this.companies.length;
    }

    /**
     * Export companies as JSON (for backup)
     */
    exportAsJson(): string {
        return JSON.stringify(this.companies, null, 2);
    }

    /**
     * Import companies from JSON (for restore)
     */
    importFromJson(json: string): boolean {
        try {
            const imported = JSON.parse(json) as Company[];
            if (!Array.isArray(imported)) {
                throw new Error('Invalid format: expected array');
            }

            // Validate basic structure
            for (const company of imported) {
                if (!company.id || !company.name) {
                    throw new Error('Invalid company: missing id or name');
                }
            }

            this.companies = imported;
            if (this.companies.length > 0 && !this.currentCompanyId) {
                this.currentCompanyId = this.companies[0].id;
            }
            this.saveToStorage();
            logger.info('Companies imported', { count: imported.length });
            return true;
        } catch (e) {
            logger.error('Failed to import companies', e);
            return false;
        }
    }

    clearLocalCache(): void {
        this.companies = [];
        this.currentCompanyId = null;
        this.dbUserId = null;
        this.initialized = false;

        try {
            localStorage.removeItem(STORAGE_KEYS.COMPANIES);
            localStorage.removeItem(STORAGE_KEYS.CURRENT_COMPANY_ID);
            localStorage.removeItem(STORAGE_KEYS.USER_ID);
        } catch (e) {
            logger.error('Failed to clear company cache', e);
        }
    }

    private isPlaceholderDefaultCompany(company: Company): boolean {
        const hasNoData = (company.history?.length ?? 0) === 0
            && (company.invoices?.length ?? 0) === 0
            && (company.documents?.length ?? 0) === 0
            && !company.conversationId
            && (company.verificationCounter ?? 1) === 1;

        return company.name === 'Mitt Företag AB'
            && !company.orgNumber
            && !company.address
            && !company.phone
            && hasNoData;
    }

    /**
     * Check if a DB row represents a placeholder company
     */
    private isDbRowPlaceholder(row: { name: string; org_number?: string; address?: string; phone?: string }): boolean {
        return row.name === 'Mitt Företag AB'
            && !row.org_number
            && !row.address
            && !row.phone;
    }

    /**
     * Remove duplicate placeholder companies from DB, keeping only the oldest one
     */
    private async cleanupDuplicatePlaceholders(
        userId: string,
        dbCompanies: Array<{ id: string; name: string; org_number?: string; address?: string; phone?: string; created_at?: string }>
    ): Promise<string[]> {
        const placeholders = dbCompanies.filter(row => this.isDbRowPlaceholder(row));

        if (placeholders.length <= 1) {
            return []; // No duplicates to clean
        }

        // Sort by created_at ascending - keep the oldest
        placeholders.sort((a, b) => {
            const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
            const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
            return dateA - dateB;
        });

        // Delete all but the first (oldest)
        const toDelete = placeholders.slice(1);
        const deletedIds: string[] = [];

        for (const row of toDelete) {
            const { error } = await supabase
                .from('companies')
                .delete()
                .eq('user_id', userId)
                .eq('id', row.id);

            if (error) {
                logger.error('Failed to delete duplicate placeholder', { id: row.id, error });
            } else {
                deletedIds.push(row.id);
                logger.info('Deleted duplicate placeholder company', { id: row.id, name: row.name });
            }
        }

        return deletedIds;
    }

    private async getAuthenticatedUserId(): Promise<string | null> {
        if (this.dbUserId) return this.dbUserId;

        const { data: { session } } = await supabase.auth.getSession();
        this.dbUserId = session?.user?.id ?? null;
        return this.dbUserId;
    }

    private async upsertCompanyToDatabase(company: Company): Promise<void> {
        try {
            const userId = await this.getAuthenticatedUserId();
            if (!userId) return;

            const { error } = await supabase
                .from('companies')
                .upsert(
                    {
                        user_id: userId,
                        id: company.id,
                        name: company.name,
                        org_number: company.orgNumber || '',
                        address: company.address || '',
                        phone: company.phone || ''
                    },
                    { onConflict: 'user_id,id' }
                );

            if (error) {
                logger.error('Failed to upsert company to DB', { companyId: company.id, error });
            }
        } catch (e) {
            logger.error('Exception upserting company to DB', e);
        }
    }

    private async deleteCompanyFromDatabase(companyId: string): Promise<void> {
        try {
            const userId = await this.getAuthenticatedUserId();
            if (!userId) return;

            const { error } = await supabase
                .from('companies')
                .delete()
                .eq('user_id', userId)
                .eq('id', companyId);

            if (error) {
                logger.error('Failed to delete company from DB', { companyId, error });
            }
        } catch (e) {
            logger.error('Exception deleting company from DB', e);
        }
    }

    async syncWithDatabase(userId: string): Promise<void> {
        this.dbUserId = userId;

        try {
            const cachedUserId = localStorage.getItem(STORAGE_KEYS.USER_ID);
            if (cachedUserId && cachedUserId !== userId) {
                logger.info('User changed, clearing local company cache before sync', { cachedUserId, userId });
                this.companies = [];
                this.currentCompanyId = null;
                localStorage.removeItem(STORAGE_KEYS.COMPANIES);
                localStorage.removeItem(STORAGE_KEYS.CURRENT_COMPANY_ID);
            }

            localStorage.setItem(STORAGE_KEYS.USER_ID, userId);

            const { data: dbCompanies, error } = await supabase
                .from('companies')
                .select('id, name, org_number, address, phone, created_at, updated_at')
                .eq('user_id', userId)
                .order('created_at', { ascending: true });

            if (error) {
                logger.error('Failed to fetch companies from DB', { error });
                return;
            }

            // Clean up any duplicate placeholder companies from previous buggy syncs
            const deletedIds = await this.cleanupDuplicatePlaceholders(userId, dbCompanies || []);
            const cleanDbCompanies = (dbCompanies || []).filter(row => !deletedIds.includes(row.id));

            const safeLocalCompanies = this.companies.map((c) => this.normalizeCompany(c));
            const localById = new Map(safeLocalCompanies.map((company) => [company.id, company]));
            const dbIds = new Set(cleanDbCompanies.map((row) => row.id));

            const mergedCompanies: Company[] = cleanDbCompanies.map((row) => {
                const local = localById.get(row.id);
                return {
                    id: row.id,
                    name: row.name,
                    orgNumber: row.org_number || '',
                    address: row.address || '',
                    phone: row.phone || '',
                    history: local?.history || [],
                    invoices: local?.invoices || [],
                    documents: local?.documents || [],
                    verificationCounter: local?.verificationCounter || 1,
                    conversationId: local?.conversationId,
                    createdAt: row.created_at || local?.createdAt,
                    updatedAt: row.updated_at || local?.updatedAt
                };
            });

            const localNotInDb = safeLocalCompanies.filter((company) => !dbIds.has(company.id));

            if (cleanDbCompanies.length === 0) {
                // First-time sync: push local companies up (including the default company).
                if (safeLocalCompanies.length > 0) {
                    const rows = safeLocalCompanies.map((company) => ({
                        user_id: userId,
                        id: company.id,
                        name: company.name,
                        org_number: company.orgNumber || '',
                        address: company.address || '',
                        phone: company.phone || ''
                    }));

                    const { error: upsertError } = await supabase
                        .from('companies')
                        .upsert(rows, { onConflict: 'user_id,id' });

                    if (upsertError) {
                        logger.error('Failed to seed companies to DB from localStorage', { upsertError });
                    } else {
                        logger.info('Seeded companies to DB from localStorage', { count: rows.length });
                    }
                }

                // Keep local list as-is (already normalized).
                this.companies = safeLocalCompanies;
            } else {
                // DB already has companies: only push meaningful local-only companies (avoid creating a placeholder).
                const shouldSkipSinglePlaceholder = localNotInDb.length === 1 && this.isPlaceholderDefaultCompany(localNotInDb[0]);
                const toUpsert = shouldSkipSinglePlaceholder
                    ? []
                    : localNotInDb;

                if (toUpsert.length > 0) {
                    const rows = toUpsert.map((company) => ({
                        user_id: userId,
                        id: company.id,
                        name: company.name,
                        org_number: company.orgNumber || '',
                        address: company.address || '',
                        phone: company.phone || ''
                    }));

                    const { error: upsertError } = await supabase
                        .from('companies')
                        .upsert(rows, { onConflict: 'user_id,id' });

                    if (upsertError) {
                        logger.error('Failed to upsert local-only companies to DB', { upsertError });
                    } else {
                        mergedCompanies.push(...toUpsert);
                    }
                }

                this.companies = mergedCompanies;
            }

            if (this.companies.length === 0) {
                // No companies after sync - create a fallback and sync it
                const fallbackCompany = this.create({
                    name: 'Mitt Företag AB',
                    orgNumber: ''
                }, false); // DO sync this one since DB is empty
                this.companies = [fallbackCompany];
            }

            if (!this.currentCompanyId || !this.companies.some((company) => company.id === this.currentCompanyId)) {
                this.currentCompanyId = this.companies[0].id;
            }

            this.saveToStorage();
            logger.info('Company sync completed', {
                companies: this.companies.length,
                currentCompanyId: this.currentCompanyId
            });
        } catch (e) {
            logger.error('Company sync failed', e);
        }
    }
}

// Singleton instance
export const companyService = new CompanyServiceClass();

// Backward-compatible alias
export const companyManager = companyService;

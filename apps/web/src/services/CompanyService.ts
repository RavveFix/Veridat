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
import { logger } from './LoggerService';

const STORAGE_KEYS = {
    COMPANIES: 'companies',
    CURRENT_COMPANY_ID: 'currentCompanyId'
} as const;

class CompanyServiceClass {
    private companies: Company[] = [];
    private currentCompanyId: string | null = null;
    private initialized = false;

    /**
     * Initialize the company manager (load from localStorage)
     */
    init(): void {
        if (this.initialized) return;

        this.loadFromStorage();

        // Create default company if none exist
        if (this.companies.length === 0) {
            const defaultCompany = this.create({
                name: 'Mitt Företag AB',
                orgNumber: ''
            });
            this.currentCompanyId = defaultCompany.id;
            this.saveToStorage();
            logger.info('Created default company', { id: defaultCompany.id });
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
            this.companies = stored ? JSON.parse(stored) : [];
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

        // No companies - create default
        const defaultCompany = this.create({
            name: 'Mitt Företag AB',
            orgNumber: ''
        });
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
     */
    create(input: CreateCompanyInput): Company {
        const company = createEmptyCompany(input);
        this.companies.push(company);
        this.saveToStorage();
        logger.info('Company created', { id: company.id, name: company.name });
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
}

// Singleton instance
export const companyService = new CompanyServiceClass();

// Backward-compatible alias
export const companyManager = companyService;

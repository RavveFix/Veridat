/**
 * Company-related type definitions for Britta
 */

/**
 * Represents a bookkeeping entry in the company's history
 */
export interface BookkeepingEntry {
    id: string;
    date: string;
    description: string;
    verificationNumber: number;
    debit: number;
    credit: number;
    account: string;
    accountName?: string;
    createdAt: string;
}

/**
 * Represents a supplier invoice
 */
export interface SupplierInvoice {
    id: string;
    invoiceNumber: string;
    supplier: string;
    amount: number;
    vat: number;
    vatRate: number;
    dueDate: string;
    status: 'pending' | 'paid' | 'overdue';
    createdAt: string;
    paidAt?: string;
    description?: string;
}

/**
 * Represents an uploaded document
 */
export interface CompanyDocument {
    id: string;
    name: string;
    type: 'pdf' | 'excel' | 'image' | 'other';
    url: string;
    size: number;
    uploadedAt: string;
    description?: string;
    category?: 'invoice' | 'receipt' | 'contract' | 'report' | 'other';
}

/**
 * Represents a company in the Britta application
 */
export interface Company {
    id: string;
    name: string;
    orgNumber: string;
    address: string;
    phone: string;
    history: BookkeepingEntry[];
    invoices: SupplierInvoice[];
    documents: CompanyDocument[];
    verificationCounter: number;
    conversationId?: string;
    createdAt?: string;
    updatedAt?: string;
}

/**
 * Data required to create a new company
 */
export interface CreateCompanyInput {
    name: string;
    orgNumber: string;
    address?: string;
    phone?: string;
}

/**
 * Data for updating an existing company
 */
export interface UpdateCompanyInput {
    name?: string;
    orgNumber?: string;
    address?: string;
    phone?: string;
}

function generateCompanyId(): string {
    try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }
    } catch {
        // Ignore and fall back below
    }
    return `company-${Date.now()}`;
}

/**
 * Creates a new company with default values
 */
export function createEmptyCompany(input: CreateCompanyInput): Company {
    return {
        id: generateCompanyId(),
        name: input.name,
        orgNumber: input.orgNumber,
        address: input.address || '',
        phone: input.phone || '',
        history: [],
        invoices: [],
        documents: [],
        verificationCounter: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
}

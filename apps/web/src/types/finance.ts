import type { BankImport, BankTransaction } from './bank';

export type CompanyForm = 'ab' | 'enskild';
export type VatPeriodicity = 'monthly' | 'quarterly' | 'yearly';
export type BookkeepingMethod = 'accrual' | 'cash';

export interface AccountingProfile {
    companyId: string;
    companyForm: CompanyForm;
    vatPeriodicity: VatPeriodicity;
    bookkeepingMethod: BookkeepingMethod;
    payrollEnabled: boolean;
    fiscalYearStartMonth: number;
    createdAt?: string;
    updatedAt?: string;
}

export interface BankImportRecord extends Omit<BankImport, 'transactions'> {
    transactions: BankTransactionRecord[];
}

export interface BankTransactionRecord extends BankTransaction {
    matchStatus?: 'unmatched' | 'suggested' | 'approved' | 'posted' | 'dismissed';
    fortnoxRef?: Record<string, unknown>;
    aiDecisionId?: string | null;
}

export interface ReconciliationPeriodRecord {
    id?: string;
    period: string;
    status: 'open' | 'reconciled' | 'locked';
    reconciledAt?: string | null;
    lockedAt?: string | null;
    notes?: string;
}

export type InvoiceStatus = 'ny' | 'granskad' | 'bokford' | 'betald';
export type InvoiceSource = 'upload' | 'fortnox';
export type FortnoxSyncStatus = 'not_exported' | 'exported' | 'booked' | 'attested';

export interface InvoiceInboxRecord {
    id: string;
    fileName: string;
    fileUrl: string;
    filePath: string;
    fileBucket: string;
    uploadedAt: string;
    status: InvoiceStatus;
    source: InvoiceSource;
    supplierName: string;
    supplierOrgNr: string;
    invoiceNumber: string;
    invoiceDate: string;
    dueDate: string;
    totalAmount: number | null;
    vatAmount: number | null;
    vatRate: number | null;
    ocrNumber: string;
    basAccount: string;
    basAccountName: string;
    currency: string;
    fortnoxSyncStatus: FortnoxSyncStatus;
    fortnoxSupplierNumber: string;
    fortnoxGivenNumber: number | null;
    fortnoxBooked: boolean;
    fortnoxBalance: number | null;
    aiExtracted: boolean;
    aiRawResponse: string;
    aiReviewNote: string;
    aiDecisionId?: string | null;
}

export interface AgiRunRecord {
    id: string;
    period: string;
    status: 'draft' | 'review_required' | 'approved';
    sourceType: 'system' | 'fortnox' | 'manual' | 'hybrid';
    totals: Record<string, unknown>;
    controlResults: Record<string, unknown>;
    approvedBy?: string | null;
    approvedAt?: string | null;
    createdAt?: string;
    updatedAt?: string;
}

export interface RegulatoryRuleRecord {
    id: string;
    ruleKey: string;
    domain: string;
    companyForm: CompanyForm | 'all';
    effectiveFrom: string;
    effectiveTo?: string | null;
    legalStatus: 'proposed' | 'active' | 'sunset';
    payload: Record<string, unknown>;
    sourceUrls: string[];
    lastVerifiedAt?: string | null;
}

export interface AutoPostPolicy {
    enabled: boolean;
    minConfidence: number;
    maxAmountSek: number;
    requireKnownCounterparty: boolean;
    allowWithActiveRuleOnly: boolean;
    requireManualForNewSupplier: boolean;
    requireManualForDeviatingVat: boolean;
    requireManualForLockedPeriod: boolean;
}


export interface BankImportMapping {
    date?: string;
    description?: string;
    amount?: string;
    inflow?: string;
    outflow?: string;
    counterparty?: string;
    reference?: string;
    ocr?: string;
    currency?: string;
    account?: string;
}

export interface BankTransaction {
    id: string;
    date: string;
    description: string;
    amount: number;
    currency?: string;
    counterparty?: string;
    reference?: string;
    ocr?: string;
    account?: string;
    raw?: Record<string, string>;
}

export interface BankImport {
    id: string;
    companyId: string;
    filename: string;
    importedAt: string;
    rowCount: number;
    mapping: BankImportMapping;
    transactions: BankTransaction[];
}

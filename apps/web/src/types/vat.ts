export interface VATReportResponse {
    type: 'vat_report';
    data: VATReportData;
}

export interface VATReportData {
    type: 'vat_report';
    period: string;
    company: {
        name: string;
        org_number: string;
    };
    summary: {
        total_income: number;
        total_costs: number;
        result: number;
    };
    sales: SalesTransaction[];
    costs: CostTransaction[];
    vat: VATSummary;
    journal_entries: JournalEntry[];
    validation: ValidationResult;
    verification?: VerificationInfo;
    charging_sessions?: ChargingSession[];
}

export interface SalesTransaction {
    description: string;
    net: number;
    vat: number;
    rate: number;
}

export interface CostTransaction {
    description: string;
    net: number;
    vat: number;
    rate: number;
}

export interface VATSummary {
    outgoing_25: number;
    outgoing_12?: number;
    outgoing_6?: number;
    incoming: number;
    net: number;
    to_pay?: number;
    to_refund?: number;
}

export interface JournalEntry {
    account: string;
    name: string;
    debit: number;
    credit: number;
}

/**
 * Varning för 0%-moms transaktioner
 */
export interface ZeroVATWarning {
    level: 'info' | 'warning' | 'error';
    code: string;
    message: string;
    transaction_id?: string;
    suggestion?: string;
}

export interface ValidationResult {
    is_valid: boolean;
    errors: string[];
    warnings: string[];
    zero_vat_warnings?: ZeroVATWarning[];
    zero_vat_count?: number;
}

/**
 * Verifikatinformation enligt BFL 7:1
 */
export interface VerificationInfo {
    internal_id: string;
    generated_at: string;
    source_file?: string;
    transaction_count: number;
    has_external_receipts?: boolean;
    missing_receipt_count?: number;
}

export interface ChargingSession {
    id: string;
    kwh: number;
    amount: number;
    [key: string]: any;
}

/**
 * BAS account descriptions for tooltips
 */
export const BAS_ACCOUNT_INFO: Record<string, string> = {
    '3010': 'Försäljning tjänster med 25% moms',
    '3011': 'Försäljning momsfria tjänster (t.ex. roaming)',
    '3012': 'Roaming-intäkter',
    '3001': 'Försäljning varor med 25% moms',
    '4010': 'Inköp av tjänster med 25% moms',
    '4011': 'Inköp av momsfria tjänster',
    '6540': 'Abonnemangskostnader (IT-tjänster)',
    '6570': 'Bankavgifter och transaktionsavgifter',
    '6590': 'Övriga externa tjänster',
    '6591': 'Plattformsavgifter (Monta, etc.)',
    '2611': 'Utgående moms 25% - redovisas till Skatteverket',
    '2621': 'Utgående moms 12% - redovisas till Skatteverket',
    '2631': 'Utgående moms 6% - redovisas till Skatteverket',
    '2641': 'Ingående moms 25% - avdragsgill',
};

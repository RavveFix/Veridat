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

export interface ValidationResult {
    is_valid: boolean;
    errors: string[];
    warnings: string[];
}

export interface ChargingSession {
    id: string;
    kwh: number;
    amount: number;
    [key: string]: any;
}

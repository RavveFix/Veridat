
export interface FortnoxCustomer {
    CustomerNumber: string;
    Name: string;
    OrganisationNumber?: string;
    Email?: string;
    Address1?: string;
    ZipCode?: string;
    City?: string;
    Phone1?: string;
    Active?: boolean;
}

export interface FortnoxArticle {
    ArticleNumber: string;
    Description: string;
    DisposableQuantity?: number;
    SalesPrice?: number;
    Unit?: string;
    StockPlace?: string;
    WebshopArticle?: boolean;
}

export interface FortnoxInvoiceRow {
    ArticleNumber?: string;
    Description?: string;
    DeliveredQuantity?: string; // Fortnox API uses strings for quantities in some contexts, but often numbers in JSON. Keeping string to match service usage if needed, or number. The schema says string for DeliveredQuantity in one place, let's be safe.
    Price?: number;
    AccountNumber?: number;
    CostCenter?: string;
}

export interface FortnoxInvoice {
    CustomerNumber: string;
    InvoiceDate?: string;
    DueDate?: string;
    InvoiceRows: FortnoxInvoiceRow[];
    Comments?: string;
    OurReference?: string;
    YourReference?: string;
}

export interface FortnoxResponse<T> {
    MetaInformation?: {
        "@TotalResources": number;
        "@TotalPages": number;
        "@CurrentPage": number;
    };
}

export interface FortnoxCustomerListResponse extends FortnoxResponse<FortnoxCustomer> {
    Customers: FortnoxCustomer[];
}

export interface FortnoxArticleListResponse extends FortnoxResponse<FortnoxArticle> {
    Articles: FortnoxArticle[];
}

export interface FortnoxInvoiceResponse extends FortnoxResponse<FortnoxInvoice> {
    Invoice: FortnoxInvoice;
}

// ============================================================================
// VOUCHER TYPES (Verifikationer)
// ============================================================================

export interface FortnoxVoucherRow {
    Account: number;
    Debit?: number;
    Credit?: number;
    Description?: string;
    TransactionInformation?: string;
    CostCenter?: string;
    Project?: string;
}

export interface FortnoxVoucher {
    Description: string;
    TransactionDate: string;
    VoucherSeries: string;
    VoucherRows: FortnoxVoucherRow[];
    Comments?: string;
    CostCenter?: string;
    Project?: string;
}

export interface FortnoxVoucherResponse extends FortnoxResponse<FortnoxVoucher> {
    Voucher: FortnoxVoucher & {
        VoucherNumber: number;
        Year: number;
    };
}

export interface FortnoxVoucherListResponse extends FortnoxResponse<FortnoxVoucher> {
    Vouchers: Array<FortnoxVoucher & {
        VoucherNumber: number;
        Year: number;
    }>;
}

// ============================================================================
// SUPPLIER INVOICE TYPES (Leverantörsfakturor)
// ============================================================================

export interface FortnoxSupplierInvoiceRow {
    Account: number;
    Debit?: number;
    Credit?: number;
    TransactionInformation?: string;
    CostCenter?: string;
    Project?: string;
}

export interface FortnoxSupplierInvoice {
    SupplierNumber: string;
    InvoiceNumber: string;
    InvoiceDate: string;
    DueDate: string;
    Total: number;
    VAT?: number;
    VATType?: 'NORMAL' | 'EUINTERNAL' | 'REVERSE';
    Currency?: string;
    ExternalInvoiceNumber?: string;
    ExternalInvoiceSeries?: string;
    AccountingMethod?: 'ACCRUAL' | 'CASH';
    SupplierInvoiceRows?: FortnoxSupplierInvoiceRow[];
    Comments?: string;
    OCR?: string;
    YourReference?: string;
    OurReference?: string;
}

export interface FortnoxSupplierInvoiceResponse extends FortnoxResponse<FortnoxSupplierInvoice> {
    SupplierInvoice: FortnoxSupplierInvoice & {
        GivenNumber: number;
        Balance: number;
        Booked: boolean;
        FinalPayDate?: string;
    };
}

export interface FortnoxSupplierInvoiceListResponse extends FortnoxResponse<FortnoxSupplierInvoice> {
    SupplierInvoices: Array<FortnoxSupplierInvoice & {
        GivenNumber: number;
        Balance: number;
        Booked: boolean;
    }>;
}

// ============================================================================
// SUPPLIER TYPES (Leverantörer)
// ============================================================================

export interface FortnoxSupplier {
    SupplierNumber?: string;
    Name: string;
    OrganisationNumber?: string;
    Email?: string;
    Address1?: string;
    Address2?: string;
    ZipCode?: string;
    City?: string;
    Country?: string;
    CountryCode?: string;
    Phone1?: string;
    Phone2?: string;
    BankAccountNumber?: string;
    BG?: string;
    PG?: string;
    BIC?: string;
    IBAN?: string;
    VATNumber?: string;
    VATType?: 'NORMAL' | 'EUINTERNAL' | 'REVERSE';
    Currency?: string;
    TermsOfPayment?: string;
    Active?: boolean;
    Comments?: string;
}

export interface FortnoxSupplierResponse extends FortnoxResponse<FortnoxSupplier> {
    Supplier: FortnoxSupplier & {
        SupplierNumber: string;
    };
}

export interface FortnoxSupplierListResponse extends FortnoxResponse<FortnoxSupplier> {
    Suppliers: Array<FortnoxSupplier & {
        SupplierNumber: string;
    }>;
}

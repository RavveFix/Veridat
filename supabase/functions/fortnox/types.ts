
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

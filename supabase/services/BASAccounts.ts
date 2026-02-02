/**
 * Swedish BAS Chart of Accounts (Kontoplan)
 *
 * Standard accounts for Swedish bookkeeping used by Veridat.
 * Based on BAS 2024 with focus on EV charging/CPO operations.
 *
 * Account ranges:
 * - 1xxx: Assets (Tillgångar)
 * - 2xxx: Liabilities (Skulder)
 * - 3xxx: Revenue (Intäkter)
 * - 4xxx: Costs of goods sold (Varuinköp)
 * - 5-6xxx: Operating expenses (Övriga kostnader)
 * - 7xxx: Personnel costs (Personal)
 * - 8xxx: Financial items (Finansiella poster)
 */

export interface BASAccount {
    account: string;
    name: string;
    description?: string;
}

// BAS accounts used by Veridat
export const BAS_ACCOUNTS = {
    // Revenue accounts (3xxx)
    SALES_25: {
        account: '3010',
        name: 'Försäljning tjänster 25% moms',
        description: 'Laddningsintäkter med 25% moms',
    },
    SALES_12: {
        account: '3011',
        name: 'Försäljning tjänster 12% moms',
        description: 'Tjänster med 12% moms (livsmedel, hotell)',
    },
    SALES_6: {
        account: '3012',
        name: 'Försäljning tjänster 6% moms',
        description: 'Tjänster med 6% moms (kultur, böcker)',
    },
    SALES_0: {
        account: '3013',
        name: 'Försäljning momsfri',
        description: 'Momsfri försäljning (omvänd skattskyldighet)',
    },
    SALES_ROAMING: {
        account: '3014',
        name: 'Roamingintäkter',
        description: 'Intäkter från roaming-laddning (OCPI)',
    },

    // Cost accounts (4xxx, 6xxx)
    SUBSCRIPTION: {
        account: '6540',
        name: 'IT-tjänster, abonnemang',
        description: 'Programvara, SaaS, abonnemang',
    },
    BANK_FEES: {
        account: '6570',
        name: 'Bankavgifter, transaktionsavgifter',
        description: 'Bank- och betalningsavgifter',
    },
    PLATFORM_FEES: {
        account: '6591',
        name: 'Plattformsavgifter',
        description: 'Avgifter till Monta och andra plattformar',
    },
    EXTERNAL_SERVICES: {
        account: '6590',
        name: 'Övriga externa tjänster',
        description: 'Konsulter och andra externa tjänster',
    },
    OPERATOR_FEES: {
        account: '6592',
        name: 'Operatörsavgifter',
        description: 'Avgifter till elnätsoperatörer',
    },

    // VAT accounts (2xxx)
    VAT_OUT_25: {
        account: '2611',
        name: 'Utgående moms 25%',
        description: 'Moms att betala på försäljning 25%',
    },
    VAT_OUT_12: {
        account: '2621',
        name: 'Utgående moms 12%',
        description: 'Moms att betala på försäljning 12%',
    },
    VAT_OUT_6: {
        account: '2631',
        name: 'Utgående moms 6%',
        description: 'Moms att betala på försäljning 6%',
    },
    VAT_IN: {
        account: '2641',
        name: 'Ingående moms',
        description: 'Avdragsgill moms på inköp',
    },
    VAT_SETTLEMENT: {
        account: '2650',
        name: 'Momsredovisning',
        description: 'Avräkningskonto för moms',
    },

    // Bank accounts (1xxx)
    BANK: {
        account: '1930',
        name: 'Företagskonto',
        description: 'Huvudkonto för affärsverksamhet',
    },
    ACCOUNTS_RECEIVABLE: {
        account: '1510',
        name: 'Kundfordringar',
        description: 'Utestående kundfordringar',
    },
    ACCOUNTS_PAYABLE: {
        account: '2440',
        name: 'Leverantörsskulder',
        description: 'Skulder till leverantörer',
    },
} as const;

export type BASAccountKey = keyof typeof BAS_ACCOUNTS;

/**
 * Get cost account based on VAT rate and transaction description.
 * Uses intelligent routing to categorize costs.
 */
export function getCostAccount(vatRate: number, description: string): BASAccount {
    const desc = description.toLowerCase();

    // Subscription services
    if (desc.includes('abonnemang') || desc.includes('subscription') || desc.includes('månadsavgift')) {
        return BAS_ACCOUNTS.SUBSCRIPTION;
    }

    // Bank and transaction fees
    if (
        desc.includes('transaktionsavgift') ||
        desc.includes('transaction fee') ||
        desc.includes('bankavgift') ||
        desc.includes('kortavgift')
    ) {
        return BAS_ACCOUNTS.BANK_FEES;
    }

    // Operator fees
    if (desc.includes('operator fee') || desc.includes('operatörsavgift')) {
        return BAS_ACCOUNTS.OPERATOR_FEES;
    }

    // Platform fees (Monta, etc.) - often 0% VAT
    if (
        desc.includes('platform') ||
        desc.includes('plattform') ||
        desc.includes('monta') ||
        vatRate === 0
    ) {
        return BAS_ACCOUNTS.PLATFORM_FEES;
    }

    // Default to external services
    return BAS_ACCOUNTS.EXTERNAL_SERVICES;
}

/**
 * Get sales account based on VAT rate and roaming status.
 */
export function getSalesAccount(vatRate: number, isRoaming: boolean = false): BASAccount {
    if (isRoaming) {
        return BAS_ACCOUNTS.SALES_ROAMING;
    }

    switch (vatRate) {
        case 25:
            return BAS_ACCOUNTS.SALES_25;
        case 12:
            return BAS_ACCOUNTS.SALES_12;
        case 6:
            return BAS_ACCOUNTS.SALES_6;
        default:
            return BAS_ACCOUNTS.SALES_0;
    }
}

/**
 * Get VAT account based on rate and direction (in/out).
 */
export function getVATAccount(vatRate: number, isOutgoing: boolean): BASAccount {
    if (!isOutgoing) {
        return BAS_ACCOUNTS.VAT_IN;
    }

    switch (vatRate) {
        case 25:
            return BAS_ACCOUNTS.VAT_OUT_25;
        case 12:
            return BAS_ACCOUNTS.VAT_OUT_12;
        case 6:
            return BAS_ACCOUNTS.VAT_OUT_6;
        default:
            return BAS_ACCOUNTS.VAT_OUT_25; // Default to 25% if rate unknown
    }
}

/**
 * Get account by number
 */
export function getAccountByNumber(accountNumber: string): BASAccount | undefined {
    return Object.values(BAS_ACCOUNTS).find((acc) => acc.account === accountNumber);
}

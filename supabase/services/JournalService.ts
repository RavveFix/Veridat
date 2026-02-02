/**
 * Journal Entry Service for Swedish Bookkeeping
 *
 * Generates verification IDs (verifikatnummer) per BFL 7:1 and
 * creates journal entries for Swedish double-entry bookkeeping.
 */

import { roundToOre } from './SwedishRounding.ts';
import { BAS_ACCOUNTS, getCostAccount, getSalesAccount, getVATAccount } from './BASAccounts.ts';

export interface JournalEntry {
    account: string;
    accountName: string;
    debit: number;
    credit: number;
    description: string;
}

export interface VerificationMetadata {
    verificationId: string;
    generatedAt: string;
    sourceFile?: string;
    transactionCount: number;
    period: string;
    companyId?: string;
}

/**
 * Generate verification ID according to BFL 7:1
 * Format: VERIDAT-{YEAR}-{MONTH}-{SEQUENCE}
 *
 * @param period - Period in YYYY-MM format
 * @param sequence - Sequence number within the period
 */
export function generateVerificationId(period: string, sequence: number = 1): string {
    const parts = period.split('-');
    const year = parts[0] || new Date().getFullYear().toString();
    const month = parts[1] || String(new Date().getMonth() + 1).padStart(2, '0');

    return `VERIDAT-${year}-${month}-${String(sequence).padStart(3, '0')}`;
}

/**
 * Generate deterministic transaction verification ID using SHA-256 hash.
 * Same transaction ID will always produce the same verification ID.
 *
 * Format: V{YYYYMMDD}-{HASH}
 *
 * @param transactionId - Unique transaction identifier
 * @param createdAt - Optional creation date (defaults to now)
 */
export async function generateTransactionVerificationId(
    transactionId: string,
    createdAt?: Date
): Promise<string> {
    const date = createdAt || new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');

    const encoder = new TextEncoder();
    const data = encoder.encode(transactionId);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

    return `V${dateStr}-${hashHex.slice(0, 6).toUpperCase()}`;
}

/**
 * Generate batch verification metadata
 */
export function generateBatchVerification(
    period: string,
    transactionCount: number,
    sourceFile?: string,
    companyId?: string
): VerificationMetadata {
    return {
        verificationId: generateVerificationId(period, 1),
        generatedAt: new Date().toISOString(),
        sourceFile,
        transactionCount,
        period,
        companyId,
    };
}

/**
 * Create journal entries for a sales transaction.
 * Debits bank/receivables, credits revenue and outgoing VAT.
 *
 * @param netAmount - Net amount (excl. VAT)
 * @param vatAmount - VAT amount
 * @param vatRate - VAT rate (25, 12, 6, or 0)
 * @param isRoaming - Whether this is a roaming transaction
 */
export function createSalesJournalEntries(
    netAmount: number,
    vatAmount: number,
    vatRate: number,
    isRoaming: boolean = false
): JournalEntry[] {
    const salesAccount = getSalesAccount(vatRate, isRoaming);
    const entries: JournalEntry[] = [];
    const grossAmount = roundToOre(netAmount + vatAmount);

    // Debit bank/receivables (total including VAT)
    entries.push({
        account: BAS_ACCOUNTS.BANK.account,
        accountName: BAS_ACCOUNTS.BANK.name,
        debit: grossAmount,
        credit: 0,
        description: `Inbetalning laddning ${vatRate}% moms`,
    });

    // Credit revenue (net amount)
    entries.push({
        account: salesAccount.account,
        accountName: salesAccount.name,
        debit: 0,
        credit: roundToOre(netAmount),
        description: `Intäkter ${vatRate}% moms`,
    });

    // Credit outgoing VAT (if > 0%)
    if (vatRate > 0 && vatAmount > 0) {
        const vatAccount = getVATAccount(vatRate, true);
        entries.push({
            account: vatAccount.account,
            accountName: vatAccount.name,
            debit: 0,
            credit: roundToOre(vatAmount),
            description: `Utgående moms ${vatRate}%`,
        });
    }

    return entries;
}

/**
 * Create journal entries for a cost/expense transaction.
 * Debits costs and incoming VAT, credits bank/payables.
 *
 * @param netAmount - Net amount (excl. VAT) - should be positive
 * @param vatAmount - VAT amount - should be positive
 * @param vatRate - VAT rate (25, 12, 6, or 0)
 * @param description - Transaction description for account routing
 */
export function createCostJournalEntries(
    netAmount: number,
    vatAmount: number,
    vatRate: number,
    description: string
): JournalEntry[] {
    const costAccount = getCostAccount(vatRate, description);
    const entries: JournalEntry[] = [];

    // Use absolute values for clarity
    const absNet = Math.abs(netAmount);
    const absVat = Math.abs(vatAmount);
    const grossAmount = roundToOre(absNet + absVat);

    // Debit cost account
    entries.push({
        account: costAccount.account,
        accountName: costAccount.name,
        debit: roundToOre(absNet),
        credit: 0,
        description: costAccount.name,
    });

    // Debit incoming VAT (if deductible)
    if (vatRate > 0 && absVat > 0) {
        entries.push({
            account: BAS_ACCOUNTS.VAT_IN.account,
            accountName: BAS_ACCOUNTS.VAT_IN.name,
            debit: roundToOre(absVat),
            credit: 0,
            description: 'Ingående moms',
        });
    }

    // Credit bank/payables (total)
    entries.push({
        account: BAS_ACCOUNTS.BANK.account,
        accountName: BAS_ACCOUNTS.BANK.name,
        debit: 0,
        credit: grossAmount,
        description: `Betalning ${description}`,
    });

    return entries;
}

/**
 * Validate that journal entries balance (debit = credit)
 */
export function validateJournalBalance(entries: JournalEntry[]): {
    balanced: boolean;
    totalDebit: number;
    totalCredit: number;
    difference: number;
} {
    const totalDebit = entries.reduce((sum, e) => sum + e.debit, 0);
    const totalCredit = entries.reduce((sum, e) => sum + e.credit, 0);
    const difference = roundToOre(Math.abs(totalDebit - totalCredit));

    return {
        balanced: difference < 0.01, // Allow 1 öre tolerance
        totalDebit: roundToOre(totalDebit),
        totalCredit: roundToOre(totalCredit),
        difference,
    };
}

/**
 * Group journal entries by account
 */
export function groupEntriesByAccount(
    entries: JournalEntry[]
): Map<string, { account: string; name: string; totalDebit: number; totalCredit: number }> {
    const grouped = new Map<
        string,
        { account: string; name: string; totalDebit: number; totalCredit: number }
    >();

    for (const entry of entries) {
        const existing = grouped.get(entry.account);
        if (existing) {
            existing.totalDebit = roundToOre(existing.totalDebit + entry.debit);
            existing.totalCredit = roundToOre(existing.totalCredit + entry.credit);
        } else {
            grouped.set(entry.account, {
                account: entry.account,
                name: entry.accountName,
                totalDebit: entry.debit,
                totalCredit: entry.credit,
            });
        }
    }

    return grouped;
}

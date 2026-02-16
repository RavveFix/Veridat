import type { JournalEntry, SalesTransaction, CostTransaction, Verifikat } from '../types/vat';

/**
 * Groups flat journal entries into numbered Verifikat (V1, V2, ...)
 *
 * Each Verifikat represents a balanced debit/credit pair for a specific
 * transaction category (e.g. sales at 25%, roaming at 0%, subscriptions).
 */
export function groupToVerifikationer(
    _journalEntries: unknown[],
    sales: SalesTransaction[],
    costs: CostTransaction[],
    period: string
): Verifikat[] {
    const verifikationer: Verifikat[] = [];
    let vNumber = 1;

    // Determine date from period (last day of period month)
    const date = getLastDayOfPeriod(period);

    // Group sales by VAT rate
    const salesByRate = groupByRate(sales);
    for (const [rate, transactions] of salesByRate) {
        const totalNet = transactions.reduce((sum, t) => sum + t.net, 0);
        const totalVat = transactions.reduce((sum, t) => sum + t.vat, 0);
        const totalGross = totalNet + totalVat;

        if (totalNet === 0 && totalVat === 0) continue;

        // Find matching journal entries for this sale group
        const entries = buildSalesEntries(transactions, rate, totalNet, totalVat, totalGross);

        verifikationer.push({
            number: vNumber++,
            description: getSalesDescription(transactions, rate),
            date,
            entries,
            grossAmount: totalGross,
            vatRate: rate,
        });
    }

    // Group costs by description/category
    const costGroups = groupCostsByCategory(costs);
    for (const [category, transactions] of costGroups) {
        const totalNet = transactions.reduce((sum, t) => sum + Math.abs(t.net), 0);
        const totalVat = transactions.reduce((sum, t) => sum + Math.abs(t.vat), 0);
        const totalGross = totalNet + totalVat;

        if (totalNet === 0 && totalVat === 0) continue;

        const rate = transactions[0]?.rate ?? 25;
        const entries = buildCostEntries(category, totalNet, totalVat, totalGross, rate);

        verifikationer.push({
            number: vNumber++,
            description: category,
            date,
            entries,
            grossAmount: -totalGross,
            vatRate: rate,
        });
    }

    return verifikationer;
}

function getLastDayOfPeriod(period: string): string {
    const monthNames: Record<string, number> = {
        'januari': 0, 'februari': 1, 'mars': 2, 'april': 3,
        'maj': 4, 'juni': 5, 'juli': 6, 'augusti': 7,
        'september': 8, 'oktober': 9, 'november': 10, 'december': 11,
    };

    const lower = period.toLowerCase();
    let month = -1;
    let year = new Date().getFullYear();

    for (const [name, idx] of Object.entries(monthNames)) {
        if (lower.includes(name)) {
            month = idx;
            break;
        }
    }

    const yearMatch = period.match(/20\d{2}/);
    if (yearMatch) year = parseInt(yearMatch[0]);

    if (month === -1) {
        // Try Q format
        const qMatch = period.match(/Q([1-4])/i);
        if (qMatch) {
            month = (parseInt(qMatch[1]) * 3) - 1; // Last month of quarter
        } else {
            return `${year}-12-31`;
        }
    }

    const lastDay = new Date(year, month + 1, 0);
    return lastDay.toISOString().split('T')[0];
}

function groupByRate(transactions: SalesTransaction[]): Map<number, SalesTransaction[]> {
    const map = new Map<number, SalesTransaction[]>();
    for (const tx of transactions) {
        const existing = map.get(tx.rate) || [];
        existing.push(tx);
        map.set(tx.rate, existing);
    }
    return map;
}

function groupCostsByCategory(costs: CostTransaction[]): Map<string, CostTransaction[]> {
    const map = new Map<string, CostTransaction[]>();
    for (const tx of costs) {
        const key = tx.description || 'Övriga kostnader';
        const existing = map.get(key) || [];
        existing.push(tx);
        map.set(key, existing);
    }
    return map;
}

function getSalesDescription(transactions: SalesTransaction[], rate: number): string {
    if (transactions.length === 1 && transactions[0].description) {
        return transactions[0].description;
    }
    if (rate === 0) return 'Momsfri försäljning';
    return `Försäljning ${rate}% moms`;
}

function getAccountForSales(rate: number): { account: string; name: string } {
    if (rate === 0) return { account: '3011', name: 'Momsfri försäljning' };
    if (rate === 12) return { account: '3010', name: 'Försäljning 12% moms' };
    if (rate === 6) return { account: '3010', name: 'Försäljning 6% moms' };
    return { account: '3010', name: 'Försäljning 25% moms' };
}

function getVatAccount(rate: number): string {
    if (rate === 12) return '2620';
    if (rate === 6) return '2630';
    return '2610';
}

function buildSalesEntries(
    _transactions: SalesTransaction[],
    rate: number,
    totalNet: number,
    totalVat: number,
    totalGross: number,
): JournalEntry[] {
    const entries: JournalEntry[] = [];
    const salesAccount = getAccountForSales(rate);

    // Debit: Bank account
    entries.push({
        account: '1930',
        name: 'Företagskonto',
        debit: totalGross,
        credit: 0,
    });

    // Credit: Sales account
    entries.push({
        account: salesAccount.account,
        name: salesAccount.name,
        debit: 0,
        credit: totalNet,
    });

    // Credit: VAT account (if applicable)
    if (totalVat > 0) {
        entries.push({
            account: getVatAccount(rate),
            name: `Utgående moms ${rate}%`,
            debit: 0,
            credit: totalVat,
        });
    }

    return entries;
}

function buildCostEntries(
    category: string,
    totalNet: number,
    totalVat: number,
    totalGross: number,
    _rate: number,
): JournalEntry[] {
    const entries: JournalEntry[] = [];

    // Debit: Cost account
    entries.push({
        account: '6590',
        name: category,
        debit: totalNet,
        credit: 0,
    });

    // Debit: Input VAT (if applicable)
    if (totalVat > 0) {
        entries.push({
            account: '2640',
            name: 'Ingående moms',
            debit: totalVat,
            credit: 0,
        });
    }

    // Credit: Bank account
    entries.push({
        account: '1930',
        name: 'Företagskonto',
        debit: 0,
        credit: totalGross,
    });

    return entries;
}

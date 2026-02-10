/**
 * Swedish VAT Rate Service - Date-Aware
 *
 * Handles VAT rate changes over time for Swedish tax compliance.
 *
 * Key change: From April 1, 2026, food VAT (matmoms) drops from 12% to 6%.
 * Restaurant/catering stays at 12%. This is temporary until December 31, 2027.
 *
 * Legal basis: Prop. 2025/26:55 (Vårändringsbudgeten)
 */

export type VATCategory =
    | 'standard'          // 25% - most goods and services
    | 'food'              // 12% → 6% from 2026-04-01 (livsmedel)
    | 'restaurant'        // 12% (unchanged - restaurang/catering)
    | 'hotel'             // 12% (unchanged - hotell)
    | 'culture'           // 6% (böcker, kultur, kollektivtrafik)
    | 'exempt';           // 0% (export, sjukvård, finans)

interface VATRateChange {
    effectiveFrom: string;  // ISO date YYYY-MM-DD
    effectiveTo?: string;   // ISO date YYYY-MM-DD (undefined = indefinite)
    rate: number;
}

/**
 * VAT rate history per category.
 * When rates change, add a new entry with effectiveFrom date.
 */
const VAT_RATE_HISTORY: Record<VATCategory, VATRateChange[]> = {
    standard: [
        { effectiveFrom: '1990-01-01', rate: 25 },
    ],
    food: [
        { effectiveFrom: '1996-01-01', rate: 12 },
        { effectiveFrom: '2026-04-01', effectiveTo: '2027-12-31', rate: 6 },
        // After 2027-12-31, reverts to 12% unless extended
    ],
    restaurant: [
        { effectiveFrom: '2012-01-01', rate: 12 },
    ],
    hotel: [
        { effectiveFrom: '1993-01-01', rate: 12 },
    ],
    culture: [
        { effectiveFrom: '2002-01-01', rate: 6 },
    ],
    exempt: [
        { effectiveFrom: '1990-01-01', rate: 0 },
    ],
};

/**
 * Get the VAT rate for a given category and transaction date.
 *
 * @param category - The VAT category
 * @param transactionDate - The date of the transaction (ISO string or Date)
 * @returns The applicable VAT rate as a percentage (e.g., 25, 12, 6, 0)
 */
export function getVATRate(category: VATCategory, transactionDate?: string | Date): number {
    const dateStr = normalizeDate(transactionDate);
    const history = VAT_RATE_HISTORY[category];

    // Find the applicable rate: latest entry where effectiveFrom <= transactionDate
    // and (no effectiveTo or effectiveTo >= transactionDate)
    let applicableRate = history[0].rate;

    for (const entry of history) {
        if (entry.effectiveFrom <= dateStr) {
            if (!entry.effectiveTo || entry.effectiveTo >= dateStr) {
                applicableRate = entry.rate;
            }
        }
    }

    return applicableRate;
}

/**
 * Get the current food VAT rate based on today's date.
 * Convenience function for the most common use case.
 */
export function getFoodVATRate(transactionDate?: string | Date): number {
    return getVATRate('food', transactionDate);
}

/**
 * Check if the matmoms reduction is active for a given date.
 * Active from 2026-04-01 to 2027-12-31.
 */
export function isMatmomsReductionActive(transactionDate?: string | Date): boolean {
    const dateStr = normalizeDate(transactionDate);
    return dateStr >= '2026-04-01' && dateStr <= '2027-12-31';
}

/**
 * Get a human-readable summary of all current VAT rates.
 * Useful for AI prompts and documentation.
 */
export function getVATRateSummary(transactionDate?: string | Date): string {
    const date = transactionDate || new Date();
    const foodRate = getVATRate('food', date);
    const matmomsActive = isMatmomsReductionActive(date);

    let summary = `Svenska momssatser:\n`;
    summary += `- Standard: 25% (de flesta varor och tjänster)\n`;
    summary += `- Livsmedel: ${foodRate}%`;
    if (matmomsActive) {
        summary += ` (tillfälligt sänkt från 12%, gäller 1 april 2026 – 31 december 2027)`;
    }
    summary += `\n`;
    summary += `- Restaurang/catering: 12%\n`;
    summary += `- Hotell: 12%\n`;
    summary += `- Kultur, böcker, kollektivtrafik: 6%\n`;
    summary += `- Momsfri: 0% (export, sjukvård, finans, fastighetsuthyrning)\n`;

    return summary;
}

function normalizeDate(date?: string | Date): string {
    if (!date) {
        return new Date().toISOString().split('T')[0];
    }
    if (date instanceof Date) {
        return date.toISOString().split('T')[0];
    }
    // Already ISO string - take just the date part
    return date.split('T')[0];
}

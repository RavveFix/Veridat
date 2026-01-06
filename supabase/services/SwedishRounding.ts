/**
 * Swedish Bank Rounding (ROUND_HALF_UP) for monetary amounts.
 *
 * CRITICAL: All amounts MUST be rounded BEFORE summing to avoid
 * accumulated floating-point errors.
 *
 * Swedish accounting requires öre precision (2 decimals).
 */

/**
 * Round to öre (2 decimals) using banker's rounding (ROUND_HALF_UP)
 */
export function roundToOre(amount: number): number {
    return Math.round(amount * 100) / 100;
}

/**
 * Round to whole kronor (for cash payments and tax declarations)
 */
export function roundToKrona(amount: number): number {
    return Math.round(amount);
}

/**
 * Calculate VAT amount with correct rounding
 * @param netAmount - Net amount (excl. VAT)
 * @param vatRate - VAT rate as percentage (25, 12, 6, or 0)
 */
export function calculateVAT(netAmount: number, vatRate: number): number {
    return roundToOre(netAmount * (vatRate / 100));
}

/**
 * Calculate gross amount (net + VAT) with rounding
 */
export function calculateGross(netAmount: number, vatAmount: number): number {
    return roundToOre(netAmount + vatAmount);
}

/**
 * Calculate net amount from gross and VAT rate
 */
export function calculateNet(grossAmount: number, vatRate: number): number {
    return roundToOre(grossAmount / (1 + vatRate / 100));
}

/**
 * Safe sum - rounds each amount BEFORE addition to avoid accumulated errors.
 * This is critical for Swedish accounting where öre precision matters.
 */
export function safeSum(amounts: number[]): number {
    return amounts.reduce((sum, amount) => roundToOre(sum + roundToOre(amount)), 0);
}

/**
 * Validate VAT calculation with tolerance (default: 1 öre)
 * Returns true if the difference is within tolerance
 */
export function validateVATCalculation(
    net: number,
    vat: number,
    rate: number,
    tolerance: number = 0.01
): boolean {
    const expected = calculateVAT(net, rate);
    return Math.abs(vat - expected) <= tolerance;
}

/**
 * Validate gross amount (net + vat = gross) with tolerance
 */
export function validateGrossAmount(
    net: number,
    vat: number,
    gross: number,
    tolerance: number = 0.01
): boolean {
    const expected = calculateGross(net, vat);
    return Math.abs(gross - expected) <= tolerance;
}

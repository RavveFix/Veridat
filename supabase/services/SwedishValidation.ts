/**
 * Swedish Business Validation Utilities
 *
 * Validates Swedish organization numbers and VAT numbers using the Luhn algorithm.
 * Required for tax compliance and invoice validation.
 */

export interface ValidationResult {
    valid: boolean;
    message: string;
}

/**
 * Validate Swedish organization number (organisationsnummer)
 * Format: NNNNNN-NNNN (10 digits, with or without hyphen)
 *
 * Uses Luhn algorithm (modulus 10) for checksum validation.
 * The check digit is the 10th digit.
 */
export function validateOrgNumber(orgNr: string): ValidationResult {
    // Strip all non-digits
    const clean = orgNr.replace(/\D/g, '');

    if (clean.length !== 10) {
        return {
            valid: false,
            message: 'Organisationsnummer måste vara 10 siffror',
        };
    }

    // Luhn algorithm
    const digits = clean.split('').map(Number);
    let checksum = 0;

    for (let i = 0; i < 9; i++) {
        const d = digits[i];
        if (i % 2 === 0) {
            // Double digits at even positions (0, 2, 4, 6, 8)
            const doubled = d * 2;
            checksum += doubled < 10 ? doubled : doubled - 9;
        } else {
            checksum += d;
        }
    }

    // Calculate expected check digit
    const expected = (10 - (checksum % 10)) % 10;

    if (digits[9] !== expected) {
        return {
            valid: false,
            message: `Ogiltig kontrollsiffra (förväntat ${expected})`,
        };
    }

    return { valid: true, message: 'OK' };
}

/**
 * Validate Swedish VAT number (momsnummer/momsregistreringsnummer)
 * Format: SE + 10 digits + 01 (e.g., SE556183919101)
 *
 * The 10 middle digits are the organization number.
 */
export function validateVATNumber(vatNr: string): ValidationResult {
    const clean = vatNr.replace(/\s/g, '').toUpperCase();

    if (!clean.startsWith('SE')) {
        return {
            valid: false,
            message: 'Svenskt VAT-nummer måste börja med SE',
        };
    }

    if (!clean.endsWith('01')) {
        return {
            valid: false,
            message: 'Svenskt VAT-nummer måste sluta med 01',
        };
    }

    if (clean.length !== 14) {
        return {
            valid: false,
            message: 'Svenskt VAT-nummer måste vara 14 tecken (SE + 10 siffror + 01)',
        };
    }

    // Extract and validate the organization number part
    const orgPart = clean.slice(2, 12);
    return validateOrgNumber(orgPart);
}

/**
 * Format organization number with hyphen (NNNNNN-NNNN)
 */
export function formatOrgNumber(orgNr: string): string {
    const clean = orgNr.replace(/\D/g, '');
    if (clean.length !== 10) return orgNr;
    return `${clean.slice(0, 6)}-${clean.slice(6)}`;
}

/**
 * Format VAT number in standard format (SE NNNNNNNNNN 01)
 */
export function formatVATNumber(vatNr: string): string {
    const clean = vatNr.replace(/\D/g, '');
    if (clean.length !== 12) return vatNr;
    return `SE${clean.slice(0, 10)}01`;
}

/**
 * Extract organization number from VAT number
 */
export function extractOrgFromVAT(vatNr: string): string | null {
    const clean = vatNr.replace(/[^0-9]/g, '');
    if (clean.length === 12) {
        return clean.slice(0, 10);
    }
    return null;
}

/**
 * Zero VAT Validation for Swedish Tax Compliance
 *
 * Validates 0% VAT transactions according to Swedish tax law (ML 3:30a).
 * Zero VAT is valid for:
 * - Roaming transactions (OCPI, EU C-60/23)
 * - B2B with reverse charge (omvänd skattskyldighet)
 * - Platform fees from foreign providers
 *
 * All other 0% VAT transactions are flagged for manual review.
 */

export interface ZeroVATWarning {
    level: 'info' | 'warning' | 'error';
    code: string;
    message: string;
    transactionId?: string;
    suggestion?: string;
}

export interface ZeroVATValidationParams {
    transactionId: string;
    amount: number;
    vatRate: number;
    isRoaming?: boolean;
    counterpartName?: string;
    description?: string;
    counterpartVatNumber?: string;
}

/**
 * Validate a transaction with 0% VAT.
 * Returns warnings/info about why 0% VAT is or isn't valid.
 */
export function validateZeroVAT(params: ZeroVATValidationParams): ZeroVATWarning[] {
    // Only validate 0% VAT transactions
    if (params.vatRate !== 0) {
        return [];
    }

    const name = (params.counterpartName || '').toLowerCase();
    const description = (params.description || '').toLowerCase();

    // 1. Roaming transactions - valid 0% VAT (EU C-60/23, OCPI)
    if (params.isRoaming) {
        return [
            {
                level: 'info',
                code: 'ZERO_VAT_ROAMING',
                message: '0% moms på roaming-transaktion. Omvänd skattskyldighet (ML 3:30a).',
                transactionId: params.transactionId,
            },
        ];
    }

    // 2. Platform fees from Monta or similar - valid 0% VAT
    if (
        name.includes('monta') ||
        name.includes('platform') ||
        description.includes('platform fee') ||
        description.includes('plattformsavgift')
    ) {
        return [
            {
                level: 'info',
                code: 'ZERO_VAT_PLATFORM_FEE',
                message: '0% moms på plattformsavgift. B2B-tjänst med omvänd skattskyldighet.',
                transactionId: params.transactionId,
            },
        ];
    }

    // 3. B2B with valid VAT number - valid 0% VAT (reverse charge)
    if (params.counterpartVatNumber) {
        return [
            {
                level: 'info',
                code: 'ZERO_VAT_B2B',
                message: `0% moms med VAT-nummer: ${params.counterpartVatNumber}. Omvänd skattskyldighet (ML 3:30a).`,
                transactionId: params.transactionId,
            },
        ];
    }

    // 4. Export outside EU - valid 0% VAT
    if (
        description.includes('export') ||
        description.includes('utanför eu') ||
        description.includes('outside eu')
    ) {
        return [
            {
                level: 'info',
                code: 'ZERO_VAT_EXPORT',
                message: '0% moms på export utanför EU (ML 5 kap 9§).',
                transactionId: params.transactionId,
            },
        ];
    }

    // 5. Unknown reason for 0% VAT - requires manual review
    return [
        {
            level: 'warning',
            code: 'ZERO_VAT_UNKNOWN',
            message: '0% moms utan tydlig anledning. Granska manuellt.',
            transactionId: params.transactionId,
            suggestion: 'Kontrollera om det finns VAT-nummer, roaming-flagga, eller om det är export.',
        },
    ];
}

/**
 * Batch validate multiple transactions
 */
export function validateZeroVATBatch(
    transactions: ZeroVATValidationParams[]
): Map<string, ZeroVATWarning[]> {
    const results = new Map<string, ZeroVATWarning[]>();

    for (const tx of transactions) {
        const warnings = validateZeroVAT(tx);
        if (warnings.length > 0) {
            results.set(tx.transactionId, warnings);
        }
    }

    return results;
}

/**
 * Count warnings by level
 */
export function countWarningsByLevel(warnings: ZeroVATWarning[]): {
    info: number;
    warning: number;
    error: number;
} {
    return {
        info: warnings.filter((w) => w.level === 'info').length,
        warning: warnings.filter((w) => w.level === 'warning').length,
        error: warnings.filter((w) => w.level === 'error').length,
    };
}

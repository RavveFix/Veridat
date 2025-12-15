// Expense Pattern Service for Supabase Edge Functions
// Handles pattern matching and learning for expense categorization

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

// =============================================================================
// INTERFACES
// =============================================================================

export interface ExpensePattern {
    id: string;
    user_id: string;
    company_id: string;
    supplier_name: string;
    supplier_name_normalized: string;
    description_keywords: string[];
    bas_account: string;
    bas_account_name: string;
    vat_rate: number;
    expense_type: 'cost' | 'sale';
    category: string | null;
    usage_count: number;
    total_amount: number;
    avg_amount: number;
    min_amount: number | null;
    max_amount: number | null;
    confirmation_count: number;
    rejection_count: number;
    first_used_at: string;
    last_used_at: string;
    created_at: string;
    updated_at: string;
}

export interface PatternMatch {
    id: string;
    supplier_name: string;
    bas_account: string;
    bas_account_name: string;
    vat_rate: number;
    category: string | null;
    confidence_score: number;
    avg_amount: number;
    usage_count: number;
}

export interface TransactionToMatch {
    id?: string;
    supplier_name: string;
    description?: string;
    amount: number;
}

export interface PatternSuggestion {
    transaction_id: string | null;
    supplier_name: string;
    pattern: PatternMatch;
    anomaly_warning: string | null;
    suggested_message: string;
    auto_apply: boolean;
}

// =============================================================================
// SERVICE CLASS
// =============================================================================

export class ExpensePatternService {
    constructor(private supabase: SupabaseClient) {}

    // =========================================================================
    // FIND PATTERNS
    // =========================================================================

    /**
     * Find matching patterns for a transaction
     * Returns suggestions sorted by confidence score
     */
    async findMatches(
        userId: string,
        companyId: string,
        transaction: TransactionToMatch
    ): Promise<PatternSuggestion[]> {
        try {
            if (!transaction.supplier_name || transaction.supplier_name.trim() === '') {
                return [];
            }

            const { data, error } = await this.supabase.rpc('find_expense_patterns', {
                p_user_id: userId,
                p_company_id: companyId,
                p_supplier_name: transaction.supplier_name,
                p_min_similarity: 0.3
            });

            if (error) {
                console.error('Error finding patterns:', error);
                return [];
            }

            if (!data || data.length === 0) {
                return [];
            }

            // Convert database results to PatternSuggestion objects
            return data.map((match: PatternMatch) => {
                const suggestion: PatternSuggestion = {
                    transaction_id: transaction.id || null,
                    supplier_name: transaction.supplier_name,
                    pattern: match,
                    anomaly_warning: this.detectAnomaly(transaction, match),
                    suggested_message: this.buildSuggestionMessage(transaction, match),
                    auto_apply: match.confidence_score >= 0.8
                };
                return suggestion;
            });
        } catch (error) {
            console.error('Error in findMatches:', error);
            return [];
        }
    }

    /**
     * Find matches for multiple transactions in batch
     * More efficient than calling findMatches for each transaction
     */
    async findMatchesBatch(
        userId: string,
        companyId: string,
        transactions: TransactionToMatch[]
    ): Promise<Map<string, PatternSuggestion[]>> {
        const results = new Map<string, PatternSuggestion[]>();

        // Process in parallel for efficiency
        const promises = transactions.map(async (tx) => {
            const suggestions = await this.findMatches(userId, companyId, tx);
            const key = tx.id || tx.supplier_name;
            results.set(key, suggestions);
        });

        await Promise.all(promises);
        return results;
    }

    // =========================================================================
    // CONFIRM / REJECT PATTERNS
    // =========================================================================

    /**
     * Record user confirmation of a pattern
     * Creates new pattern or updates existing one
     */
    async confirmPattern(
        userId: string,
        companyId: string,
        supplierName: string,
        basAccount: string,
        basAccountName: string,
        vatRate: number,
        expenseType: 'cost' | 'sale' = 'cost',
        amount: number = 0,
        category: string | null = null,
        descriptionKeywords: string[] = [],
        wasSuggestion: boolean = false
    ): Promise<string | null> {
        try {
            const { data, error } = await this.supabase.rpc('upsert_expense_pattern', {
                p_user_id: userId,
                p_company_id: companyId,
                p_supplier_name: supplierName,
                p_bas_account: basAccount,
                p_bas_account_name: basAccountName,
                p_vat_rate: vatRate,
                p_expense_type: expenseType,
                p_amount: amount,
                p_category: category,
                p_description_keywords: descriptionKeywords,
                p_was_suggestion: wasSuggestion
            });

            if (error) {
                console.error('Failed to upsert pattern:', error);
                return null;
            }

            return data;
        } catch (error) {
            console.error('Error in confirmPattern:', error);
            return null;
        }
    }

    /**
     * Record user rejection of a pattern suggestion
     * Increases rejection count to lower future confidence
     */
    async rejectPattern(
        userId: string,
        patternId: string
    ): Promise<boolean> {
        try {
            const { error } = await this.supabase.rpc('reject_expense_pattern', {
                p_pattern_id: patternId,
                p_user_id: userId
            });

            if (error) {
                console.error('Failed to reject pattern:', error);
                return false;
            }

            return true;
        } catch (error) {
            console.error('Error in rejectPattern:', error);
            return false;
        }
    }

    // =========================================================================
    // LIST / DELETE PATTERNS
    // =========================================================================

    /**
     * Get all patterns for a user/company
     * Used for settings/management UI
     */
    async listPatterns(
        userId: string,
        companyId: string,
        limit: number = 50
    ): Promise<ExpensePattern[]> {
        try {
            const { data, error } = await this.supabase
                .from('expense_patterns')
                .select('*')
                .eq('user_id', userId)
                .eq('company_id', companyId)
                .order('last_used_at', { ascending: false })
                .limit(limit);

            if (error) {
                console.error('Error listing patterns:', error);
                return [];
            }

            return data || [];
        } catch (error) {
            console.error('Error in listPatterns:', error);
            return [];
        }
    }

    /**
     * Delete a specific pattern
     */
    async deletePattern(
        userId: string,
        patternId: string
    ): Promise<boolean> {
        try {
            const { error } = await this.supabase
                .from('expense_patterns')
                .delete()
                .eq('id', patternId)
                .eq('user_id', userId);

            if (error) {
                console.error('Error deleting pattern:', error);
                return false;
            }

            return true;
        } catch (error) {
            console.error('Error in deletePattern:', error);
            return false;
        }
    }

    // =========================================================================
    // HELPER METHODS
    // =========================================================================

    /**
     * Detect anomalies in transaction amounts
     * Returns warning message if amount is unusual
     */
    private detectAnomaly(
        transaction: TransactionToMatch,
        pattern: PatternMatch
    ): string | null {
        // Need at least 3 data points for meaningful anomaly detection
        if (pattern.usage_count < 3) {
            return null;
        }

        const currentAmount = Math.abs(transaction.amount);
        const avgAmount = pattern.avg_amount;

        if (avgAmount === 0) {
            return null;
        }

        const ratio = currentAmount / avgAmount;

        if (ratio > 5) {
            return `OBS: Detta belopp (${currentAmount.toFixed(0)} kr) är ${ratio.toFixed(1)}x högre än genomsnittet (${avgAmount.toFixed(0)} kr) för ${pattern.supplier_name}.`;
        }

        if (ratio < 0.2) {
            return `OBS: Detta belopp (${currentAmount.toFixed(0)} kr) är ovanligt lågt jämfört med genomsnittet (${avgAmount.toFixed(0)} kr).`;
        }

        return null;
    }

    /**
     * Build user-friendly suggestion message in Swedish
     */
    private buildSuggestionMessage(
        transaction: TransactionToMatch,
        pattern: PatternMatch
    ): string {
        const confidence = Math.round(pattern.confidence_score * 100);
        return `Förra gången kategoriserades "${pattern.supplier_name}" som ${pattern.bas_account} (${pattern.bas_account_name}). Använd samma? (${confidence}% säkerhet)`;
    }

    /**
     * Extract keywords from a description for matching
     * Filters out Swedish stop words
     */
    static extractKeywords(description: string): string[] {
        if (!description) return [];

        const stopWords = new Set([
            'och', 'i', 'på', 'för', 'av', 'till', 'med', 'den', 'det',
            'en', 'ett', 'är', 'var', 'som', 'har', 'de', 'att', 'om',
            'från', 'kan', 'inte', 'så', 'vi', 'du', 'han', 'hon',
            'this', 'the', 'and', 'for', 'is', 'to', 'of', 'in', 'a'
        ]);

        return description
            .toLowerCase()
            .replace(/[^a-zåäö0-9\s]/g, ' ')  // Include Swedish characters
            .split(/\s+/)
            .filter(word => word.length > 2 && !stopWords.has(word))
            .slice(0, 10);  // Limit to 10 keywords
    }

    /**
     * Normalize supplier name for matching
     */
    static normalizeSupplierName(name: string): string {
        return name
            .toLowerCase()
            .trim()
            .replace(/\s+/g, ' ')  // Collapse multiple spaces
            .replace(/\b(ab|aktiebolag|hb|handelsbolag|kb|kommanditbolag)\b/gi, '')  // Remove company suffixes
            .trim();
    }
}

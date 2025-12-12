-- Enable pg_trgm extension for fuzzy text matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Create expense_patterns table for learning user categorizations
CREATE TABLE IF NOT EXISTS public.expense_patterns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    company_id TEXT NOT NULL,

    -- Pattern identification
    supplier_name TEXT NOT NULL,
    supplier_name_normalized TEXT NOT NULL,  -- Lowercase, trimmed for matching
    description_keywords TEXT[] DEFAULT '{}',  -- Extracted keywords from descriptions

    -- Categorization
    bas_account TEXT NOT NULL,               -- e.g., '6540', '6110'
    bas_account_name TEXT NOT NULL,          -- e.g., 'IT-tjänster', 'Telefon'
    vat_rate INTEGER NOT NULL DEFAULT 25,    -- 25, 12, 6, or 0
    expense_type TEXT NOT NULL DEFAULT 'cost' CHECK (expense_type IN ('cost', 'sale')),
    category TEXT,                           -- Optional: 'subscription', 'utility', etc.

    -- Statistics for confidence scoring
    usage_count INTEGER NOT NULL DEFAULT 1,
    total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    avg_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    min_amount DECIMAL(12,2),
    max_amount DECIMAL(12,2),

    -- User feedback tracking
    confirmation_count INTEGER NOT NULL DEFAULT 0,  -- User accepted suggestion
    rejection_count INTEGER NOT NULL DEFAULT 0,     -- User overrode suggestion

    -- Timestamps
    first_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_expense_patterns_user_company
    ON public.expense_patterns(user_id, company_id);
CREATE INDEX IF NOT EXISTS idx_expense_patterns_supplier_normalized
    ON public.expense_patterns(user_id, company_id, supplier_name_normalized);
CREATE INDEX IF NOT EXISTS idx_expense_patterns_last_used
    ON public.expense_patterns(last_used_at DESC);

-- Trigram index for fuzzy matching
CREATE INDEX IF NOT EXISTS idx_expense_patterns_supplier_trgm
    ON public.expense_patterns USING gin (supplier_name_normalized gin_trgm_ops);

-- Updated_at trigger (reuse existing function)
DROP TRIGGER IF EXISTS update_expense_patterns_updated_at ON public.expense_patterns;
CREATE TRIGGER update_expense_patterns_updated_at
    BEFORE UPDATE ON public.expense_patterns
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- Enable RLS
ALTER TABLE public.expense_patterns ENABLE ROW LEVEL SECURITY;

-- RLS Policies - Drop existing first for idempotency
DROP POLICY IF EXISTS "Users can view own patterns" ON public.expense_patterns;
DROP POLICY IF EXISTS "Users can insert own patterns" ON public.expense_patterns;
DROP POLICY IF EXISTS "Users can update own patterns" ON public.expense_patterns;
DROP POLICY IF EXISTS "Users can delete own patterns" ON public.expense_patterns;

-- Users can see their own patterns
CREATE POLICY "Users can view own patterns"
    ON public.expense_patterns
    FOR SELECT
    USING (auth.uid() = user_id);

-- Users can create their own patterns
CREATE POLICY "Users can insert own patterns"
    ON public.expense_patterns
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Users can update their own patterns
CREATE POLICY "Users can update own patterns"
    ON public.expense_patterns
    FOR UPDATE
    USING (auth.uid() = user_id);

-- Users can delete their own patterns
CREATE POLICY "Users can delete own patterns"
    ON public.expense_patterns
    FOR DELETE
    USING (auth.uid() = user_id);

-- =============================================================================
-- HELPER FUNCTIONS
-- =============================================================================

-- Function to find matching patterns with fuzzy matching
-- Returns top matches sorted by confidence score
CREATE OR REPLACE FUNCTION public.find_expense_patterns(
    p_user_id UUID,
    p_company_id TEXT,
    p_supplier_name TEXT,
    p_min_similarity FLOAT DEFAULT 0.3
)
RETURNS TABLE (
    id UUID,
    supplier_name TEXT,
    bas_account TEXT,
    bas_account_name TEXT,
    vat_rate INTEGER,
    category TEXT,
    confidence_score FLOAT,
    avg_amount DECIMAL,
    usage_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_normalized TEXT;
BEGIN
    v_normalized := lower(trim(p_supplier_name));

    RETURN QUERY
    SELECT
        ep.id,
        ep.supplier_name,
        ep.bas_account,
        ep.bas_account_name,
        ep.vat_rate,
        ep.category,
        -- Confidence score based on similarity and usage
        -- Formula: (similarity * 0.6) + (usage_frequency * 0.3) + (confirm_ratio * 0.1)
        (
            similarity(ep.supplier_name_normalized, v_normalized) * 0.6 +
            LEAST(ep.usage_count::FLOAT / 10.0, 1.0) * 0.3 +
            CASE
                WHEN (ep.confirmation_count + ep.rejection_count) > 0
                THEN (ep.confirmation_count::FLOAT / (ep.confirmation_count + ep.rejection_count)::FLOAT) * 0.1
                ELSE 0.05  -- Neutral if no feedback yet
            END
        )::FLOAT AS confidence_score,
        ep.avg_amount,
        ep.usage_count
    FROM public.expense_patterns ep
    WHERE ep.user_id = p_user_id
      AND ep.company_id = p_company_id
      AND similarity(ep.supplier_name_normalized, v_normalized) >= p_min_similarity
    ORDER BY confidence_score DESC
    LIMIT 5;
END;
$$;

-- Function to upsert a pattern after user confirmation
-- Creates new pattern or updates existing one
CREATE OR REPLACE FUNCTION public.upsert_expense_pattern(
    p_user_id UUID,
    p_company_id TEXT,
    p_supplier_name TEXT,
    p_bas_account TEXT,
    p_bas_account_name TEXT,
    p_vat_rate INTEGER,
    p_expense_type TEXT,
    p_amount DECIMAL,
    p_category TEXT DEFAULT NULL,
    p_description_keywords TEXT[] DEFAULT '{}'::TEXT[],
    p_was_suggestion BOOLEAN DEFAULT FALSE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_pattern_id UUID;
    v_normalized TEXT;
    v_new_usage_count INTEGER;
    v_new_total DECIMAL;
BEGIN
    v_normalized := lower(trim(p_supplier_name));

    -- Try to find existing pattern with same supplier and account
    SELECT id INTO v_pattern_id
    FROM public.expense_patterns
    WHERE user_id = p_user_id
      AND company_id = p_company_id
      AND supplier_name_normalized = v_normalized
      AND bas_account = p_bas_account
    LIMIT 1;

    IF v_pattern_id IS NOT NULL THEN
        -- Update existing pattern
        UPDATE public.expense_patterns
        SET
            usage_count = usage_count + 1,
            total_amount = total_amount + COALESCE(p_amount, 0),
            avg_amount = (total_amount + COALESCE(p_amount, 0)) / (usage_count + 1),
            min_amount = LEAST(COALESCE(min_amount, p_amount), p_amount),
            max_amount = GREATEST(COALESCE(max_amount, p_amount), p_amount),
            confirmation_count = confirmation_count + CASE WHEN p_was_suggestion THEN 1 ELSE 0 END,
            last_used_at = NOW(),
            description_keywords = ARRAY(
                SELECT DISTINCT unnest(description_keywords || p_description_keywords)
            )
        WHERE id = v_pattern_id;
    ELSE
        -- Insert new pattern
        INSERT INTO public.expense_patterns (
            user_id,
            company_id,
            supplier_name,
            supplier_name_normalized,
            bas_account,
            bas_account_name,
            vat_rate,
            expense_type,
            category,
            total_amount,
            avg_amount,
            min_amount,
            max_amount,
            description_keywords,
            confirmation_count
        )
        VALUES (
            p_user_id,
            p_company_id,
            p_supplier_name,
            v_normalized,
            p_bas_account,
            p_bas_account_name,
            p_vat_rate,
            COALESCE(p_expense_type, 'cost'),
            p_category,
            COALESCE(p_amount, 0),
            COALESCE(p_amount, 0),
            p_amount,
            p_amount,
            p_description_keywords,
            CASE WHEN p_was_suggestion THEN 1 ELSE 0 END
        )
        RETURNING id INTO v_pattern_id;
    END IF;

    RETURN v_pattern_id;
END;
$$;

-- Function to record pattern rejection
CREATE OR REPLACE FUNCTION public.reject_expense_pattern(
    p_pattern_id UUID,
    p_user_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.expense_patterns
    SET rejection_count = rejection_count + 1
    WHERE id = p_pattern_id
      AND user_id = p_user_id;
END;
$$;

-- Grant permissions to authenticated users
GRANT EXECUTE ON FUNCTION public.find_expense_patterns(UUID, TEXT, TEXT, FLOAT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_expense_pattern(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, DECIMAL, TEXT, TEXT[], BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_expense_pattern(UUID, UUID) TO authenticated;

-- Comment on table
COMMENT ON TABLE public.expense_patterns IS 'Learned expense categorization patterns for auto-suggesting BAS accounts';
COMMENT ON COLUMN public.expense_patterns.supplier_name_normalized IS 'Lowercase trimmed supplier name for fuzzy matching';
-- Note: confidence_score is calculated in find_expense_patterns() function, not a table column

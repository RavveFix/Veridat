-- Migration: Fix Supabase lint errors in production
-- Date: 2026-02-05
--
-- Fixes:
-- 1. Ensure expense_patterns table exists (required by find_expense_patterns)
-- 2. Fix UUID overload of get_next_verification_id (TEXT/UUID mismatch)

-- Ensure pg_trgm is available for similarity + trigram indexes
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- =============================================================================
-- expense_patterns (table + indexes + RLS)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.expense_patterns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    company_id TEXT NOT NULL,

    -- Pattern identification
    supplier_name TEXT NOT NULL,
    supplier_name_normalized TEXT NOT NULL,
    description_keywords TEXT[] DEFAULT '{}',

    -- Categorization
    bas_account TEXT NOT NULL,
    bas_account_name TEXT NOT NULL,
    vat_rate INTEGER NOT NULL DEFAULT 25,
    expense_type TEXT NOT NULL DEFAULT 'cost' CHECK (expense_type IN ('cost', 'sale')),
    category TEXT,

    -- Statistics for confidence scoring
    usage_count INTEGER NOT NULL DEFAULT 1,
    total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    avg_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    min_amount DECIMAL(12,2),
    max_amount DECIMAL(12,2),

    -- User feedback tracking
    confirmation_count INTEGER NOT NULL DEFAULT 0,
    rejection_count INTEGER NOT NULL DEFAULT 0,

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
-- get_next_verification_id (UUID overload fix)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_next_verification_id(
    p_period TEXT,
    p_company_id UUID DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN public.get_next_verification_id(
        p_period,
        COALESCE(p_company_id::TEXT, 'default')
    );
END;
$$;

ALTER FUNCTION public.get_next_verification_id(TEXT, UUID) SET search_path = public;

-- Migration: Fix Supabase Security Adviser warnings
-- Date: 2026-02-10
--
-- Fixes:
-- 1) function_search_path_mutable on public.validate_skill_approval_update
-- 2) extension_in_public on pg_trgm
-- 3) Ensure find_expense_patterns keeps working after moving pg_trgm

BEGIN;

-- Ensure extensions schema is available and readable by app roles.
CREATE SCHEMA IF NOT EXISTS extensions;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;

-- Lock search_path for trigger function to remove mutable search_path warning.
ALTER FUNCTION public.validate_skill_approval_update() SET search_path = public;

-- Move pg_trgm out of public when needed.
DO $$
DECLARE
    v_schema TEXT;
BEGIN
    SELECT n.nspname
      INTO v_schema
      FROM pg_extension e
      JOIN pg_namespace n ON n.oid = e.extnamespace
     WHERE e.extname = 'pg_trgm';

    IF v_schema IS NULL THEN
        CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
    ELSIF v_schema = 'extensions' THEN
        NULL;
    ELSE
        BEGIN
            EXECUTE 'ALTER EXTENSION pg_trgm SET SCHEMA extensions';
        EXCEPTION
            WHEN OTHERS THEN
                RAISE EXCEPTION 'Unable to move extension pg_trgm from % to extensions: %', v_schema, SQLERRM;
        END;
    END IF;
END $$;

-- Recreate function with schema-qualified trigram calls.
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
    usage_count INTEGER,
    confirmation_count INTEGER,
    rejection_count INTEGER
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
        (
            extensions.similarity(ep.supplier_name_normalized, v_normalized) * 0.6 +
            LEAST(ep.usage_count::FLOAT / 10.0, 1.0) * 0.3 +
            CASE
                WHEN (ep.confirmation_count + ep.rejection_count) > 0
                THEN (ep.confirmation_count::FLOAT / (ep.confirmation_count + ep.rejection_count)::FLOAT) * 0.1
                ELSE 0.05
            END
        )::FLOAT AS confidence_score,
        ep.avg_amount,
        ep.usage_count,
        ep.confirmation_count,
        ep.rejection_count
    FROM public.expense_patterns ep
    WHERE ep.user_id = p_user_id
      AND ep.company_id = p_company_id
      AND extensions.similarity(ep.supplier_name_normalized, v_normalized) >= p_min_similarity
    ORDER BY confidence_score DESC
    LIMIT 5;
END;
$$;

ALTER FUNCTION public.find_expense_patterns(UUID, TEXT, TEXT, FLOAT) SET search_path = public;
GRANT EXECUTE ON FUNCTION public.find_expense_patterns(UUID, TEXT, TEXT, FLOAT) TO authenticated;

COMMIT;

-- Extend expense pattern lookup with confirmation/rejection counts for safer suggestions

DROP FUNCTION IF EXISTS public.find_expense_patterns(UUID, TEXT, TEXT, FLOAT);

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
            similarity(ep.supplier_name_normalized, v_normalized) * 0.6 +
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
      AND similarity(ep.supplier_name_normalized, v_normalized) >= p_min_similarity
    ORDER BY confidence_score DESC
    LIMIT 5;
END;
$$;

GRANT EXECUTE ON FUNCTION public.find_expense_patterns(UUID, TEXT, TEXT, FLOAT) TO authenticated;

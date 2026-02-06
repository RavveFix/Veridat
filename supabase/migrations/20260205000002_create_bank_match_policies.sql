-- Bank match policies for controlled automation (BFL-compliant traceability)

CREATE TABLE IF NOT EXISTS public.bank_match_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    company_id TEXT NOT NULL,
    counterparty_type TEXT NOT NULL CHECK (counterparty_type IN ('supplier', 'customer')),
    counterparty_number TEXT NOT NULL,
    approved_count INTEGER NOT NULL DEFAULT 0,
    auto_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    last_approved_at TIMESTAMPTZ,
    last_approved_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, company_id, counterparty_type, counterparty_number)
);

CREATE INDEX IF NOT EXISTS idx_bank_match_policies_user
    ON public.bank_match_policies (user_id);

CREATE INDEX IF NOT EXISTS idx_bank_match_policies_company
    ON public.bank_match_policies (company_id);

CREATE INDEX IF NOT EXISTS idx_bank_match_policies_counterparty
    ON public.bank_match_policies (counterparty_type, counterparty_number);

-- Maintain updated_at via existing trigger function
DROP TRIGGER IF EXISTS update_bank_match_policies_updated_at ON public.bank_match_policies;
CREATE TRIGGER update_bank_match_policies_updated_at
    BEFORE UPDATE ON public.bank_match_policies
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- Enable RLS
ALTER TABLE public.bank_match_policies ENABLE ROW LEVEL SECURITY;

-- Policies (idempotent)
DROP POLICY IF EXISTS "Users can view own bank match policies" ON public.bank_match_policies;
DROP POLICY IF EXISTS "Users can insert own bank match policies" ON public.bank_match_policies;
DROP POLICY IF EXISTS "Users can update own bank match policies" ON public.bank_match_policies;
DROP POLICY IF EXISTS "Users can delete own bank match policies" ON public.bank_match_policies;

CREATE POLICY "Users can view own bank match policies"
    ON public.bank_match_policies
    FOR SELECT
    USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can insert own bank match policies"
    ON public.bank_match_policies
    FOR INSERT
    WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can update own bank match policies"
    ON public.bank_match_policies
    FOR UPDATE
    USING ((SELECT auth.uid()) = user_id)
    WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can delete own bank match policies"
    ON public.bank_match_policies
    FOR DELETE
    USING ((SELECT auth.uid()) = user_id);

-- Increment approvals counter (used by Edge Functions)
CREATE OR REPLACE FUNCTION public.increment_bank_match_policy(
    p_user_id UUID,
    p_company_id TEXT,
    p_counterparty_type TEXT,
    p_counterparty_number TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.bank_match_policies (
        user_id,
        company_id,
        counterparty_type,
        counterparty_number,
        approved_count,
        last_approved_at,
        last_approved_by
    ) VALUES (
        p_user_id,
        p_company_id,
        p_counterparty_type,
        p_counterparty_number,
        1,
        NOW(),
        p_user_id
    )
    ON CONFLICT (user_id, company_id, counterparty_type, counterparty_number)
    DO UPDATE SET
        approved_count = public.bank_match_policies.approved_count + 1,
        last_approved_at = NOW(),
        last_approved_by = p_user_id,
        updated_at = NOW();
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_bank_match_policy(UUID, TEXT, TEXT, TEXT) TO authenticated;

COMMENT ON TABLE public.bank_match_policies IS 'Bankmatch-policy per motpart (spårbar lärperiod, BFL 7 kap)';

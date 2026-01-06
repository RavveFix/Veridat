-- Companies table (per user) for syncing the company selector across devices.
-- Uses a composite primary key (user_id, id) to avoid global ID collisions.

CREATE TABLE IF NOT EXISTS public.companies (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    org_number TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS idx_companies_user_id
    ON public.companies (user_id);

CREATE INDEX IF NOT EXISTS idx_companies_company_id
    ON public.companies (id);

-- Maintain updated_at via existing trigger function
DROP TRIGGER IF EXISTS update_companies_updated_at ON public.companies;
CREATE TRIGGER update_companies_updated_at
    BEFORE UPDATE ON public.companies
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- Enable RLS
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

-- Policies (idempotent via drop + recreate)
DROP POLICY IF EXISTS "Users can view own companies" ON public.companies;
DROP POLICY IF EXISTS "Users can insert own companies" ON public.companies;
DROP POLICY IF EXISTS "Users can update own companies" ON public.companies;
DROP POLICY IF EXISTS "Users can delete own companies" ON public.companies;

CREATE POLICY "Users can view own companies"
    ON public.companies
    FOR SELECT
    USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can insert own companies"
    ON public.companies
    FOR INSERT
    WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can update own companies"
    ON public.companies
    FOR UPDATE
    USING ((SELECT auth.uid()) = user_id)
    WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can delete own companies"
    ON public.companies
    FOR DELETE
    USING ((SELECT auth.uid()) = user_id);

COMMENT ON TABLE public.companies IS 'Companies owned by users (for company selector + AI context)';

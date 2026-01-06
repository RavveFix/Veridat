-- Company memory per user/company for AI context
-- Stores small structured summaries (e.g. latest VAT report) that can be injected into prompts.

CREATE TABLE IF NOT EXISTS public.company_memory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    company_id TEXT NOT NULL,
    memory JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_company_memory_user_company
    ON public.company_memory (user_id, company_id);

CREATE INDEX IF NOT EXISTS idx_company_memory_company_id
    ON public.company_memory (company_id);

-- Maintain updated_at via existing trigger function
DROP TRIGGER IF EXISTS update_company_memory_updated_at ON public.company_memory;
CREATE TRIGGER update_company_memory_updated_at
    BEFORE UPDATE ON public.company_memory
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- Enable RLS
ALTER TABLE public.company_memory ENABLE ROW LEVEL SECURITY;

-- Policies (idempotent via drop + recreate)
DROP POLICY IF EXISTS "Users can view own company memory" ON public.company_memory;
DROP POLICY IF EXISTS "Users can insert own company memory" ON public.company_memory;
DROP POLICY IF EXISTS "Users can update own company memory" ON public.company_memory;
DROP POLICY IF EXISTS "Users can delete own company memory" ON public.company_memory;

CREATE POLICY "Users can view own company memory"
    ON public.company_memory
    FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own company memory"
    ON public.company_memory
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own company memory"
    ON public.company_memory
    FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own company memory"
    ON public.company_memory
    FOR DELETE
    USING (auth.uid() = user_id);


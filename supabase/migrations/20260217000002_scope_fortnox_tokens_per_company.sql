-- Scope Fortnox OAuth tokens per company (user_id + company_id).
-- This migration intentionally clears legacy tokens to force a safe reconnect.

BEGIN;

ALTER TABLE public.fortnox_tokens
    ADD COLUMN IF NOT EXISTS company_id TEXT;

-- Force explicit reconnect per company to avoid cross-company token leakage.
DELETE FROM public.fortnox_tokens;

ALTER TABLE public.fortnox_tokens
    ALTER COLUMN user_id SET NOT NULL,
    ALTER COLUMN company_id SET NOT NULL;

ALTER TABLE public.fortnox_tokens
    DROP CONSTRAINT IF EXISTS fortnox_tokens_user_id_unique;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fortnox_tokens_user_company_unique'
    ) THEN
        ALTER TABLE public.fortnox_tokens
            ADD CONSTRAINT fortnox_tokens_user_company_unique UNIQUE (user_id, company_id);
    END IF;
END
$$;

ALTER TABLE public.fortnox_tokens
    DROP CONSTRAINT IF EXISTS fortnox_tokens_user_company_fkey;

ALTER TABLE public.fortnox_tokens
    ADD CONSTRAINT fortnox_tokens_user_company_fkey
    FOREIGN KEY (user_id, company_id)
    REFERENCES public.companies (user_id, id)
    ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_fortnox_tokens_user_company
    ON public.fortnox_tokens (user_id, company_id);

CREATE INDEX IF NOT EXISTS idx_fortnox_tokens_expires_at
    ON public.fortnox_tokens (expires_at);

ALTER TABLE public.fortnox_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own tokens" ON public.fortnox_tokens;
DROP POLICY IF EXISTS "Users can update their own tokens" ON public.fortnox_tokens;
DROP POLICY IF EXISTS "Users can insert their own tokens" ON public.fortnox_tokens;
DROP POLICY IF EXISTS "Users can delete their own tokens" ON public.fortnox_tokens;
DROP POLICY IF EXISTS "Deny anon access" ON public.fortnox_tokens;

CREATE POLICY "Users can view their own tokens"
    ON public.fortnox_tokens
    FOR SELECT
    USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can update their own tokens"
    ON public.fortnox_tokens
    FOR UPDATE
    USING ((SELECT auth.uid()) = user_id)
    WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can insert their own tokens"
    ON public.fortnox_tokens
    FOR INSERT
    WITH CHECK (
        (SELECT auth.uid()) = user_id
        AND EXISTS (
            SELECT 1
            FROM public.profiles
            WHERE profiles.id = user_id
              AND profiles.plan IN ('pro', 'trial')
        )
    );

CREATE POLICY "Users can delete their own tokens"
    ON public.fortnox_tokens
    FOR DELETE
    USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Deny anon access"
    ON public.fortnox_tokens
    FOR ALL
    TO anon
    USING (false)
    WITH CHECK (false);

COMMIT;

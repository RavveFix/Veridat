-- Onboarding progress table — persists onboarding state across devices.
-- Replaces the previous localStorage-only approach.

CREATE TABLE IF NOT EXISTS public.onboarding_progress (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    current_step INT NOT NULL DEFAULT 0,
    completed BOOLEAN NOT NULL DEFAULT FALSE,
    company_created BOOLEAN NOT NULL DEFAULT FALSE,
    fortnox_connected BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Maintain updated_at
DROP TRIGGER IF EXISTS update_onboarding_progress_updated_at ON public.onboarding_progress;
CREATE TRIGGER update_onboarding_progress_updated_at
    BEFORE UPDATE ON public.onboarding_progress
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- Enable RLS
ALTER TABLE public.onboarding_progress ENABLE ROW LEVEL SECURITY;

-- Policies: users can only access their own onboarding progress
DROP POLICY IF EXISTS "Users can view own onboarding progress" ON public.onboarding_progress;
DROP POLICY IF EXISTS "Users can insert own onboarding progress" ON public.onboarding_progress;
DROP POLICY IF EXISTS "Users can update own onboarding progress" ON public.onboarding_progress;

CREATE POLICY "Users can view own onboarding progress"
    ON public.onboarding_progress
    FOR SELECT
    USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can insert own onboarding progress"
    ON public.onboarding_progress
    FOR INSERT
    WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can update own onboarding progress"
    ON public.onboarding_progress
    FOR UPDATE
    USING ((SELECT auth.uid()) = user_id)
    WITH CHECK ((SELECT auth.uid()) = user_id);

COMMENT ON TABLE public.onboarding_progress IS 'Tracks user onboarding wizard progress across devices';

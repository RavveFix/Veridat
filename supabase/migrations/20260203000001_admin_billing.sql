-- Admin billing + manual invoice tracking (profiles)
-- Date: 2026-02-03

-- ============================================================
-- 1) Extend profiles with billing/admin fields
-- ============================================================

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS billing_status TEXT,
    ADD COLUMN IF NOT EXISTS period_end TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS grace_until TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS trial_end TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS billing_provider TEXT,
    ADD COLUMN IF NOT EXISTS external_subscription_id TEXT,
    ADD COLUMN IF NOT EXISTS invoice_id TEXT,
    ADD COLUMN IF NOT EXISTS invoice_due_date DATE,
    ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

-- Backfill defaults for existing rows
UPDATE public.profiles
SET billing_status = 'active'
WHERE billing_status IS NULL;

UPDATE public.profiles
SET billing_provider = 'manual'
WHERE billing_provider IS NULL;

UPDATE public.profiles
SET is_admin = false
WHERE is_admin IS NULL;

ALTER TABLE public.profiles
    ALTER COLUMN billing_status SET DEFAULT 'active',
    ALTER COLUMN billing_status SET NOT NULL,
    ALTER COLUMN billing_provider SET DEFAULT 'manual',
    ALTER COLUMN billing_provider SET NOT NULL,
    ALTER COLUMN is_admin SET DEFAULT false;

-- ============================================================
-- 2) Constraints
-- ============================================================

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'profiles_plan_check'
          AND conrelid = 'public.profiles'::regclass
    ) THEN
        ALTER TABLE public.profiles
            DROP CONSTRAINT profiles_plan_check;
    END IF;

    ALTER TABLE public.profiles
        ADD CONSTRAINT profiles_plan_check
        CHECK (plan IN ('free', 'pro', 'trial'));
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'profiles_billing_status_check'
          AND conrelid = 'public.profiles'::regclass
    ) THEN
        ALTER TABLE public.profiles
            ADD CONSTRAINT profiles_billing_status_check
            CHECK (billing_status IN ('active', 'past_due', 'suspended'));
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'profiles_billing_provider_check'
          AND conrelid = 'public.profiles'::regclass
    ) THEN
        ALTER TABLE public.profiles
            ADD CONSTRAINT profiles_billing_provider_check
            CHECK (billing_provider IN ('manual', 'stripe'));
    END IF;
END $$;

-- ============================================================
-- 3) Trigger enforcement (service_role only for plan/billing fields)
-- ============================================================

CREATE OR REPLACE FUNCTION public.enforce_profiles_plan()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF (SELECT auth.role()) = 'service_role' THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        NEW.plan := 'free';
        NEW.billing_status := 'active';
        NEW.billing_provider := 'manual';
        NEW.is_admin := false;
        NEW.period_end := NULL;
        NEW.grace_until := NULL;
        NEW.trial_end := NULL;
        NEW.external_subscription_id := NULL;
        NEW.invoice_id := NULL;
        NEW.invoice_due_date := NULL;
        NEW.paid_at := NULL;
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        NEW.plan := OLD.plan;
        NEW.billing_status := OLD.billing_status;
        NEW.billing_provider := OLD.billing_provider;
        NEW.is_admin := OLD.is_admin;
        NEW.period_end := OLD.period_end;
        NEW.grace_until := OLD.grace_until;
        NEW.trial_end := OLD.trial_end;
        NEW.external_subscription_id := OLD.external_subscription_id;
        NEW.invoice_id := OLD.invoice_id;
        NEW.invoice_due_date := OLD.invoice_due_date;
        NEW.paid_at := OLD.paid_at;
        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$;

ALTER FUNCTION public.enforce_profiles_plan() SET search_path = public;

-- ============================================================
-- 4) Profiles RLS tightening
-- ============================================================

-- Remove public access to profiles
DROP POLICY IF EXISTS "Public profiles are viewable by everyone." ON public.profiles;

-- Ensure only owners can read their profile
DROP POLICY IF EXISTS "Users can view own profiles" ON public.profiles;
CREATE POLICY "Users can view own profiles"
    ON public.profiles
    FOR SELECT
    USING ((SELECT auth.uid()) = id);

-- ============================================================
-- 5) Indexes for admin list filtering
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_profiles_plan ON public.profiles(plan);
CREATE INDEX IF NOT EXISTS idx_profiles_billing_status ON public.profiles(billing_status);

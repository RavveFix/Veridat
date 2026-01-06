-- Migration: Manual Free/Pro plans (per-person) + harden rate limiting storage
-- Date: 2025-12-15
--
-- Goals:
-- 1) Add `profiles.plan` (free|pro) for manual upgrades (no Stripe).
-- 2) Prevent clients from self-upgrading by forcing plan changes to service_role only.
-- 3) Ensure `api_usage` has at most one row per (user_id, endpoint) to avoid rate limiter bypass.

-- ============================================================
-- 1) profiles.plan
-- ============================================================

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS plan TEXT;

UPDATE public.profiles
SET plan = 'free'
WHERE plan IS NULL;

ALTER TABLE public.profiles
    ALTER COLUMN plan SET DEFAULT 'free',
    ALTER COLUMN plan SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'profiles_plan_check'
          AND conrelid = 'public.profiles'::regclass
    ) THEN
        ALTER TABLE public.profiles
            ADD CONSTRAINT profiles_plan_check
            CHECK (plan IN ('free', 'pro'));
    END IF;
END $$;

-- Only service_role may change plan; everyone else is forced to 'free' on insert and cannot change it on update.
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
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        NEW.plan := OLD.plan;
        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_enforce_profiles_plan ON public.profiles;
CREATE TRIGGER tr_enforce_profiles_plan
    BEFORE INSERT OR UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_profiles_plan();


-- ============================================================
-- 2) api_usage uniqueness for (user_id, endpoint)
-- ============================================================

-- Deduplicate existing rows to safely add a uniqueness constraint.
WITH ranked AS (
    SELECT
        id,
        row_number() OVER (
            PARTITION BY user_id, endpoint
            ORDER BY updated_at DESC, created_at DESC, id DESC
        ) AS rn
    FROM public.api_usage
)
DELETE FROM public.api_usage
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'api_usage_user_endpoint_unique'
          AND conrelid = 'public.api_usage'::regclass
    ) THEN
        ALTER TABLE public.api_usage
            ADD CONSTRAINT api_usage_user_endpoint_unique
            UNIQUE (user_id, endpoint);
    END IF;
END $$;


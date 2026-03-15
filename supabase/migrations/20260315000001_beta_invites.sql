-- Migration: Beta invitation code system
-- Date: 2026-03-15
--
-- Goals:
-- 1) Create beta_invites table for shareable invitation codes
-- 2) Add invited_by_code column to profiles
-- 3) Update enforce_profiles_plan trigger to protect invited_by_code + support bypass flag
-- 4) Create redeem_beta_invite RPC function (SECURITY DEFINER)

-- ============================================================
-- 1) beta_invites table
-- ============================================================

CREATE TABLE IF NOT EXISTS public.beta_invites (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  code text UNIQUE NOT NULL,
  label text,
  max_uses int NOT NULL DEFAULT 100,
  current_uses int NOT NULL DEFAULT 0,
  expires_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.beta_invites ENABLE ROW LEVEL SECURITY;

-- No SELECT/INSERT/UPDATE/DELETE policies for authenticated users.
-- All access goes through the SECURITY DEFINER RPC function.
-- Only service_role can read/mutate this table directly.

-- ============================================================
-- 2) profiles.invited_by_code
-- ============================================================

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS invited_by_code text;

-- ============================================================
-- 3) Update enforce_profiles_plan trigger
--    - Add bypass check via transaction-local config app.bypass_plan_trigger
--    - Protect invited_by_code from client modification
-- ============================================================

CREATE OR REPLACE FUNCTION public.enforce_profiles_plan()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Allow service_role full access
    IF (SELECT auth.role()) = 'service_role' THEN
        RETURN NEW;
    END IF;

    -- Allow trusted server-side functions (e.g. redeem_beta_invite) via transaction-local flag
    IF current_setting('app.bypass_plan_trigger', true) = 'true' THEN
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
        NEW.invited_by_code := NULL;
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
        NEW.invited_by_code := OLD.invited_by_code;
        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$;

ALTER FUNCTION public.enforce_profiles_plan() SET search_path = public;

-- ============================================================
-- 4) redeem_beta_invite RPC function
-- ============================================================

CREATE OR REPLACE FUNCTION public.redeem_beta_invite(invite_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_invite_id uuid;
  v_current_uses int;
  v_max_uses int;
  v_expires_at timestamptz;
  v_existing_code text;
BEGIN
  -- 1. Get authenticated user
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Ej inloggad');
  END IF;

  -- 2. Check if user already redeemed a code
  SELECT invited_by_code INTO v_existing_code
  FROM profiles WHERE id = v_user_id;

  IF v_existing_code IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Du har redan använt en inbjudningskod');
  END IF;

  -- 3. Find and validate invite (case-insensitive via UPPER)
  -- FOR UPDATE: row-level lock prevents race condition on current_uses
  SELECT id, current_uses, max_uses, expires_at
  INTO v_invite_id, v_current_uses, v_max_uses, v_expires_at
  FROM beta_invites
  WHERE code = UPPER(invite_code)
  FOR UPDATE;

  IF v_invite_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Ogiltig inbjudningskod');
  END IF;

  IF v_current_uses >= v_max_uses THEN
    RETURN jsonb_build_object('success', false, 'error', 'Inbjudningskoden har nått max antal användningar');
  END IF;

  IF v_expires_at IS NOT NULL AND v_expires_at < now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Inbjudningskoden har gått ut');
  END IF;

  -- 4. Set transaction-local bypass flag so enforce_profiles_plan trigger allows the change
  PERFORM set_config('app.bypass_plan_trigger', 'true', true);

  -- 5. Upgrade profile + increment usage atomically
  UPDATE profiles
  SET plan = 'pro', invited_by_code = UPPER(invite_code)
  WHERE id = v_user_id;

  UPDATE beta_invites
  SET current_uses = current_uses + 1
  WHERE id = v_invite_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.redeem_beta_invite(text) TO authenticated;

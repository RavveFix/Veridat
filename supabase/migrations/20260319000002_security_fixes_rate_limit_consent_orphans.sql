-- Migration: Security fixes for beta pipeline audit
-- Date: 2026-03-19
--
-- Fixes:
-- 1) Rate limiting on invite code brute-force attempts
-- 2) Server-side consent validation (pending_consents table)
-- 3) Profile trigger error handling + orphan recovery

-- ============================================================
-- FIX 1: Rate limiting on invite code validation
-- ============================================================

-- Table to track invite code attempts per user
-- NOTE: We do NOT store the submitted code (PII/security risk).
-- Only the attempt timestamp and success flag are needed for rate limiting.
CREATE TABLE IF NOT EXISTS public.invite_code_attempts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  success boolean NOT NULL DEFAULT false
);

ALTER TABLE public.invite_code_attempts ENABLE ROW LEVEL SECURITY;

-- No direct access for authenticated users; only via SECURITY DEFINER RPC
-- Service role can read for monitoring/auditing
CREATE POLICY "Service role full access on invite_code_attempts"
  ON public.invite_code_attempts FOR ALL
  USING ((SELECT auth.role()) = 'service_role');

-- Index for efficient lookups by user + time window
CREATE INDEX IF NOT EXISTS idx_invite_code_attempts_user_time
  ON public.invite_code_attempts (user_id, attempted_at DESC);

-- Auto-cleanup: delete attempt records older than 24 hours (keep table small)
-- This can be called by a cron job or pg_cron
CREATE OR REPLACE FUNCTION public.cleanup_old_invite_attempts()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM invite_code_attempts WHERE attempted_at < now() - interval '24 hours';
$$;

-- Replace redeem_beta_invite with rate-limited version
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
  v_recent_attempts int;
  v_max_attempts_per_window constant int := 5;
  v_window_minutes constant int := 15;
BEGIN
  -- 1. Get authenticated user
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Ej inloggad');
  END IF;

  -- 2. Rate limit check: max 5 attempts per 15-minute window
  SELECT count(*) INTO v_recent_attempts
  FROM invite_code_attempts
  WHERE user_id = v_user_id
    AND attempted_at > now() - (v_window_minutes || ' minutes')::interval;

  IF v_recent_attempts >= v_max_attempts_per_window THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'För många försök. Vänta en stund innan du försöker igen.'
    );
  END IF;

  -- 3. Log this attempt (before validation, to count all attempts)
  -- We never store the submitted code — only the attempt event for rate limiting
  INSERT INTO invite_code_attempts (user_id, success)
  VALUES (v_user_id, false);

  -- 4. Check if user already redeemed a code
  SELECT invited_by_code INTO v_existing_code
  FROM profiles WHERE id = v_user_id;

  IF v_existing_code IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Du har redan använt en inbjudningskod');
  END IF;

  -- 5. Find and validate invite (case-insensitive via UPPER)
  -- FOR UPDATE: row-level lock prevents race condition on current_uses
  SELECT id, current_uses, max_uses, expires_at
  INTO v_invite_id, v_current_uses, v_max_uses, v_expires_at
  FROM beta_invites
  WHERE code = UPPER(invite_code)
  FOR UPDATE;

  -- Return a single generic error for all invalid states to prevent
  -- attackers from enumerating valid codes via different error messages
  IF v_invite_id IS NULL
     OR v_current_uses >= v_max_uses
     OR (v_expires_at IS NOT NULL AND v_expires_at < now()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Ogiltig eller utgången inbjudningskod');
  END IF;

  -- 6. Set transaction-local bypass flag so enforce_profiles_plan trigger allows the change
  PERFORM set_config('app.bypass_plan_trigger', 'true', true);

  -- 7. Upgrade profile + increment usage atomically
  UPDATE profiles
  SET plan = 'pro', invited_by_code = UPPER(invite_code)
  WHERE id = v_user_id;

  UPDATE beta_invites
  SET current_uses = current_uses + 1
  WHERE id = v_invite_id;

  -- 8. Mark the last attempt as successful
  UPDATE invite_code_attempts
  SET success = true
  WHERE user_id = v_user_id
    AND attempted_at = (
      SELECT max(attempted_at) FROM invite_code_attempts WHERE user_id = v_user_id
    );

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ============================================================
-- FIX 2: Server-side consent validation
-- ============================================================

-- Table to store consent intent tokens created during login
-- These are created server-side BEFORE the magic link is sent,
-- and verified in the callback instead of trusting a URL parameter.
-- NOTE: We store a SHA-256 hash of the email (not plaintext) to avoid PII storage.
CREATE TABLE IF NOT EXISTS public.pending_consents (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  email_hash text NOT NULL,
  consent_token text NOT NULL UNIQUE,
  terms_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  used boolean NOT NULL DEFAULT false,
  used_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '1 hour')
);

ALTER TABLE public.pending_consents ENABLE ROW LEVEL SECURITY;

-- No direct access; only via server-side functions
CREATE POLICY "Service role full access on pending_consents"
  ON public.pending_consents FOR ALL
  USING ((SELECT auth.role()) = 'service_role');

-- Index for token lookups
CREATE INDEX IF NOT EXISTS idx_pending_consents_token
  ON public.pending_consents (consent_token) WHERE NOT used;

-- Index for cleanup of expired records
CREATE INDEX IF NOT EXISTS idx_pending_consents_expires
  ON public.pending_consents (expires_at) WHERE NOT used;

-- RPC: Validate and consume a consent token (called from callback route)
-- Returns true if valid, false if invalid/expired/already-used
-- p_email_hash: SHA-256 hex digest of LOWER(email), computed by the caller
CREATE OR REPLACE FUNCTION public.validate_consent_token(
  p_consent_token text,
  p_email_hash text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_consent_id uuid;
BEGIN
  -- Find a matching, unused, non-expired token for this email hash
  SELECT id INTO v_consent_id
  FROM pending_consents
  WHERE consent_token = p_consent_token
    AND email_hash = p_email_hash
    AND NOT used
    AND expires_at > now()
  FOR UPDATE;

  IF v_consent_id IS NULL THEN
    RETURN false;
  END IF;

  -- Mark as used
  UPDATE pending_consents
  SET used = true, used_at = now()
  WHERE id = v_consent_id;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_consent_token(text, text) TO authenticated;

-- Cleanup function for expired/used consent tokens
CREATE OR REPLACE FUNCTION public.cleanup_pending_consents()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM pending_consents
  WHERE used = true OR expires_at < now();
$$;

-- ============================================================
-- FIX 3: Profile trigger error handling + orphan recovery
-- ============================================================

-- Replace handle_new_user with error-resilient version
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_retry_count int := 0;
  v_max_retries constant int := 2;
BEGIN
  LOOP
    BEGIN
      INSERT INTO public.profiles (id, full_name, avatar_url)
      VALUES (
        NEW.id,
        NEW.raw_user_meta_data->>'full_name',
        NEW.raw_user_meta_data->>'avatar_url'
      );
      -- Success — exit loop
      RETURN NEW;
    EXCEPTION
      WHEN unique_violation THEN
        -- Profile already exists (e.g., race condition or re-trigger) — not an error
        RETURN NEW;
      WHEN OTHERS THEN
        v_retry_count := v_retry_count + 1;
        IF v_retry_count >= v_max_retries THEN
          -- Log to orphaned_auth_users for recovery, but do NOT block auth signup
          -- Do NOT store raw_user_meta_data (contains PII like full_name)
          BEGIN
            INSERT INTO public.orphaned_auth_users (auth_user_id, error_message)
            VALUES (
              NEW.id,
              SQLERRM
            );
          EXCEPTION WHEN OTHERS THEN
            -- If even logging fails, still don't block signup
            NULL;
          END;
          -- Return NEW so the auth.users insert succeeds (don't orphan silently)
          RETURN NEW;
        END IF;
        -- Brief pause before retry (PostgreSQL advisory wait)
        PERFORM pg_sleep(0.1);
    END;
  END LOOP;
END;
$$;

-- Table to track orphaned auth users (profile creation failed)
-- NOTE: No PII stored here — only auth_user_id and generic error message.
-- The recovery function reads metadata from auth.users at recovery time.
CREATE TABLE IF NOT EXISTS public.orphaned_auth_users (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  auth_user_id uuid NOT NULL UNIQUE,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved boolean NOT NULL DEFAULT false,
  resolved_at timestamptz
);

ALTER TABLE public.orphaned_auth_users ENABLE ROW LEVEL SECURITY;

-- Only service_role can access this table
CREATE POLICY "Service role full access on orphaned_auth_users"
  ON public.orphaned_auth_users FOR ALL
  USING ((SELECT auth.role()) = 'service_role');

-- Recovery function: attempts to create profiles for all orphaned users
-- Can be called manually or via a cron job
CREATE OR REPLACE FUNCTION public.recover_orphaned_profiles()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_orphan record;
  v_recovered int := 0;
  v_failed int := 0;
  v_already_ok int := 0;
BEGIN
  FOR v_orphan IN
    SELECT o.id AS orphan_id, o.auth_user_id, u.raw_user_meta_data
    FROM orphaned_auth_users o
    JOIN auth.users u ON u.id = o.auth_user_id
    WHERE o.resolved = false
  LOOP
    -- Check if profile already exists (may have been created by another path)
    IF EXISTS (SELECT 1 FROM profiles WHERE id = v_orphan.auth_user_id) THEN
      UPDATE orphaned_auth_users SET resolved = true, resolved_at = now()
      WHERE id = v_orphan.orphan_id;
      v_already_ok := v_already_ok + 1;
      CONTINUE;
    END IF;

    -- Attempt to create the missing profile using ON CONFLICT to handle
    -- race conditions where another process creates the profile concurrently
    BEGIN
      INSERT INTO public.profiles (id, full_name, avatar_url)
      VALUES (
        v_orphan.auth_user_id,
        v_orphan.raw_user_meta_data->>'full_name',
        v_orphan.raw_user_meta_data->>'avatar_url'
      )
      ON CONFLICT (id) DO NOTHING;

      UPDATE orphaned_auth_users SET resolved = true, resolved_at = now()
      WHERE id = v_orphan.orphan_id;
      v_recovered := v_recovered + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'recovered', v_recovered,
    'already_ok', v_already_ok,
    'failed', v_failed
  );
END;
$$;

-- Migration: Harden profiles RLS (remove public read of PII)
-- Date: 2025-12-12
-- Rationale: profiles now store full_name and consent data, so SELECT should be owner-only.

-- Drop the old public read policy (from initial setup)
DROP POLICY IF EXISTS "Public profiles are viewable by everyone." ON public.profiles;

-- Ensure owner-only SELECT
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile"
  ON public.profiles
  FOR SELECT
  USING ((SELECT auth.uid()) = id);

-- Keep existing INSERT/UPDATE owner policies (optimized in 20251201120000_optimize_rls_policies.sql)

-- Explicitly allow service role to manage profiles (safe + clear)
DROP POLICY IF EXISTS "Service role can manage profiles" ON public.profiles;
CREATE POLICY "Service role can manage profiles"
  ON public.profiles
  FOR ALL
  USING ((SELECT auth.role()) = 'service_role');

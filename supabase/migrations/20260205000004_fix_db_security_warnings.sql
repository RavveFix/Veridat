-- Migration: Fix remaining Supabase security warnings
-- Date: 2026-02-05
--
-- Fixes:
-- 1. Lock search_path for external functions (SECURITY)
-- 2. Move vector extension out of public schema (SECURITY)

CREATE SCHEMA IF NOT EXISTS extensions;

-- Move vector extension out of public if present
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    EXECUTE 'ALTER EXTENSION vector SET SCHEMA extensions';
  END IF;
END $$;

-- Allow app roles to access extensions schema
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;

-- Lock search_path to public to avoid role-mutable search_path issues
ALTER FUNCTION public.find_expense_patterns(UUID, TEXT, TEXT, FLOAT) SET search_path = public;
ALTER FUNCTION public.get_audit_trail(TEXT, TEXT) SET search_path = public;
ALTER FUNCTION public.record_ai_decision_override(UUID, UUID, TEXT) SET search_path = public;
ALTER FUNCTION public.get_next_verification_id(TEXT, TEXT) SET search_path = public;
ALTER FUNCTION public.get_next_verification_id(TEXT, UUID) SET search_path = public;

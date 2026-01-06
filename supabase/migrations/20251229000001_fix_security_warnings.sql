-- Migration: Fix Supabase Security and Performance Warnings
-- Date: 2025-12-29
--
-- Fixes:
-- 1. Enable RLS on terms_versions (ERROR)
-- 2. Set search_path on 9 functions (SECURITY)
-- 3. Optimize RLS policies with (select auth.uid()) (PERFORMANCE)
-- 4. Add missing indexes on foreign keys (PERFORMANCE)

-- ============================================================
-- 1. Enable RLS on terms_versions
-- ============================================================
ALTER TABLE public.terms_versions ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read terms versions (public info)
CREATE POLICY "Anyone can read terms versions"
ON public.terms_versions FOR SELECT
USING (true);

-- Only service_role can modify terms
CREATE POLICY "Service role can manage terms versions"
ON public.terms_versions FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- ============================================================
-- 2. Fix function search_path (prevents SQL injection)
-- ============================================================
ALTER FUNCTION public.update_conversation_search_vector() SET search_path = public;
ALTER FUNCTION public.update_conversation_stats_from_message() SET search_path = public;
ALTER FUNCTION public.handle_new_user() SET search_path = public;
ALTER FUNCTION public.enforce_profiles_plan() SET search_path = public;
ALTER FUNCTION public.update_updated_at_column() SET search_path = public;
ALTER FUNCTION public.update_message_search_vector() SET search_path = public;
ALTER FUNCTION public.cleanup_old_api_usage() SET search_path = public;
ALTER FUNCTION public.update_conversation_timestamp() SET search_path = public;
ALTER FUNCTION public.get_or_create_conversation(uuid, text) SET search_path = public;

-- ============================================================
-- 3. Optimize RLS policies (use subquery to avoid per-row evaluation)
-- ============================================================

-- company_memory policies
DROP POLICY IF EXISTS "Users can view own company memory" ON public.company_memory;
DROP POLICY IF EXISTS "Users can insert own company memory" ON public.company_memory;
DROP POLICY IF EXISTS "Users can update own company memory" ON public.company_memory;
DROP POLICY IF EXISTS "Users can delete own company memory" ON public.company_memory;

CREATE POLICY "Users can view own company memory"
ON public.company_memory FOR SELECT
USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can insert own company memory"
ON public.company_memory FOR INSERT
WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can update own company memory"
ON public.company_memory FOR UPDATE
USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can delete own company memory"
ON public.company_memory FOR DELETE
USING ((select auth.uid()) = user_id);

-- user_memories policies
DROP POLICY IF EXISTS "Users can view own user memories" ON public.user_memories;
DROP POLICY IF EXISTS "Users can insert own user memories" ON public.user_memories;
DROP POLICY IF EXISTS "Users can update own user memories" ON public.user_memories;
DROP POLICY IF EXISTS "Users can delete own user memories" ON public.user_memories;

CREATE POLICY "Users can view own user memories"
ON public.user_memories FOR SELECT
USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can insert own user memories"
ON public.user_memories FOR INSERT
WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can update own user memories"
ON public.user_memories FOR UPDATE
USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can delete own user memories"
ON public.user_memories FOR DELETE
USING ((select auth.uid()) = user_id);

-- memory_user_edits policies
DROP POLICY IF EXISTS "Users can view own memory edits" ON public.memory_user_edits;
DROP POLICY IF EXISTS "Users can insert own memory edits" ON public.memory_user_edits;
DROP POLICY IF EXISTS "Users can delete own memory edits" ON public.memory_user_edits;

CREATE POLICY "Users can view own memory edits"
ON public.memory_user_edits FOR SELECT
USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can insert own memory edits"
ON public.memory_user_edits FOR INSERT
WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can delete own memory edits"
ON public.memory_user_edits FOR DELETE
USING ((select auth.uid()) = user_id);

-- ============================================================
-- 4. Add missing indexes on foreign keys
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_fortnox_tokens_user_id
ON public.fortnox_tokens(user_id);

CREATE INDEX IF NOT EXISTS idx_user_memories_source_conversation_id
ON public.user_memories(source_conversation_id);

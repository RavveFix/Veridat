-- Migration: Fix Supabase linter warnings (RLS initplan + multiple permissive policies + missing FK indexes)
-- Date: 2026-02-03

BEGIN;

-- ============================================================
-- 1) terms_versions (auth_rls_initplan + multiple_permissive_policies)
-- ============================================================

DROP POLICY IF EXISTS "Public read access to terms versions" ON public.terms_versions;
DROP POLICY IF EXISTS "Anyone can read terms versions" ON public.terms_versions;
DROP POLICY IF EXISTS "Service role can manage terms versions" ON public.terms_versions;
DROP POLICY IF EXISTS "Service role insert terms" ON public.terms_versions;
DROP POLICY IF EXISTS "Service role update terms" ON public.terms_versions;
DROP POLICY IF EXISTS "Service role delete terms" ON public.terms_versions;

CREATE POLICY "Public read access to terms versions"
    ON public.terms_versions
    FOR SELECT
    TO anon, authenticated
    USING (true);

CREATE POLICY "Service role can manage terms versions"
    ON public.terms_versions
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================================
-- 2) profiles (multiple_permissive_policies)
-- ============================================================

DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profiles" ON public.profiles;

CREATE POLICY "Users can view own profile"
    ON public.profiles
    FOR SELECT
    TO authenticated
    USING ((SELECT auth.uid()) = id);

-- ============================================================
-- 3) audit_logs (auth_rls_initplan)
-- ============================================================

DROP POLICY IF EXISTS "Users can view own audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Service role can insert audit logs" ON public.audit_logs;

CREATE POLICY "Users can view own audit logs"
    ON public.audit_logs
    FOR SELECT
    TO authenticated
    USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Service role can insert audit logs"
    ON public.audit_logs
    FOR INSERT
    TO service_role
    WITH CHECK (true);

-- ============================================================
-- 4) ai_decisions (auth_rls_initplan)
-- ============================================================

DROP POLICY IF EXISTS "Users can view own AI decisions" ON public.ai_decisions;
DROP POLICY IF EXISTS "Service role can insert AI decisions" ON public.ai_decisions;
DROP POLICY IF EXISTS "Service role can update AI decisions for override" ON public.ai_decisions;

CREATE POLICY "Users can view own AI decisions"
    ON public.ai_decisions
    FOR SELECT
    TO authenticated
    USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Service role can insert AI decisions"
    ON public.ai_decisions
    FOR INSERT
    TO service_role
    WITH CHECK (true);

CREATE POLICY "Service role can update AI decisions for override"
    ON public.ai_decisions
    FOR UPDATE
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================================
-- 5) fortnox_sync_log (auth_rls_initplan + multiple_permissive_policies)
-- ============================================================

DROP POLICY IF EXISTS "Users can view own Fortnox sync logs" ON public.fortnox_sync_log;
DROP POLICY IF EXISTS "Service role can manage Fortnox sync logs" ON public.fortnox_sync_log;

CREATE POLICY "Users can view own Fortnox sync logs"
    ON public.fortnox_sync_log
    FOR SELECT
    TO authenticated
    USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Service role can manage Fortnox sync logs"
    ON public.fortnox_sync_log
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================================
-- 6) journal_entries (auth_rls_initplan + multiple_permissive_policies)
-- ============================================================

DROP POLICY IF EXISTS "Users can view own journal entries" ON public.journal_entries;
DROP POLICY IF EXISTS "Users can create own journal entries" ON public.journal_entries;
DROP POLICY IF EXISTS "Anonymous users can view own journal entries" ON public.journal_entries;
DROP POLICY IF EXISTS "Anonymous users can create journal entries" ON public.journal_entries;

CREATE POLICY "Users can view own journal entries"
    ON public.journal_entries
    FOR SELECT
    TO authenticated
    USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can create own journal entries"
    ON public.journal_entries
    FOR INSERT
    TO authenticated
    WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Anonymous users can view own journal entries"
    ON public.journal_entries
    FOR SELECT
    TO anon
    USING (user_id::text = 'anonymous');

CREATE POLICY "Anonymous users can create journal entries"
    ON public.journal_entries
    FOR INSERT
    TO anon
    WITH CHECK (user_id::text = 'anonymous');

-- ============================================================
-- 7) accounting_memories (auth_rls_initplan)
-- ============================================================

DROP POLICY IF EXISTS "Users can view own accounting memories" ON public.accounting_memories;
DROP POLICY IF EXISTS "Users can insert own accounting memories" ON public.accounting_memories;
DROP POLICY IF EXISTS "Users can update own accounting memories" ON public.accounting_memories;
DROP POLICY IF EXISTS "Users can delete own accounting memories" ON public.accounting_memories;

CREATE POLICY "Users can view own accounting memories"
    ON public.accounting_memories
    FOR SELECT
    TO authenticated
    USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can insert own accounting memories"
    ON public.accounting_memories
    FOR INSERT
    TO authenticated
    WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can update own accounting memories"
    ON public.accounting_memories
    FOR UPDATE
    TO authenticated
    USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can delete own accounting memories"
    ON public.accounting_memories
    FOR DELETE
    TO authenticated
    USING ((SELECT auth.uid()) = user_id);

-- ============================================================
-- 8) Missing FK indexes (unindexed_foreign_keys)
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_ai_decisions_override_by
    ON public.ai_decisions(override_by);

CREATE INDEX IF NOT EXISTS idx_fortnox_sync_log_ai_decision_id
    ON public.fortnox_sync_log(ai_decision_id);

COMMIT;

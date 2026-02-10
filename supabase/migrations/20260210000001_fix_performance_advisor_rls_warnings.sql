-- Migration: Fix remaining Supabase performance advisor RLS warnings
-- Date: 2026-02-10
--
-- Fixes:
-- 1) auth_rls_initplan warnings on skills/memory/pattern/token/legal policies
-- 2) multiple_permissive_policies warnings on legal_acceptances

BEGIN;

-- ============================================================================
-- skills
-- ============================================================================

DROP POLICY IF EXISTS "Users can view own skills" ON public.skills;
DROP POLICY IF EXISTS "Users can insert own skills" ON public.skills;
DROP POLICY IF EXISTS "Users can update own skills" ON public.skills;
DROP POLICY IF EXISTS "Users can delete own skills" ON public.skills;

CREATE POLICY "Users can view own skills"
    ON public.skills
    FOR SELECT
    USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can insert own skills"
    ON public.skills
    FOR INSERT
    WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can update own skills"
    ON public.skills
    FOR UPDATE
    USING ((SELECT auth.uid()) = user_id)
    WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can delete own skills"
    ON public.skills
    FOR DELETE
    USING ((SELECT auth.uid()) = user_id);

-- ============================================================================
-- skill_runs
-- ============================================================================

DROP POLICY IF EXISTS "Users can view own skill runs" ON public.skill_runs;
DROP POLICY IF EXISTS "Users can insert own skill runs" ON public.skill_runs;
DROP POLICY IF EXISTS "Users can update own skill runs" ON public.skill_runs;
DROP POLICY IF EXISTS "Users can delete own skill runs" ON public.skill_runs;

CREATE POLICY "Users can view own skill runs"
    ON public.skill_runs
    FOR SELECT
    USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can insert own skill runs"
    ON public.skill_runs
    FOR INSERT
    WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can update own skill runs"
    ON public.skill_runs
    FOR UPDATE
    USING ((SELECT auth.uid()) = user_id)
    WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can delete own skill runs"
    ON public.skill_runs
    FOR DELETE
    USING ((SELECT auth.uid()) = user_id);

-- ============================================================================
-- skill_approvals
-- ============================================================================

DROP POLICY IF EXISTS "Users can view own skill approvals" ON public.skill_approvals;
DROP POLICY IF EXISTS "Users can insert own skill approvals" ON public.skill_approvals;
DROP POLICY IF EXISTS "Users can update own skill approvals" ON public.skill_approvals;
DROP POLICY IF EXISTS "Users can delete own skill approvals" ON public.skill_approvals;

CREATE POLICY "Users can view own skill approvals"
    ON public.skill_approvals
    FOR SELECT
    USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can insert own skill approvals"
    ON public.skill_approvals
    FOR INSERT
    WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can update own skill approvals"
    ON public.skill_approvals
    FOR UPDATE
    USING ((SELECT auth.uid()) = user_id)
    WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can delete own skill approvals"
    ON public.skill_approvals
    FOR DELETE
    USING ((SELECT auth.uid()) = user_id);

-- ============================================================================
-- memory_items
-- ============================================================================

DROP POLICY IF EXISTS "Users can view own memory items" ON public.memory_items;
DROP POLICY IF EXISTS "Users can insert own memory items" ON public.memory_items;
DROP POLICY IF EXISTS "Users can update own memory items" ON public.memory_items;
DROP POLICY IF EXISTS "Users can delete own memory items" ON public.memory_items;

CREATE POLICY "Users can view own memory items"
    ON public.memory_items
    FOR SELECT
    USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can insert own memory items"
    ON public.memory_items
    FOR INSERT
    WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can update own memory items"
    ON public.memory_items
    FOR UPDATE
    USING ((SELECT auth.uid()) = user_id)
    WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can delete own memory items"
    ON public.memory_items
    FOR DELETE
    USING ((SELECT auth.uid()) = user_id);

-- ============================================================================
-- memory_usage
-- ============================================================================

DROP POLICY IF EXISTS "Users can view own memory usage" ON public.memory_usage;
DROP POLICY IF EXISTS "Users can insert own memory usage" ON public.memory_usage;
DROP POLICY IF EXISTS "Users can delete own memory usage" ON public.memory_usage;

CREATE POLICY "Users can view own memory usage"
    ON public.memory_usage
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1
            FROM public.memory_items mi
            WHERE mi.id = memory_usage.memory_id
              AND mi.user_id = (SELECT auth.uid())
        )
    );

CREATE POLICY "Users can insert own memory usage"
    ON public.memory_usage
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM public.memory_items mi
            WHERE mi.id = memory_usage.memory_id
              AND mi.user_id = (SELECT auth.uid())
        )
    );

CREATE POLICY "Users can delete own memory usage"
    ON public.memory_usage
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1
            FROM public.memory_items mi
            WHERE mi.id = memory_usage.memory_id
              AND mi.user_id = (SELECT auth.uid())
        )
    );

-- ============================================================================
-- expense_patterns
-- ============================================================================

DROP POLICY IF EXISTS "Users can view own patterns" ON public.expense_patterns;
DROP POLICY IF EXISTS "Users can insert own patterns" ON public.expense_patterns;
DROP POLICY IF EXISTS "Users can update own patterns" ON public.expense_patterns;
DROP POLICY IF EXISTS "Users can delete own patterns" ON public.expense_patterns;

CREATE POLICY "Users can view own patterns"
    ON public.expense_patterns
    FOR SELECT
    USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can insert own patterns"
    ON public.expense_patterns
    FOR INSERT
    WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can update own patterns"
    ON public.expense_patterns
    FOR UPDATE
    USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can delete own patterns"
    ON public.expense_patterns
    FOR DELETE
    USING ((SELECT auth.uid()) = user_id);

-- ============================================================================
-- fortnox_tokens
-- ============================================================================

DROP POLICY IF EXISTS "Users can insert their own tokens" ON public.fortnox_tokens;
DROP POLICY IF EXISTS "Users can delete their own tokens" ON public.fortnox_tokens;

CREATE POLICY "Users can insert their own tokens"
    ON public.fortnox_tokens
    FOR INSERT
    WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can delete their own tokens"
    ON public.fortnox_tokens
    FOR DELETE
    USING ((SELECT auth.uid()) = user_id);

-- ============================================================================
-- legal_acceptances
-- ============================================================================

DROP POLICY IF EXISTS "Users can view own legal acceptances" ON public.legal_acceptances;
DROP POLICY IF EXISTS "Users can insert own legal acceptances" ON public.legal_acceptances;
DROP POLICY IF EXISTS "Service role can manage legal acceptances" ON public.legal_acceptances;

CREATE POLICY "Users can view own legal acceptances"
    ON public.legal_acceptances
    FOR SELECT
    USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can insert own legal acceptances"
    ON public.legal_acceptances
    FOR INSERT
    WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Service role can manage legal acceptances"
    ON public.legal_acceptances
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

COMMIT;

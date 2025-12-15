-- Migration: Fix Supabase DB linter warnings (RLS initplan + multiple permissive policies)
-- Date: 2025-12-15
-- Notes:
-- - Wrap auth.<function>() calls in subselects to avoid per-row re-evaluation.
-- - Remove duplicate permissive policies on messages.
-- - Scope service-role policies to only apply to service_role.

-- ============================================================
-- 1) conversations (auth_rls_initplan)
-- ============================================================

DROP POLICY IF EXISTS "Users can view own conversations" ON public.conversations;
CREATE POLICY "Users can view own conversations"
    ON public.conversations
    FOR SELECT
    USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can create own conversations" ON public.conversations;
CREATE POLICY "Users can create own conversations"
    ON public.conversations
    FOR INSERT
    WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update own conversations" ON public.conversations;
CREATE POLICY "Users can update own conversations"
    ON public.conversations
    FOR UPDATE
    USING ((SELECT auth.uid()) = user_id)
    WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can delete own conversations" ON public.conversations;
CREATE POLICY "Users can delete own conversations"
    ON public.conversations
    FOR DELETE
    USING ((SELECT auth.uid()) = user_id);


-- ============================================================
-- 2) messages (auth_rls_initplan + multiple_permissive_policies)
-- ============================================================

-- Drop both naming variants to avoid duplicate permissive policies.
DROP POLICY IF EXISTS "Users can view messages in own conversations" ON public.messages;
DROP POLICY IF EXISTS "Users can insert messages in own conversations" ON public.messages;
DROP POLICY IF EXISTS "Users can update messages in own conversations" ON public.messages;
DROP POLICY IF EXISTS "Users can delete messages in own conversations" ON public.messages;

DROP POLICY IF EXISTS "Users can view messages in their conversations" ON public.messages;
DROP POLICY IF EXISTS "Users can insert messages in their conversations" ON public.messages;
DROP POLICY IF EXISTS "Users can update messages in their conversations" ON public.messages;
DROP POLICY IF EXISTS "Users can delete messages in their conversations" ON public.messages;

CREATE POLICY "Users can view messages in own conversations"
    ON public.messages
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1
            FROM public.conversations c
            WHERE c.id = messages.conversation_id
              AND c.user_id = (SELECT auth.uid())
        )
    );

CREATE POLICY "Users can insert messages in own conversations"
    ON public.messages
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM public.conversations c
            WHERE c.id = messages.conversation_id
              AND c.user_id = (SELECT auth.uid())
        )
    );

CREATE POLICY "Users can update messages in own conversations"
    ON public.messages
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1
            FROM public.conversations c
            WHERE c.id = messages.conversation_id
              AND c.user_id = (SELECT auth.uid())
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM public.conversations c
            WHERE c.id = messages.conversation_id
              AND c.user_id = (SELECT auth.uid())
        )
    );

CREATE POLICY "Users can delete messages in own conversations"
    ON public.messages
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1
            FROM public.conversations c
            WHERE c.id = messages.conversation_id
              AND c.user_id = (SELECT auth.uid())
        )
    );


-- ============================================================
-- 3) vat_reports (auth_rls_initplan)
-- ============================================================

DROP POLICY IF EXISTS "Users can view own reports" ON public.vat_reports;
CREATE POLICY "Users can view own reports"
    ON public.vat_reports
    FOR SELECT
    USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert own reports" ON public.vat_reports;
CREATE POLICY "Users can insert own reports"
    ON public.vat_reports
    FOR INSERT
    WITH CHECK ((SELECT auth.uid()) = user_id);


-- ============================================================
-- 4) api_usage (multiple_permissive_policies)
-- ============================================================

-- Ensure this policy only applies to the service role to avoid overlapping permissive policies.
DROP POLICY IF EXISTS "Service role has full access" ON public.api_usage;
CREATE POLICY "Service role has full access"
    ON public.api_usage
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);


-- ============================================================
-- 5) profiles (multiple_permissive_policies)
-- ============================================================

-- Ensure this policy only applies to the service role to avoid overlapping permissive policies.
DROP POLICY IF EXISTS "Service role can manage profiles" ON public.profiles;
CREATE POLICY "Service role can manage profiles"
    ON public.profiles
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);


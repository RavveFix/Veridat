-- Migration: Fix remaining Supabase Performance Advisor RLS warnings (round 2)
-- Date: 2026-02-19
--
-- Goals:
-- 1) Resolve auth_rls_initplan warnings by wrapping auth.* in subselects.
-- 2) Resolve multiple_permissive_policies warnings by reducing overlapping
--    permissive policies and making role targets explicit.

BEGIN;

-- ============================================================================
-- Finance user-owned tables: explicit TO authenticated + auth.uid subselect
-- ============================================================================

-- accounting_profiles
DROP POLICY IF EXISTS "Users can view own accounting profiles" ON public.accounting_profiles;
DROP POLICY IF EXISTS "Users can insert own accounting profiles" ON public.accounting_profiles;
DROP POLICY IF EXISTS "Users can update own accounting profiles" ON public.accounting_profiles;
DROP POLICY IF EXISTS "Users can delete own accounting profiles" ON public.accounting_profiles;

CREATE POLICY "Users can view own accounting profiles"
    ON public.accounting_profiles
    FOR SELECT
    TO authenticated
    USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can insert own accounting profiles"
    ON public.accounting_profiles
    FOR INSERT
    TO authenticated
    WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can update own accounting profiles"
    ON public.accounting_profiles
    FOR UPDATE
    TO authenticated
    USING ((SELECT auth.uid()) = user_id)
    WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can delete own accounting profiles"
    ON public.accounting_profiles
    FOR DELETE
    TO authenticated
    USING ((SELECT auth.uid()) = user_id);

-- bank_imports
DROP POLICY IF EXISTS "Users can view own bank imports" ON public.bank_imports;
DROP POLICY IF EXISTS "Users can insert own bank imports" ON public.bank_imports;
DROP POLICY IF EXISTS "Users can update own bank imports" ON public.bank_imports;
DROP POLICY IF EXISTS "Users can delete own bank imports" ON public.bank_imports;

CREATE POLICY "Users can view own bank imports"
    ON public.bank_imports
    FOR SELECT
    TO authenticated
    USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can insert own bank imports"
    ON public.bank_imports
    FOR INSERT
    TO authenticated
    WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can update own bank imports"
    ON public.bank_imports
    FOR UPDATE
    TO authenticated
    USING ((SELECT auth.uid()) = user_id)
    WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can delete own bank imports"
    ON public.bank_imports
    FOR DELETE
    TO authenticated
    USING ((SELECT auth.uid()) = user_id);

-- bank_transactions
DROP POLICY IF EXISTS "Users can view own bank transactions" ON public.bank_transactions;
DROP POLICY IF EXISTS "Users can insert own bank transactions" ON public.bank_transactions;
DROP POLICY IF EXISTS "Users can update own bank transactions" ON public.bank_transactions;
DROP POLICY IF EXISTS "Users can delete own bank transactions" ON public.bank_transactions;

CREATE POLICY "Users can view own bank transactions"
    ON public.bank_transactions
    FOR SELECT
    TO authenticated
    USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can insert own bank transactions"
    ON public.bank_transactions
    FOR INSERT
    TO authenticated
    WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can update own bank transactions"
    ON public.bank_transactions
    FOR UPDATE
    TO authenticated
    USING ((SELECT auth.uid()) = user_id)
    WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can delete own bank transactions"
    ON public.bank_transactions
    FOR DELETE
    TO authenticated
    USING ((SELECT auth.uid()) = user_id);

-- reconciliation_periods
DROP POLICY IF EXISTS "Users can view own reconciliation periods" ON public.reconciliation_periods;
DROP POLICY IF EXISTS "Users can insert own reconciliation periods" ON public.reconciliation_periods;
DROP POLICY IF EXISTS "Users can update own reconciliation periods" ON public.reconciliation_periods;
DROP POLICY IF EXISTS "Users can delete own reconciliation periods" ON public.reconciliation_periods;

CREATE POLICY "Users can view own reconciliation periods"
    ON public.reconciliation_periods
    FOR SELECT
    TO authenticated
    USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can insert own reconciliation periods"
    ON public.reconciliation_periods
    FOR INSERT
    TO authenticated
    WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can update own reconciliation periods"
    ON public.reconciliation_periods
    FOR UPDATE
    TO authenticated
    USING ((SELECT auth.uid()) = user_id)
    WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can delete own reconciliation periods"
    ON public.reconciliation_periods
    FOR DELETE
    TO authenticated
    USING ((SELECT auth.uid()) = user_id);

-- invoice_inbox_items
DROP POLICY IF EXISTS "Users can view own invoice inbox items" ON public.invoice_inbox_items;
DROP POLICY IF EXISTS "Users can insert own invoice inbox items" ON public.invoice_inbox_items;
DROP POLICY IF EXISTS "Users can update own invoice inbox items" ON public.invoice_inbox_items;
DROP POLICY IF EXISTS "Users can delete own invoice inbox items" ON public.invoice_inbox_items;

CREATE POLICY "Users can view own invoice inbox items"
    ON public.invoice_inbox_items
    FOR SELECT
    TO authenticated
    USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can insert own invoice inbox items"
    ON public.invoice_inbox_items
    FOR INSERT
    TO authenticated
    WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can update own invoice inbox items"
    ON public.invoice_inbox_items
    FOR UPDATE
    TO authenticated
    USING ((SELECT auth.uid()) = user_id)
    WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can delete own invoice inbox items"
    ON public.invoice_inbox_items
    FOR DELETE
    TO authenticated
    USING ((SELECT auth.uid()) = user_id);

-- invoice_inbox_events
DROP POLICY IF EXISTS "Users can view own invoice inbox events" ON public.invoice_inbox_events;
DROP POLICY IF EXISTS "Users can insert own invoice inbox events" ON public.invoice_inbox_events;
DROP POLICY IF EXISTS "Users can update own invoice inbox events" ON public.invoice_inbox_events;
DROP POLICY IF EXISTS "Users can delete own invoice inbox events" ON public.invoice_inbox_events;

CREATE POLICY "Users can view own invoice inbox events"
    ON public.invoice_inbox_events
    FOR SELECT
    TO authenticated
    USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can insert own invoice inbox events"
    ON public.invoice_inbox_events
    FOR INSERT
    TO authenticated
    WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can update own invoice inbox events"
    ON public.invoice_inbox_events
    FOR UPDATE
    TO authenticated
    USING ((SELECT auth.uid()) = user_id)
    WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can delete own invoice inbox events"
    ON public.invoice_inbox_events
    FOR DELETE
    TO authenticated
    USING ((SELECT auth.uid()) = user_id);

-- agi_runs
DROP POLICY IF EXISTS "Users can view own agi runs" ON public.agi_runs;
DROP POLICY IF EXISTS "Users can insert own agi runs" ON public.agi_runs;
DROP POLICY IF EXISTS "Users can update own agi runs" ON public.agi_runs;
DROP POLICY IF EXISTS "Users can delete own agi runs" ON public.agi_runs;

CREATE POLICY "Users can view own agi runs"
    ON public.agi_runs
    FOR SELECT
    TO authenticated
    USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can insert own agi runs"
    ON public.agi_runs
    FOR INSERT
    TO authenticated
    WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can update own agi runs"
    ON public.agi_runs
    FOR UPDATE
    TO authenticated
    USING ((SELECT auth.uid()) = user_id)
    WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can delete own agi runs"
    ON public.agi_runs
    FOR DELETE
    TO authenticated
    USING ((SELECT auth.uid()) = user_id);

-- auto_post_policies
DROP POLICY IF EXISTS "Users can view own auto post policies" ON public.auto_post_policies;
DROP POLICY IF EXISTS "Users can insert own auto post policies" ON public.auto_post_policies;
DROP POLICY IF EXISTS "Users can update own auto post policies" ON public.auto_post_policies;
DROP POLICY IF EXISTS "Users can delete own auto post policies" ON public.auto_post_policies;

CREATE POLICY "Users can view own auto post policies"
    ON public.auto_post_policies
    FOR SELECT
    TO authenticated
    USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can insert own auto post policies"
    ON public.auto_post_policies
    FOR INSERT
    TO authenticated
    WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can update own auto post policies"
    ON public.auto_post_policies
    FOR UPDATE
    TO authenticated
    USING ((SELECT auth.uid()) = user_id)
    WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can delete own auto post policies"
    ON public.auto_post_policies
    FOR DELETE
    TO authenticated
    USING ((SELECT auth.uid()) = user_id);

-- ============================================================================
-- agent_tasks: remove broad FOR ALL policy; keep user access + service writes
-- ============================================================================

DROP POLICY IF EXISTS "Users can view own agent tasks" ON public.agent_tasks;
DROP POLICY IF EXISTS "Users can insert own agent tasks" ON public.agent_tasks;
DROP POLICY IF EXISTS "Service role can manage agent tasks" ON public.agent_tasks;
DROP POLICY IF EXISTS "Service role can insert agent tasks" ON public.agent_tasks;
DROP POLICY IF EXISTS "Service role can update agent tasks" ON public.agent_tasks;
DROP POLICY IF EXISTS "Service role can delete agent tasks" ON public.agent_tasks;

CREATE POLICY "Users can view own agent tasks"
    ON public.agent_tasks
    FOR SELECT
    TO authenticated
    USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can insert own agent tasks"
    ON public.agent_tasks
    FOR INSERT
    TO authenticated
    WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Service role can insert agent tasks"
    ON public.agent_tasks
    FOR INSERT
    TO service_role
    WITH CHECK (true);

CREATE POLICY "Service role can update agent tasks"
    ON public.agent_tasks
    FOR UPDATE
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role can delete agent tasks"
    ON public.agent_tasks
    FOR DELETE
    TO service_role
    USING (true);

-- ============================================================================
-- agent_registry: keep public read, split service policy to write-only actions
-- ============================================================================

DROP POLICY IF EXISTS "Anyone can view agent registry" ON public.agent_registry;
DROP POLICY IF EXISTS "Service role can manage agent registry" ON public.agent_registry;
DROP POLICY IF EXISTS "Service role can insert agent registry" ON public.agent_registry;
DROP POLICY IF EXISTS "Service role can update agent registry" ON public.agent_registry;
DROP POLICY IF EXISTS "Service role can delete agent registry" ON public.agent_registry;

CREATE POLICY "Anyone can view agent registry"
    ON public.agent_registry
    FOR SELECT
    USING (true);

CREATE POLICY "Service role can insert agent registry"
    ON public.agent_registry
    FOR INSERT
    TO service_role
    WITH CHECK (true);

CREATE POLICY "Service role can update agent registry"
    ON public.agent_registry
    FOR UPDATE
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role can delete agent registry"
    ON public.agent_registry
    FOR DELETE
    TO service_role
    USING (true);

-- ============================================================================
-- regulatory_rules: keep authenticated read, service write-only
-- ============================================================================

DROP POLICY IF EXISTS "Authenticated users can read regulatory rules" ON public.regulatory_rules;
DROP POLICY IF EXISTS "Service role can manage regulatory rules" ON public.regulatory_rules;
DROP POLICY IF EXISTS "Service role can insert regulatory rules" ON public.regulatory_rules;
DROP POLICY IF EXISTS "Service role can update regulatory rules" ON public.regulatory_rules;
DROP POLICY IF EXISTS "Service role can delete regulatory rules" ON public.regulatory_rules;

CREATE POLICY "Authenticated users can read regulatory rules"
    ON public.regulatory_rules
    FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Service role can insert regulatory rules"
    ON public.regulatory_rules
    FOR INSERT
    TO service_role
    WITH CHECK (true);

CREATE POLICY "Service role can update regulatory rules"
    ON public.regulatory_rules
    FOR UPDATE
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role can delete regulatory rules"
    ON public.regulatory_rules
    FOR DELETE
    TO service_role
    USING (true);

-- ============================================================================
-- fortnox_tokens: explicit TO authenticated + auth.uid subselect; remove deny
-- ============================================================================

DROP POLICY IF EXISTS "Users can view their own tokens" ON public.fortnox_tokens;
DROP POLICY IF EXISTS "Users can update their own tokens" ON public.fortnox_tokens;
DROP POLICY IF EXISTS "Users can insert their own tokens" ON public.fortnox_tokens;
DROP POLICY IF EXISTS "Users can delete their own tokens" ON public.fortnox_tokens;
DROP POLICY IF EXISTS "Deny anon access" ON public.fortnox_tokens;

CREATE POLICY "Users can view their own tokens"
    ON public.fortnox_tokens
    FOR SELECT
    TO authenticated
    USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can update their own tokens"
    ON public.fortnox_tokens
    FOR UPDATE
    TO authenticated
    USING ((SELECT auth.uid()) = user_id)
    WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can insert their own tokens"
    ON public.fortnox_tokens
    FOR INSERT
    TO authenticated
    WITH CHECK (
        (SELECT auth.uid()) = user_id
        AND EXISTS (
            SELECT 1
            FROM public.profiles
            WHERE profiles.id = user_id
              AND profiles.plan IN ('pro', 'trial')
        )
    );

CREATE POLICY "Users can delete their own tokens"
    ON public.fortnox_tokens
    FOR DELETE
    TO authenticated
    USING ((SELECT auth.uid()) = user_id);

COMMIT;

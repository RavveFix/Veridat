-- Finance Agent V2 RLS policies

ALTER TABLE public.accounting_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reconciliation_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_inbox_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_inbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agi_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.regulatory_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_post_policies ENABLE ROW LEVEL SECURITY;

-- accounting_profiles
DROP POLICY IF EXISTS "Users can view own accounting profiles" ON public.accounting_profiles;
DROP POLICY IF EXISTS "Users can insert own accounting profiles" ON public.accounting_profiles;
DROP POLICY IF EXISTS "Users can update own accounting profiles" ON public.accounting_profiles;
DROP POLICY IF EXISTS "Users can delete own accounting profiles" ON public.accounting_profiles;

CREATE POLICY "Users can view own accounting profiles"
    ON public.accounting_profiles
    FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own accounting profiles"
    ON public.accounting_profiles
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own accounting profiles"
    ON public.accounting_profiles
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own accounting profiles"
    ON public.accounting_profiles
    FOR DELETE
    USING (auth.uid() = user_id);

-- bank_imports
DROP POLICY IF EXISTS "Users can view own bank imports" ON public.bank_imports;
DROP POLICY IF EXISTS "Users can insert own bank imports" ON public.bank_imports;
DROP POLICY IF EXISTS "Users can update own bank imports" ON public.bank_imports;
DROP POLICY IF EXISTS "Users can delete own bank imports" ON public.bank_imports;

CREATE POLICY "Users can view own bank imports"
    ON public.bank_imports
    FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own bank imports"
    ON public.bank_imports
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own bank imports"
    ON public.bank_imports
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own bank imports"
    ON public.bank_imports
    FOR DELETE
    USING (auth.uid() = user_id);

-- bank_transactions
DROP POLICY IF EXISTS "Users can view own bank transactions" ON public.bank_transactions;
DROP POLICY IF EXISTS "Users can insert own bank transactions" ON public.bank_transactions;
DROP POLICY IF EXISTS "Users can update own bank transactions" ON public.bank_transactions;
DROP POLICY IF EXISTS "Users can delete own bank transactions" ON public.bank_transactions;

CREATE POLICY "Users can view own bank transactions"
    ON public.bank_transactions
    FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own bank transactions"
    ON public.bank_transactions
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own bank transactions"
    ON public.bank_transactions
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own bank transactions"
    ON public.bank_transactions
    FOR DELETE
    USING (auth.uid() = user_id);

-- reconciliation_periods
DROP POLICY IF EXISTS "Users can view own reconciliation periods" ON public.reconciliation_periods;
DROP POLICY IF EXISTS "Users can insert own reconciliation periods" ON public.reconciliation_periods;
DROP POLICY IF EXISTS "Users can update own reconciliation periods" ON public.reconciliation_periods;
DROP POLICY IF EXISTS "Users can delete own reconciliation periods" ON public.reconciliation_periods;

CREATE POLICY "Users can view own reconciliation periods"
    ON public.reconciliation_periods
    FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own reconciliation periods"
    ON public.reconciliation_periods
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own reconciliation periods"
    ON public.reconciliation_periods
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own reconciliation periods"
    ON public.reconciliation_periods
    FOR DELETE
    USING (auth.uid() = user_id);

-- invoice_inbox_items
DROP POLICY IF EXISTS "Users can view own invoice inbox items" ON public.invoice_inbox_items;
DROP POLICY IF EXISTS "Users can insert own invoice inbox items" ON public.invoice_inbox_items;
DROP POLICY IF EXISTS "Users can update own invoice inbox items" ON public.invoice_inbox_items;
DROP POLICY IF EXISTS "Users can delete own invoice inbox items" ON public.invoice_inbox_items;

CREATE POLICY "Users can view own invoice inbox items"
    ON public.invoice_inbox_items
    FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own invoice inbox items"
    ON public.invoice_inbox_items
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own invoice inbox items"
    ON public.invoice_inbox_items
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own invoice inbox items"
    ON public.invoice_inbox_items
    FOR DELETE
    USING (auth.uid() = user_id);

-- invoice_inbox_events
DROP POLICY IF EXISTS "Users can view own invoice inbox events" ON public.invoice_inbox_events;
DROP POLICY IF EXISTS "Users can insert own invoice inbox events" ON public.invoice_inbox_events;
DROP POLICY IF EXISTS "Users can update own invoice inbox events" ON public.invoice_inbox_events;
DROP POLICY IF EXISTS "Users can delete own invoice inbox events" ON public.invoice_inbox_events;

CREATE POLICY "Users can view own invoice inbox events"
    ON public.invoice_inbox_events
    FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own invoice inbox events"
    ON public.invoice_inbox_events
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own invoice inbox events"
    ON public.invoice_inbox_events
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own invoice inbox events"
    ON public.invoice_inbox_events
    FOR DELETE
    USING (auth.uid() = user_id);

-- agi_runs
DROP POLICY IF EXISTS "Users can view own agi runs" ON public.agi_runs;
DROP POLICY IF EXISTS "Users can insert own agi runs" ON public.agi_runs;
DROP POLICY IF EXISTS "Users can update own agi runs" ON public.agi_runs;
DROP POLICY IF EXISTS "Users can delete own agi runs" ON public.agi_runs;

CREATE POLICY "Users can view own agi runs"
    ON public.agi_runs
    FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own agi runs"
    ON public.agi_runs
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own agi runs"
    ON public.agi_runs
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own agi runs"
    ON public.agi_runs
    FOR DELETE
    USING (auth.uid() = user_id);

-- regulatory_rules
DROP POLICY IF EXISTS "Authenticated users can read regulatory rules" ON public.regulatory_rules;
DROP POLICY IF EXISTS "Service role can manage regulatory rules" ON public.regulatory_rules;

CREATE POLICY "Authenticated users can read regulatory rules"
    ON public.regulatory_rules
    FOR SELECT
    TO authenticated
    USING (TRUE);

CREATE POLICY "Service role can manage regulatory rules"
    ON public.regulatory_rules
    FOR ALL
    USING ((auth.jwt() ->> 'role') = 'service_role')
    WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

-- auto_post_policies
DROP POLICY IF EXISTS "Users can view own auto post policies" ON public.auto_post_policies;
DROP POLICY IF EXISTS "Users can insert own auto post policies" ON public.auto_post_policies;
DROP POLICY IF EXISTS "Users can update own auto post policies" ON public.auto_post_policies;
DROP POLICY IF EXISTS "Users can delete own auto post policies" ON public.auto_post_policies;

CREATE POLICY "Users can view own auto post policies"
    ON public.auto_post_policies
    FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own auto post policies"
    ON public.auto_post_policies
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own auto post policies"
    ON public.auto_post_policies
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own auto post policies"
    ON public.auto_post_policies
    FOR DELETE
    USING (auth.uid() = user_id);


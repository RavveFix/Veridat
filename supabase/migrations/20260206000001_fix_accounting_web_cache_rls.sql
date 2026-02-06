-- Fix: Add RLS policies for accounting_web_cache
-- The table had RLS enabled but zero policies, blocking all operations.
-- This table is a server-side cache used by the web-search Edge Function
-- via service_role key — no user_id column exists.

-- Service role needs full access for cache read/write
CREATE POLICY "Service role full access"
    ON public.accounting_web_cache
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

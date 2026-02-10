-- Guardian alerts table for server-side Fortnox health checks
-- Date: 2026-02-10

CREATE TABLE IF NOT EXISTS public.guardian_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    company_id TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved')),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    action_target TEXT,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurrences INTEGER NOT NULL DEFAULT 1,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_guardian_alerts_user_company_status
    ON public.guardian_alerts(user_id, company_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_guardian_alerts_fingerprint
    ON public.guardian_alerts(user_id, company_id, fingerprint);

CREATE UNIQUE INDEX IF NOT EXISTS idx_guardian_alerts_dedupe
    ON public.guardian_alerts(user_id, company_id, fingerprint, status);

DROP TRIGGER IF EXISTS update_guardian_alerts_updated_at ON public.guardian_alerts;
CREATE TRIGGER update_guardian_alerts_updated_at
    BEFORE UPDATE ON public.guardian_alerts
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.guardian_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own guardian alerts" ON public.guardian_alerts;
DROP POLICY IF EXISTS "Users can update own guardian alerts" ON public.guardian_alerts;
DROP POLICY IF EXISTS "Service role can manage guardian alerts" ON public.guardian_alerts;

CREATE POLICY "Users can view own guardian alerts"
    ON public.guardian_alerts
    FOR SELECT
    USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can update own guardian alerts"
    ON public.guardian_alerts
    FOR UPDATE
    USING ((SELECT auth.uid()) = user_id)
    WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Service role can manage guardian alerts"
    ON public.guardian_alerts
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

COMMENT ON TABLE public.guardian_alerts IS 'Server-side guardian alerts for Fortnox operational/compliance checks';
COMMENT ON COLUMN public.guardian_alerts.fingerprint IS 'Deterministic dedupe key per user+company+check';
COMMENT ON COLUMN public.guardian_alerts.action_target IS 'UI tool target (e.g. fortnox-panel, invoice-inbox, vat-report)';

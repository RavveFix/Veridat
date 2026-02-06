-- Legal acceptances table for tracking consent to key documents

CREATE TABLE IF NOT EXISTS public.legal_acceptances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    company_id TEXT,
    doc_type TEXT NOT NULL CHECK (doc_type IN ('terms', 'privacy', 'security', 'dpa')),
    version TEXT NOT NULL,
    accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_agent TEXT,
    dpa_authorized BOOLEAN NOT NULL DEFAULT FALSE,
    accepted_from TEXT NOT NULL DEFAULT 'app',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_acceptances_unique
    ON public.legal_acceptances (user_id, doc_type, version);

CREATE INDEX IF NOT EXISTS idx_legal_acceptances_user
    ON public.legal_acceptances (user_id);

CREATE INDEX IF NOT EXISTS idx_legal_acceptances_company
    ON public.legal_acceptances (company_id);

ALTER TABLE public.legal_acceptances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own legal acceptances" ON public.legal_acceptances;
DROP POLICY IF EXISTS "Users can insert own legal acceptances" ON public.legal_acceptances;
DROP POLICY IF EXISTS "Service role can manage legal acceptances" ON public.legal_acceptances;

CREATE POLICY "Users can view own legal acceptances"
    ON public.legal_acceptances FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own legal acceptances"
    ON public.legal_acceptances FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role can manage legal acceptances"
    ON public.legal_acceptances FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

COMMENT ON TABLE public.legal_acceptances IS 'Tracks acceptance of legal documents per user and version.';
COMMENT ON COLUMN public.legal_acceptances.doc_type IS 'terms, privacy, security, dpa';
COMMENT ON COLUMN public.legal_acceptances.dpa_authorized IS 'Whether user asserted authority to accept DPA.';

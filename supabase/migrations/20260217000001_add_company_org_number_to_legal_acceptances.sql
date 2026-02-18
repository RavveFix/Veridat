-- Capture company org number for legal acceptance audit trails and enforce DPA company context.

ALTER TABLE public.legal_acceptances
    ADD COLUMN IF NOT EXISTS company_org_number TEXT;

CREATE INDEX IF NOT EXISTS idx_legal_acceptances_company_org_number
    ON public.legal_acceptances (company_org_number);

ALTER TABLE public.legal_acceptances
    DROP CONSTRAINT IF EXISTS legal_acceptances_dpa_requires_company_context;

ALTER TABLE public.legal_acceptances
    ADD CONSTRAINT legal_acceptances_dpa_requires_company_context
    CHECK (doc_type <> 'dpa' OR company_id IS NOT NULL) NOT VALID;

COMMENT ON COLUMN public.legal_acceptances.company_org_number IS
    'Optional organization number captured for DPA acceptance audit.';

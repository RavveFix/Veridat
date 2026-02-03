-- Structured accounting memories for safe, period-aware AI context

CREATE TABLE IF NOT EXISTS public.accounting_memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    company_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_key TEXT,
    label TEXT NOT NULL DEFAULT '',
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    source_type TEXT NOT NULL,
    source_id TEXT,
    source_reliability REAL NOT NULL DEFAULT 0.5,
    confidence REAL NOT NULL DEFAULT 0.7,
    confirmation_count INTEGER NOT NULL DEFAULT 0,
    rejection_count INTEGER NOT NULL DEFAULT 0,
    review_status TEXT NOT NULL DEFAULT 'auto',
    fiscal_year TEXT,
    period_start DATE,
    period_end DATE,
    valid_from DATE,
    valid_to DATE,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT accounting_memories_entity_type_check
        CHECK (entity_type IN (
            'company_profile',
            'account_policy',
            'supplier_profile',
            'tax_profile',
            'period_summary',
            'annual_report',
            'journal_summary',
            'rule',
            'other'
        )),
    CONSTRAINT accounting_memories_source_type_check
        CHECK (source_type IN (
            'ledger',
            'annual_report',
            'sie',
            'fortnox',
            'bank',
            'user',
            'system',
            'other'
        )),
    CONSTRAINT accounting_memories_review_status_check
        CHECK (review_status IN ('auto', 'needs_review', 'confirmed', 'rejected')),
    CONSTRAINT accounting_memories_source_reliability_check
        CHECK (source_reliability >= 0 AND source_reliability <= 1),
    CONSTRAINT accounting_memories_confidence_check
        CHECK (confidence >= 0 AND confidence <= 1)
);

CREATE INDEX IF NOT EXISTS idx_accounting_memories_user_company
    ON public.accounting_memories (user_id, company_id);

CREATE INDEX IF NOT EXISTS idx_accounting_memories_entity_type
    ON public.accounting_memories (entity_type);

CREATE INDEX IF NOT EXISTS idx_accounting_memories_fiscal_year
    ON public.accounting_memories (fiscal_year);

CREATE INDEX IF NOT EXISTS idx_accounting_memories_review_status
    ON public.accounting_memories (review_status);

CREATE INDEX IF NOT EXISTS idx_accounting_memories_last_used_at
    ON public.accounting_memories (last_used_at DESC);

-- Maintain updated_at via existing trigger function
DROP TRIGGER IF EXISTS update_accounting_memories_updated_at ON public.accounting_memories;
CREATE TRIGGER update_accounting_memories_updated_at
    BEFORE UPDATE ON public.accounting_memories
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- Enable RLS
ALTER TABLE public.accounting_memories ENABLE ROW LEVEL SECURITY;

-- Policies (idempotent via drop + recreate)
DROP POLICY IF EXISTS "Users can view own accounting memories" ON public.accounting_memories;
DROP POLICY IF EXISTS "Users can insert own accounting memories" ON public.accounting_memories;
DROP POLICY IF EXISTS "Users can update own accounting memories" ON public.accounting_memories;
DROP POLICY IF EXISTS "Users can delete own accounting memories" ON public.accounting_memories;

CREATE POLICY "Users can view own accounting memories"
    ON public.accounting_memories
    FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own accounting memories"
    ON public.accounting_memories
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own accounting memories"
    ON public.accounting_memories
    FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own accounting memories"
    ON public.accounting_memories
    FOR DELETE
    USING (auth.uid() = user_id);

COMMENT ON TABLE public.accounting_memories IS 'Structured accounting memories with source reliability and period awareness.';
COMMENT ON COLUMN public.accounting_memories.entity_type IS 'Semantic type for memory records (company_profile, account_policy, etc).';
COMMENT ON COLUMN public.accounting_memories.source_reliability IS '0-1 reliability score based on source (ledger/annual_report highest).';
COMMENT ON COLUMN public.accounting_memories.review_status IS 'auto, needs_review, confirmed, rejected.';

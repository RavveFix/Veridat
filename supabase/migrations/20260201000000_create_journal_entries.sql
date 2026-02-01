-- Migration: Create journal_entries table for AI-powered bookkeeping
-- Description: Stores journal entries (verifikationer) for Swedish bookkeeping compliance (BFL 7:1)

-- Create journal_entries table
CREATE TABLE IF NOT EXISTS public.journal_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    company_id TEXT,
    conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
    verification_id TEXT NOT NULL,
    period TEXT NOT NULL, -- YYYY-MM format
    transaction_type TEXT NOT NULL CHECK (transaction_type IN ('revenue', 'expense')),
    gross_amount NUMERIC(10, 2) NOT NULL,
    net_amount NUMERIC(10, 2) NOT NULL,
    vat_amount NUMERIC(10, 2) NOT NULL,
    vat_rate NUMERIC(5, 2) NOT NULL,
    description TEXT NOT NULL,
    entries JSONB NOT NULL, -- Array of JournalEntry objects
    is_balanced BOOLEAN NOT NULL DEFAULT true,
    exported_to_fortnox BOOLEAN DEFAULT false,
    exported_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes
CREATE INDEX idx_journal_entries_user_id ON public.journal_entries(user_id);
CREATE INDEX idx_journal_entries_company_id ON public.journal_entries(company_id);
CREATE INDEX idx_journal_entries_verification_id ON public.journal_entries(verification_id);
CREATE INDEX idx_journal_entries_period ON public.journal_entries(period);
CREATE INDEX idx_journal_entries_conversation_id ON public.journal_entries(conversation_id);

-- Enable RLS
ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;

-- RLS Policies for authenticated users
CREATE POLICY "Users can view own journal entries"
    ON public.journal_entries FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create own journal entries"
    ON public.journal_entries FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- RLS Policies for anonymous users (using user_id = 'anonymous')
CREATE POLICY "Anonymous users can view own journal entries"
    ON public.journal_entries FOR SELECT
    USING (user_id::text = 'anonymous');

CREATE POLICY "Anonymous users can create journal entries"
    ON public.journal_entries FOR INSERT
    WITH CHECK (user_id::text = 'anonymous');

-- Create trigger for updated_at
CREATE TRIGGER update_journal_entries_updated_at
    BEFORE UPDATE ON public.journal_entries
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- Create verification_sequences table for BFL 7:1 compliance
CREATE TABLE IF NOT EXISTS public.verification_sequences (
    period TEXT NOT NULL,
    company_id TEXT NOT NULL,
    last_sequence INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (period, company_id)
);

-- Create function to get next verification ID
CREATE OR REPLACE FUNCTION public.get_next_verification_id(
    p_period TEXT,
    p_company_id TEXT DEFAULT 'default'
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_sequence INTEGER;
    v_verification_id TEXT;
BEGIN
    -- Upsert sequence number (atomic operation)
    INSERT INTO public.verification_sequences (period, company_id, last_sequence)
    VALUES (p_period, p_company_id, 1)
    ON CONFLICT (period, company_id)
    DO UPDATE SET
        last_sequence = verification_sequences.last_sequence + 1,
        updated_at = NOW()
    RETURNING last_sequence INTO v_sequence;

    -- Generate verification ID: BRITTA-YYYY-MM-NNN
    v_verification_id := 'BRITTA-' ||
        SUBSTRING(p_period, 1, 4) || '-' ||
        SUBSTRING(p_period, 6, 2) || '-' ||
        LPAD(v_sequence::TEXT, 3, '0');

    RETURN v_verification_id;
END;
$$;

-- Add comments for documentation
COMMENT ON TABLE public.journal_entries IS 'Journal entries (verifikationer) for Swedish bookkeeping compliance (BFL 7:1)';
COMMENT ON TABLE public.verification_sequences IS 'Sequence tracking for verification IDs per period and company';
COMMENT ON FUNCTION public.get_next_verification_id IS 'Generates next verification ID in format BRITTA-YYYY-MM-NNN';

-- Grant permissions
GRANT SELECT, INSERT ON public.journal_entries TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.verification_sequences TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_next_verification_id TO anon, authenticated;

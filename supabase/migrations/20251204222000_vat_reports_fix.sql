-- Create table for storing VAT analysis reports (Idempotent)
CREATE TABLE IF NOT EXISTS vat_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
    period TEXT NOT NULL, -- Format: YYYY-MM
    company_name TEXT,
    report_data JSONB NOT NULL, -- The full JSON report from Python/Claude
    source_filename TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE vat_reports ENABLE ROW LEVEL SECURITY;

-- Policies (Idempotent)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'vat_reports' 
        AND policyname = 'Users can view own reports'
    ) THEN
        CREATE POLICY "Users can view own reports"
            ON vat_reports FOR SELECT
            USING (auth.uid() = user_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'vat_reports' 
        AND policyname = 'Users can insert own reports'
    ) THEN
        CREATE POLICY "Users can insert own reports"
            ON vat_reports FOR INSERT
            WITH CHECK (auth.uid() = user_id);
    END IF;
END $$;

-- Indexes (Idempotent-ish: IF NOT EXISTS is standard in PG 9.5+)
CREATE INDEX IF NOT EXISTS idx_vat_reports_conversation_id ON vat_reports(conversation_id);
CREATE INDEX IF NOT EXISTS idx_vat_reports_user_period ON vat_reports(user_id, period);

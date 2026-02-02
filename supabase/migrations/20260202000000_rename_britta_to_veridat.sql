-- Migration: Rename verification ID prefix from BRITTA- to VERIDAT-
-- Existing verification IDs with BRITTA- prefix are preserved.
-- Only new verification IDs will use the VERIDAT- prefix.

CREATE OR REPLACE FUNCTION public.get_next_verification_id(
    p_period TEXT,
    p_company_id UUID DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
    v_sequence INTEGER;
    v_verification_id TEXT;
BEGIN
    INSERT INTO verification_sequences (period, company_id, last_sequence)
    VALUES (p_period, p_company_id, 1)
    ON CONFLICT (period, COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::UUID))
    DO UPDATE SET
        last_sequence = verification_sequences.last_sequence + 1,
        updated_at = NOW()
    RETURNING last_sequence INTO v_sequence;

    -- Generate verification ID: VERIDAT-YYYY-MM-NNN
    v_verification_id := 'VERIDAT-' ||
        SUBSTRING(p_period, 1, 4) || '-' ||
        SUBSTRING(p_period, 6, 2) || '-' ||
        LPAD(v_sequence::TEXT, 3, '0');

    RETURN v_verification_id;
END;
$$;

COMMENT ON FUNCTION public.get_next_verification_id IS 'Generates next verification ID in format VERIDAT-YYYY-MM-NNN';

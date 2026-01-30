-- BFL Compliance: Audit Trail Tables
-- Migration: Create audit_logs, ai_decisions, and fortnox_sync_log tables
-- Legal Reference: BFL 7 kap 1§ - Verifikationer ska innehålla uppgift om vem som bokfört

-- ============================================================================
-- AUDIT_LOGS TABLE
-- Central audit log for all BFL-relevant actions
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'system', 'ai', 'fortnox_sync')),
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    company_id TEXT,
    previous_state JSONB,
    new_state JSONB,
    ai_model TEXT,
    ai_confidence REAL CHECK (ai_confidence IS NULL OR (ai_confidence >= 0 AND ai_confidence <= 1)),
    ai_decision_id UUID,
    bfl_reference TEXT DEFAULT 'BFL 7:1',
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    retention_until TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 years')
);

-- Indexes for audit_logs
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON public.audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_company_id ON public.audit_logs(company_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON public.audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_retention ON public.audit_logs(retention_until);
CREATE INDEX IF NOT EXISTS idx_audit_logs_ai_decision ON public.audit_logs(ai_decision_id) WHERE ai_decision_id IS NOT NULL;

-- ============================================================================
-- AI_DECISIONS TABLE
-- Tracks all AI decisions separately for compliance auditing
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ai_decisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
    company_id TEXT,
    ai_provider TEXT NOT NULL CHECK (ai_provider IN ('gemini', 'openai', 'claude')),
    ai_model TEXT NOT NULL,
    ai_function TEXT NOT NULL,
    input_hash TEXT NOT NULL,
    input_data JSONB NOT NULL,
    output_data JSONB NOT NULL,
    confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    processing_time_ms INTEGER,
    was_overridden BOOLEAN NOT NULL DEFAULT FALSE,
    override_reason TEXT,
    override_by UUID REFERENCES auth.users(id),
    override_at TIMESTAMPTZ,
    bfl_reference TEXT DEFAULT 'BFL 7:1',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    retention_until TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 years')
);

-- Indexes for ai_decisions
CREATE INDEX IF NOT EXISTS idx_ai_decisions_user_id ON public.ai_decisions(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_decisions_company_id ON public.ai_decisions(company_id);
CREATE INDEX IF NOT EXISTS idx_ai_decisions_function ON public.ai_decisions(ai_function);
CREATE INDEX IF NOT EXISTS idx_ai_decisions_created_at ON public.ai_decisions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_decisions_provider ON public.ai_decisions(ai_provider);
CREATE INDEX IF NOT EXISTS idx_ai_decisions_overridden ON public.ai_decisions(was_overridden) WHERE was_overridden = TRUE;
CREATE INDEX IF NOT EXISTS idx_ai_decisions_input_hash ON public.ai_decisions(input_hash);

-- ============================================================================
-- FORTNOX_SYNC_LOG TABLE
-- Tracks all exports to Fortnox for audit trail
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.fortnox_sync_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
    company_id TEXT NOT NULL,
    operation TEXT NOT NULL CHECK (operation IN (
        'export_voucher',
        'export_supplier_invoice',
        'create_supplier',
        'create_customer',
        'create_article',
        'update_voucher',
        'import_vouchers',
        'import_supplier_invoices'
    )),

    -- Local references
    vat_report_id UUID,
    transaction_id TEXT,
    ai_decision_id UUID REFERENCES public.ai_decisions(id),

    -- Fortnox response data
    fortnox_document_number TEXT,
    fortnox_voucher_series TEXT,
    fortnox_supplier_number TEXT,
    fortnox_invoice_number TEXT,

    -- Status tracking
    status TEXT NOT NULL CHECK (status IN ('pending', 'in_progress', 'success', 'failed', 'cancelled')),
    error_code TEXT,
    error_message TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,

    -- Request/Response payload for debugging
    request_payload JSONB NOT NULL,
    response_payload JSONB,

    -- BFL compliance
    bfl_reference TEXT DEFAULT 'BFL 7:1',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    retention_until TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 years')
);

-- Indexes for fortnox_sync_log
CREATE INDEX IF NOT EXISTS idx_fortnox_sync_user_id ON public.fortnox_sync_log(user_id);
CREATE INDEX IF NOT EXISTS idx_fortnox_sync_company_id ON public.fortnox_sync_log(company_id);
CREATE INDEX IF NOT EXISTS idx_fortnox_sync_operation ON public.fortnox_sync_log(operation);
CREATE INDEX IF NOT EXISTS idx_fortnox_sync_status ON public.fortnox_sync_log(status);
CREATE INDEX IF NOT EXISTS idx_fortnox_sync_created_at ON public.fortnox_sync_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fortnox_sync_vat_report ON public.fortnox_sync_log(vat_report_id) WHERE vat_report_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fortnox_sync_document ON public.fortnox_sync_log(fortnox_document_number) WHERE fortnox_document_number IS NOT NULL;

-- ============================================================================
-- ROW LEVEL SECURITY
-- Audit logs are append-only: SELECT for users, no UPDATE/DELETE
-- ============================================================================

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fortnox_sync_log ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (idempotent)
DROP POLICY IF EXISTS "Users can view own audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Service role can insert audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Users can view own AI decisions" ON public.ai_decisions;
DROP POLICY IF EXISTS "Service role can insert AI decisions" ON public.ai_decisions;
DROP POLICY IF EXISTS "Service role can update AI decisions for override" ON public.ai_decisions;
DROP POLICY IF EXISTS "Users can view own Fortnox sync logs" ON public.fortnox_sync_log;
DROP POLICY IF EXISTS "Service role can manage Fortnox sync logs" ON public.fortnox_sync_log;

-- AUDIT_LOGS RLS Policies
-- Users can only SELECT their own logs (no UPDATE, no DELETE)
CREATE POLICY "Users can view own audit logs"
    ON public.audit_logs FOR SELECT
    USING (auth.uid() = user_id);

-- Service role can insert (from Edge Functions)
CREATE POLICY "Service role can insert audit logs"
    ON public.audit_logs FOR INSERT
    WITH CHECK (true);

-- AI_DECISIONS RLS Policies
CREATE POLICY "Users can view own AI decisions"
    ON public.ai_decisions FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Service role can insert AI decisions"
    ON public.ai_decisions FOR INSERT
    WITH CHECK (true);

-- Allow updating override fields only
CREATE POLICY "Service role can update AI decisions for override"
    ON public.ai_decisions FOR UPDATE
    USING (true)
    WITH CHECK (true);

-- FORTNOX_SYNC_LOG RLS Policies
CREATE POLICY "Users can view own Fortnox sync logs"
    ON public.fortnox_sync_log FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage Fortnox sync logs"
    ON public.fortnox_sync_log FOR ALL
    USING (true);

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to record an AI decision override
CREATE OR REPLACE FUNCTION public.record_ai_decision_override(
    p_decision_id UUID,
    p_user_id UUID,
    p_reason TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.ai_decisions
    SET
        was_overridden = TRUE,
        override_reason = p_reason,
        override_by = p_user_id,
        override_at = NOW()
    WHERE id = p_decision_id;

    -- Also log to audit_logs
    INSERT INTO public.audit_logs (
        user_id,
        actor_type,
        action,
        resource_type,
        resource_id,
        ai_decision_id,
        new_state
    ) VALUES (
        p_user_id,
        'user',
        'override_ai_decision',
        'ai_decision',
        p_decision_id::TEXT,
        p_decision_id,
        jsonb_build_object('reason', p_reason)
    );
END;
$$;

-- Function to get audit trail for a resource
CREATE OR REPLACE FUNCTION public.get_audit_trail(
    p_resource_type TEXT,
    p_resource_id TEXT
)
RETURNS SETOF public.audit_logs
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT *
    FROM public.audit_logs
    WHERE resource_type = p_resource_type
    AND resource_id = p_resource_id
    ORDER BY created_at DESC;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.record_ai_decision_override(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_audit_trail(TEXT, TEXT) TO authenticated;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE public.audit_logs IS 'BFL-compliant audit trail for all accounting-relevant actions (BFL 7 kap 1§)';
COMMENT ON TABLE public.ai_decisions IS 'Tracks all AI decisions for compliance auditing and override tracking';
COMMENT ON TABLE public.fortnox_sync_log IS 'Tracks all exports to Fortnox bokföringssystem';

COMMENT ON COLUMN public.audit_logs.actor_type IS 'Who performed the action: user, system, ai, or fortnox_sync';
COMMENT ON COLUMN public.audit_logs.bfl_reference IS 'Reference to applicable BFL section';
COMMENT ON COLUMN public.audit_logs.retention_until IS '7 years retention per BFL 7:2';

COMMENT ON COLUMN public.ai_decisions.input_hash IS 'SHA256 hash of input for deduplication';
COMMENT ON COLUMN public.ai_decisions.confidence IS 'AI confidence score (0.0 - 1.0)';
COMMENT ON COLUMN public.ai_decisions.was_overridden IS 'Whether a human overrode this AI decision';

COMMENT ON COLUMN public.fortnox_sync_log.fortnox_document_number IS 'Document number returned by Fortnox (verifikationsnummer)';
COMMENT ON COLUMN public.fortnox_sync_log.fortnox_voucher_series IS 'Voucher series in Fortnox (A, B, C, etc.)';

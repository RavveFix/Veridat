-- Finance Agent V2 core tables (database-backed system of record)

CREATE TABLE IF NOT EXISTS public.accounting_profiles (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    company_id TEXT NOT NULL,
    company_form TEXT NOT NULL DEFAULT 'ab',
    vat_periodicity TEXT NOT NULL DEFAULT 'monthly',
    bookkeeping_method TEXT NOT NULL DEFAULT 'accrual',
    payroll_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    fiscal_year_start_month SMALLINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, company_id),
    CONSTRAINT accounting_profiles_company_form_check
        CHECK (company_form IN ('ab', 'enskild')),
    CONSTRAINT accounting_profiles_vat_periodicity_check
        CHECK (vat_periodicity IN ('monthly', 'quarterly', 'yearly')),
    CONSTRAINT accounting_profiles_bookkeeping_method_check
        CHECK (bookkeeping_method IN ('accrual', 'cash')),
    CONSTRAINT accounting_profiles_fiscal_year_month_check
        CHECK (fiscal_year_start_month >= 1 AND fiscal_year_start_month <= 12)
);

CREATE TABLE IF NOT EXISTS public.bank_imports (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    company_id TEXT NOT NULL,
    filename TEXT NOT NULL DEFAULT '',
    imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    row_count INTEGER NOT NULL DEFAULT 0,
    mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
    idempotency_key TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT bank_imports_row_count_check CHECK (row_count >= 0)
);

CREATE TABLE IF NOT EXISTS public.bank_transactions (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    company_id TEXT NOT NULL,
    id TEXT NOT NULL,
    import_id TEXT REFERENCES public.bank_imports(id) ON DELETE CASCADE,
    tx_date DATE NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'SEK',
    counterparty TEXT,
    reference TEXT,
    ocr TEXT,
    account TEXT,
    raw JSONB NOT NULL DEFAULT '{}'::jsonb,
    match_status TEXT NOT NULL DEFAULT 'unmatched',
    fortnox_ref JSONB NOT NULL DEFAULT '{}'::jsonb,
    ai_decision_id UUID REFERENCES public.ai_decisions(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, company_id, id),
    CONSTRAINT bank_transactions_match_status_check
        CHECK (match_status IN ('unmatched', 'suggested', 'approved', 'posted', 'dismissed'))
);

CREATE TABLE IF NOT EXISTS public.reconciliation_periods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    company_id TEXT NOT NULL,
    period TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    reconciled_at TIMESTAMPTZ,
    reconciled_by UUID REFERENCES auth.users(id),
    locked_at TIMESTAMPTZ,
    notes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT reconciliation_periods_period_check
        CHECK (period ~ '^[0-9]{4}-[0-9]{2}$'),
    CONSTRAINT reconciliation_periods_status_check
        CHECK (status IN ('open', 'reconciled', 'locked'))
);

CREATE TABLE IF NOT EXISTS public.invoice_inbox_items (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    company_id TEXT NOT NULL,
    id TEXT NOT NULL,
    file_name TEXT NOT NULL DEFAULT '',
    file_url TEXT NOT NULL DEFAULT '',
    file_path TEXT NOT NULL DEFAULT '',
    file_bucket TEXT NOT NULL DEFAULT '',
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status TEXT NOT NULL DEFAULT 'ny',
    source TEXT NOT NULL DEFAULT 'upload',
    supplier_name TEXT NOT NULL DEFAULT '',
    supplier_org_nr TEXT NOT NULL DEFAULT '',
    invoice_number TEXT NOT NULL DEFAULT '',
    invoice_date DATE,
    due_date DATE,
    total_amount NUMERIC(14, 2),
    vat_amount NUMERIC(14, 2),
    vat_rate NUMERIC(6, 2),
    ocr_number TEXT NOT NULL DEFAULT '',
    bas_account TEXT NOT NULL DEFAULT '',
    bas_account_name TEXT NOT NULL DEFAULT '',
    currency TEXT NOT NULL DEFAULT 'SEK',
    fortnox_sync_status TEXT NOT NULL DEFAULT 'not_exported',
    fortnox_supplier_number TEXT NOT NULL DEFAULT '',
    fortnox_given_number INTEGER,
    fortnox_booked BOOLEAN NOT NULL DEFAULT FALSE,
    fortnox_balance NUMERIC(14, 2),
    ai_extracted BOOLEAN NOT NULL DEFAULT FALSE,
    ai_raw_response TEXT NOT NULL DEFAULT '',
    ai_review_note TEXT NOT NULL DEFAULT '',
    ai_decision_id UUID REFERENCES public.ai_decisions(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, company_id, id),
    CONSTRAINT invoice_inbox_items_status_check
        CHECK (status IN ('ny', 'granskad', 'bokford', 'betald')),
    CONSTRAINT invoice_inbox_items_source_check
        CHECK (source IN ('upload', 'fortnox')),
    CONSTRAINT invoice_inbox_items_sync_status_check
        CHECK (fortnox_sync_status IN ('not_exported', 'exported', 'booked', 'attested'))
);

CREATE TABLE IF NOT EXISTS public.invoice_inbox_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    company_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    previous_status TEXT,
    new_status TEXT,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    ai_decision_id UUID REFERENCES public.ai_decisions(id),
    idempotency_key TEXT,
    fingerprint TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT invoice_inbox_events_status_check
        CHECK (
            previous_status IS NULL OR previous_status IN ('ny', 'granskad', 'bokford', 'betald')
        ),
    CONSTRAINT invoice_inbox_events_new_status_check
        CHECK (
            new_status IS NULL OR new_status IN ('ny', 'granskad', 'bokford', 'betald')
        )
);

CREATE TABLE IF NOT EXISTS public.agi_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    company_id TEXT NOT NULL,
    period TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    source_type TEXT NOT NULL DEFAULT 'system',
    totals JSONB NOT NULL DEFAULT '{}'::jsonb,
    control_results JSONB NOT NULL DEFAULT '{}'::jsonb,
    approved_by UUID REFERENCES auth.users(id),
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT agi_runs_period_check
        CHECK (period ~ '^[0-9]{4}-[0-9]{2}$'),
    CONSTRAINT agi_runs_status_check
        CHECK (status IN ('draft', 'review_required', 'approved')),
    CONSTRAINT agi_runs_source_type_check
        CHECK (source_type IN ('system', 'fortnox', 'manual', 'hybrid'))
);

CREATE TABLE IF NOT EXISTS public.regulatory_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_key TEXT NOT NULL,
    domain TEXT NOT NULL,
    company_form TEXT NOT NULL DEFAULT 'all',
    effective_from DATE NOT NULL,
    effective_to DATE,
    legal_status TEXT NOT NULL DEFAULT 'proposed',
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    source_urls TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    last_verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT regulatory_rules_company_form_check
        CHECK (company_form IN ('ab', 'enskild', 'all')),
    CONSTRAINT regulatory_rules_status_check
        CHECK (legal_status IN ('proposed', 'active', 'sunset'))
);

CREATE TABLE IF NOT EXISTS public.auto_post_policies (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    company_id TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    min_confidence NUMERIC(4, 3) NOT NULL DEFAULT 0.880,
    max_amount_sek NUMERIC(14, 2) NOT NULL DEFAULT 25000,
    require_known_counterparty BOOLEAN NOT NULL DEFAULT TRUE,
    allow_with_active_rule_only BOOLEAN NOT NULL DEFAULT TRUE,
    require_manual_for_new_supplier BOOLEAN NOT NULL DEFAULT TRUE,
    require_manual_for_deviating_vat BOOLEAN NOT NULL DEFAULT TRUE,
    require_manual_for_locked_period BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, company_id),
    CONSTRAINT auto_post_min_confidence_check
        CHECK (min_confidence >= 0 AND min_confidence <= 1),
    CONSTRAINT auto_post_max_amount_check
        CHECK (max_amount_sek >= 0)
);

-- Generic timestamp triggers
DROP TRIGGER IF EXISTS update_accounting_profiles_updated_at ON public.accounting_profiles;
CREATE TRIGGER update_accounting_profiles_updated_at
    BEFORE UPDATE ON public.accounting_profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_bank_imports_updated_at ON public.bank_imports;
CREATE TRIGGER update_bank_imports_updated_at
    BEFORE UPDATE ON public.bank_imports
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_bank_transactions_updated_at ON public.bank_transactions;
CREATE TRIGGER update_bank_transactions_updated_at
    BEFORE UPDATE ON public.bank_transactions
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_reconciliation_periods_updated_at ON public.reconciliation_periods;
CREATE TRIGGER update_reconciliation_periods_updated_at
    BEFORE UPDATE ON public.reconciliation_periods
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_invoice_inbox_items_updated_at ON public.invoice_inbox_items;
CREATE TRIGGER update_invoice_inbox_items_updated_at
    BEFORE UPDATE ON public.invoice_inbox_items
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_agi_runs_updated_at ON public.agi_runs;
CREATE TRIGGER update_agi_runs_updated_at
    BEFORE UPDATE ON public.agi_runs
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_regulatory_rules_updated_at ON public.regulatory_rules;
CREATE TRIGGER update_regulatory_rules_updated_at
    BEFORE UPDATE ON public.regulatory_rules
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_auto_post_policies_updated_at ON public.auto_post_policies;
CREATE TRIGGER update_auto_post_policies_updated_at
    BEFORE UPDATE ON public.auto_post_policies
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.accounting_profiles IS 'Per-company accounting profile driving compliance and agent behavior.';
COMMENT ON TABLE public.bank_imports IS 'Imported bank files stored server-side for deterministic reconciliation.';
COMMENT ON TABLE public.bank_transactions IS 'Normalized bank transactions per company/import.';
COMMENT ON TABLE public.reconciliation_periods IS 'Period lock/reconciliation status for bookkeeping close flow.';
COMMENT ON TABLE public.invoice_inbox_items IS 'Server-backed supplier invoice inbox state.';
COMMENT ON TABLE public.invoice_inbox_events IS 'Append-only event log for invoice inbox status/export actions.';
COMMENT ON TABLE public.agi_runs IS 'AGI draft and approval runs with control results.';
COMMENT ON TABLE public.regulatory_rules IS 'Versioned Swedish compliance rules with legal status snapshots.';
COMMENT ON TABLE public.auto_post_policies IS 'Risk-based guardrails for autonomous bookkeeping actions.';

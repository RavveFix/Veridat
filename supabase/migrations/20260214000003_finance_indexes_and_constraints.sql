-- Finance Agent V2 indexes and uniqueness guarantees

-- accounting_profiles
CREATE INDEX IF NOT EXISTS idx_accounting_profiles_company
    ON public.accounting_profiles (company_id);

-- bank_imports
CREATE INDEX IF NOT EXISTS idx_bank_imports_user_company_imported
    ON public.bank_imports (user_id, company_id, imported_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_imports_idempotency_unique
    ON public.bank_imports (user_id, company_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

-- bank_transactions
CREATE INDEX IF NOT EXISTS idx_bank_transactions_import
    ON public.bank_transactions (import_id);

CREATE INDEX IF NOT EXISTS idx_bank_transactions_user_company_date
    ON public.bank_transactions (user_id, company_id, tx_date DESC);

CREATE INDEX IF NOT EXISTS idx_bank_transactions_match_status
    ON public.bank_transactions (user_id, company_id, match_status);

CREATE INDEX IF NOT EXISTS idx_bank_transactions_ai_decision
    ON public.bank_transactions (ai_decision_id)
    WHERE ai_decision_id IS NOT NULL;

-- reconciliation_periods
CREATE UNIQUE INDEX IF NOT EXISTS idx_reconciliation_periods_unique
    ON public.reconciliation_periods (user_id, company_id, period);

CREATE INDEX IF NOT EXISTS idx_reconciliation_periods_status
    ON public.reconciliation_periods (user_id, company_id, status, updated_at DESC);

-- invoice_inbox_items
CREATE INDEX IF NOT EXISTS idx_invoice_inbox_items_uploaded
    ON public.invoice_inbox_items (user_id, company_id, uploaded_at DESC);

CREATE INDEX IF NOT EXISTS idx_invoice_inbox_items_status
    ON public.invoice_inbox_items (user_id, company_id, status);

CREATE INDEX IF NOT EXISTS idx_invoice_inbox_items_fortnox_given
    ON public.invoice_inbox_items (user_id, company_id, fortnox_given_number)
    WHERE fortnox_given_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_invoice_inbox_items_ai_decision
    ON public.invoice_inbox_items (ai_decision_id)
    WHERE ai_decision_id IS NOT NULL;

-- invoice_inbox_events
CREATE INDEX IF NOT EXISTS idx_invoice_inbox_events_item
    ON public.invoice_inbox_events (user_id, company_id, item_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_inbox_events_idempotency_unique
    ON public.invoice_inbox_events (user_id, company_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_inbox_events_fingerprint_unique
    ON public.invoice_inbox_events (user_id, company_id, fingerprint, event_type)
    WHERE fingerprint IS NOT NULL;

-- agi_runs
CREATE UNIQUE INDEX IF NOT EXISTS idx_agi_runs_period_unique
    ON public.agi_runs (user_id, company_id, period, status);

CREATE INDEX IF NOT EXISTS idx_agi_runs_status
    ON public.agi_runs (user_id, company_id, status, created_at DESC);

-- regulatory_rules
CREATE UNIQUE INDEX IF NOT EXISTS idx_regulatory_rules_unique
    ON public.regulatory_rules (rule_key, domain, company_form, effective_from, legal_status);

CREATE INDEX IF NOT EXISTS idx_regulatory_rules_active_lookup
    ON public.regulatory_rules (domain, company_form, legal_status, effective_from DESC);

CREATE INDEX IF NOT EXISTS idx_regulatory_rules_last_verified
    ON public.regulatory_rules (last_verified_at);

-- auto_post_policies
CREATE INDEX IF NOT EXISTS idx_auto_post_policies_company
    ON public.auto_post_policies (company_id);


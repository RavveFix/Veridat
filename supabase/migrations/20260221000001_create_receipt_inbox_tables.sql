-- Receipt inbox tables for kvittoskanning feature
-- Mirrors invoice_inbox_items structure but with receipt-specific fields

-- =============================================================================
-- receipt_inbox_items — main receipt storage
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.receipt_inbox_items (
    user_id       UUID           NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    company_id    TEXT           NOT NULL,
    id            TEXT           NOT NULL,

    -- File metadata
    file_name     TEXT           NOT NULL DEFAULT '',
    file_url      TEXT           NOT NULL DEFAULT '',
    file_path     TEXT           NOT NULL DEFAULT '',
    file_bucket   TEXT           NOT NULL DEFAULT '',
    uploaded_at   TIMESTAMPTZ    NOT NULL DEFAULT now(),

    -- Status workflow: ny → granskad → bokford
    status        TEXT           NOT NULL DEFAULT 'ny'
                  CHECK (status IN ('ny', 'granskad', 'bokford')),
    source        TEXT           NOT NULL DEFAULT 'upload'
                  CHECK (source IN ('upload', 'manual')),

    -- Extracted receipt data
    merchant_name       TEXT    NOT NULL DEFAULT '',
    transaction_date    DATE,
    transaction_time    TEXT    NOT NULL DEFAULT '',
    total_amount        NUMERIC,
    vat_amount          NUMERIC,
    vat_rate            NUMERIC,
    payment_method      TEXT    NOT NULL DEFAULT '',
    category            TEXT    NOT NULL DEFAULT '',
    description         TEXT    NOT NULL DEFAULT '',
    receipt_number      TEXT    NOT NULL DEFAULT '',
    currency            TEXT    NOT NULL DEFAULT 'SEK',

    -- Accounting
    bas_account         TEXT    NOT NULL DEFAULT '',
    bas_account_name    TEXT    NOT NULL DEFAULT '',

    -- Fortnox integration (voucher-based export for receipts)
    fortnox_voucher_series  TEXT    NOT NULL DEFAULT '',
    fortnox_voucher_number  INTEGER,
    fortnox_sync_status     TEXT   NOT NULL DEFAULT 'not_exported'
                            CHECK (fortnox_sync_status IN ('not_exported', 'exported', 'booked')),

    -- AI metadata
    ai_extracted      BOOLEAN  NOT NULL DEFAULT false,
    ai_raw_response   TEXT     NOT NULL DEFAULT '',
    ai_review_note    TEXT     NOT NULL DEFAULT '',

    -- Timestamps
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),

    PRIMARY KEY (user_id, company_id, id)
);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.update_receipt_inbox_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_receipt_inbox_updated_at
    BEFORE UPDATE ON public.receipt_inbox_items
    FOR EACH ROW EXECUTE FUNCTION public.update_receipt_inbox_updated_at();

-- =============================================================================
-- receipt_inbox_events — audit log (append-only)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.receipt_inbox_events (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    company_id       TEXT        NOT NULL,
    item_id          TEXT        NOT NULL,
    event_type       TEXT        NOT NULL,
    previous_status  TEXT,
    new_status       TEXT,
    payload          JSONB       NOT NULL DEFAULT '{}',
    idempotency_key  TEXT,
    fingerprint      TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- Indexes
-- =============================================================================
CREATE INDEX idx_receipt_inbox_items_uploaded
    ON public.receipt_inbox_items (user_id, company_id, uploaded_at DESC);

CREATE INDEX idx_receipt_inbox_items_status
    ON public.receipt_inbox_items (user_id, company_id, status);

CREATE INDEX idx_receipt_inbox_events_item
    ON public.receipt_inbox_events (user_id, company_id, item_id, created_at DESC);

-- =============================================================================
-- RLS Policies
-- =============================================================================
ALTER TABLE public.receipt_inbox_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipt_inbox_events ENABLE ROW LEVEL SECURITY;

-- receipt_inbox_items: users can only see/modify their own data
CREATE POLICY receipt_inbox_items_select ON public.receipt_inbox_items
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY receipt_inbox_items_insert ON public.receipt_inbox_items
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY receipt_inbox_items_update ON public.receipt_inbox_items
    FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY receipt_inbox_items_delete ON public.receipt_inbox_items
    FOR DELETE USING (auth.uid() = user_id);

-- receipt_inbox_events: users can only see/insert their own events
CREATE POLICY receipt_inbox_events_select ON public.receipt_inbox_events
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY receipt_inbox_events_insert ON public.receipt_inbox_events
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Fortnox write hardening: idempotency, action metadata, and richer sync tracing
-- Date: 2026-02-10

ALTER TABLE public.fortnox_sync_log
    ADD COLUMN IF NOT EXISTS action_name TEXT,
    ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
    ADD COLUMN IF NOT EXISTS ip_address INET,
    ADD COLUMN IF NOT EXISTS user_agent TEXT;

UPDATE public.fortnox_sync_log
SET action_name = operation
WHERE action_name IS NULL;

ALTER TABLE public.fortnox_sync_log
    ALTER COLUMN action_name SET DEFAULT 'unknown';

-- Extend operation constraint for additional write actions
ALTER TABLE public.fortnox_sync_log
    DROP CONSTRAINT IF EXISTS fortnox_sync_log_operation_check;

ALTER TABLE public.fortnox_sync_log
    ADD CONSTRAINT fortnox_sync_log_operation_check CHECK (operation IN (
        'export_voucher',
        'export_supplier_invoice',
        'book_supplier_invoice',
        'approve_supplier_invoice_bookkeep',
        'approve_supplier_invoice_payment',
        'register_invoice_payment',
        'register_supplier_invoice_payment',
        'create_invoice',
        'create_supplier',
        'create_customer',
        'create_article',
        'update_voucher',
        'import_vouchers',
        'import_supplier_invoices'
    ));

-- Keep only one active row per idempotency key to allow unique guard creation
WITH ranked AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY user_id, company_id, operation, idempotency_key
            ORDER BY created_at DESC
        ) AS rn
    FROM public.fortnox_sync_log
    WHERE idempotency_key IS NOT NULL
      AND status IN ('pending', 'in_progress', 'success')
)
UPDATE public.fortnox_sync_log AS f
SET
    status = 'cancelled',
    error_code = COALESCE(f.error_code, 'DEDUPED_BY_MIGRATION'),
    error_message = COALESCE(f.error_message, 'Cancelled due to idempotency key dedupe migration'),
    completed_at = COALESCE(f.completed_at, NOW())
FROM ranked r
WHERE f.id = r.id
  AND r.rn > 1;

CREATE INDEX IF NOT EXISTS idx_fortnox_sync_action_name
    ON public.fortnox_sync_log(action_name);

CREATE INDEX IF NOT EXISTS idx_fortnox_sync_idempotency_lookup
    ON public.fortnox_sync_log(user_id, company_id, operation, idempotency_key, created_at DESC)
    WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_fortnox_sync_idempotency_active_unique
    ON public.fortnox_sync_log(user_id, company_id, operation, idempotency_key)
    WHERE idempotency_key IS NOT NULL
      AND status IN ('pending', 'in_progress', 'success');

COMMENT ON COLUMN public.fortnox_sync_log.action_name IS 'API action name in the fortnox edge function';
COMMENT ON COLUMN public.fortnox_sync_log.idempotency_key IS 'Client-provided or server-generated key for write deduplication';
COMMENT ON COLUMN public.fortnox_sync_log.ip_address IS 'Requester IP captured by edge function';
COMMENT ON COLUMN public.fortnox_sync_log.user_agent IS 'Requester user-agent captured by edge function';

-- Add 'update_invoice' to the fortnox_sync_log operation check constraint
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
        'update_invoice',
        'create_supplier',
        'create_customer',
        'create_article',
        'update_voucher',
        'import_vouchers',
        'import_supplier_invoices'
    ));

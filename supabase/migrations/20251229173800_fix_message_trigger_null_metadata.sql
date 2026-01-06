-- Migration: Fix message trigger NULL metadata bug
-- Date: 2025-12-29
-- Author: Claude Code
--
-- Problem:
-- The trigger `update_conversation_stats_from_message()` crashed when inserting
-- messages with NULL metadata. This caused ALL message inserts to fail silently,
-- which also prevented smart title generation from running.
--
-- Root Cause:
-- The expression `(NEW.metadata->>'type' = 'vat_report')` returns NULL (not FALSE)
-- when metadata is NULL. Combined with OR: `FALSE OR NULL = NULL`, which violated
-- the NOT NULL constraint on `has_vat_report` column.
--
-- Fix:
-- Wrap the metadata check in COALESCE to ensure it always returns a boolean.

CREATE OR REPLACE FUNCTION update_conversation_stats_from_message()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.conversations
    SET
        updated_at = NOW(),
        message_count = COALESCE(message_count, 0) + 1,
        has_file_upload = COALESCE(has_file_upload, FALSE) OR (NEW.file_url IS NOT NULL OR NEW.file_name IS NOT NULL),
        -- Fix: Wrap metadata check in COALESCE to handle NULL metadata
        has_vat_report = COALESCE(has_vat_report, FALSE) OR COALESCE((NEW.metadata->>'type' = 'vat_report'), FALSE)
    WHERE id = NEW.conversation_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Also fix any existing conversations with NULL has_vat_report
UPDATE conversations
SET has_vat_report = FALSE
WHERE has_vat_report IS NULL;

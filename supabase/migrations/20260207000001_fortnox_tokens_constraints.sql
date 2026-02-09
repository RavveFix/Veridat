-- Fortnox tokens: add UNIQUE constraint, index, and tracking columns
-- Required for atomic upsert and optimistic locking in token refresh

-- Add UNIQUE constraint on user_id (prevents duplicate token rows per user)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fortnox_tokens_user_id_unique'
  ) THEN
    ALTER TABLE fortnox_tokens
      ADD CONSTRAINT fortnox_tokens_user_id_unique UNIQUE (user_id);
  END IF;
END
$$;

-- Add index on expires_at for efficient token expiry queries
CREATE INDEX IF NOT EXISTS idx_fortnox_tokens_expires_at
  ON fortnox_tokens (expires_at);

-- Add tracking columns for refresh monitoring
ALTER TABLE fortnox_tokens
  ADD COLUMN IF NOT EXISTS last_refresh_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS refresh_count INTEGER DEFAULT 0;

-- Migration: Add separate hourly/daily tracking columns to api_usage
-- This fixes the rate limiter to properly track hourly and daily limits independently

-- Add new columns for separate tracking
ALTER TABLE api_usage
    ADD COLUMN IF NOT EXISTS hourly_count INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS daily_count INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS hourly_reset TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS daily_reset TIMESTAMPTZ DEFAULT NOW();

-- Initialize new columns with existing data
UPDATE api_usage SET
    hourly_count = request_count,
    daily_count = request_count,
    hourly_reset = last_reset,
    daily_reset = last_reset
WHERE hourly_count IS NULL OR daily_count IS NULL;

-- Add NOT NULL constraints after initialization
ALTER TABLE api_usage
    ALTER COLUMN hourly_count SET NOT NULL,
    ALTER COLUMN daily_count SET NOT NULL,
    ALTER COLUMN hourly_reset SET NOT NULL,
    ALTER COLUMN daily_reset SET NOT NULL;

-- Update comments
COMMENT ON COLUMN api_usage.hourly_count IS 'Number of requests in current hour window';
COMMENT ON COLUMN api_usage.daily_count IS 'Number of requests in current day window';
COMMENT ON COLUMN api_usage.hourly_reset IS 'Timestamp when hourly counter was last reset';
COMMENT ON COLUMN api_usage.daily_reset IS 'Timestamp when daily counter was last reset';

-- Note: request_count and last_reset are kept for backwards compatibility
-- They can be removed in a future migration once all code is updated

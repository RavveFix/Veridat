-- API Usage Tracking Table for Rate Limiting
-- Migration: Create api_usage table

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create api_usage table
CREATE TABLE IF NOT EXISTS api_usage (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    company_id TEXT,
    endpoint TEXT NOT NULL,
    request_count INTEGER DEFAULT 1,
    last_reset TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for fast lookups by user and endpoint
CREATE INDEX IF NOT EXISTS idx_api_usage_user_endpoint 
    ON api_usage(user_id, endpoint);

-- Create index for cleanup queries
CREATE INDEX IF NOT EXISTS idx_api_usage_last_reset 
    ON api_usage(last_reset);

-- Enable Row Level Security
ALTER TABLE api_usage ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for idempotency)
DROP POLICY IF EXISTS "Users can view own usage" ON api_usage;
DROP POLICY IF EXISTS "Service role has full access" ON api_usage;

-- Policy: Users can only view their own usage
CREATE POLICY "Users can view own usage"
    ON api_usage FOR SELECT
    USING (auth.uid() = user_id);

-- Policy: Service role can do everything (for Edge Functions)
CREATE POLICY "Service role has full access"
    ON api_usage FOR ALL
    USING (auth.role() = 'service_role');

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to call the function before update
DROP TRIGGER IF EXISTS update_api_usage_updated_at ON api_usage;
CREATE TRIGGER update_api_usage_updated_at
    BEFORE UPDATE ON api_usage
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Optional: Function to clean up old usage records (>30 days)
CREATE OR REPLACE FUNCTION cleanup_old_api_usage()
RETURNS void AS $$
BEGIN
    DELETE FROM api_usage
    WHERE last_reset < NOW() - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql;

-- Comment on table
COMMENT ON TABLE api_usage IS 'Tracks API usage per user for rate limiting purposes';
COMMENT ON COLUMN api_usage.user_id IS 'User ID from auth.users';
COMMENT ON COLUMN api_usage.endpoint IS 'API endpoint name (e.g., gemini-chat, fortnox)';
COMMENT ON COLUMN api_usage.request_count IS 'Number of requests since last reset';
COMMENT ON COLUMN api_usage.last_reset IS 'Timestamp of last counter reset';

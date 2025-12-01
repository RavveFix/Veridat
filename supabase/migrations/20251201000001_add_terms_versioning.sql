-- Add terms version tracking and email confirmation to profiles
-- Migration: 20251201000001_add_terms_versioning.sql

-- Add version tracking and email confirmation columns to profiles table
ALTER TABLE profiles 
  ADD COLUMN terms_version TEXT,
  ADD COLUMN consent_email_sent BOOLEAN DEFAULT false,
  ADD COLUMN consent_email_sent_at TIMESTAMP WITH TIME ZONE;

-- Create terms_versions table for audit trail and version management
CREATE TABLE terms_versions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  version TEXT NOT NULL UNIQUE,
  effective_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  terms_url TEXT,
  privacy_url TEXT,
  change_summary TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert current version as baseline
INSERT INTO terms_versions (version, terms_url, privacy_url, change_summary)
VALUES (
  '1.0.0', 
  '/terms.html', 
  '/privacy.html', 
  'Initial terms version - baseline for GDPR compliance tracking'
);

-- Add index for faster version lookups
CREATE INDEX idx_profiles_terms_version ON profiles(terms_version);

-- Add index for email confirmation tracking
CREATE INDEX idx_profiles_consent_email ON profiles(consent_email_sent);

-- Comment on new columns for documentation
COMMENT ON COLUMN profiles.terms_version IS 'Version of terms/privacy policy that user accepted';
COMMENT ON COLUMN profiles.consent_email_sent IS 'Whether consent confirmation email was successfully sent';
COMMENT ON COLUMN profiles.consent_email_sent_at IS 'Timestamp when consent confirmation email was sent';
COMMENT ON TABLE terms_versions IS 'Audit trail of all terms and privacy policy versions';

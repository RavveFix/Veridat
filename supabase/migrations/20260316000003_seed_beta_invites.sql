-- Migration: Seed initial beta invitation codes
-- Date: 2026-03-16

INSERT INTO public.beta_invites (code, label, max_uses) VALUES
  ('VERIDAT-BETA-2026', 'Allmän beta-kod', 100),
  ('VERIDAT-FORTNOX',   'Fortnox-forum',   50),
  ('VERIDAT-EV',        'EV-laddning',     50)
ON CONFLICT (code) DO NOTHING;

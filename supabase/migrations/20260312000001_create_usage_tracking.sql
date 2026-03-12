-- Usage Tracking & Plan Limits
-- Tracks monthly usage (AI messages, Fortnox API calls) for billing/analytics.
-- Separate from api_usage which handles hourly/daily rate limiting.

-- =============================================================================
-- plan_limits: reference table with per-plan monthly quotas
-- =============================================================================
CREATE TABLE public.plan_limits (
  plan TEXT PRIMARY KEY CHECK (plan IN ('free', 'pro', 'trial', 'enterprise')),
  ai_messages_per_month INTEGER NOT NULL,
  fortnox_reads_per_month INTEGER NOT NULL,
  fortnox_writes_per_month INTEGER NOT NULL
);

INSERT INTO public.plan_limits VALUES
  ('free',       50,   100,  10),
  ('pro',        500,  1000, 100),
  ('trial',      500,  1000, 100),
  ('enterprise', -1,   -1,   -1);  -- -1 = unlimited

ALTER TABLE public.plan_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read plan limits" ON public.plan_limits
  FOR SELECT USING (true);

-- =============================================================================
-- usage_tracking: event-level log for monthly aggregation
-- =============================================================================
CREATE TABLE public.usage_tracking (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id TEXT,  -- informational only; companies has composite PK so no FK
  event_type TEXT NOT NULL CHECK (event_type IN ('ai_message', 'fortnox_read', 'fortnox_write')),
  tool_name TEXT,
  tokens_used INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_usage_tracking_user_created
  ON public.usage_tracking (user_id, created_at);

CREATE INDEX idx_usage_tracking_monthly
  ON public.usage_tracking (user_id, event_type, created_at);

ALTER TABLE public.usage_tracking ENABLE ROW LEVEL SECURITY;

-- Users can read their own usage
CREATE POLICY "Users can view own usage" ON public.usage_tracking
  FOR SELECT USING ((SELECT auth.uid()) = user_id);

-- Only allow users to insert their own usage (belt-and-suspenders;
-- Edge Functions use service_role which bypasses RLS entirely)
CREATE POLICY "Users can only insert own usage" ON public.usage_tracking
  FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);

-- =============================================================================
-- get_monthly_usage: efficient aggregation function
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_monthly_usage(p_user_id UUID)
RETURNS TABLE (event_type TEXT, count BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ut.event_type, COUNT(*)
  FROM usage_tracking ut
  WHERE ut.user_id = p_user_id
    AND ut.created_at >= date_trunc('month', now())
  GROUP BY ut.event_type;
$$;

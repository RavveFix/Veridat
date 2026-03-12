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

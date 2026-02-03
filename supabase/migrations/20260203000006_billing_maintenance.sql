-- Billing maintenance job: apply grace + trial expiry
-- Date: 2026-02-03

CREATE OR REPLACE FUNCTION public.run_billing_maintenance()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    now_ts TIMESTAMPTZ := NOW();
    moved_to_past_due INTEGER := 0;
    downgraded_after_grace INTEGER := 0;
    trial_expired INTEGER := 0;
BEGIN
    -- 1) Pro -> past_due when period ends
    WITH updated AS (
        UPDATE public.profiles
        SET
            billing_status = 'past_due',
            grace_until = COALESCE(grace_until, period_end + INTERVAL '14 days')
        WHERE plan = 'pro'
          AND billing_status = 'active'
          AND period_end IS NOT NULL
          AND period_end < now_ts
        RETURNING 1
    )
    SELECT COUNT(*) INTO moved_to_past_due FROM updated;

    -- 2) Past due -> suspended/free after grace
    WITH updated AS (
        UPDATE public.profiles
        SET
            plan = 'free',
            billing_status = 'suspended',
            period_end = NULL,
            grace_until = NULL,
            trial_end = NULL
        WHERE billing_status = 'past_due'
          AND grace_until IS NOT NULL
          AND grace_until < now_ts
        RETURNING 1
    )
    SELECT COUNT(*) INTO downgraded_after_grace FROM updated;

    -- 3) Trial expiry -> free
    WITH updated AS (
        UPDATE public.profiles
        SET
            plan = 'free',
            billing_status = 'active',
            trial_end = NULL,
            period_end = NULL,
            grace_until = NULL
        WHERE plan = 'trial'
          AND trial_end IS NOT NULL
          AND trial_end < now_ts
        RETURNING 1
    )
    SELECT COUNT(*) INTO trial_expired FROM updated;

    RETURN jsonb_build_object(
        'moved_to_past_due', moved_to_past_due,
        'downgraded_after_grace', downgraded_after_grace,
        'trial_expired', trial_expired
    );
END;
$$;

ALTER FUNCTION public.run_billing_maintenance() SET search_path = public;

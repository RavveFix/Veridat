-- Fix: Prevent tampering with already-decided skill approvals.
-- Users can update their own approvals (needed for approve/reject flow),
-- but only when the current status is 'pending'.
-- Once approved/rejected, the record becomes immutable.

CREATE OR REPLACE FUNCTION public.validate_skill_approval_update()
RETURNS TRIGGER AS $$
BEGIN
    -- Only allow updates when current status is 'pending'
    IF OLD.status <> 'pending' THEN
        RAISE EXCEPTION 'Cannot modify a decided approval (current status: %)', OLD.status;
    END IF;

    -- New status must be 'approved' or 'rejected'
    IF NEW.status NOT IN ('approved', 'rejected') THEN
        RAISE EXCEPTION 'Invalid approval status transition: % -> %', OLD.status, NEW.status;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS validate_skill_approval_update_trigger ON public.skill_approvals;
CREATE TRIGGER validate_skill_approval_update_trigger
    BEFORE UPDATE ON public.skill_approvals
    FOR EACH ROW
    EXECUTE FUNCTION public.validate_skill_approval_update();

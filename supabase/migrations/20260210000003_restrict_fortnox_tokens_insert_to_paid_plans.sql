-- Restrict Fortnox token creation to paid plans (pro/trial).
-- Legacy free users can still delete their own tokens via existing DELETE policy.

DROP POLICY IF EXISTS "Users can insert their own tokens" ON public.fortnox_tokens;

CREATE POLICY "Users can insert their own tokens"
    ON public.fortnox_tokens
    FOR INSERT
    WITH CHECK (
        (SELECT auth.uid()) = user_id
        AND EXISTS (
            SELECT 1
            FROM public.profiles
            WHERE profiles.id = user_id
              AND profiles.plan IN ('pro', 'trial')
        )
    );

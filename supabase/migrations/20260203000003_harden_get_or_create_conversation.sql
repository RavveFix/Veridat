-- Harden get_or_create_conversation to rely on auth.uid() (ignore client-supplied user_id)
-- Date: 2026-02-03

CREATE OR REPLACE FUNCTION public.get_or_create_conversation(
    p_user_id UUID,
    p_company_id TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_conversation_id UUID;
    v_user_id UUID;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;

    -- Try to find existing conversation for the authenticated user
    SELECT id INTO v_conversation_id
    FROM public.conversations
    WHERE user_id = v_user_id
    AND (
        (company_id IS NULL AND p_company_id IS NULL) OR
        (company_id = p_company_id)
    )
    ORDER BY updated_at DESC
    LIMIT 1;

    -- If no conversation found, create one
    IF v_conversation_id IS NULL THEN
        INSERT INTO public.conversations (user_id, company_id)
        VALUES (v_user_id, p_company_id)
        RETURNING id INTO v_conversation_id;
    END IF;

    RETURN v_conversation_id;
END;
$$;

ALTER FUNCTION public.get_or_create_conversation(UUID, TEXT) SET search_path = public;
GRANT EXECUTE ON FUNCTION public.get_or_create_conversation(UUID, TEXT) TO authenticated;

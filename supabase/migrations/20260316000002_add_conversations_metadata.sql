-- Add metadata jsonb column to conversations for conversation state tracking
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Add comment for documentation
COMMENT ON COLUMN public.conversations.metadata IS 'Stores conversation_state and other metadata. States: idle, file_analysis, awaiting_input, action_plan_pending';

-- Helper function for atomic jsonb key update (avoids read-modify-write race conditions)
CREATE OR REPLACE FUNCTION public.set_conversation_state(
  p_conversation_id uuid,
  p_state text
) RETURNS void AS $$
BEGIN
  UPDATE public.conversations
  SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('conversation_state', p_state)
  WHERE id = p_conversation_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

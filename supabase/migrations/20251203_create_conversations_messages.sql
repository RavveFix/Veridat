-- Create conversations table
CREATE TABLE IF NOT EXISTS public.conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    company_id TEXT,
    title TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create messages table
CREATE TABLE IF NOT EXISTS public.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    file_url TEXT,
    file_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON public.conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_company_id ON public.conversations(company_id);
CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON public.conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON public.messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON public.messages(created_at);

-- Create updated_at trigger function if it doesn't exist
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for conversations.updated_at
DROP TRIGGER IF EXISTS update_conversations_updated_at ON public.conversations;
CREATE TRIGGER update_conversations_updated_at
    BEFORE UPDATE ON public.conversations
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- Enable RLS
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- RLS Policies for conversations
-- Drop existing policies first to make migration idempotent
DROP POLICY IF EXISTS "Users can view own conversations" ON public.conversations;
DROP POLICY IF EXISTS "Users can create own conversations" ON public.conversations;
DROP POLICY IF EXISTS "Users can update own conversations" ON public.conversations;
DROP POLICY IF EXISTS "Users can delete own conversations" ON public.conversations;

-- Users can see their own conversations
CREATE POLICY "Users can view own conversations"
    ON public.conversations
    FOR SELECT
    USING (auth.uid() = user_id);

-- Users can create their own conversations
CREATE POLICY "Users can create own conversations"
    ON public.conversations
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Users can update their own conversations
CREATE POLICY "Users can update own conversations"
    ON public.conversations
    FOR UPDATE
    USING (auth.uid() = user_id);

-- Users can delete their own conversations
CREATE POLICY "Users can delete own conversations"
    ON public.conversations
    FOR DELETE
    USING (auth.uid() = user_id);

-- RLS Policies for messages
-- Drop existing policies first to make migration idempotent
DROP POLICY IF EXISTS "Users can view messages in own conversations" ON public.messages;
DROP POLICY IF EXISTS "Users can insert messages in own conversations" ON public.messages;
DROP POLICY IF EXISTS "Users can delete messages in own conversations" ON public.messages;

-- Users can view messages in their conversations
CREATE POLICY "Users can view messages in own conversations"
    ON public.messages
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.conversations
            WHERE conversations.id = messages.conversation_id
            AND conversations.user_id = auth.uid()
        )
    );

-- Users can insert messages in their conversations
CREATE POLICY "Users can insert messages in own conversations"
    ON public.messages
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.conversations
            WHERE conversations.id = messages.conversation_id
            AND conversations.user_id = auth.uid()
        )
    );

-- Users can delete messages in their conversations
CREATE POLICY "Users can delete messages in own conversations"
    ON public.messages
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM public.conversations
            WHERE conversations.id = messages.conversation_id
            AND conversations.user_id = auth.uid()
        )
    );

-- Create get_or_create_conversation function
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
BEGIN
    -- Try to find existing conversation
    SELECT id INTO v_conversation_id
    FROM public.conversations
    WHERE user_id = p_user_id
    AND (
        (company_id IS NULL AND p_company_id IS NULL) OR
        (company_id = p_company_id)
    )
    ORDER BY updated_at DESC
    LIMIT 1;

    -- If no conversation found, create one
    IF v_conversation_id IS NULL THEN
        INSERT INTO public.conversations (user_id, company_id)
        VALUES (p_user_id, p_company_id)
        RETURNING id INTO v_conversation_id;
    END IF;

    RETURN v_conversation_id;
END;
$$;

-- Grant execute permission on the function
GRANT EXECUTE ON FUNCTION public.get_or_create_conversation(UUID, TEXT) TO authenticated;

-- Comment on tables
COMMENT ON TABLE public.conversations IS 'User conversations with Britta AI assistant';
COMMENT ON TABLE public.messages IS 'Messages within conversations (user and assistant messages)';

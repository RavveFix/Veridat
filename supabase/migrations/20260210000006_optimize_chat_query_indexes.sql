-- Improve performance for chat-heavy query patterns in frontend + edge functions.
-- Date: 2026-02-10
BEGIN;

-- Conversation list queries:
-- WHERE user_id = ? [AND company_id = ?] ORDER BY updated_at DESC LIMIT N
CREATE INDEX IF NOT EXISTS idx_conversations_user_company_updated_at
    ON public.conversations(user_id, company_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversations_user_updated_at
    ON public.conversations(user_id, updated_at DESC);

-- Message timeline queries:
-- WHERE conversation_id = ? ORDER BY created_at DESC LIMIT N
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created_at_desc
    ON public.messages(conversation_id, created_at DESC);

-- First-user-message/title queries:
-- WHERE conversation_id = ? AND role = 'user' ORDER BY created_at ASC LIMIT 1
CREATE INDEX IF NOT EXISTS idx_messages_conversation_role_created_at
    ON public.messages(conversation_id, role, created_at);

COMMIT;

-- Memory system: user memories, search vectors, and conversation metadata

-- Enable pgvector for embeddings (if available)
CREATE EXTENSION IF NOT EXISTS vector;

-- User memories (personalized context per company)
CREATE TABLE IF NOT EXISTS public.user_memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    company_id TEXT NOT NULL,
    category TEXT NOT NULL,
    content TEXT NOT NULL,
    source_conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
    confidence REAL NOT NULL DEFAULT 1.0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    embedding VECTOR(1536),
    CONSTRAINT user_memories_category_check CHECK (
        category IN ('work_context', 'preferences', 'history', 'top_of_mind', 'user_defined')
    )
);

CREATE INDEX IF NOT EXISTS idx_user_memories_user_company
    ON public.user_memories (user_id, company_id);

CREATE INDEX IF NOT EXISTS idx_user_memories_category
    ON public.user_memories (category);

CREATE INDEX IF NOT EXISTS idx_user_memories_embedding
    ON public.user_memories
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Maintain updated_at for user memories
DROP TRIGGER IF EXISTS update_user_memories_updated_at ON public.user_memories;
CREATE TRIGGER update_user_memories_updated_at
    BEFORE UPDATE ON public.user_memories
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- User memory edits (manual add/remove/replace)
CREATE TABLE IF NOT EXISTS public.memory_user_edits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    company_id TEXT NOT NULL,
    edit_type TEXT NOT NULL CHECK (edit_type IN ('add', 'remove', 'replace')),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_memory_user_edits_user_company
    ON public.memory_user_edits (user_id, company_id);

-- Extend conversations with summary, counts, and search fields
ALTER TABLE public.conversations
    ADD COLUMN IF NOT EXISTS summary TEXT,
    ADD COLUMN IF NOT EXISTS message_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS has_file_upload BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS has_vat_report BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS search_vector TSVECTOR,
    ADD COLUMN IF NOT EXISTS embedding VECTOR(1536);

-- Extend messages with search fields
ALTER TABLE public.messages
    ADD COLUMN IF NOT EXISTS search_vector TSVECTOR,
    ADD COLUMN IF NOT EXISTS embedding VECTOR(1536);

-- Search vector triggers
CREATE OR REPLACE FUNCTION public.update_message_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector := to_tsvector('swedish', COALESCE(NEW.content, ''));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS messages_search_update ON public.messages;
CREATE TRIGGER messages_search_update
    BEFORE INSERT OR UPDATE ON public.messages
    FOR EACH ROW
    EXECUTE FUNCTION public.update_message_search_vector();

CREATE OR REPLACE FUNCTION public.update_conversation_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector := to_tsvector(
        'swedish',
        COALESCE(NEW.title, '') || ' ' || COALESCE(NEW.summary, '')
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS conversations_search_update ON public.conversations;
CREATE TRIGGER conversations_search_update
    BEFORE INSERT OR UPDATE ON public.conversations
    FOR EACH ROW
    EXECUTE FUNCTION public.update_conversation_search_vector();

-- Conversation stats (updated_at, message_count, file/vat flags) from message inserts
CREATE OR REPLACE FUNCTION public.update_conversation_stats_from_message()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.conversations
    SET
        updated_at = NOW(),
        message_count = COALESCE(message_count, 0) + 1,
        has_file_upload = COALESCE(has_file_upload, FALSE) OR (NEW.file_url IS NOT NULL OR NEW.file_name IS NOT NULL),
        has_vat_report = COALESCE(has_vat_report, FALSE) OR (NEW.metadata->>'type' = 'vat_report')
    WHERE id = NEW.conversation_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS messages_conversation_stats_update ON public.messages;
CREATE TRIGGER messages_conversation_stats_update
    AFTER INSERT ON public.messages
    FOR EACH ROW
    EXECUTE FUNCTION public.update_conversation_stats_from_message();

-- Backfill search vectors for existing rows
UPDATE public.messages
SET search_vector = to_tsvector('swedish', COALESCE(content, ''))
WHERE search_vector IS NULL;

UPDATE public.conversations
SET search_vector = to_tsvector('swedish', COALESCE(title, '') || ' ' || COALESCE(summary, ''))
WHERE search_vector IS NULL;

-- Backfill conversation stats for existing rows
UPDATE public.conversations AS c
SET
    message_count = COALESCE(stats.message_count, 0),
    has_file_upload = COALESCE(stats.has_file_upload, FALSE),
    has_vat_report = COALESCE(stats.has_vat_report, FALSE)
FROM (
    SELECT
        conversation_id,
        COUNT(*)::INTEGER AS message_count,
        COALESCE(BOOL_OR(file_url IS NOT NULL OR file_name IS NOT NULL), FALSE) AS has_file_upload,
        COALESCE(BOOL_OR((metadata->>'type') = 'vat_report'), FALSE) AS has_vat_report
    FROM public.messages
    GROUP BY conversation_id
) AS stats
WHERE c.id = stats.conversation_id;

-- Indexes for search and embeddings
CREATE INDEX IF NOT EXISTS idx_conversations_search_vector
    ON public.conversations USING GIN (search_vector);

CREATE INDEX IF NOT EXISTS idx_messages_search_vector
    ON public.messages USING GIN (search_vector);

CREATE INDEX IF NOT EXISTS idx_conversations_embedding
    ON public.conversations
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_messages_embedding
    ON public.messages
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Enable RLS for new tables
ALTER TABLE public.user_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memory_user_edits ENABLE ROW LEVEL SECURITY;

-- Policies for user_memories
DROP POLICY IF EXISTS "Users can view own user memories" ON public.user_memories;
DROP POLICY IF EXISTS "Users can insert own user memories" ON public.user_memories;
DROP POLICY IF EXISTS "Users can update own user memories" ON public.user_memories;
DROP POLICY IF EXISTS "Users can delete own user memories" ON public.user_memories;

CREATE POLICY "Users can view own user memories"
    ON public.user_memories
    FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own user memories"
    ON public.user_memories
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own user memories"
    ON public.user_memories
    FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own user memories"
    ON public.user_memories
    FOR DELETE
    USING (auth.uid() = user_id);

-- Policies for memory_user_edits
DROP POLICY IF EXISTS "Users can view own memory edits" ON public.memory_user_edits;
DROP POLICY IF EXISTS "Users can insert own memory edits" ON public.memory_user_edits;
DROP POLICY IF EXISTS "Users can delete own memory edits" ON public.memory_user_edits;

CREATE POLICY "Users can view own memory edits"
    ON public.memory_user_edits
    FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own memory edits"
    ON public.memory_user_edits
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own memory edits"
    ON public.memory_user_edits
    FOR DELETE
    USING (auth.uid() = user_id);

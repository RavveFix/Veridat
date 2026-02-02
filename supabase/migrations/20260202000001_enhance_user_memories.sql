-- Enhance user_memories with tier/importance/expiry for better memory retrieval

ALTER TABLE public.user_memories
    ADD COLUMN IF NOT EXISTS memory_tier TEXT NOT NULL DEFAULT 'fact',
    ADD COLUMN IF NOT EXISTS importance REAL NOT NULL DEFAULT 0.5,
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'user_memories_memory_tier_check'
    ) THEN
        ALTER TABLE public.user_memories
            ADD CONSTRAINT user_memories_memory_tier_check
            CHECK (memory_tier IN ('profile', 'project', 'episodic', 'fact'));
    END IF;
END $$;

UPDATE public.user_memories
SET memory_tier = CASE category
        WHEN 'preferences' THEN 'profile'
        WHEN 'user_defined' THEN 'profile'
        WHEN 'work_context' THEN 'fact'
        WHEN 'history' THEN 'episodic'
        WHEN 'top_of_mind' THEN 'project'
        ELSE 'fact'
    END,
    importance = CASE category
        WHEN 'work_context' THEN GREATEST(importance, 0.75)
        WHEN 'preferences' THEN GREATEST(importance, 0.7)
        WHEN 'history' THEN GREATEST(importance, 0.6)
        WHEN 'top_of_mind' THEN GREATEST(importance, 0.6)
        WHEN 'user_defined' THEN GREATEST(importance, 0.85)
        ELSE importance
    END;

CREATE INDEX IF NOT EXISTS idx_user_memories_expires_at
    ON public.user_memories (expires_at);

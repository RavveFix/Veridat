ALTER TABLE public.skills
ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'automation';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'skills_kind_check'
    ) THEN
        ALTER TABLE public.skills
        ADD CONSTRAINT skills_kind_check
        CHECK (kind IN ('skill', 'automation'));
    END IF;
END $$;

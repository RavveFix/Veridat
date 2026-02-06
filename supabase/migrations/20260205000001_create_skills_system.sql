-- Skills + approvals + memory items + usage tracking

-- ============================================================================
-- SKILLS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft',
    scope TEXT NOT NULL DEFAULT 'company',
    visibility TEXT NOT NULL DEFAULT 'private',
    input_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
    output_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
    allowed_actions TEXT[] NOT NULL DEFAULT '{}',
    requires_approval BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT skills_status_check CHECK (status IN ('draft', 'active', 'deprecated', 'archived')),
    CONSTRAINT skills_scope_check CHECK (scope IN ('user', 'company', 'org')),
    CONSTRAINT skills_visibility_check CHECK (visibility IN ('private', 'company', 'org'))
);

CREATE INDEX IF NOT EXISTS idx_skills_user_company
    ON public.skills (user_id, company_id);

CREATE INDEX IF NOT EXISTS idx_skills_status
    ON public.skills (status);

DROP TRIGGER IF EXISTS update_skills_updated_at ON public.skills;
CREATE TRIGGER update_skills_updated_at
    BEFORE UPDATE ON public.skills
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.skills ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own skills" ON public.skills;
DROP POLICY IF EXISTS "Users can insert own skills" ON public.skills;
DROP POLICY IF EXISTS "Users can update own skills" ON public.skills;
DROP POLICY IF EXISTS "Users can delete own skills" ON public.skills;

CREATE POLICY "Users can view own skills"
    ON public.skills
    FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own skills"
    ON public.skills
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own skills"
    ON public.skills
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own skills"
    ON public.skills
    FOR DELETE
    USING (auth.uid() = user_id);

-- ============================================================================
-- SKILL RUNS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.skill_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    skill_id UUID NOT NULL REFERENCES public.skills(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    company_id TEXT NOT NULL,
    triggered_by TEXT NOT NULL DEFAULT 'user',
    status TEXT NOT NULL DEFAULT 'preview',
    input_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    preview_output JSONB,
    output_payload JSONB,
    input_hash TEXT,
    preview_hash TEXT,
    ai_decision_id UUID,
    error_code TEXT,
    error_message TEXT,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT skill_runs_triggered_by_check CHECK (triggered_by IN ('user', 'ai', 'schedule', 'system')),
    CONSTRAINT skill_runs_status_check CHECK (status IN ('preview', 'pending_approval', 'running', 'succeeded', 'failed', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_skill_runs_skill
    ON public.skill_runs (skill_id);

CREATE INDEX IF NOT EXISTS idx_skill_runs_user_company
    ON public.skill_runs (user_id, company_id);

CREATE INDEX IF NOT EXISTS idx_skill_runs_status
    ON public.skill_runs (status);

CREATE INDEX IF NOT EXISTS idx_skill_runs_created_at
    ON public.skill_runs (created_at DESC);

DROP TRIGGER IF EXISTS update_skill_runs_updated_at ON public.skill_runs;
CREATE TRIGGER update_skill_runs_updated_at
    BEFORE UPDATE ON public.skill_runs
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.skill_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own skill runs" ON public.skill_runs;
DROP POLICY IF EXISTS "Users can insert own skill runs" ON public.skill_runs;
DROP POLICY IF EXISTS "Users can update own skill runs" ON public.skill_runs;
DROP POLICY IF EXISTS "Users can delete own skill runs" ON public.skill_runs;

CREATE POLICY "Users can view own skill runs"
    ON public.skill_runs
    FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own skill runs"
    ON public.skill_runs
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own skill runs"
    ON public.skill_runs
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own skill runs"
    ON public.skill_runs
    FOR DELETE
    USING (auth.uid() = user_id);

-- ============================================================================
-- SKILL APPROVALS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.skill_approvals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES public.skill_runs(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    company_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    required_role TEXT NOT NULL DEFAULT 'owner',
    required_count INTEGER NOT NULL DEFAULT 1,
    approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    comment TEXT,
    input_hash TEXT,
    preview_hash TEXT,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT skill_approvals_status_check CHECK (status IN ('pending', 'approved', 'rejected', 'expired'))
);

CREATE INDEX IF NOT EXISTS idx_skill_approvals_run
    ON public.skill_approvals (run_id);

CREATE INDEX IF NOT EXISTS idx_skill_approvals_status
    ON public.skill_approvals (status);

CREATE INDEX IF NOT EXISTS idx_skill_approvals_user_company
    ON public.skill_approvals (user_id, company_id);

DROP TRIGGER IF EXISTS update_skill_approvals_updated_at ON public.skill_approvals;
CREATE TRIGGER update_skill_approvals_updated_at
    BEFORE UPDATE ON public.skill_approvals
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.skill_approvals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own skill approvals" ON public.skill_approvals;
DROP POLICY IF EXISTS "Users can insert own skill approvals" ON public.skill_approvals;
DROP POLICY IF EXISTS "Users can update own skill approvals" ON public.skill_approvals;
DROP POLICY IF EXISTS "Users can delete own skill approvals" ON public.skill_approvals;

CREATE POLICY "Users can view own skill approvals"
    ON public.skill_approvals
    FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own skill approvals"
    ON public.skill_approvals
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own skill approvals"
    ON public.skill_approvals
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own skill approvals"
    ON public.skill_approvals
    FOR DELETE
    USING (auth.uid() = user_id);

-- ============================================================================
-- MEMORY ITEMS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.memory_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    company_id TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'company',
    category TEXT NOT NULL,
    memory_type TEXT NOT NULL DEFAULT 'explicit',
    status TEXT NOT NULL DEFAULT 'active',
    content TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    importance REAL NOT NULL DEFAULT 0.7,
    confidence REAL NOT NULL DEFAULT 0.7,
    source_type TEXT NOT NULL DEFAULT 'manual',
    source_id TEXT,
    created_by TEXT NOT NULL DEFAULT 'user',
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT memory_items_scope_check CHECK (scope IN ('user', 'company', 'org')),
    CONSTRAINT memory_items_category_check CHECK (category IN ('work_context', 'preferences', 'history', 'top_of_mind', 'user_defined')),
    CONSTRAINT memory_items_type_check CHECK (memory_type IN ('explicit', 'inferred', 'policy')),
    CONSTRAINT memory_items_status_check CHECK (status IN ('draft', 'approved', 'active', 'expired', 'rejected')),
    CONSTRAINT memory_items_source_type_check CHECK (source_type IN ('conversation', 'skill_run', 'manual', 'system', 'import', 'other')),
    CONSTRAINT memory_items_created_by_check CHECK (created_by IN ('user', 'ai', 'system')),
    CONSTRAINT memory_items_importance_check CHECK (importance >= 0 AND importance <= 1),
    CONSTRAINT memory_items_confidence_check CHECK (confidence >= 0 AND confidence <= 1)
);

CREATE INDEX IF NOT EXISTS idx_memory_items_user_company
    ON public.memory_items (user_id, company_id);

CREATE INDEX IF NOT EXISTS idx_memory_items_category
    ON public.memory_items (category);

CREATE INDEX IF NOT EXISTS idx_memory_items_status
    ON public.memory_items (status);

CREATE INDEX IF NOT EXISTS idx_memory_items_expires_at
    ON public.memory_items (expires_at);

CREATE INDEX IF NOT EXISTS idx_memory_items_last_used_at
    ON public.memory_items (last_used_at DESC);

DROP TRIGGER IF EXISTS update_memory_items_updated_at ON public.memory_items;
CREATE TRIGGER update_memory_items_updated_at
    BEFORE UPDATE ON public.memory_items
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.memory_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own memory items" ON public.memory_items;
DROP POLICY IF EXISTS "Users can insert own memory items" ON public.memory_items;
DROP POLICY IF EXISTS "Users can update own memory items" ON public.memory_items;
DROP POLICY IF EXISTS "Users can delete own memory items" ON public.memory_items;

CREATE POLICY "Users can view own memory items"
    ON public.memory_items
    FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own memory items"
    ON public.memory_items
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own memory items"
    ON public.memory_items
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own memory items"
    ON public.memory_items
    FOR DELETE
    USING (auth.uid() = user_id);

-- ============================================================================
-- MEMORY USAGE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.memory_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    memory_id UUID NOT NULL REFERENCES public.memory_items(id) ON DELETE CASCADE,
    skill_run_id UUID REFERENCES public.skill_runs(id) ON DELETE SET NULL,
    conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
    used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_memory_usage_memory
    ON public.memory_usage (memory_id);

CREATE INDEX IF NOT EXISTS idx_memory_usage_skill_run
    ON public.memory_usage (skill_run_id);

CREATE INDEX IF NOT EXISTS idx_memory_usage_conversation
    ON public.memory_usage (conversation_id);

ALTER TABLE public.memory_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own memory usage" ON public.memory_usage;
DROP POLICY IF EXISTS "Users can insert own memory usage" ON public.memory_usage;
DROP POLICY IF EXISTS "Users can delete own memory usage" ON public.memory_usage;

CREATE POLICY "Users can view own memory usage"
    ON public.memory_usage
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1
            FROM public.memory_items mi
            WHERE mi.id = memory_usage.memory_id
            AND mi.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert own memory usage"
    ON public.memory_usage
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM public.memory_items mi
            WHERE mi.id = memory_usage.memory_id
            AND mi.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete own memory usage"
    ON public.memory_usage
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1
            FROM public.memory_items mi
            WHERE mi.id = memory_usage.memory_id
            AND mi.user_id = auth.uid()
        )
    );

COMMENT ON TABLE public.skills IS 'Reusable skill definitions for bookkeeping workflows.';
COMMENT ON TABLE public.skill_runs IS 'Execution log for skills (preview + live runs).';
COMMENT ON TABLE public.skill_approvals IS 'Approval records for skill runs.';
COMMENT ON TABLE public.memory_items IS 'User/company memory items with lifecycle + provenance.';
COMMENT ON TABLE public.memory_usage IS 'Tracks which memories were used in skill runs or conversations.';

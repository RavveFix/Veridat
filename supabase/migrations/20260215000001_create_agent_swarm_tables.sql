-- Agent Swarm: Task Queue + Agent Registry
-- Coordinated AI agents for autonomous Swedish bookkeeping
-- Legal: BFL 7:1 compliance via ai_decisions FK

-- ============================================================================
-- AGENT_TASKS TABLE — Database-backed task queue for agent swarm
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.agent_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    company_id TEXT NOT NULL,
    agent_type TEXT NOT NULL,
    parent_task_id UUID REFERENCES public.agent_tasks(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    priority INTEGER NOT NULL DEFAULT 5,
    input_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    output_payload JSONB,
    error_code TEXT,
    error_message TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 3,
    scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    claimed_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    ai_decision_id UUID REFERENCES public.ai_decisions(id),
    idempotency_key TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT agent_tasks_agent_type_check
        CHECK (agent_type IN ('faktura', 'bank', 'moms', 'bokforings', 'guardian', 'agi')),
    CONSTRAINT agent_tasks_status_check
        CHECK (status IN ('pending', 'claimed', 'running', 'succeeded', 'failed', 'cancelled')),
    CONSTRAINT agent_tasks_priority_check
        CHECK (priority >= 1 AND priority <= 10),
    CONSTRAINT agent_tasks_retry_count_check
        CHECK (retry_count >= 0),
    CONSTRAINT agent_tasks_max_retries_check
        CHECK (max_retries >= 0)
);

-- Partial unique on idempotency_key to prevent duplicate scheduled tasks
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_tasks_idempotency
    ON public.agent_tasks (idempotency_key)
    WHERE idempotency_key IS NOT NULL;

-- Queue claim pattern: find next pending task efficiently
CREATE INDEX IF NOT EXISTS idx_agent_tasks_queue_claim
    ON public.agent_tasks (agent_type, status, scheduled_at, priority, created_at)
    WHERE status = 'pending';

-- User/company lookup
CREATE INDEX IF NOT EXISTS idx_agent_tasks_user_company
    ON public.agent_tasks (user_id, company_id);

-- Parent task lookup for chain tracking
CREATE INDEX IF NOT EXISTS idx_agent_tasks_parent
    ON public.agent_tasks (parent_task_id)
    WHERE parent_task_id IS NOT NULL;

-- Status filter for dashboard queries
CREATE INDEX IF NOT EXISTS idx_agent_tasks_status
    ON public.agent_tasks (status, created_at DESC);

-- AI decision lookup
CREATE INDEX IF NOT EXISTS idx_agent_tasks_ai_decision
    ON public.agent_tasks (ai_decision_id)
    WHERE ai_decision_id IS NOT NULL;

-- Timestamp trigger
DROP TRIGGER IF EXISTS update_agent_tasks_updated_at ON public.agent_tasks;
CREATE TRIGGER update_agent_tasks_updated_at
    BEFORE UPDATE ON public.agent_tasks
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- AGENT_REGISTRY TABLE — Agent definitions and scheduling config
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.agent_registry (
    agent_type TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    description TEXT NOT NULL,
    edge_function TEXT NOT NULL,
    schedule_cron TEXT,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_run_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed the 6 agents
INSERT INTO public.agent_registry (agent_type, display_name, description, edge_function, schedule_cron, enabled) VALUES
    ('faktura',    'Fakturaagent',    'AI-extraktion och routing av leverantörsfakturor. Skannar PDF/bild och extraherar leverantör, belopp, moms, OCR.',              'finance-agent',    NULL,          TRUE),
    ('bank',       'Bankagent',       'Import och avstämning av banktransaktioner. Matchar transaktioner mot fakturor och föreslår BAS-konton.',                        'finance-agent',    NULL,          TRUE),
    ('moms',       'Momsagent',       'Beräkning, validering och export av momsrapporter. Stöd för matmoms och ML 3:30a-validering.',                                  'finance-agent',    '0 6 12 * *',  TRUE),
    ('bokforings', 'Bokföringsagent', 'Automatisk kontering och verifikatskapande. Skapar journal entries med debet/kredit och exporterar till Fortnox.',               'finance-agent',    NULL,          TRUE),
    ('guardian',   'Guardian',        'Övervakning av compliance, Fortnox-hälsa, förfallna fakturor och anomalier. Skapar varningar vid problem.',                      'fortnox-guardian', '0 2 * * *',   TRUE),
    ('agi',        'AGI-agent',       'Arbetsgivardeklaration: utkast, kontroll och jämförelse mot tidigare perioder.',                                                 'finance-agent',    '0 6 1 * *',   TRUE)
ON CONFLICT (agent_type) DO NOTHING;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE public.agent_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_registry ENABLE ROW LEVEL SECURITY;

-- agent_tasks: users see own tasks
DROP POLICY IF EXISTS "Users can view own agent tasks" ON public.agent_tasks;
CREATE POLICY "Users can view own agent tasks"
    ON public.agent_tasks FOR SELECT
    USING (auth.uid() = user_id);

-- agent_tasks: service role manages all (INSERT, UPDATE, DELETE from edge functions)
DROP POLICY IF EXISTS "Service role can manage agent tasks" ON public.agent_tasks;
CREATE POLICY "Service role can manage agent tasks"
    ON public.agent_tasks FOR ALL
    USING (true);

-- agent_tasks: authenticated users can insert own tasks (dispatch from frontend)
DROP POLICY IF EXISTS "Users can insert own agent tasks" ON public.agent_tasks;
CREATE POLICY "Users can insert own agent tasks"
    ON public.agent_tasks FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- agent_registry: everyone can read (public config)
DROP POLICY IF EXISTS "Anyone can view agent registry" ON public.agent_registry;
CREATE POLICY "Anyone can view agent registry"
    ON public.agent_registry FOR SELECT
    USING (true);

-- agent_registry: service role manages
DROP POLICY IF EXISTS "Service role can manage agent registry" ON public.agent_registry;
CREATE POLICY "Service role can manage agent registry"
    ON public.agent_registry FOR ALL
    USING (true);

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE public.agent_tasks IS 'Task queue for coordinated AI agent swarm. Each task belongs to an agent type and tracks execution lifecycle.';
COMMENT ON TABLE public.agent_registry IS 'Agent definitions with scheduling config. Seed data for the 6 bookkeeping agents.';

COMMENT ON COLUMN public.agent_tasks.agent_type IS 'Which agent handles this task: faktura, bank, moms, bokforings, guardian, agi';
COMMENT ON COLUMN public.agent_tasks.parent_task_id IS 'For chained tasks: e.g. faktura-agent creates a child task for bokforings-agent';
COMMENT ON COLUMN public.agent_tasks.priority IS '1=critical (errors), 5=normal (user-triggered), 10=background (scheduled)';
COMMENT ON COLUMN public.agent_tasks.idempotency_key IS 'Prevents duplicate tasks from cron: format cron:{agent}:{period}:{user}';
COMMENT ON COLUMN public.agent_tasks.ai_decision_id IS 'FK to ai_decisions for BFL 7:1 compliance audit trail';

COMMENT ON COLUMN public.agent_registry.schedule_cron IS 'Cron expression for scheduled runs. NULL = manual only.';
COMMENT ON COLUMN public.agent_registry.edge_function IS 'Which Supabase Edge Function handles this agent type';

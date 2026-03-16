-- Fix: ai_decisions_ai_provider_check constraint too restrictive
-- The original constraint only allowed ('gemini', 'openai', 'claude')
-- but deterministic handlers (AgentHandlers) legitimately log with 'system'
-- and action plan execution needs to be tracked.

ALTER TABLE public.ai_decisions
  DROP CONSTRAINT ai_decisions_ai_provider_check;

ALTER TABLE public.ai_decisions
  ADD CONSTRAINT ai_decisions_ai_provider_check
  CHECK (ai_provider IN ('gemini', 'openai', 'claude', 'system'));

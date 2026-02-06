-- Migration: Add accounting web search cache
-- Date: 2026-02-05

CREATE TABLE IF NOT EXISTS public.accounting_web_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cache_key TEXT NOT NULL UNIQUE,
    query TEXT NOT NULL,
    provider TEXT NOT NULL,
    allowlist TEXT[] NOT NULL,
    response JSONB NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS accounting_web_cache_expires_at_idx
    ON public.accounting_web_cache (expires_at);

ALTER TABLE public.accounting_web_cache ENABLE ROW LEVEL SECURITY;

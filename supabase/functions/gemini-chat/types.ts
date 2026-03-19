// Supabase Edge Function types for Gemini Chat
/// <reference path="../types/deno.d.ts" />

import type { FileData } from "../../services/GeminiService.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type EdgeSupabaseClient = SupabaseClient<any, any, any, any, any>;

// ── Conversation state machine ──────────────────────────────────
export type ConversationState = "idle" | "file_analysis" | "awaiting_input" | "action_plan_pending";

export type SkillDraft = {
  name?: string;
  description?: string;
  schedule?: string;
  requires_approval?: boolean;
  data_needed?: string[];
};

export type UserMemoryRow = {
  id: string;
  category: string;
  content: string;
  updated_at?: string | null;
  last_used_at?: string | null;
  created_at?: string | null;
  confidence?: number | null;
  memory_tier?: string | null;
  importance?: number | null;
  expires_at?: string | null;
};

export type AccountingMemoryPayload = {
  summary?: string;
  [key: string]: unknown;
};

export type AccountingMemoryRow = {
  id: string;
  entity_type: string;
  entity_key?: string | null;
  label?: string | null;
  payload?: AccountingMemoryPayload | null;
  source_type: string;
  source_reliability?: number | null;
  confidence?: number | null;
  review_status?: string | null;
  fiscal_year?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  last_used_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

// For transparency: track which memories were used in the response
export type UsedMemory = {
  id: string;
  category: string;
  preview: string; // First 50 chars of content
  reason?: string;
  confidenceLevel?: "high" | "medium";
};

export type HistorySearchResult = {
  conversation_id: string;
  conversation_title: string | null;
  snippet: string;
  created_at: string;
};

export type WebSearchResult = {
  title: string;
  url: string;
  snippet: string;
  source: string;
  published_at?: string | null;
};

export type WebSearchResponse = {
  query: string;
  provider: string;
  fetched_at: string;
  results: WebSearchResult[];
  used_cache: boolean;
  allowlist: string[];
};

export type MemoryTier = "profile" | "project" | "episodic" | "fact";

export type ScoredMemory = {
  memory: UserMemoryRow;
  tier: MemoryTier;
  isStable: boolean;
  score: number;
  overlapScore: number;
  recencyScore: number;
  reason: string;
};

export interface ActionResponseMetadata {
  action_response: {
    plan_id: string;
    decision: "approved" | "modified" | "rejected";
    modifications?: Record<string, unknown>;
  };
}

// Proper type for VAT report context instead of 'any'
export interface VATReportContext {
  type: string;
  period: string;
  company?: { name: string; org_number: string };
  summary?: {
    total_income: number;
    total_costs: number;
    result: number;
    total_sales?: number;
  };
  vat?: { outgoing_25: number; incoming: number; net: number };
  validation?: { is_valid: boolean; errors: string[]; warnings: string[] };
}

export interface RequestBody {
  action?: "generate_title" | null;
  message: string;
  fileData?: FileData;
  fileDataPages?: Array<FileData & { pageNumber?: number }>;
  documentText?: string | null;
  history?: Array<{ role: string; content: string }>;
  conversationId?: string;
  companyId?: string | null;
  fileUrl?: string | null;
  fileName?: string | null;
  vatReportContext?: VATReportContext | null;
  model?: string | null;
  titleContext?: string | null;
  assistantMode?: "skill_assist" | "agent" | null;
  stream?: boolean;
  metadata?: ActionResponseMetadata | null;
}

export interface SourceFile {
  storage_path: string;
  file_name: string;
  mime_type: string;
}

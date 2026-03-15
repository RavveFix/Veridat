// Supabase Edge Function for Gemini Chat
/// <reference path="../types/deno.d.ts" />

import {
  type BookSupplierInvoiceArgs,
  type ConversationSearchArgs,
  type CreateJournalEntryArgs,
  type CreateSupplierArgs,
  type CreateSupplierInvoiceArgs,
  type ExportJournalToFortnoxArgs,
  type FileData,
  GeminiRateLimitError,
  generateConversationTitle,
  type LearnAccountingPatternArgs,
  type RecentChatsArgs,
  sendMessageStreamToGemini,
  sendMessageToGemini,
  type WebSearchArgs,
} from "../../services/GeminiService.ts";
import { sendMessageToOpenAI } from "../../services/OpenAIService.ts";
import {
  createCostJournalEntries,
  createSalesJournalEntries,
  generateVerificationId,
  validateJournalBalance,
} from "../../services/JournalService.ts";
import { roundToOre } from "../../services/SwedishRounding.ts";
import { RateLimiterService } from "../../services/RateLimiterService.ts";
import { UsageTrackingService } from "../../services/UsageTrackingService.ts";
import {
  type CompanyMemory,
  CompanyMemoryService,
} from "../../services/CompanyMemoryService.ts";
import {
  getRateLimitConfigForPlan,
  getUserPlan,
} from "../../services/PlanService.ts";
import { ConversationService } from "../../services/ConversationService.ts";
import {
  createForbiddenOriginResponse,
  createOptionsResponse,
  getCorsHeaders,
  isOriginAllowed,
} from "../../services/CorsService.ts";
import { createLogger } from "../../services/LoggerService.ts";
import { AuditService } from "../../services/AuditService.ts";
import {
  buildAccountingContract,
  formatToolResponse,
  isAccountingIntent,
} from "../../services/AccountingResponseContract.ts";

import { createClient } from "npm:@supabase/supabase-js@2";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { FortnoxService } from "../../services/FortnoxService.ts";
import { ExpensePatternService } from "../../services/ExpensePatternService.ts";

const logger = createLogger("gemini-chat");
const RATE_LIMIT_ENDPOINT = "ai";

/** Model routing: abstract tier → concrete Gemini model ID */
const MODEL_MAP = {
  standard: "gemini-3-flash-preview",
  pro: "gemini-3.1-pro-preview",
} as const;
type EdgeSupabaseClient = SupabaseClient<any, any, any, any, any>;

const ACCOUNTING_TOOL_RESPONSE_NAMES = new Set([
  "get_customers",
  "get_articles",
  "get_suppliers",
  "create_supplier",
  "create_supplier_invoice",
  "create_journal_entry",
  "export_journal_to_fortnox",
  "book_supplier_invoice",
]);

function getEnv(keys: string[]): string | undefined {
  for (const key of keys) {
    const value = Deno.env.get(key);
    if (value && value.trim()) return value.trim();
  }
  return undefined;
}

function parseBooleanEnvFlag(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "on";
}

const ACCOUNTING_RESPONSE_TEMPLATE_ENABLED = parseBooleanEnvFlag(
  Deno.env.get("ACCOUNTING_RESPONSE_TEMPLATE_ENABLED"),
);

function truncateText(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars)}…`;
}

function formatSek(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 0 }).format(
    value,
  );
}

// ============================================================
// Voucher Attachment Helpers
// ============================================================

const ATTACHABLE_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp'];

interface SourceFile {
  storage_path: string;
  file_name: string;
  mime_type: string;
}

function isAttachableFile(fileName: string): boolean {
  return ATTACHABLE_EXTENSIONS.some(ext => fileName.toLowerCase().endsWith(ext));
}

function inferMimeType(fileName: string): string {
  const ext = (fileName.toLowerCase().split('.').pop() || '');
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
  };
  return map[ext] || 'application/octet-stream';
}

function extractStoragePath(fileUrl: string): string {
  try {
    const url = new URL(fileUrl);
    const match = url.pathname.match(/\/storage\/v1\/object\/sign\/chat-files\/(.+)/);
    return match ? decodeURIComponent(match[1]) : '';
  } catch {
    return '';
  }
}

// deno-lint-ignore no-explicit-any
function findSourceFile(history: any[]): SourceFile | undefined {
  // Search backwards for the most recent user message with an attachable file.
  // History objects include file_name/file_url at runtime (from messages table)
  // but these fields are not in the TS interface — use `any` like existing code (line 3661).
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role === 'user' && msg.file_name && isAttachableFile(msg.file_name) && msg.file_url) {
      const storagePath = extractStoragePath(msg.file_url);
      if (storagePath) {
        return {
          storage_path: storagePath,
          file_name: msg.file_name,
          mime_type: inferMimeType(msg.file_name),
        };
      }
    }
  }
  return undefined;
}

function buildSkillAssistSystemPrompt(): string {
  return [
    "SYSTEM: Du är Veridats Skill-assistent.",
    "Hjälp en icke-teknisk användare att skapa eller förbättra en automation för bokföringen i Sverige.",
    "Skriv på enkel svenska, kort och tydligt. Undvik tekniska ord.",
    "Fokusera på: vad som ska hända, när det ska hända och om det kräver godkännande.",
    "Hitta inte på organisationsnummer, konton, datum, eller systemdata. Om något saknas: ställ en fråga.",
    "Nämn inte tekniska actions, JSON eller interna verktyg om inte användaren specifikt ber om det.",
    "Lägg sist en dold systemrad som börjar med <skill_draft> och slutar med </skill_draft>.",
    "I taggen ska det finnas JSON med fälten: name, description, schedule, requires_approval, data_needed.",
    "Om information saknas: lämna fälten tomma och ställ frågor i punkt 3.",
    "Denna rad ska inte nämnas i texten och ska vara sista raden.",
    "",
    "Svara exakt i detta format:",
    "1) Kort sammanfattning (max 2 meningar).",
    "2) Förslag på automation:",
    "- Namn",
    "- Vad händer?",
    "- När körs den? (t.ex. varje månad, vid ny faktura, vid bankhändelse)",
    "- Behöver godkännande? (Ja/Nej + kort varför)",
    "- Vilken data behövs från användaren?",
    "3) Frågor (max 3 korta frågor om något saknas).",
  ].join("\n");
}

type SkillDraft = {
  name?: string;
  description?: string;
  schedule?: string;
  requires_approval?: boolean;
  data_needed?: string[];
};

function extractSkillDraft(
  text: string,
): { cleanText: string; draft: SkillDraft | null } {
  const draftMatch = text.match(/<skill_draft>([\s\S]*?)<\/skill_draft>/i);
  if (!draftMatch) {
    return { cleanText: text.trim(), draft: null };
  }

  let draft: SkillDraft | null = null;
  try {
    draft = JSON.parse(draftMatch[1]) as SkillDraft;
  } catch {
    draft = null;
  }

  const cleanText = text.replace(draftMatch[0], "").trim();
  return { cleanText, draft };
}

function buildCompanyMemoryContext(
  memory: CompanyMemory,
  includeVat: boolean,
): string | null {
  const lines: string[] = [];

  const companyBits: string[] = [];
  if (memory.company_name) companyBits.push(memory.company_name);
  if (memory.org_number) companyBits.push(memory.org_number);
  if (companyBits.length > 0) {
    lines.push(`Bolag: ${companyBits.join(" • ")}`);
  }

  if (includeVat && memory.last_vat_report) {
    const vat = memory.last_vat_report;
    const period = vat.period || "okänd period";
    const netVat = vat.net_vat;
    const direction = typeof netVat === "number"
      ? (netVat >= 0 ? "betala" : "återfå")
      : null;
    const absNet = typeof netVat === "number" ? Math.abs(netVat) : null;

    lines.push(
      `Senaste momsrapport: ${period} — moms att ${direction ?? "hantera"}: ${
        formatSek(absNet)
      } SEK (utgående ${formatSek(vat.outgoing_vat)} / ingående ${
        formatSek(vat.incoming_vat)
      })`,
    );
  }

  if (memory.notes) {
    lines.push(`Noteringar: ${truncateText(memory.notes, 800)}`);
  }

  if (lines.length === 0) return null;

  return `SYSTEM CONTEXT: Företagsminne för detta bolag (gäller bara detta bolag):\n- ${
    lines.join("\n- ")
  }`;
}

type UserMemoryRow = {
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

type AccountingMemoryPayload = {
  summary?: string;
  [key: string]: unknown;
};

type AccountingMemoryRow = {
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
type UsedMemory = {
  id: string;
  category: string;
  preview: string; // First 50 chars of content
  reason?: string;
  confidenceLevel?: "high" | "medium";
};

type HistorySearchResult = {
  conversation_id: string;
  conversation_title: string | null;
  snippet: string;
  created_at: string;
};

type WebSearchResult = {
  title: string;
  url: string;
  snippet: string;
  source: string;
  published_at?: string | null;
};

type WebSearchResponse = {
  query: string;
  provider: string;
  fetched_at: string;
  results: WebSearchResult[];
  used_cache: boolean;
  allowlist: string[];
};

function formatUserMemoriesForContext(
  memories: UserMemoryRow[],
): string | null {
  if (!memories.length) return null;

  const categories: Record<string, string[]> = {
    work_context: [],
    preferences: [],
    history: [],
    top_of_mind: [],
    user_defined: [],
  };

  for (const memory of memories) {
    if (categories[memory.category]) {
      categories[memory.category].push(memory.content);
    }
  }

  const sections: Array<{ title: string; items: string[] }> = [
    { title: "Företagskontext", items: categories.work_context },
    { title: "Preferenser", items: categories.preferences },
    { title: "Aktuellt", items: categories.top_of_mind },
    { title: "Historik", items: categories.history },
    { title: "Användardefinierat", items: categories.user_defined },
  ];

  const sectionText = sections
    .filter((section) => section.items.length > 0)
    .map((section) => `${section.title}:\n- ${section.items.join("\n- ")}`)
    .join("\n\n");

  if (!sectionText) return null;

  return [
    "SYSTEM CONTEXT: Användarminnen. Använd dessa naturligt i dina svar.",
    "- När du har hög konfidens: Använd informationen direkt men bekräfta ibland:",
    '  "Ni brukar bokföra X på konto Y — stämmer det fortfarande?"',
    "- När du har lägre konfidens: Fråga först:",
    '  "Jag tror att ni brukar... stämmer det?"',
    '- Referera aldrig till "mitt minne" — formulera det som',
    '  "baserat på vad vi pratat om tidigare" eller "om jag förstått er verksamhet rätt".',
    "<userMemories>",
    sectionText,
    "</userMemories>",
  ].join("\n");
}

type MemoryTier = "profile" | "project" | "episodic" | "fact";

const MEMORY_TIER_BY_CATEGORY: Record<string, MemoryTier> = {
  work_context: "fact",
  preferences: "profile",
  history: "episodic",
  top_of_mind: "project",
  user_defined: "profile",
};

const MEMORY_STOP_WORDS = new Set([
  "och",
  "att",
  "som",
  "det",
  "den",
  "detta",
  "har",
  "hade",
  "ska",
  "kan",
  "inte",
  "med",
  "för",
  "till",
  "från",
  "på",
  "av",
  "om",
  "ni",
  "vi",
  "jag",
  "du",
  "är",
  "var",
  "vara",
  "the",
  "and",
  "or",
]);

const MAX_MEMORY_CONTEXT = 10;
const MAX_STABLE_MEMORIES = 4;
const MAX_CONTEXTUAL_MEMORIES = 6;

const ACCOUNTING_CONTEXT_MAX = 6;
const ACCOUNTING_RELIABILITY_THRESHOLD = 0.6;
const ACCOUNTING_ALLOWED_STATUSES = new Set(["auto", "confirmed"]);
const ACCOUNTING_CONTEXT_ENTITY_TYPES = new Set([
  "company_profile",
  "account_policy",
  "supplier_profile",
  "tax_profile",
  "period_summary",
  "annual_report",
  "journal_summary",
  "rule",
  "other",
]);
const ACCOUNTING_PERIOD_BOUND_TYPES = new Set([
  "period_summary",
  "annual_report",
  "journal_summary",
]);
const ACCOUNTING_HIGH_RELIABILITY_SOURCES = new Set([
  "ledger",
  "annual_report",
]);

const ACCOUNTING_TYPE_LABELS: Record<string, string> = {
  company_profile: "Bolagsprofil",
  account_policy: "Kontoplan & policy",
  supplier_profile: "Leverantörer",
  tax_profile: "Skatt & moms",
  period_summary: "Periodsammanfattning",
  annual_report: "Årsredovisning",
  journal_summary: "Bokföring",
  rule: "Regler",
  other: "Övrigt",
};

function extractYearHint(message: string): string | null {
  const match = message.match(/\b(20\d{2})\b/);
  return match ? match[1] : null;
}

function parseDate(value?: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function isAccountingMemoryActive(
  memory: AccountingMemoryRow,
  now: Date,
): boolean {
  const validFrom = parseDate(memory.valid_from);
  const validTo = parseDate(memory.valid_to);
  if (validFrom && validFrom.getTime() > now.getTime()) return false;
  if (validTo && validTo.getTime() < now.getTime()) return false;
  return true;
}

function isAccountingMemoryPeriodMatch(
  memory: AccountingMemoryRow,
  yearHint: string | null,
): boolean {
  const isPeriodBound = ACCOUNTING_PERIOD_BOUND_TYPES.has(memory.entity_type);
  if (!isPeriodBound) return true;
  if (!memory.fiscal_year) return false;
  if (!yearHint) return false;
  return memory.fiscal_year.includes(yearHint);
}

function isAccountingMemoryReliable(memory: AccountingMemoryRow): boolean {
  const status = memory.review_status || "auto";
  if (!ACCOUNTING_ALLOWED_STATUSES.has(status)) return false;

  const reliability = typeof memory.source_reliability === "number"
    ? memory.source_reliability
    : 0.0;
  if (reliability < ACCOUNTING_RELIABILITY_THRESHOLD) return false;

  if (ACCOUNTING_PERIOD_BOUND_TYPES.has(memory.entity_type)) {
    if (!ACCOUNTING_HIGH_RELIABILITY_SOURCES.has(memory.source_type)) {
      return false;
    }
  }

  return true;
}

function selectAccountingMemoriesForContext(
  memories: AccountingMemoryRow[],
  message: string,
): AccountingMemoryRow[] {
  if (!memories.length) return [];

  const yearHint = extractYearHint(message);
  const now = new Date();

  const filtered = memories.filter((memory) => {
    if (!ACCOUNTING_CONTEXT_ENTITY_TYPES.has(memory.entity_type)) return false;
    if (!isAccountingMemoryReliable(memory)) return false;
    if (!isAccountingMemoryActive(memory, now)) return false;
    if (!isAccountingMemoryPeriodMatch(memory, yearHint)) return false;
    return true;
  });

  if (filtered.length === 0) return [];

  const priorityOrder = [
    "company_profile",
    "account_policy",
    "tax_profile",
    "supplier_profile",
    "period_summary",
    "annual_report",
    "journal_summary",
    "rule",
    "other",
  ];

  const toTime = (memory: AccountingMemoryRow): number => {
    const timestamp = memory.last_used_at || memory.updated_at ||
      memory.created_at || null;
    if (!timestamp) return 0;
    const parsed = new Date(timestamp);
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
  };

  const selected: AccountingMemoryRow[] = [];

  for (const type of priorityOrder) {
    const group = filtered
      .filter((memory) => memory.entity_type === type)
      .sort((a, b) => toTime(b) - toTime(a));
    for (const memory of group) {
      if (selected.length >= ACCOUNTING_CONTEXT_MAX) break;
      selected.push(memory);
    }
    if (selected.length >= ACCOUNTING_CONTEXT_MAX) break;
  }

  return selected;
}

function formatAccountingMemoriesForContext(
  memories: AccountingMemoryRow[],
): string | null {
  if (!memories.length) return null;

  const sections: Record<string, string[]> = {};

  for (const memory of memories) {
    const rawLabel = memory.label?.trim() || "";
    const payload = memory.payload || {};
    const payloadSummary = typeof payload.summary === "string"
      ? payload.summary.trim()
      : "";
    const fallback = payloadSummary ||
      (Object.keys(payload).length > 0 ? JSON.stringify(payload) : "");
    const content = rawLabel || fallback;
    if (!content) continue;

    const suffixParts: string[] = [];
    if (
      ACCOUNTING_PERIOD_BOUND_TYPES.has(memory.entity_type) &&
      memory.fiscal_year
    ) {
      suffixParts.push(`År ${memory.fiscal_year}`);
    }
    const sourceLabel = memory.source_type
      ? `Källa: ${memory.source_type}`
      : "";
    if (sourceLabel) suffixParts.push(sourceLabel);

    const suffix = suffixParts.length > 0 ? ` (${suffixParts.join(", ")})` : "";
    const line = `${truncateText(content, 220)}${suffix}`;

    const sectionKey = ACCOUNTING_TYPE_LABELS[memory.entity_type] || "Övrigt";
    if (!sections[sectionKey]) {
      sections[sectionKey] = [];
    }
    sections[sectionKey].push(line);
  }

  const sectionText = Object.entries(sections)
    .map(([title, items]) => `${title}:\n- ${items.join("\n- ")}`)
    .join("\n\n");

  if (!sectionText) return null;

  return [
    "SYSTEM CONTEXT: Redovisningsminne (verifierade uppgifter, periodstyrt).",
    "<accountingMemories>",
    sectionText,
    "</accountingMemories>",
  ].join("\n");
}

function normalizeTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9åäö]+/gi, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !MEMORY_STOP_WORDS.has(token));
}

function resolveMemoryTier(memory: UserMemoryRow): MemoryTier {
  const tier = memory.memory_tier || "";
  if (
    tier === "profile" || tier === "project" || tier === "episodic" ||
    tier === "fact"
  ) {
    return tier;
  }
  return MEMORY_TIER_BY_CATEGORY[memory.category] || "fact";
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function clampScore(value: unknown, fallback: number): number {
  const parsed = toNumberOrNull(value);
  if (parsed === null) return fallback;
  return Math.min(1, Math.max(0, parsed));
}

function getHalfLifeDays(tier: MemoryTier): number {
  switch (tier) {
    case "project":
      return 30;
    case "episodic":
      return 180;
    case "profile":
    case "fact":
    default:
      return 365;
  }
}

function computeRecencyScore(
  dateString: string | null | undefined,
  tier: MemoryTier,
): number {
  if (!dateString) return 0.3;
  const parsed = new Date(dateString);
  if (Number.isNaN(parsed.getTime())) return 0.3;
  const diffMs = Date.now() - parsed.getTime();
  const diffDays = Math.max(0, diffMs / (1000 * 60 * 60 * 24));
  const halfLife = getHalfLifeDays(tier);
  return Math.exp(-diffDays / halfLife);
}

function computeOverlapScore(
  queryTokens: string[],
  contentTokens: string[],
): number {
  if (queryTokens.length === 0 || contentTokens.length === 0) return 0;
  const contentSet = new Set(contentTokens);
  let matches = 0;
  for (const token of queryTokens) {
    if (contentSet.has(token)) matches += 1;
  }
  const normalization = Math.max(1, Math.min(queryTokens.length, 6));
  return matches / normalization;
}

function isMemoryExpired(memory: UserMemoryRow): boolean {
  if (!memory.expires_at) return false;
  const parsed = new Date(memory.expires_at);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.getTime() < Date.now();
}

function buildMemoryReason(
  tier: MemoryTier,
  overlapScore: number,
  recencyScore: number,
): string {
  if (overlapScore >= 0.2) return "Matchade frågan";
  if (tier === "project") {
    return recencyScore > 0.5 ? "Aktuellt projekt" : "Projektminne";
  }
  if (tier === "episodic") return "Historik";
  if (tier === "profile") return "Profil/preferens";
  return "Faktaminne";
}

type ScoredMemory = {
  memory: UserMemoryRow;
  tier: MemoryTier;
  isStable: boolean;
  score: number;
  overlapScore: number;
  recencyScore: number;
  reason: string;
};

function selectRelevantMemories(memories: UserMemoryRow[], message: string): {
  selected: UserMemoryRow[];
  usedMemories: UsedMemory[];
} {
  const queryTokens = normalizeTokens(message || "");

  const scored: ScoredMemory[] = [];
  for (const memory of memories) {
    if (isMemoryExpired(memory)) continue;
    if (!memory.content) continue;

    const tier = resolveMemoryTier(memory);
    const isStable = tier === "profile" || tier === "fact";
    const recencyScore = computeRecencyScore(
      memory.last_used_at || memory.updated_at || memory.created_at,
      tier,
    );
    const overlapScore = computeOverlapScore(
      queryTokens,
      normalizeTokens(memory.content),
    );
    const importance = clampScore(memory.importance, isStable ? 0.7 : 0.6);
    const confidence = clampScore(memory.confidence, 0.7);
    const tierBoost = isStable ? 0.2 : 0;

    if (!isStable && overlapScore === 0 && recencyScore < 0.35) {
      continue;
    }

    const score = overlapScore * 2 +
      recencyScore * 0.9 +
      importance * 0.8 +
      confidence * 0.4 +
      tierBoost;

    scored.push({
      memory,
      tier,
      isStable,
      score,
      overlapScore,
      recencyScore,
      reason: buildMemoryReason(tier, overlapScore, recencyScore),
    });
  }

  scored.sort((a, b) => b.score - a.score);

  const stable = scored.filter((item) => item.isStable);
  const contextual = scored.filter((item) => !item.isStable);

  const selected: ScoredMemory[] = [];
  const selectedIds = new Set<string>();

  const pushItems = (items: ScoredMemory[], maxToAdd: number) => {
    let added = 0;
    for (const item of items) {
      if (selected.length >= MAX_MEMORY_CONTEXT) break;
      if (added >= maxToAdd) break;
      if (selectedIds.has(item.memory.id)) continue;
      selected.push(item);
      selectedIds.add(item.memory.id);
      added += 1;
    }
  };

  pushItems(stable, MAX_STABLE_MEMORIES);
  pushItems(contextual, MAX_CONTEXTUAL_MEMORIES);

  if (selected.length < MAX_MEMORY_CONTEXT) {
    pushItems(scored, MAX_MEMORY_CONTEXT - selected.length);
  }

  const usedMemories = selected.map((item) => ({
    id: item.memory.id,
    category: item.memory.category,
    preview: item.memory.content.substring(0, 50) +
      (item.memory.content.length > 50 ? "..." : ""),
    reason: item.reason,
    confidenceLevel:
      (clampScore(item.memory.importance, 0.6) >= 0.7 ? "high" : "medium") as
        | "high"
        | "medium",
  }));

  return {
    selected: selected.map((item) => item.memory),
    usedMemories,
  };
}

function extractSnippet(
  content: string,
  query: string,
  contextLength = 90,
): string {
  const lowerContent = content.toLowerCase();
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 1);

  let index = -1;
  let matchedLength = 0;

  for (const term of terms) {
    const termIndex = lowerContent.indexOf(term);
    if (termIndex !== -1) {
      index = termIndex;
      matchedLength = term.length;
      break;
    }
  }

  if (index === -1) {
    return `${content.substring(0, contextLength * 2)}...`;
  }

  const start = Math.max(0, index - contextLength);
  const end = Math.min(content.length, index + matchedLength + contextLength);

  let snippet = content.substring(start, end);
  if (start > 0) snippet = `...${snippet}`;
  if (end < content.length) snippet = `${snippet}...`;

  return snippet;
}

function detectHistoryIntent(
  message: string,
): { search: boolean; recent: boolean } {
  const normalized = message.toLowerCase();
  const explicitHistory =
    /(tidigare konversation|förra chatten|förra gången|pratade vi|diskuterade vi|sade du|sa du)/
      .test(normalized);
  if (shouldSkipHistorySearch(message)) {
    return { search: false, recent: false };
  }
  const mentionsRecent =
    /(förra veckan|förra månaden|förra kvartalet|senast|sist|tidigare|förut)/
      .test(normalized);
  const mentionsTalk = /\b(pratade|diskuterade|nämnde|sade|sa)\b/.test(normalized);
  const mentionsWe = /\bvi\b/.test(normalized);
  const mentionsHowWeDid = /(hur\s+.*(bokförde|gjorde|löste)|bokförde vi)/.test(
    normalized,
  );

  const search = mentionsTalk || mentionsHowWeDid ||
    (mentionsRecent && mentionsWe);
  const recent = mentionsRecent && (mentionsWe || mentionsTalk);

  return { search, recent };
}

function extractInvoiceReference(message: string): { type: "supplier" | "customer"; number: number } | null {
  const n = message.toLowerCase();
  const supplierMatch = n.match(/leverantörs?faktura\s+(?:nr\.?\s*)?(\d+)/);
  if (supplierMatch) return { type: "supplier", number: Number(supplierMatch[1]) };
  const customerMatch = n.match(/(?:kund)?faktura\s+(?:nr\.?\s*)?(\d+)/);
  if (customerMatch) return { type: "customer", number: Number(customerMatch[1]) };
  return null;
}

function extractInvoiceByCustomerName(message: string): string | null {
  const patterns = [
    /(?:senaste|sista)\s+(?:kund)?fakturan?\s+(?:till|för)\s+([A-Za-zÅÄÖåäö&\-\s]+?)(?:\s*[,.]|\s*$|\s+och\s|\s+med\s|\s+på\s)/i,
    /(?:ändra|uppdatera|justera)\s+(?:senaste\s+)?(?:kund)?fakturan?\s+(?:till|för)\s+([A-Za-zÅÄÖåäö&\-\s]+?)(?:\s*[,.]|\s*$|\s+och\s|\s+med\s|\s+på\s)/i,
  ];
  for (const pat of patterns) {
    const match = message.match(pat);
    if (match) return match[1].trim();
  }
  return null;
}

function detectAgentNeeds(message: string): { needsCustomers: boolean; needsSuppliers: boolean; needsArticles: boolean } {
  const m = message.toLowerCase();
  const isSupplierInvoice = /leverantörsfaktura|lev\.?faktura|supplier invoice/.test(m);
  return {
    // Fetch customers for any invoice/kund message UNLESS it's specifically a supplier invoice
    needsCustomers: /kund|faktura|invoice/.test(m) && !isSupplierInvoice,
    needsSuppliers: /leverantör|supplier|lev\.?faktura/.test(m),
    needsArticles: /artikel|produkt|vara|article/.test(m),
  };
}

function shouldSkipHistorySearch(message: string): boolean {
  const normalized = message.toLowerCase();
  const explicitHistory =
    /(tidigare konversation|förra chatten|förra gången|pratade vi|diskuterade vi|sade du|sa du)/
      .test(normalized);
  if (explicitHistory) return false;

  const hasYear = /\b20\d{2}\b/.test(normalized);
  const accountingTerms =
    /(årsredovisning|bokslut|momsrapport|momsredovisning|balansräkning|resultaträkning|sie|bas|räkenskapsår|period|omsättning|nettoomsättning|resultat|verifikation|bokföring|faktura|leverantörsfaktura|konto|kontera|bokföra|kvitto)/
      .test(normalized);
  const companyTerms = /\bbolag(et)?|företag(et)?\b/.test(normalized);
  const accountingFocus = accountingTerms || (hasYear && companyTerms);

  if (accountingFocus) {
    return true;
  }

  return false;
}

function extractMemoryRequest(message: string): string | null {
  const patterns = [
    /kom ih[aå]g(?: att)?\s*[:\-]?\s*(.+)/i,
    /spara(?: detta| det här| följande)?\s*[:\-]?\s*(.+)/i,
    /lägg till i minnet\s*[:\-]?\s*(.+)/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match && match[1]) {
      const cleaned = match[1].trim();
      if (cleaned) return cleaned;
    }
  }

  return null;
}

async function searchConversationHistory(
  supabaseAdmin: EdgeSupabaseClient,
  userId: string,
  companyId: string | null,
  query: string,
  limit: number,
): Promise<HistorySearchResult[]> {
  let searchQuery = supabaseAdmin
    .from("messages")
    .select(`
            content,
            created_at,
            conversation:conversations!inner(
                id,
                title,
                company_id,
                user_id
            )
        `)
    .eq("conversation.user_id", userId)
    .textSearch("search_vector", query, {
      type: "websearch",
      config: "swedish",
    })
    .limit(limit);

  if (companyId) {
    searchQuery = searchQuery.eq("conversation.company_id", companyId);
  }

  const { data, error } = await searchQuery;
  if (error) throw error;

  type MessageRow = {
    content: string;
    created_at: string;
    conversation: Array<
      { id: string; title: string | null; company_id: string; user_id: string }
    >;
  };
  return (((data as unknown as MessageRow[]) || [])
    .map((row) => {
      const conversation = row.conversation?.[0];
      if (!conversation) return null;
      return {
        conversation_id: conversation.id,
        conversation_title: conversation.title,
        snippet: extractSnippet(row.content, query),
        created_at: row.created_at,
      };
    })
    .filter((row): row is HistorySearchResult => row !== null));
}

async function getRecentConversations(
  supabaseAdmin: EdgeSupabaseClient,
  userId: string,
  companyId: string | null,
  limit: number,
): Promise<
  Array<
    {
      id: string;
      title: string | null;
      summary: string | null;
      updated_at: string | null;
    }
  >
> {
  let recentQuery = supabaseAdmin
    .from("conversations")
    .select("id, title, summary, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (companyId) {
    recentQuery = recentQuery.eq("company_id", companyId);
  }

  const { data, error } = await recentQuery;
  if (error) throw error;

  return data || [];
}

function formatHistoryResponse(
  query: string,
  results: HistorySearchResult[],
  recent: Array<
    {
      id: string;
      title: string | null;
      summary: string | null;
      updated_at: string | null;
    }
  >,
): string {
  if (results.length === 0 && recent.length === 0) {
    return `Jag hittade inget som matchar "${query}" i tidigare konversationer.`;
  }

  const formatDate = (value: string | null) => {
    if (!value) return "";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "";
    return parsed.toLocaleDateString("sv-SE", {
      day: "numeric",
      month: "short",
    });
  };

  const lines: string[] = [];

  if (results.length > 0) {
    lines.push("Här är relevanta träffar från tidigare konversationer:");
    for (const result of results) {
      const title = result.conversation_title || "Konversation";
      const date = formatDate(result.created_at);
      const dateSuffix = date ? ` • ${date}` : "";
      lines.push(`- ${title}${dateSuffix}\n  ${result.snippet}`);
    }
  }

  if (recent.length > 0) {
    if (lines.length > 0) {
      lines.push("\nSenaste konversationer:");
    } else {
      lines.push("Senaste konversationer:");
    }

    for (const conv of recent) {
      const title = conv.title || "Konversation";
      const date = formatDate(conv.updated_at);
      const summary = conv.summary
        ? ` — ${truncateText(conv.summary, 160)}`
        : "";
      const dateSuffix = date ? ` • ${date}` : "";
      lines.push(`- ${title}${dateSuffix}${summary}`);
    }
  }

  return lines.join("\n");
}

function formatWebSearchContext(response: WebSearchResponse): string {
  const formatDate = (value?: string | null) => {
    if (!value) return "okänt datum";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "okänt datum";
    return parsed.toLocaleDateString("sv-SE", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const header = [
    `SÖKFRÅGA: ${response.query}`,
    `HÄMTAT: ${formatDate(response.fetched_at)}`,
    `KÄLLOR (allowlist): ${response.allowlist.join(", ")}`,
  ].join("\n");

  if (!response.results.length) {
    return `${header}\n\nInga träffar från tillåtna källor.`;
  }

  const resultLines = response.results.map((result, index) => {
    const dateLine = `Datum: ${formatDate(result.published_at)}`;
    const sourceLine = `Källa: ${result.source} (${result.url})`;
    const snippetLine = result.snippet
      ? `Utdrag: ${result.snippet}`
      : "Utdrag: (saknas)";
    return `${
      index + 1
    }. ${result.title}\n${sourceLine}\n${dateLine}\n${snippetLine}`;
  });

  return `${header}\n\n${resultLines.join("\n\n")}`;
}

async function triggerMemoryGenerator(
  supabaseUrl: string,
  serviceKey: string,
  conversationId: string,
): Promise<void> {
  if (!supabaseUrl || !serviceKey || !conversationId) return;
  try {
    await fetch(`${supabaseUrl}/functions/v1/memory-generator`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ conversation_id: conversationId }),
    });
  } catch (error) {
    logger.warn("Failed to trigger memory generator", {
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}

/**
 * Generate a smart title for new conversations using AI
 * Only generates if conversation has no real title yet (null or "Ny konversation")
 */
async function generateSmartTitleIfNeeded(
  _conversationService: ConversationService,
  supabaseAdmin: EdgeSupabaseClient,
  conversationId: string,
  userMessage: string,
  aiResponse: string,
  currentTitleHint?: string | null,
): Promise<string | null> {
  try {
    const hintedTitle = currentTitleHint?.trim() || null;
    if (hintedTitle && hintedTitle !== "Ny konversation") {
      return hintedTitle;
    }

    if (!hintedTitle) {
      // Fallback for callers that do not already have the current title.
      const { data: conv, error: fetchError } = await (supabaseAdmin
        .from("conversations") as any)
        .select("title")
        .eq("id", conversationId)
        .single() as {
          data: { title: string | null } | null;
          error: Error | null;
        };

      if (fetchError || !conv) {
        return null;
      }

      const currentTitle = conv.title?.trim();
      if (currentTitle && currentTitle !== "Ny konversation") {
        return currentTitle;
      }
    }

    // Use AI to generate a smart title (falls back to truncation on error)
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    const generatedTitle = await generateConversationTitle(
      userMessage,
      aiResponse,
      apiKey,
    );

    // Use supabaseAdmin directly (service role) to bypass any RLS issues
    const { error: updateError } = await (supabaseAdmin
      .from("conversations") as any)
      .update({ title: generatedTitle, updated_at: new Date().toISOString() })
      .eq("id", conversationId);

    if (updateError) {
      return null;
    }

    return generatedTitle;
  } catch (error) {
    logger.warn("[TITLE] Exception while generating smart title", {
      conversationId,
      error: String(error),
    });
    return null;
  }
}
interface ActionResponseMetadata {
  action_response: {
    plan_id: string;
    decision: "approved" | "modified" | "rejected";
    modifications?: Record<string, unknown>;
  };
}

interface RequestBody {
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

// Proper type for VAT report context instead of 'any'
interface VATReportContext {
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

/**
 * Execute a Fortnox tool call server-side (used by streaming path).
 * Returns the response text, or null if the tool is unrecognized.
 */

async function lookupCompanyOnAllabolag(companyName: string): Promise<string> {
  if (!companyName) return "Företagsnamn saknas.";
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    try {
      const searchUrl = `https://www.allabolag.se/find?what=${encodeURIComponent(companyName)}`;
      const resp = await fetch(searchUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; Veridat/1.0)" },
        signal: controller.signal,
      });
      if (!resp.ok) {
        return `Kunde inte söka på allabolag.se (status ${resp.status}). Skapa kunden utan uppslag.`;
      }
      const html = await resp.text();
      const ndMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (!ndMatch) {
        return `Hittade ingen data på allabolag.se för "${companyName}". Skapa kunden utan uppslag.`;
      }
      let nextData;
      try {
        nextData = JSON.parse(ndMatch[1]);
      } catch {
        return `Kunde inte tolka data från allabolag.se. Skapa kunden utan uppslag.`;
      }
      const hits = nextData?.props?.pageProps?.hits
        || nextData?.props?.pageProps?.searchResult?.hits
        || [];
      if (hits.length === 0) {
        return `Inga träffar på allabolag.se för "${companyName}".`;
      }
      const results = hits.slice(0, 3).map((h: any) => {
        const name = h.name || h.companyName || "";
        const orgNr = h.orgnr || h.organisationNumber || "";
        const address = h.address || h.visitingAddress || "";
        const zipCode = h.zipCode || h.postalCode || "";
        const city = h.city || h.town || "";
        const status = h.status || h.companyStatus || "";
        return `- ${name} (${orgNr}): ${address}, ${zipCode} ${city} [${status}]`;
      }).join("\n");
      return `Sökresultat från allabolag.se för "${companyName}":\n${results}\n\nAnvänd organisationsnummer, adress och stad från träffen ovan i create_customer-parametrarna.`;
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (err) {
    logger.warn("Allabolag lookup failed", { error: err instanceof Error ? err.message : "unknown" });
    return `Uppslag på allabolag.se misslyckades. Skapa kunden utan företagsuppgifter.`;
  }
}

async function callFortnoxRead(
  action: string,
  payload: Record<string, unknown>,
  authHeader: string,
  companyId: string,
): Promise<Record<string, unknown>> {
  const supabaseUrl = getEnv(["SUPABASE_URL", "SB_URL", "SB_SUPABASE_URL", "API_URL"]);
  const response = await fetch(`${supabaseUrl}/functions/v1/fortnox`, {
    method: "POST",
    headers: {
      "Authorization": authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action, companyId, payload }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      typeof result?.error === "string"
        ? result.error
        : `Fortnox-anrop misslyckades (${response.status})`,
    );
  }
  return result as Record<string, unknown>;
}

/**
 * Resolve a supplier identifier to a numeric SupplierNumber.
 * If the value is already numeric, return as-is.
 * If it looks like a text name (e.g. "GOOGLE_IRELAND_LTD"), search Fortnox suppliers by name.
 */
async function resolveSupplierNumber(
  supplierRef: string,
  authHeader: string,
  companyId: string,
): Promise<string | null> {
  // Guard against undefined/empty input
  if (!supplierRef) return null;
  // Already numeric → return as-is
  if (/^\d+$/.test(supplierRef)) return supplierRef;

  // Text name → search Fortnox suppliers
  try {
    const result = await callFortnoxRead("getSuppliers", {}, authHeader, companyId);
    const suppliers = (result as any)?.Suppliers || (result as any)?.suppliers || [];
    // Normalize search: lowercase, strip underscores/spaces
    const normalize = (s: string) => s.toLowerCase().replace(/[_\s-]+/g, "");
    const needle = normalize(supplierRef);
    const match = suppliers.find((s: any) =>
      normalize(s.Name || "") === needle ||
      normalize(s.SupplierNumber || "") === needle
    );
    if (match?.SupplierNumber) {
      logger.info("Resolved supplier name to number", {
        input: supplierRef,
        resolved: match.SupplierNumber,
        name: match.Name,
      });
      return String(match.SupplierNumber);
    }
  } catch (err) {
    logger.warn("Supplier lookup failed", {
      supplierRef,
      error: err instanceof Error ? err.message : "Unknown",
    });
  }
  return null;
}

async function executeFortnoxTool(
  toolName: string,
  toolArgs: Record<string, unknown>,
  supabaseAdmin: any,
  userId: string,
  companyId: string | null,
  authHeader: string,
): Promise<string | null> {
  const supabaseUrl = getEnv(["SUPABASE_URL", "SB_URL"]);
  const supabaseServiceKey = getEnv([
    "SUPABASE_SERVICE_ROLE_KEY",
    "SB_SERVICE_ROLE_KEY",
  ]);
  if (!supabaseUrl || !supabaseServiceKey) return null;
  const resolvedCompanyId =
    typeof companyId === "string" && companyId.trim().length > 0
      ? companyId.trim()
      : null;
  if (!resolvedCompanyId) {
    throw new Error("Bolagskontext saknas för Fortnox-verktyg.");
  }

  const supabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const fortnoxConfig = {
    clientId: Deno.env.get("FORTNOX_CLIENT_ID") ?? "",
    clientSecret: Deno.env.get("FORTNOX_CLIENT_SECRET") ?? "",
    redirectUri: "",
  };
  const fortnoxService = new FortnoxService(
    fortnoxConfig,
    supabaseClient,
    userId,
    resolvedCompanyId,
  );
  const auditService = new AuditService(supabaseAdmin);
  const buildIdempotencyKey = (operation: string, resource: string): string =>
    `gemini_tool:${resolvedCompanyId}:${operation}:${resource}`.slice(0, 200);

  const callFortnoxWrite = async (
    action: string,
    payload: Record<string, unknown>,
    operation: string,
    resource: string,
  ): Promise<Record<string, unknown>> => {
    const response = await fetch(`${supabaseUrl}/functions/v1/fortnox`, {
      method: "POST",
      headers: {
        "Authorization": authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action,
        companyId: resolvedCompanyId,
        payload: {
          ...payload,
          idempotencyKey: buildIdempotencyKey(operation, resource),
          sourceContext: "gemini-chat-tool",
        },
      }),
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = typeof result?.error === "string"
        ? result.error
        : `Fortnox write failed (${response.status})`;
      throw new Error(message);
    }
    return (result || {}) as Record<string, unknown>;
  };

  try {
    switch (toolName) {
      case "get_customers": {
        const result = await fortnoxService.getCustomers();
        return `Här är dina kunder: ${
          (result as any).Customers.map((c: any) => c.Name).join(", ")
        }`;
      }
      case "get_articles": {
        const result = await fortnoxService.getArticles();
        return `Här är dina artiklar: ${
          (result as any).Articles.map((a: any) => a.Description).join(", ")
        }`;
      }
      case "get_suppliers": {
        const result = await fortnoxService.getSuppliers();
        const suppliers = (result as any).Suppliers || [];
        return suppliers.length > 0
          ? `Här är dina leverantörer:\n${
            suppliers.map((s: any) => `- ${s.Name} (nr ${s.SupplierNumber})`)
              .join("\n")
          }`
          : "Inga leverantörer hittades i Fortnox.";
      }
      case "get_invoice": {
        const invNum = Number(toolArgs.invoice_number);
        const resp = await fortnoxService.getInvoice(invNum);
        const inv = (resp as any).Invoice || resp;
        const invId = inv.InvoiceNumber || inv.DocumentNumber || invNum;
        let invoiceText = `Faktura ${invId}:\n` +
          `- DocumentNumber: ${inv.DocumentNumber || invId}\n` +
          `- Kund: ${inv.CustomerName || "—"} (${inv.CustomerNumber})\n` +
          `- Datum: ${inv.InvoiceDate}\n` +
          `- Förfallodatum: ${inv.DueDate}\n` +
          `- Belopp: ${inv.Total} kr (varav moms ${inv.TotalVAT} kr)\n` +
          `- Netto: ${inv.Net} kr\n` +
          `- Bokförd: ${inv.Booked ? "Ja" : "Nej"}\n` +
          `- Status: ${inv.Cancelled ? "Makulerad" : inv.Booked ? "Bokförd" : "Utkast"}`;
        // Include rows for update context
        if (inv.InvoiceRows && Array.isArray(inv.InvoiceRows) && inv.InvoiceRows.length > 0) {
          invoiceText += `\n- Fakturarader:`;
          inv.InvoiceRows.forEach((row: any, i: number) => {
            invoiceText += `\n  Rad ${i + 1}: "${row.Description || '-'}" | Antal: ${row.DeliveredQuantity || 1} | À-pris: ${row.Price || 0} kr | Total: ${row.Total || 0} kr`;
          });
        }
        return invoiceText;
      }
      case "get_supplier_invoice": {
        const siNum = Number(toolArgs.given_number);
        const resp = await fortnoxService.getSupplierInvoice(siNum);
        const si = (resp as any).SupplierInvoice || resp;
        return `Leverantörsfaktura ${si.GivenNumber}:\n` +
          `- Leverantör: ${si.SupplierName || "—"} (${si.SupplierNumber})\n` +
          `- Fakturanr: ${si.InvoiceNumber || "—"}\n` +
          `- Datum: ${si.InvoiceDate}\n` +
          `- Förfallodatum: ${si.DueDate}\n` +
          `- Belopp: ${si.Total} kr (varav moms ${si.VAT || 0} kr)\n` +
          `- Bokförd: ${si.Booked ? "Ja" : "Nej"}`;
      }
      case "create_supplier": {
        const csArgs = toolArgs as CreateSupplierArgs;
        const result = await callFortnoxWrite(
          "findOrCreateSupplier",
          {
            supplier: {
              Name: csArgs.name,
              OrganisationNumber: csArgs.org_number || undefined,
              Email: csArgs.email || undefined,
            },
          },
          "create_supplier",
          csArgs.org_number || csArgs.name,
        );
        const supplier = (result as any).Supplier || result;
        void auditService.log({
          userId,
          companyId: companyId || undefined,
          actorType: "ai",
          action: "create",
          resourceType: "supplier",
          resourceId: supplier.SupplierNumber || "",
          newState: supplier,
        });
        return `Leverantör: ${
          supplier.Name || csArgs.name
        } (nr ${supplier.SupplierNumber || "tilldelas"})`;
      }
      case "create_supplier_invoice": {
        const siArgs = toolArgs as CreateSupplierInvoiceArgs;
        // Resolve casing — AI may send snake_case, camelCase, or PascalCase
        const siSupplierRaw = (siArgs.supplier_number || siArgs.supplierNumber || siArgs.SupplierNumber) as string;
        // If AI sent a text name instead of numeric SupplierNumber, resolve it
        const siSupplierNum = companyId
          ? (await resolveSupplierNumber(siSupplierRaw, authHeader, companyId)) || siSupplierRaw
          : siSupplierRaw;
        if (siSupplierNum !== siSupplierRaw) {
          logger.info("Resolved supplier name to number for direct tool call", { from: siSupplierRaw, to: siSupplierNum });
        }
        const siInvNum = (siArgs.invoice_number || siArgs.invoiceNumber || siArgs.InvoiceNumber) as string | undefined;
        const siTotalAmt = (siArgs.total_amount ?? siArgs.totalAmount ?? siArgs.TotalAmount ?? siArgs.Total) as number;
        const siVatRate = ((siArgs.vat_rate ?? siArgs.vatRate ?? siArgs.VatRate) as number) || 25;
        const siVatAmt = (siArgs.vat_amount ?? siArgs.vatAmount ?? siArgs.VatAmount) as number | undefined;
        const siIsRC = (siArgs.is_reverse_charge ?? siArgs.isReverseCharge ?? siArgs.IsReverseCharge) === true;
        const siAcct = (siArgs.account ?? siArgs.Account) as number;
        const siDue = (siArgs.due_date || siArgs.dueDate || siArgs.DueDate) as string | undefined;
        // Use currency from AI parameters — Fortnox handles conversion for foreign currencies
        const siCurr = ((siArgs.currency || siArgs.Currency) as string) || "SEK";

        // For reverse charge: total_amount IS the net (no VAT charged by supplier)
        // For normal: calculate net from gross using VAT rate
        const vatMul = 1 + (siVatRate / 100);
        const net = siIsRC
          ? siTotalAmt
          : Math.round((siTotalAmt / vatMul) * 100) / 100;
        const vat = siIsRC
          ? 0
          : (typeof siVatAmt === "number"
            ? siVatAmt
            : Math.round((siTotalAmt - net) * 100) / 100);

        // For reverse charge: Fortnox auto-creates VAT rows (2645/2614)
        // when VATType is EUINTERNAL — send only cost + payables rows
        const fortnoxRows = siIsRC
          ? [
            { Account: siAcct, Debit: net, Credit: 0 },
            { Account: 2440, Debit: 0, Credit: net },
          ]
          : [
            { Account: siAcct, Debit: net, Credit: 0 },
            { Account: 2640, Debit: vat, Credit: 0 },
            { Account: 2440, Debit: 0, Credit: siTotalAmt },
          ];

        const vatType = siIsRC ? "EUINTERNAL" : "NORMAL";

        const result = await callFortnoxWrite(
          "exportSupplierInvoice",
          {
            invoice: {
              SupplierNumber: siSupplierNum,
              InvoiceNumber: siInvNum || undefined,
              InvoiceDate: new Date().toISOString().slice(0, 10),
              DueDate: siDue ||
                new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
              Total: siTotalAmt,
              VAT: siIsRC ? 0 : vat,
              VATType: vatType,
              Currency: siCurr,
              AccountingMethod: "ACCRUAL",
              SupplierInvoiceRows: fortnoxRows,
            },
          },
          "export_supplier_invoice",
          siInvNum || String(siSupplierNum),
        );
        void auditService.log({
          userId,
          companyId: companyId || undefined,
          actorType: "ai",
          action: "create",
          resourceType: "supplier_invoice",
          resourceId: siInvNum ||
            `supplier-${siSupplierNum}`,
          newState: result as unknown as Record<string, unknown>,
        });
        const rcNote = siIsRC ? " (omvänd skattskyldighet)" : "";
        return `Leverantörsfaktura skapad!${rcNote}\n- Belopp: ${siTotalAmt} kr${siIsRC ? "" : ` (${net} + ${vat} moms)`}\n- Konto: ${siAcct}\n- Förfallodatum: ${
          siDue || "30 dagar"
        }`;
      }
      case "export_journal_to_fortnox": {
        const ejArgs = toolArgs as ExportJournalToFortnoxArgs;
        const { data: je } = await supabaseAdmin.from("journal_entries").select(
          "*",
        ).eq("verification_id", ejArgs.journal_entry_id).maybeSingle();
        if (!je) {
          return `Kunde inte hitta verifikat ${ejArgs.journal_entry_id}.`;
        }
        const entries = typeof je.entries === "string"
          ? JSON.parse(je.entries)
          : je.entries;
        const rows = entries.map((e: any) => ({
          Account: e.account,
          Debit: e.debit || 0,
          Credit: e.credit || 0,
          Description: e.accountName || je.description,
        }));
        const result = await callFortnoxWrite(
          "exportVoucher",
          {
            voucher: {
              Description: `${je.description} (${ejArgs.journal_entry_id})`,
              TransactionDate: new Date().toISOString().slice(0, 10),
              VoucherSeries: "A",
              VoucherRows: rows,
            },
            vatReportId: `je:${ejArgs.journal_entry_id}`,
          },
          "export_voucher",
          ejArgs.journal_entry_id,
        );
        const v = (result as any).Voucher || result;
        void auditService.log({
          userId,
          companyId: companyId || undefined,
          actorType: "ai",
          action: "export",
          resourceType: "voucher",
          resourceId: ejArgs.journal_entry_id,
          newState: v,
        });
        return `Exporterat till Fortnox! Verifikat: ${v.VoucherSeries || "A"}-${
          v.VoucherNumber || "?"
        }`;
      }
      case "book_supplier_invoice": {
        const bArgs = toolArgs as BookSupplierInvoiceArgs;
        // Resolve casing — AI may send snake_case, camelCase, or PascalCase
        const bInvNum = (bArgs.invoice_number || bArgs.invoiceNumber || bArgs.InvoiceNumber || bArgs.given_number || bArgs.givenNumber || bArgs.GivenNumber) as string;
        // Booking is non-critical — attempt but gracefully degrade if "enkel attest" is disabled
        try {
          try {
            await callFortnoxWrite(
              "approveSupplierInvoiceBookkeep",
              { givenNumber: Number(bInvNum) },
              "approve_supplier_invoice",
              bInvNum,
            );
          } catch {
            await callFortnoxWrite(
              "bookSupplierInvoice",
              { givenNumber: Number(bInvNum) },
              "bookkeep_supplier_invoice",
              bInvNum,
            );
          }
          void auditService.log({
            userId,
            companyId: companyId || undefined,
            actorType: "ai",
            action: "update",
            resourceType: "supplier_invoice",
            resourceId: bInvNum,
          });
          return `Leverantörsfaktura ${bInvNum} är nu bokförd.`;
        } catch (bookingErr: unknown) {
          logger.warn("book_supplier_invoice failed (non-critical)", {
            invoiceNumber: bInvNum,
            error: bookingErr instanceof Error ? bookingErr.message : "Unknown",
          });
          void auditService.log({
            userId,
            companyId: companyId || undefined,
            actorType: "ai",
            action: "update_skipped",
            resourceType: "supplier_invoice",
            resourceId: bInvNum,
          });
          return `⚠️ Leverantörsfaktura ${bInvNum} kunde inte bokföras automatiskt. Bokför manuellt i Fortnox under Leverantörsfakturor → Attestera/Bokför.`;
        }
      }
      case "create_invoice": {
        const ciArgs = toolArgs as Record<string, unknown>;
        // Resolve casing — AI may send snake_case, camelCase, or PascalCase
        const ciCustNum = (ciArgs.customer_number || ciArgs.customerNumber || ciArgs.CustomerNumber) as string;
        if (!ciCustNum) {
          return "Kundnummer saknas. Ange kundnummer för att skapa fakturan.";
        }
        const result = await callFortnoxWrite(
          "createInvoice",
          {
            invoice: {
              CustomerNumber: ciCustNum,
              InvoiceRows: ciArgs.InvoiceRows || ciArgs.invoice_rows || [],
              InvoiceDate: (ciArgs.InvoiceDate || ciArgs.invoice_date ||
                new Date().toISOString().slice(0, 10)) as string,
              DueDate: (ciArgs.DueDate || ciArgs.due_date || undefined) as string | undefined,
              Comments: (ciArgs.Comments || ciArgs.comments || undefined) as string | undefined,
            },
          },
          "create_invoice",
          String(ciCustNum),
        );
        const inv = (result as any)?.Invoice || result;
        void auditService.log({
          userId,
          companyId: companyId || undefined,
          actorType: "ai",
          action: "create",
          resourceType: "invoice",
          resourceId: String(inv.InvoiceNumber || ""),
          newState: result,
        });
        return `Kundfaktura skapad som utkast (nr ${inv.InvoiceNumber || "tilldelas"}) i Fortnox.`;
      }
      case "update_invoice": {
        const uiArgs = toolArgs as Record<string, unknown>;
        const docNum = Number(uiArgs.DocumentNumber || uiArgs.document_number);
        if (!docNum) throw new Error("DocumentNumber saknas för update_invoice");

        const invoiceUpdate: Record<string, unknown> = {};
        if (uiArgs.InvoiceRows && Array.isArray(uiArgs.InvoiceRows)) invoiceUpdate.InvoiceRows = uiArgs.InvoiceRows;
        if (uiArgs.DueDate) invoiceUpdate.DueDate = uiArgs.DueDate;
        if (uiArgs.Comments) invoiceUpdate.Comments = uiArgs.Comments;
        if (uiArgs.OurReference) invoiceUpdate.OurReference = uiArgs.OurReference;
        if (uiArgs.YourReference) invoiceUpdate.YourReference = uiArgs.YourReference;
        if (uiArgs.InvoiceDate) invoiceUpdate.InvoiceDate = uiArgs.InvoiceDate;

        const result = await callFortnoxWrite(
          "updateInvoice",
          { documentNumber: docNum, invoice: invoiceUpdate },
          "update_invoice",
          String(docNum),
        );
        const updatedInv = (result as any)?.Invoice || result;
        void auditService.log({
          userId,
          companyId: companyId || undefined,
          actorType: "ai",
          action: "update",
          resourceType: "invoice",
          resourceId: String(docNum),
          newState: result,
        });
        return `Faktura ${docNum} har uppdaterats (ny total: ${updatedInv.Total || "?"} kr) i Fortnox.`;
      }
      case "company_lookup": {
        return await lookupCompanyOnAllabolag((toolArgs as any).company_name);
      }
      default:
        return null;
    }
  } catch (err) {
    logger.error(`Fortnox tool ${toolName} failed`, { error: err instanceof Error ? err.message : "unknown" });
    const friendlyNames: Record<string, string> = {
      get_customers: "hämtning av kunder",
      get_suppliers: "hämtning av leverantörer",
      get_articles: "hämtning av artiklar",
      get_invoice: "hämtning av faktura",
      get_supplier_invoice: "hämtning av leverantörsfaktura",
      create_invoice: "skapande av faktura",
      get_vat_report: "hämtning av momsrapport",
      get_company_info: "hämtning av företagsinfo",
      get_financial_summary: "hämtning av ekonomisk sammanfattning",
      get_account_balances: "hämtning av kontosaldon",
      create_voucher: "skapande av verifikation",
      lookup_company: "sökning av företag",
    };
    const friendly = friendlyNames[toolName] || "åtgärden";
    // Return generic error to user/AI — raw error details only in server logs
    return `Ett fel uppstod vid ${friendly}. Försök igen om en stund.`;
  }
}

async function fetchWebSearchResults(
  toolArgs: Record<string, unknown>,
  authHeader: string,
): Promise<WebSearchResponse | null> {
  const args = toolArgs as WebSearchArgs;
  const query = typeof args?.query === "string" ? args.query.trim() : "";
  if (!query) return null;

  const supabaseUrl = getEnv(["SUPABASE_URL", "SB_SUPABASE_URL", "API_URL"]);
  if (!supabaseUrl) return null;

  const payload: Record<string, unknown> = { query };
  if (typeof args.max_results === "number") {
    payload.max_results = args.max_results;
  }
  if (typeof args.recency_days === "number") {
    payload.recency_days = args.recency_days;
  }

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/web-search`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      logger.warn("Web search failed", { status: response.status });
      return null;
    }

    const data = await response.json() as WebSearchResponse;
    if (!data || !Array.isArray(data.results)) return null;
    return data;
  } catch (error) {
    logger.warn("Web search request errored", { error: String(error) });
    return null;
  }
}

Deno.serve(async (req: Request) => {
  const requestOrigin = req.headers.get("origin") || req.headers.get("Origin");
  const corsHeaders = getCorsHeaders(requestOrigin);
  const provider = (Deno.env.get("LLM_PROVIDER") || "gemini").toLowerCase();
  logger.info("LLM provider configured", { provider });
  const responseHeaders = {
    ...corsHeaders,
    "X-LLM-Provider": provider,
  };

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return createOptionsResponse(req);
  }

  if (requestOrigin && !isOriginAllowed(requestOrigin)) {
    return createForbiddenOriginResponse(requestOrigin);
  }

  try {
    let {
      action,
      message,
      fileData,
      fileDataPages,
      documentText,
      history,
      conversationId,
      companyId,
      fileUrl,
      fileName,
      vatReportContext,
      model,
      titleContext,
      assistantMode,
      stream: streamParam,
      metadata: requestMetadata,
    }: RequestBody = await req.json();
    const hasFileAttachment = Boolean(
      fileData || fileDataPages || documentText || fileUrl || fileName,
    );
    if (fileData) {
      logger.info("Received fileData", {
        mimeType: fileData.mimeType,
        dataLength: fileData.data?.length || 0,
      });
    }
    const isSkillAssist = assistantMode === "skill_assist";

    // Log which model is requested
    if (model) {
      logger.info("Client requested model:", { model });
    }

    if (!message) {
      return new Response(
        JSON.stringify({ error: "Message is required" }),
        {
          status: 400,
          headers: { ...responseHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Require auth for AI calls to prevent anonymous abuse/costs
    const authHeader = req.headers.get("authorization") ||
      req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        {
          status: 401,
          headers: { ...responseHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Initialize Supabase client with service role for rate limiting
    const supabaseUrl = getEnv(["SUPABASE_URL", "SB_SUPABASE_URL", "API_URL"]);
    const supabaseServiceKey = getEnv([
      "SUPABASE_SERVICE_ROLE_KEY",
      "SB_SERVICE_ROLE_KEY",
      "SERVICE_ROLE_KEY",
      "SECRET_KEY",
    ]);
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing Supabase service role configuration");
    }
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Initialize AuditService for BFL compliance logging
    const auditService = new AuditService(supabaseAdmin);

    // Resolve actual user id from the access token (don't trust client-provided IDs)
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: { user }, error: userError } = await supabaseAdmin.auth
      .getUser(token);
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        {
          status: 401,
          headers: { ...responseHeaders, "Content-Type": "application/json" },
        },
      );
    }
    const userId = user.id;
    let resolvedCompanyId: string | null =
      typeof companyId === "string" && companyId.trim()
        ? companyId.trim()
        : null;

    // Check rate limit
    const plan = await getUserPlan(supabaseAdmin, userId);
    logger.debug("Resolved plan", { userId, plan });

    // Resolve abstract tier ("standard"/"pro") to concrete model ID
    const effectiveModel = (() => {
      // Backwards compat: map legacy full model IDs to tier
      let resolvedTier: "standard" | "pro" = "standard";
      if (model === "pro" || model?.includes("pro")) {
        resolvedTier = "pro";
      } else if (model === "standard" || !model || model?.includes("flash")) {
        resolvedTier = "standard";
      }

      // Only pro and trial users can use pro
      if (resolvedTier === "pro" && plan !== "pro" && plan !== "trial") {
        logger.info(
          "User requested Pro model but has free plan, falling back to Standard",
          { userId, requestedTier: model },
        );
        resolvedTier = "standard";
      }

      const modelId = MODEL_MAP[resolvedTier];
      logger.info("Model resolved", { tier: resolvedTier, modelId });
      return modelId;
    })();

    const rateLimiter = new RateLimiterService(
      supabaseAdmin,
      getRateLimitConfigForPlan(plan),
    );
    const rateLimit = await rateLimiter.checkAndIncrement(
      userId,
      RATE_LIMIT_ENDPOINT,
    );

    if (!rateLimit.allowed) {
      logger.warn("Rate limit exceeded", { userId });
      return new Response(
        JSON.stringify({
          error: "rate_limit_exceeded",
          message: rateLimit.message,
          remaining: rateLimit.remaining,
          resetAt: rateLimit.resetAt.toISOString(),
        }),
        {
          status: 429,
          headers: {
            ...responseHeaders,
            "Content-Type": "application/json",
            "X-RateLimit-Remaining": String(rateLimit.remaining),
            "X-RateLimit-Reset": rateLimit.resetAt.toISOString(),
          },
        },
      );
    }

    logger.info("Rate limit check passed", {
      userId,
      remaining: rateLimit.remaining,
    });

    // --- Monthly usage tracking (soft limits, warn-only during beta) ---
    const usageTracker = new UsageTrackingService(supabaseAdmin);
    let usageWarningPayload: {
      type: string;
      ratio: number;
      used: number;
      limit: number;
    } | null = null;

    try {
      const [monthlyUsage, planLimits] = await Promise.all([
        usageTracker.getMonthlyUsage(userId),
        usageTracker.getPlanLimits(plan),
      ]);
      if (planLimits && planLimits.ai_messages_per_month > 0) {
        const used = monthlyUsage["ai_message"] ?? 0;
        const limit = planLimits.ai_messages_per_month;
        const ratio = used / limit;
        if (ratio >= 0.8) {
          usageWarningPayload = {
            type: "ai_message",
            ratio: Math.round(ratio * 100) / 100,
            used,
            limit,
          };
        }
      }
    } catch (e) {
      logger.warn("Usage check failed (non-blocking)", { error: String(e) });
    }

    let verifiedConversation: {
      id: string;
      company_id: string | null;
      title: string | null;
    } | null = null;

    // Verify that the conversation (if provided) belongs to the authenticated user.
    if (conversationId) {
      const { data: conversation, error: conversationError } =
        await supabaseAdmin
          .from("conversations")
          .select("id, company_id, title")
          .eq("id", conversationId)
          .eq("user_id", userId)
          .maybeSingle();

      if (conversationError) {
        logger.error(
          "Failed to verify conversation ownership",
          conversationError,
          { conversationId, userId },
        );
        return new Response(
          JSON.stringify({ error: "conversation_verification_failed" }),
          {
            status: 500,
            headers: { ...responseHeaders, "Content-Type": "application/json" },
          },
        );
      }

      if (!conversation) {
        return new Response(
          JSON.stringify({ error: "conversation_not_found" }),
          {
            status: 404,
            headers: { ...responseHeaders, "Content-Type": "application/json" },
          },
        );
      }

      verifiedConversation = {
        id: conversation.id,
        company_id: conversation.company_id ?? null,
        title: conversation.title ?? null,
      };

      if (conversation.company_id) {
        if (!resolvedCompanyId) {
          logger.info("Resolved companyId from conversation fallback", {
            conversationId,
            companyId: conversation.company_id,
          });
        }
        resolvedCompanyId = String(conversation.company_id);
      }
    }

    // Fallback 3: query companies table by user_id if both request and conversation fallbacks failed
    if (!resolvedCompanyId) {
      const { data: defaultCompany } = await supabaseAdmin
        .from("companies")
        .select("id")
        .eq("user_id", userId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (defaultCompany?.id) {
        resolvedCompanyId = defaultCompany.id;
        logger.info("Resolved companyId from companies table fallback", {
          userId,
          companyId: resolvedCompanyId,
        });

        // Backfill conversation.company_id so future messages skip this fallback
        if (verifiedConversation && !verifiedConversation.company_id) {
          const { error: backfillError } = await supabaseAdmin
            .from("conversations")
            .update({ company_id: resolvedCompanyId })
            .eq("id", verifiedConversation.id)
            .eq("user_id", userId);
          if (backfillError) {
            logger.warn("Failed to backfill conversation.company_id", {
              conversationId: verifiedConversation.id,
              companyId: resolvedCompanyId,
              error: backfillError.message,
            });
          }
        }
      }
    }

    if (action === "generate_title") {
      if (!conversationId) {
        return new Response(
          JSON.stringify({ error: "conversation_id_required" }),
          {
            status: 400,
            headers: { ...responseHeaders, "Content-Type": "application/json" },
          },
        );
      }

      if (!verifiedConversation) {
        logger.error("Failed to fetch conversation for title generation", {
          conversationId,
        });
        return new Response(
          JSON.stringify({ error: "conversation_not_found" }),
          {
            status: 404,
            headers: { ...responseHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const currentTitle = verifiedConversation.title?.trim();
      if (currentTitle && currentTitle !== "Ny konversation") {
        return new Response(
          JSON.stringify({
            title: currentTitle,
            updated: false,
          }),
          {
            headers: { ...responseHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const safeContext = typeof titleContext === "string" ? titleContext : "";
      const generatedTitle = await generateConversationTitle(
        message,
        safeContext,
        Deno.env.get("GEMINI_API_KEY"),
      );

      const { error: updateError } = await supabaseAdmin
        .from("conversations")
        .update({ title: generatedTitle, updated_at: new Date().toISOString() })
        .eq("id", conversationId)
        .eq("user_id", userId);

      if (updateError) {
        logger.error("Title update failed", {
          conversationId,
          error: updateError.message,
        });
        return new Response(
          JSON.stringify({
            title: generatedTitle,
            updated: false,
          }),
          {
            headers: { ...responseHeaders, "Content-Type": "application/json" },
          },
        );
      }

      verifiedConversation.title = generatedTitle;

      return new Response(
        JSON.stringify({
          title: generatedTitle,
          updated: true,
        }),
        {
          headers: { ...responseHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // User message is already saved by the frontend (chat-provider.tsx) before
    // this function is called. We only save the assistant response here.
    let conversationService: ConversationService | null = null;

    // Handle action plan response (approve/reject/modify)
    if (requestMetadata?.action_response) {
      const { plan_id, decision, modifications } =
        requestMetadata.action_response;
      logger.info("Action plan response received", { plan_id, decision });

      try {
        // Find the message with this action plan
        const { data: planMessages } = await supabaseAdmin
          .from("messages")
          .select("id, metadata")
          .eq("conversation_id", conversationId)
          .not("metadata", "is", null)
          .order("created_at", { ascending: false })
          .limit(20);

        const planMessage = (planMessages || []).find(
          (m: any) => m.metadata?.plan_id === plan_id,
        );

        if (!planMessage) {
          return new Response(
            JSON.stringify({ error: "action_plan_not_found" }),
            {
              status: 404,
              headers: {
                ...responseHeaders,
                "Content-Type": "application/json",
              },
            },
          );
        }

        const plan = planMessage.metadata as Record<string, unknown>;
        const actions = (plan.actions || []) as Array<{
          id: string;
          action_type: string;
          description: string;
          parameters: Record<string, unknown>;
          posting_rows?: Array<Record<string, unknown>>;
          status: string;
        }>;

        if (decision === "rejected") {
          // Update plan status to rejected
          await supabaseAdmin
            .from("messages")
            .update({
              metadata: { ...plan, status: "rejected" },
            })
            .eq("id", planMessage.id);

          const encoder = new TextEncoder();
          const rejectStream = new ReadableStream({
            start(controller) {
              const text = "Handlingsplanen har avbrutits. Inget har ändrats i Fortnox.";
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ text })}\n\n`,
                ),
              );
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
            },
          });

          // Save the assistant rejection message
          if (conversationService) {
            await conversationService.addMessage(
              conversationId!,
              "assistant",
              "Handlingsplanen har avbrutits. Inget har ändrats i Fortnox.",
            );
          }

          return new Response(rejectStream, {
            headers: {
              ...responseHeaders,
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
            },
          });
        }

        // Execute approved/modified actions
        if (!resolvedCompanyId) {
          logger.error("Action plan execution blocked: no companyId", {
            userId,
            conversationId,
            companyIdFromRequest: companyId,
            companyIdFromConversation: verifiedConversation?.company_id,
          });
          const encoder = new TextEncoder();
          const errStream = new ReadableStream({
            start(controller) {
              const text = "Bolagskontext saknas — välj ett företag och försök igen.";
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`));
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
            },
          });
          return new Response(errStream, {
            headers: {
              ...responseHeaders,
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
            },
          });
        }

        const fortnoxConfig = {
          clientId: Deno.env.get("FORTNOX_CLIENT_ID") ?? "",
          clientSecret: Deno.env.get("FORTNOX_CLIENT_SECRET") ?? "",
          redirectUri: "",
        };
        const supabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
          global: { headers: { Authorization: authHeader } },
        });

        const executionResults: Array<{
          action_id: string;
          success: boolean;
          result?: string;
          error?: string;
        }> = [];

        const encoder = new TextEncoder();
        const execStream = new ReadableStream({
          async start(controller) {
            try {
              let createdCustomerNumber: string | undefined;
              let createdSupplierNumber: string | undefined;

              for (let i = 0; i < actions.length; i++) {
                let action = actions[i];

                // Apply modifications if any
                if (decision === "modified" && modifications) {
                  const actionMods = (modifications as any)[action.id];
                  if (actionMods) {
                    action = { ...action, ...actionMods };
                  }
                }

                // Stream status update
                controller.enqueue(
                  encoder.encode(
                    `data: ${
                      JSON.stringify({
                        actionStatus: {
                          step: i + 1,
                          total: actions.length,
                          action_id: action.id,
                          description: action.description,
                          status: "executing",
                        },
                      })
                    }\n\n`,
                  ),
                );

                try {
                  const buildIdempotencyKey = (op: string, res: string) =>
                    `action_plan:${plan_id}:${op}:${res}`.slice(0, 200);

                  const callFortnoxWrite = async (
                    fnAction: string,
                    payload: Record<string, unknown>,
                    operation: string,
                    resource: string,
                  ): Promise<Record<string, unknown>> => {
                    const response = await fetch(
                      `${supabaseUrl}/functions/v1/fortnox`,
                      {
                        method: "POST",
                        headers: {
                          Authorization: authHeader,
                          "Content-Type": "application/json",
                        },
                        body: JSON.stringify({
                          action: fnAction,
                          companyId: resolvedCompanyId,
                          payload: {
                            ...payload,
                            idempotencyKey: buildIdempotencyKey(
                              operation,
                              resource,
                            ),
                            sourceContext: "action-plan-execution",
                          },
                        }),
                      },
                    );
                    const result = await response.json().catch(() => ({}));
                    if (!response.ok) {
                      const detail = typeof result?.detail === "string" ? ` (${result.detail})` : "";
                      throw new Error(
                        (typeof result?.error === "string"
                          ? result.error
                          : `Fortnox-anrop misslyckades (${response.status})`) + detail,
                      );
                    }
                    return (result || {}) as Record<string, unknown>;
                  };

                  let resultText = "";
                  const params = action.parameters || {};

                  switch (action.action_type) {
                    case "create_supplier_invoice": {
                      const isRC = (params.is_reverse_charge ?? params.isReverseCharge ?? params.IsReverseCharge) === true;
                      const vatMul = 1 +
                        (((params.vat_rate ?? params.vatRate ?? params.VatRate) as number || 25) / 100);
                      // Extract total from posting_rows (preferred — always SEK) or params as fallback
                      let totalAmt = 0;
                      if (action.posting_rows && Array.isArray(action.posting_rows) && action.posting_rows.length > 0) {
                        // posting_rows has debit/credit in SEK — the credit on 2440 (leverantörsskuld) = total
                        const creditRow = action.posting_rows.find((r: any) => String(r.account) === "2440" && r.credit > 0);
                        if (creditRow) {
                          totalAmt = creditRow.credit as number;
                        } else {
                          // Fallback: sum all debits (cost + VAT = total)
                          totalAmt = action.posting_rows.reduce((sum: number, r: any) => sum + ((r.debit as number) || 0), 0);
                        }
                        logger.info("Extracted totalAmt from posting_rows (SEK)", { totalAmt, rows: action.posting_rows });
                      }
                      if (!totalAmt) {
                        totalAmt = (params.total_amount ?? params.totalAmount ?? params.TotalAmount ?? params.Total ?? params.amount ?? params.Amount) as number || 0;
                      }
                      const net = isRC
                        ? totalAmt
                        : Math.round((totalAmt / vatMul) * 100) / 100;
                      const vat = isRC
                        ? 0
                        : Math.round((totalAmt - net) * 100) / 100;

                      // Resolve SupplierNumber — prefer createdSupplierNumber from prior create_supplier action
                      // (AI often sends supplier name instead of number in params)
                      const supplierRaw = (createdSupplierNumber || params.supplier_number || params.supplierNumber || params.SupplierNumber) as string;
                      const supplierNum = resolvedCompanyId
                        ? (await resolveSupplierNumber(supplierRaw, authHeader, resolvedCompanyId)) || supplierRaw
                        : supplierRaw;
                      const siInvoiceNumber = (params.invoice_number || params.invoiceNumber || params.InvoiceNumber ||
                              `KVITTO-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Date.now().toString(36).slice(-4).toUpperCase()}`) as string;
                      const siInvoiceDate = (params.invoice_date || params.invoiceDate || params.InvoiceDate ||
                              new Date().toISOString().slice(0, 10)) as string;
                      const siDueDate = (params.due_date || params.dueDate || params.DueDate ||
                              new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)) as string;
                      // Use currency from AI parameters — Fortnox handles conversion for foreign currencies
                      const siCurrency = ((params.currency || params.Currency) as string) || "SEK";
                      // Extract cost account from posting_rows if not in params
                      let siAccount = (params.account || params.Account) as number;
                      if (!siAccount && action.posting_rows && Array.isArray(action.posting_rows)) {
                        const costRow = action.posting_rows.find((r: any) => {
                          const acct = Number(r.account);
                          return acct >= 4000 && acct <= 6999 && (r.debit as number) > 0;
                        });
                        if (costRow) siAccount = Number(costRow.account);
                      }
                      if (!siAccount) siAccount = 5010;

                      const result = await callFortnoxWrite(
                        "exportSupplierInvoice",
                        {
                          invoice: {
                            SupplierNumber: supplierNum,
                            InvoiceNumber: siInvoiceNumber,
                            InvoiceDate: siInvoiceDate,
                            DueDate: siDueDate,
                            Total: totalAmt,
                            Currency: siCurrency,
                            VATType: isRC ? "EUINTERNAL" : undefined,
                            SupplierInvoiceRows: [
                              {
                                Account: siAccount,
                                Debit: net,
                                Credit: 0,
                              },
                              // For non-RC: add VAT + supplier liability rows
                              // For RC (EUINTERNAL): Fortnox auto-generates 2440, 2645, 2614
                              ...(isRC ? [] : [
                                {
                                  Account: 2640,
                                  Debit: vat,
                                  Credit: 0,
                                },
                                {
                                  Account: 2440,
                                  Debit: 0,
                                  Credit: totalAmt,
                                },
                              ]),
                            ],
                          },
                        },
                        "create_supplier_invoice",
                        String(supplierNum),
                      );
                      const givenNumber =
                        (result as any)?.SupplierInvoice?.GivenNumber || "";

                      // --- Attach source file to supplier invoice (non-blocking) ---
                      const siSourceFile = plan.source_file as SourceFile | undefined;
                      let siAttachmentNote = '';
                      if (siSourceFile?.storage_path && givenNumber) {
                        try {
                          const siAttachResult = await callFortnoxWrite(
                            "attachFileToSupplierInvoice",
                            {
                              storagePath: siSourceFile.storage_path,
                              fileName: siSourceFile.file_name,
                              mimeType: siSourceFile.mime_type,
                              supplierInvoiceNumber: String(givenNumber),
                            },
                            "attach_file_to_supplier_invoice",
                            `si-attachment-${plan_id}`,
                          );

                          if ((siAttachResult as any)?.success) {
                            logger.info('File attached to supplier invoice', {
                              fileId: (siAttachResult as any).fileId,
                              givenNumber,
                            });
                            siAttachmentNote = ` med bifogat kvitto "${siSourceFile.file_name}"`;
                          } else {
                            logger.warn('Supplier invoice file attachment failed (non-blocking)', {
                              error: (siAttachResult as any)?.error,
                            });
                            siAttachmentNote = '. Filbifogning misslyckades — bifoga kvittot manuellt i Fortnox';
                          }
                        } catch (attachError) {
                          logger.warn('File attachment to supplier invoice failed', {
                            error: attachError instanceof Error ? attachError.message : 'Unknown',
                            storagePath: siSourceFile.storage_path,
                          });
                          siAttachmentNote = '. Filbifogning misslyckades — bifoga kvittot manuellt i Fortnox';
                        }
                      }

                      // Inject created GivenNumber into subsequent book/payment actions
                      if (givenNumber) {
                        for (const remaining of actions.slice(i + 1)) {
                          if (remaining.action_type === "book_supplier_invoice" || remaining.action_type === "register_payment") {
                            remaining.parameters = { ...remaining.parameters, invoice_number: String(givenNumber) };
                            logger.info("Injected created supplier invoice number into next action", { givenNumber, actionType: remaining.action_type });
                          }
                        }
                      }
                      resultText =
                        `Leverantörsfaktura skapad (nr ${givenNumber})${siAttachmentNote}`;
                      void auditService.log({
                        userId,
                        companyId: resolvedCompanyId || undefined,
                        actorType: "ai",
                        action: "create",
                        resourceType: "supplier_invoice",
                        resourceId: String(givenNumber),
                        newState: result,
                      });
                      break;
                    }
                    case "book_supplier_invoice": {
                      const bsiInvoiceNum = (params.invoice_number || params.invoiceNumber || params.InvoiceNumber || params.given_number || params.givenNumber || params.GivenNumber) as string | number;
                      // Booking is non-critical — attempt but gracefully degrade if "enkel attest" is disabled
                      try {
                        try {
                          await callFortnoxWrite(
                            "approveSupplierInvoiceBookkeep",
                            {
                              givenNumber: Number(bsiInvoiceNum),
                            },
                            "approve_supplier_invoice",
                            String(bsiInvoiceNum),
                          );
                        } catch (approveErr: unknown) {
                          logger.warn("approvalbookkeep failed, trying bookkeep", { error: approveErr instanceof Error ? approveErr.message : "Unknown" });
                          await callFortnoxWrite(
                            "bookSupplierInvoice",
                            {
                              givenNumber: Number(bsiInvoiceNum),
                            },
                            "bookkeep_supplier_invoice",
                            String(bsiInvoiceNum),
                          );
                        }
                        resultText =
                          `Leverantörsfaktura ${bsiInvoiceNum} bokförd`;
                        void auditService.log({
                          userId,
                          companyId: resolvedCompanyId || undefined,
                          actorType: "ai",
                          action: "update",
                          resourceType: "supplier_invoice",
                          resourceId: String(bsiInvoiceNum),
                        });
                      } catch (bookingErr: unknown) {
                        logger.warn("book_supplier_invoice failed in action plan (non-critical)", {
                          invoiceNumber: String(bsiInvoiceNum),
                          error: bookingErr instanceof Error ? bookingErr.message : "Unknown",
                        });
                        resultText =
                          `⚠️ Leverantörsfaktura ${bsiInvoiceNum} kunde inte bokföras automatiskt. Bokför manuellt i Fortnox under Leverantörsfakturor → Attestera/Bokför.`;
                        void auditService.log({
                          userId,
                          companyId: resolvedCompanyId || undefined,
                          actorType: "ai",
                          action: "update_skipped",
                          resourceType: "supplier_invoice",
                          resourceId: String(bsiInvoiceNum),
                        });
                      }
                      break;
                    }
                    case "create_supplier": {
                      // Use findOrCreateSupplier to handle existing suppliers gracefully
                      // AI sends PascalCase (Name) via propose_action_plan schema,
                      // but direct tool uses lowercase (name) — handle both
                      const supplierName = (params.Name || params.name) as string;
                      const supplierOrg = (params.OrganisationNumber || params.org_number) as string | undefined;
                      const supplierEmail = (params.Email || params.email) as string | undefined;
                      const result = await callFortnoxWrite(
                        "findOrCreateSupplier",
                        {
                          supplier: {
                            Name: supplierName,
                            OrganisationNumber: supplierOrg || undefined,
                            Email: supplierEmail || undefined,
                          },
                        },
                        "create_supplier",
                        String(supplierOrg || supplierName),
                      );
                      const supplier = (result as any).Supplier || result;
                      createdSupplierNumber = supplier.SupplierNumber;
                      // Always inject SupplierNumber into subsequent supplier invoice actions
                      // AI often sends supplier name instead of number — override unconditionally
                      if (createdSupplierNumber) {
                        for (const remaining of actions.slice(i + 1)) {
                          if (remaining.action_type === "create_supplier_invoice") {
                            remaining.parameters = { ...remaining.parameters, supplier_number: createdSupplierNumber };
                            logger.info("Injected createdSupplierNumber into supplier invoice action", { supplierNumber: createdSupplierNumber });
                          }
                        }
                      }
                      resultText =
                        `Leverantör skapad: ${supplier.Name || supplierName} (nr ${supplier.SupplierNumber || "tilldelas"})`;
                      break;
                    }
                    case "book_invoice":
                    case "export_journal_to_fortnox": {
                      // Build voucher from posting_rows if available
                      const postingRows = action.posting_rows || [];
                      const voucherRows = postingRows.length > 0
                        ? postingRows.map((r: any) => ({
                            Account: Number(r.account),
                            Debit: Number(r.debit) || 0,
                            Credit: Number(r.credit) || 0,
                            Description: r.comment || r.accountName || action.description,
                          }))
                        : (params.voucher?.VoucherRows || []);
                      const voucherDesc = action.description || params.voucher?.Description || params.description || params.Description || "Verifikat från Veridat";
                      const result = await callFortnoxWrite(
                        "exportVoucher",
                        {
                          voucher: {
                            Description: voucherDesc,
                            TransactionDate: (params.transaction_date || params.transactionDate || params.TransactionDate) as string || new Date().toISOString().slice(0, 10),
                            VoucherSeries: (params.voucher_series || params.voucherSeries || params.VoucherSeries) as string || "A",
                            VoucherRows: voucherRows,
                          },
                        },
                        "export_voucher",
                        String(action.id || ""),
                      );
                      const voucher = (result as any).Voucher || result;

                      // --- Attach source file to voucher (non-blocking) ---
                      // `plan` is defined earlier: const plan = planMessage.metadata as Record<string, unknown>;
                      const sourceFile = plan.source_file as SourceFile | undefined;
                      let attachmentNote = '';
                      if (sourceFile?.storage_path && voucher.VoucherNumber) {
                        try {
                          const transactionDate = (params.transaction_date || params.transactionDate || params.TransactionDate) as string ||
                            new Date().toISOString().slice(0, 10);
                          const financialYearDate = transactionDate.slice(0, 4) + '-01-01';

                          const attachResult = await callFortnoxWrite(
                            "attachFileToVoucher",
                            {
                              storagePath: sourceFile.storage_path,
                              fileName: sourceFile.file_name,
                              mimeType: sourceFile.mime_type,
                              voucherSeries: String(voucher.VoucherSeries || "A"),
                              voucherNumber: Number(voucher.VoucherNumber),
                              financialYearDate,
                            },
                            "attach_file_to_voucher",
                            `attachment-${plan_id}`,
                          );

                          if ((attachResult as any)?.success) {
                            logger.info('File attached to voucher', {
                              fileId: (attachResult as any).fileId,
                              voucherSeries: voucher.VoucherSeries,
                              voucherNumber: voucher.VoucherNumber,
                            });
                            attachmentNote = ` med bifogat kvitto "${sourceFile.file_name}"`;
                          } else {
                            logger.warn('File attachment failed (non-blocking)', {
                              error: (attachResult as any)?.error,
                            });
                            attachmentNote = '. Filbifogning misslyckades — bifoga kvittot manuellt i Fortnox';
                          }
                        } catch (attachError) {
                          // Non-blocking: log and continue — voucher is already created
                          logger.warn('File attachment to voucher failed', {
                            error: attachError instanceof Error ? attachError.message : 'Unknown',
                            storagePath: sourceFile.storage_path,
                          });
                          attachmentNote = '. Filbifogning misslyckades — bifoga kvittot manuellt i Fortnox';
                        }
                      }

                      resultText = `Verifikat exporterat: ${voucher.VoucherSeries || ""}${voucher.VoucherNumber || ""}${attachmentNote}`;
                      break;
                    }
                    case "register_payment": {
                      const payType = (params.payment_type || params.paymentType || params.PaymentType) as string;
                      const invoiceNum = String(
                        params.invoice_number || params.invoiceNumber || params.InvoiceNumber || "",
                      );
                      const payAmount = (params.amount || params.Amount) as number || 0;
                      const payDate = (params.payment_date || params.paymentDate || params.PaymentDate) as string ||
                        new Date().toISOString().slice(0, 10);

                      if (payType === "supplier") {
                        // Supplier payment is non-critical — approve+pay, but gracefully degrade
                        try {
                          try {
                            await callFortnoxWrite(
                              "approveSupplierInvoiceBookkeep",
                              { givenNumber: Number(invoiceNum) },
                              "approve_supplier_invoice",
                              invoiceNum,
                            );
                            logger.info("Auto-approved supplier invoice before payment", { invoiceNum });
                          } catch (bookErr: unknown) {
                            logger.info("Supplier invoice already booked or approval failed (continuing)", {
                              invoiceNum,
                              error: bookErr instanceof Error ? bookErr.message : "Unknown",
                            });
                          }
                          await callFortnoxWrite(
                            "registerSupplierInvoicePayment",
                            {
                              payment: {
                                InvoiceNumber: invoiceNum,
                                Amount: payAmount,
                                PaymentDate: payDate,
                              },
                            },
                            "register_supplier_invoice_payment",
                            invoiceNum,
                          );
                          resultText =
                            `Betalning ${payAmount} kr registrerad för faktura ${invoiceNum}`;
                        } catch (payErr: unknown) {
                          logger.warn("register_payment for supplier invoice failed (non-critical)", {
                            invoiceNumber: invoiceNum,
                            error: payErr instanceof Error ? payErr.message : "Unknown",
                          });
                          resultText =
                            `⚠️ Betalning kunde inte registreras — fakturan behöver attesteras och bokföras först i Fortnox.`;
                          void auditService.log({
                            userId,
                            companyId: resolvedCompanyId || undefined,
                            actorType: "ai",
                            action: "update_skipped",
                            resourceType: "supplier_invoice",
                            resourceId: invoiceNum,
                          });
                        }
                      } else {
                        // Customer payment — graceful degradation like supplier path
                        try {
                          await callFortnoxWrite(
                            "registerInvoicePayment",
                            {
                              payment: {
                                InvoiceNumber: Number(invoiceNum),
                                Amount: payAmount,
                                PaymentDate: payDate,
                              },
                            },
                            "register_invoice_payment",
                            invoiceNum,
                          );
                          resultText =
                            `Betalning ${payAmount} kr registrerad för faktura ${invoiceNum}`;
                        } catch (payErr: unknown) {
                          logger.warn("register_payment for customer invoice failed (non-critical)", {
                            invoiceNumber: invoiceNum,
                            error: payErr instanceof Error ? payErr.message : "Unknown",
                          });
                          resultText =
                            `⚠️ Betalning kunde inte registreras för faktura ${invoiceNum}. Kontrollera att fakturan är bokförd i Fortnox.`;
                        }
                      }
                      break;
                    }
                    case "create_invoice": {
                      // Resolve CustomerNumber — try params first, then createdCustomerNumber from prior action, then name lookup
                      let custNum = params.CustomerNumber || params.customer_number || createdCustomerNumber;
                      if (!custNum && resolvedCompanyId) {
                        // Fetch customer list and match by name from action/plan text
                        try {
                          const custResp = await fetch(`${supabaseUrl}/functions/v1/fortnox`, {
                            method: "POST",
                            headers: { Authorization: authHeader, "Content-Type": "application/json" },
                            body: JSON.stringify({ action: "getCustomers", companyId: resolvedCompanyId }),
                          });
                          if (custResp.ok) {
                            const custData = await custResp.json();
                            const customers = (custData?.Customers || []) as Array<{ CustomerNumber: string; Name: string }>;
                            const searchText = ((action.description || "") + " " + (plan.summary || "")).toLowerCase();
                            const match = customers.find((c: any) => searchText.includes(c.Name.toLowerCase()));
                            if (match) {
                              custNum = match.CustomerNumber;
                              logger.info("CustomerNumber resolved from name lookup", { name: match.Name, number: custNum });
                            }
                          }
                        } catch (lookupErr) {
                          logger.warn("Customer name lookup failed", lookupErr);
                        }
                      }

                      // Build InvoiceRows — try multiple sources
                      let invoiceRows = params.InvoiceRows || params.invoice_rows || params.invoiceRows || params.rows;
                      logger.info("create_invoice params", {
                        paramKeys: Object.keys(params),
                        hasInvoiceRows: !!invoiceRows,
                        hasPostingRows: !!action.posting_rows?.length,
                        description: action.description?.slice(0, 100),
                      });

                      // Helper: extract clean service description for invoice line
                      const cleanDesc = (text: string): string => {
                        let d = text
                          .replace(/^skapa\s+(kund)?faktura\s+till\s+.+?\s+(för|på)\s+/i, "")
                          .replace(/\d[\d\s]*(?:timmar|tim|st|h)\s*[áàa@×x]\s*[\d\s]+\s*kr/gi, "")
                          .replace(/[\d\s]+kr\s*(inkl\.?\s*moms|exkl\.?\s*moms)?/gi, "")
                          .replace(/^(för|på)\s+/i, "")
                          .replace(/\.\s*$/, "")
                          .replace(/,\s*$/, "")
                          .trim();
                        if (d) d = d.charAt(0).toUpperCase() + d.slice(1);
                        return d || "Konsulttjänster";
                      };

                      // Fallback 1: Parse qty×price from description/posting_row comments
                      if (!invoiceRows || (Array.isArray(invoiceRows) && invoiceRows.length === 0)) {
                        const allComments = (action.posting_rows || []).map((r: any) => r.comment || "").join(" ");
                        const text = `${action.description || ""} ${plan.summary || ""} ${allComments}`;
                        const qtyPriceMatch = text.match(/(\d+)\s*(?:timmar|tim|st|h)\s*[áàa@×x]\s*([\d\s]+)\s*kr/i);

                        if (qtyPriceMatch) {
                          const qty = parseInt(qtyPriceMatch[1], 10);
                          const unitPrice = parseInt(qtyPriceMatch[2].replace(/\s/g, ""), 10);
                          const desc = cleanDesc(action.description || plan.summary || "");
                          invoiceRows = [{
                            Description: desc,
                            Price: unitPrice,
                            DeliveredQuantity: qty,
                          }];
                          logger.info("InvoiceRows from qty×price parse", { qty, unitPrice, desc });
                        }
                      }

                      // Fallback 2: Build from posting_rows revenue lines
                      if ((!invoiceRows || (Array.isArray(invoiceRows) && invoiceRows.length === 0)) && action.posting_rows?.length) {
                        const revenueRows = action.posting_rows.filter((r: any) => {
                          const acct = parseInt(String(r.account), 10);
                          return !isNaN(acct) && acct >= 3000 && acct <= 3999;
                        });
                        const sourceRows = revenueRows.length > 0
                          ? revenueRows
                          : action.posting_rows.filter((r: any) => Number(r.credit) > 0);
                        if (sourceRows.length > 0) {
                          invoiceRows = sourceRows.map((r: any) => ({
                            Description: cleanDesc(r.comment || r.accountName || action.description || ""),
                            Price: Number(r.credit) || Number(r.debit) || 0,
                            DeliveredQuantity: 1,
                          }));
                          logger.info("InvoiceRows from posting_rows", { rowCount: invoiceRows.length });
                        }
                      }

                      // Fallback 3: Parse total amount from text
                      if (!invoiceRows || (Array.isArray(invoiceRows) && invoiceRows.length === 0)) {
                        const text = `${action.description || ""} ${plan.summary || ""}`;
                        const totalMatch = text.match(/([\d\s]+)\s*kr/i);
                        if (totalMatch) {
                          const total = parseInt(totalMatch[1].replace(/\s/g, ""), 10);
                          const isInkl = /inkl/i.test(text);
                          const nettoAmount = isInkl ? Math.round(total / 1.25) : total;
                          invoiceRows = [{
                            Description: cleanDesc(action.description || plan.summary || ""),
                            Price: nettoAmount,
                            DeliveredQuantity: 1,
                          }];
                          logger.info("InvoiceRows from total parse", { total, nettoAmount, isInkl });
                        }
                      }

                      const result = await callFortnoxWrite(
                        "createInvoice",
                        {
                          invoice: {
                            CustomerNumber: custNum,
                            InvoiceRows: invoiceRows || [],
                            InvoiceDate: params.InvoiceDate ||
                              params.invoice_date ||
                              new Date().toISOString().slice(0, 10),
                            DueDate: params.DueDate || params.due_date ||
                              undefined,
                            Comments: params.Comments || params.description ||
                              undefined,
                          },
                        },
                        "create_invoice",
                        String(custNum || ""),
                      );
                      const inv = (result as any)?.Invoice || result;
                      resultText = `Kundfaktura skapad som utkast (nr ${
                        inv.InvoiceNumber || "tilldelas"
                      })`;
                      void auditService.log({
                        userId,
                        companyId: resolvedCompanyId || undefined,
                        actorType: "ai",
                        action: "create",
                        resourceType: "invoice",
                        resourceId: String(inv.InvoiceNumber || ""),
                        newState: result,
                      });
                      break;
                    }
                    case "update_invoice": {
                      const docNum = Number(params.DocumentNumber || params.document_number);
                      if (!docNum) {
                        throw new Error("DocumentNumber saknas för update_invoice");
                      }

                      // Build update payload
                      const invoiceUpdate: Record<string, unknown> = {};

                      // InvoiceRows (must include ALL rows)
                      const updateRows = params.InvoiceRows || params.invoice_rows || params.invoiceRows || params.rows;
                      if (updateRows && Array.isArray(updateRows) && updateRows.length > 0) {
                        invoiceUpdate.InvoiceRows = updateRows;
                      }

                      // Optional fields
                      if (params.DueDate || params.due_date) invoiceUpdate.DueDate = params.DueDate || params.due_date;
                      if (params.Comments || params.comments) invoiceUpdate.Comments = params.Comments || params.comments;
                      if (params.OurReference || params.our_reference) invoiceUpdate.OurReference = params.OurReference || params.our_reference;
                      if (params.YourReference || params.your_reference) invoiceUpdate.YourReference = params.YourReference || params.your_reference;
                      if (params.InvoiceDate || params.invoice_date) invoiceUpdate.InvoiceDate = params.InvoiceDate || params.invoice_date;

                      const result = await callFortnoxWrite(
                        "updateInvoice",
                        {
                          documentNumber: docNum,
                          invoice: invoiceUpdate,
                        },
                        "update_invoice",
                        String(docNum),
                      );
                      const updatedInv = (result as any)?.Invoice || result;
                      resultText = `Faktura ${docNum} har uppdaterats (ny total: ${updatedInv.Total || "?"} kr)`;
                      void auditService.log({
                        userId,
                        companyId: resolvedCompanyId || undefined,
                        actorType: "ai",
                        action: "update",
                        resourceType: "invoice",
                        resourceId: String(docNum),
                        newState: result,
                      });
                      break;
                    }
                    case "create_customer": {
                      // Auto-lookup company on allabolag.se if org number is missing
                      const customerName = params.name || params.Name || "";
                      let orgNr = params.org_number || params.OrganisationNumber;
                      let address = params.address || params.Address1;
                      let zipCode = params.zip_code || params.ZipCode;
                      let city = params.city || params.City;

                      if (!orgNr && customerName) {
                        try {
                          const lookupText = await lookupCompanyOnAllabolag(customerName);
                          // Parse first result: "- Name (XXXXXX-XXXX): Address, ZipCode City [Status]"
                          const lineMatch = lookupText.match(/^- .+?\((\d{6}-?\d{4})\):\s*(.+?),\s*(\d{3}\s?\d{2})\s+(.+?)\s*\[/m);
                          if (lineMatch) {
                            orgNr = orgNr || lineMatch[1];
                            address = address || lineMatch[2].trim();
                            zipCode = zipCode || lineMatch[3].trim();
                            city = city || lineMatch[4].trim();
                            logger.info("Company lookup enriched customer data", { customerName, orgNr, city });
                          }
                        } catch (lookupErr) {
                          logger.warn("Company lookup failed during create_customer, proceeding without", lookupErr);
                        }
                      }

                      const result = await callFortnoxWrite(
                        "createCustomer",
                        {
                          customer: {
                            Name: customerName,
                            OrganisationNumber: orgNr || undefined,
                            Email: params.email || params.Email || undefined,
                            Address1: address || undefined,
                            ZipCode: zipCode || undefined,
                            City: city || undefined,
                          },
                        },
                        "create_customer",
                        String(params.org_number || params.name || params.Name),
                      );
                      const customer = (result as any).Customer || result;
                      createdCustomerNumber = customer.CustomerNumber;
                      // Inject CustomerNumber into subsequent invoice actions to avoid Fortnox replication delay
                      if (createdCustomerNumber) {
                        for (const remaining of actions.slice(i + 1)) {
                          if (remaining.action_type === "create_invoice" && !remaining.parameters?.CustomerNumber) {
                            remaining.parameters = { ...remaining.parameters, CustomerNumber: createdCustomerNumber };
                            logger.info("Injected createdCustomerNumber into invoice action", { customerNumber: createdCustomerNumber });
                          }
                        }
                      }
                      resultText =
                        `Kund skapad: ${customer.Name || params.name || params.Name} (nr ${customer.CustomerNumber || "tilldelas"})`;
                      break;
                    }
                    case "search_invoices": {
                      // Read-tool that ended up in action plan — run same logic as streaming path
                      const searchArgs = params as { query?: string; status?: string; limit?: number };
                      const fetchLimit = Math.min(searchArgs.limit || 25, 100);
                      const invResult = await callFortnoxRead("getInvoices", {
                        pagination: { page: 1, limit: fetchLimit },
                      }, authHeader, resolvedCompanyId);
                      let invoices = ((invResult as any)?.Invoices || []) as Array<Record<string, unknown>>;
                      if (searchArgs.query) {
                        const q = searchArgs.query.toLowerCase();
                        invoices = invoices.filter((inv: any) =>
                          (inv.CustomerName || "").toLowerCase().includes(q) ||
                          String(inv.DocumentNumber || "").includes(q)
                        );
                      }
                      if (searchArgs.status && searchArgs.status !== "all") {
                        invoices = invoices.filter((inv: any) => {
                          const cancelled = inv.Cancelled === true;
                          if (searchArgs.status === "cancelled") return cancelled;
                          if (cancelled) return false;
                          const balance = Number(inv.Balance) || 0;
                          const booked = inv.Booked === true || String(inv.Booked).toLowerCase() === "true";
                          const dueDate = inv.DueDate as string;
                          const isOverdue = dueDate ? new Date(dueDate) < new Date() : false;
                          if (searchArgs.status === "paid") return balance === 0 && booked;
                          if (searchArgs.status === "overdue") return balance > 0 && isOverdue;
                          if (searchArgs.status === "unpaid") return balance > 0;
                          return true;
                        });
                      }
                      const displayLimit = searchArgs.limit || 25;
                      const invoiceListData = {
                        type: "invoice_list" as const,
                        invoices: invoices.slice(0, displayLimit).map((inv: any) => ({
                          invoiceNumber: String(inv.DocumentNumber || ""),
                          customerName: String(inv.CustomerName || ""),
                          total: Number(inv.Total) || 0,
                          totalVat: Number(inv.TotalVAT) || 0,
                          status: inv.Cancelled ? "cancelled"
                            : Number(inv.Balance) === 0 ? "paid"
                            : (inv.DueDate && new Date(inv.DueDate) < new Date() ? "overdue" : "unpaid"),
                          invoiceDate: String(inv.InvoiceDate || ""),
                          dueDate: String(inv.DueDate || ""),
                        })),
                        query: searchArgs.query,
                      };
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ invoiceList: invoiceListData })}\n\n`));
                      const invCount = invoiceListData.invoices.length;
                      resultText = invCount > 0
                        ? `Hittade ${invCount} fakturor${searchArgs.query ? ` som matchar "${searchArgs.query}"` : ""}.`
                        : `Inga fakturor hittades.`;
                      break;
                    }
                    case "search_supplier_invoices": {
                      const suppArgs = params as { query?: string; status?: string; from_date?: string; to_date?: string; limit?: number };
                      const suppFetchLimit = Math.min(suppArgs.limit || 25, 100);
                      const suppResult = await callFortnoxRead("getSupplierInvoices", {
                        fromDate: suppArgs.from_date,
                        toDate: suppArgs.to_date,
                        pagination: { page: 1, limit: suppFetchLimit },
                      }, authHeader, resolvedCompanyId);
                      let suppInvoices = ((suppResult as any)?.SupplierInvoices || []) as Array<Record<string, unknown>>;
                      if (suppArgs.query) {
                        const q = suppArgs.query.toLowerCase();
                        suppInvoices = suppInvoices.filter((inv: any) =>
                          (inv.SupplierName || "").toLowerCase().includes(q) ||
                          String(inv.GivenNumber || "").includes(q) ||
                          String(inv.InvoiceNumber || "").includes(q)
                        );
                      }
                      if (suppArgs.status && suppArgs.status !== "all") {
                        suppInvoices = suppInvoices.filter((inv: any) => {
                          const cancelled = inv.Cancelled === true;
                          if (suppArgs.status === "cancelled") return cancelled;
                          if (cancelled) return false;
                          const balance = Number(inv.Balance) || 0;
                          const booked = inv.Booked === true || String(inv.Booked).toLowerCase() === "true";
                          const dueDate = inv.DueDate as string;
                          const isOverdue = dueDate ? new Date(dueDate) < new Date() : false;
                          if (suppArgs.status === "paid") return balance === 0 && booked;
                          if (suppArgs.status === "overdue") return balance > 0 && isOverdue;
                          if (suppArgs.status === "unpaid") return balance > 0;
                          return true;
                        });
                      }
                      const suppDisplayLimit = suppArgs.limit || 25;
                      const supplierInvoiceListData = {
                        type: "supplier_invoice_list" as const,
                        invoices: suppInvoices.slice(0, suppDisplayLimit).map((inv: any) => ({
                          givenNumber: String(inv.GivenNumber || ""),
                          supplierName: String(inv.SupplierName || ""),
                          invoiceNumber: String(inv.InvoiceNumber || ""),
                          total: Number(inv.Total) || 0,
                          balance: Number(inv.Balance) || 0,
                          status: inv.Cancelled ? "cancelled"
                            : Number(inv.Balance) === 0 ? "paid"
                            : (inv.DueDate && new Date(inv.DueDate) < new Date() ? "overdue" : "unpaid"),
                          invoiceDate: String(inv.InvoiceDate || ""),
                          dueDate: String(inv.DueDate || ""),
                        })),
                        query: suppArgs.query,
                      };
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ supplierInvoiceList: supplierInvoiceListData })}\n\n`));
                      const suppCount = supplierInvoiceListData.invoices.length;
                      resultText = suppCount > 0
                        ? `Hittade ${suppCount} leverantörsfakturor${suppArgs.query ? ` som matchar "${suppArgs.query}"` : ""}.`
                        : `Inga leverantörsfakturor hittades.`;
                      break;
                    }
                    case "search_customers": {
                      const custArgs = params as { query?: string };
                      const custResult = await callFortnoxRead("getCustomers", {}, authHeader, resolvedCompanyId);
                      let customers = ((custResult as any)?.Customers || []) as Array<Record<string, unknown>>;
                      if (custArgs.query) {
                        const q = custArgs.query.toLowerCase();
                        customers = customers.filter((c: any) =>
                          (c.Name || "").toLowerCase().includes(q) ||
                          (c.OrganisationNumber || "").toLowerCase().includes(q) ||
                          String(c.CustomerNumber || "").includes(q)
                        );
                      }
                      const customerListData = {
                        type: "customer_list" as const,
                        customers: customers.slice(0, 20).map((c: any) => ({
                          customerNumber: String(c.CustomerNumber || ""),
                          name: String(c.Name || ""),
                          organisationNumber: c.OrganisationNumber || undefined,
                          email: c.Email || undefined,
                          phone: c.Phone || undefined,
                        })),
                        query: custArgs.query,
                      };
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ customerList: customerListData })}\n\n`));
                      const custCount = customerListData.customers.length;
                      resultText = custCount > 0
                        ? `Hittade ${custCount} kunder${custArgs.query ? ` som matchar "${custArgs.query}"` : ""}.`
                        : `Inga kunder hittades.`;
                      break;
                    }
                    case "get_vat_report": {
                      const vatArgs = params as { from_date: string; to_date: string };
                      const vatResult = await callFortnoxRead("getVATReport", {
                        fromDate: vatArgs.from_date,
                        toDate: vatArgs.to_date,
                      }, authHeader, resolvedCompanyId);
                      const report = vatResult as any;
                      const reportData = report?.data || report;
                      if (reportData?.vat || reportData?.summary) {
                        const vatReportArtifact = {
                          type: "vat_report" as const,
                          period: reportData.period || `${vatArgs.from_date} – ${vatArgs.to_date}`,
                          company: reportData.company || {},
                          summary: reportData.summary || {},
                          sales: reportData.sales || [],
                          costs: reportData.costs || [],
                          vat: reportData.vat || {},
                          journal_entries: reportData.journal_entries || [],
                          validation: reportData.validation || {},
                        };
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ vatReport: vatReportArtifact })}\n\n`));
                      }
                      const vatData = reportData?.vat || {};
                      const outgoingVat = (vatData.outgoing_25 || 0) + (vatData.outgoing_12 || 0) + (vatData.outgoing_6 || 0);
                      const incomingVat = vatData.incoming || 0;
                      const netVat = vatData.net ?? (outgoingVat - incomingVat);
                      resultText = `Momsrapport ${vatArgs.from_date} till ${vatArgs.to_date}: ` +
                        `Utgående ${outgoingVat.toFixed(2)} kr, Ingående ${incomingVat.toFixed(2)} kr, ` +
                        `${netVat >= 0 ? "Att betala" : "Att återfå"}: ${Math.abs(netVat).toFixed(2)} kr`;
                      break;
                    }
                    case "get_company_info": {
                      const fnxClient = createClient(supabaseUrl, supabaseServiceKey, {
                        global: { headers: { Authorization: authHeader } },
                      });
                      const fnxConfig = {
                        clientId: Deno.env.get("FORTNOX_CLIENT_ID") ?? "",
                        clientSecret: Deno.env.get("FORTNOX_CLIENT_SECRET") ?? "",
                        redirectUri: "",
                      };
                      const fnxSvc = new FortnoxService(fnxConfig, fnxClient, userId, resolvedCompanyId);
                      const [companyRes, yearsRes] = await Promise.all([
                        fnxSvc.getCompanyInfo(),
                        fnxSvc.getFinancialYears().catch(() => ({ FinancialYears: [] })),
                      ]);
                      const info = (companyRes as any).CompanyInformation || {};
                      const years = (yearsRes as any).FinancialYears || [];
                      const currentYear = years.length > 0 ? years[0] : null;
                      const companyInfoData = {
                        type: "company_info" as const,
                        companyName: info.CompanyName || "",
                        organisationNumber: info.OrganizationNumber || "",
                        address: [info.Address, info.ZipCode, info.City].filter(Boolean).join(", ") || undefined,
                        email: info.Email || undefined,
                        phone: info.Phone1 || info.Phone2 || undefined,
                        fiscalYear: currentYear
                          ? { from: currentYear.FromDate, to: currentYear.ToDate }
                          : undefined,
                      };
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ companyInfo: companyInfoData })}\n\n`));
                      resultText = `Företagsinformation: ${companyInfoData.companyName}` +
                        (companyInfoData.organisationNumber ? ` (${companyInfoData.organisationNumber})` : "");
                      break;
                    }
                    case "get_financial_summary": {
                      const fsArgs = params as { financial_year_id?: number };
                      const fsResult = await callFortnoxRead("getFinancialStatements", {
                        financialYearId: fsArgs.financial_year_id,
                      }, authHeader, resolvedCompanyId);
                      const fs = fsResult as any;
                      const financialSummaryData = {
                        type: "financial_summary" as const,
                        company: fs.company?.name || "",
                        financialYear: {
                          from: fs.financialYear?.fromDate || "",
                          to: fs.financialYear?.toDate || "",
                        },
                        revenue: fs.resultatRakning?.totalRevenue || 0,
                        expenses: fs.resultatRakning?.totalExpenses || 0,
                        netResult: fs.resultatRakning?.netResult || 0,
                        totalAssets: fs.balansRakning?.totalAssets || 0,
                        totalLiabilitiesEquity: fs.balansRakning?.totalLiabilitiesEquity || 0,
                        balanced: fs.balansRakning?.balanced ?? true,
                        sections: [
                          ...(fs.resultatRakning?.sections || []),
                          ...(fs.balansRakning?.assets || []),
                          ...(fs.balansRakning?.liabilitiesEquity || []),
                        ].map((s: any) => ({
                          title: s.title,
                          total: s.total,
                          accounts: (s.accounts || []).map((a: any) => ({
                            number: a.number,
                            name: a.name,
                            amount: a.closingBalance ?? a.change ?? 0,
                          })),
                        })),
                      };
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ financialSummary: financialSummaryData })}\n\n`));
                      const fsCompanyLabel = financialSummaryData.company || "ditt företag";
                      const fsDisplayResult = -financialSummaryData.netResult;
                      resultText = `Ekonomisk sammanfattning för ${fsCompanyLabel}. Resultat: ${fsDisplayResult} kr.`;
                      break;
                    }
                    case "get_account_balances": {
                      const abArgs = params as { from_account?: number; to_account?: number; financial_year_id?: number; non_zero_only?: boolean };
                      const abResult = await callFortnoxRead("getFinancialStatements", {
                        financialYearId: abArgs.financial_year_id,
                      }, authHeader, resolvedCompanyId);
                      const abFs = abResult as any;
                      const allAccounts: Array<{number: number; name: string; openingBalance: number; closingBalance: number; change: number}> = [];
                      for (const section of [...(abFs.resultatRakning?.sections || []), ...(abFs.balansRakning?.assets || []), ...(abFs.balansRakning?.liabilitiesEquity || [])]) {
                        for (const acc of (section.accounts || [])) {
                          allAccounts.push({
                            number: acc.number,
                            name: acc.name,
                            openingBalance: acc.openingBalance || 0,
                            closingBalance: acc.closingBalance || 0,
                            change: acc.change || 0,
                          });
                        }
                      }
                      let filtered = allAccounts;
                      if (abArgs.from_account) filtered = filtered.filter(a => a.number >= abArgs.from_account!);
                      if (abArgs.to_account) filtered = filtered.filter(a => a.number <= abArgs.to_account!);
                      const nonZeroOnly = abArgs.non_zero_only !== false;
                      if (nonZeroOnly) filtered = filtered.filter(a => a.openingBalance !== 0 || a.closingBalance !== 0 || a.change !== 0);
                      filtered.sort((a, b) => a.number - b.number);
                      const accountBalancesData = {
                        type: "account_balances" as const,
                        accounts: filtered.map(a => ({
                          number: a.number, name: a.name,
                          openingBalance: a.openingBalance, closingBalance: a.closingBalance, change: a.change,
                        })),
                        financialYear: { from: abFs.financialYear?.fromDate || "", to: abFs.financialYear?.toDate || "" },
                        filter: abArgs.from_account || abArgs.to_account ? { fromAccount: abArgs.from_account, toAccount: abArgs.to_account } : undefined,
                      };
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ accountBalances: accountBalancesData })}\n\n`));
                      resultText = `Hittade ${filtered.length} konton med saldo.`;
                      break;
                    }
                    case "search_vouchers": {
                      const svArgs = params as { financial_year?: number; series?: string; from_date?: string; to_date?: string; limit?: number };
                      const svFetchLimit = Math.min(svArgs.limit || 20, 100);
                      const svResult = await callFortnoxRead("getVouchers", {
                        financialYear: svArgs.financial_year,
                        voucherSeries: svArgs.series,
                        fromDate: svArgs.from_date,
                        toDate: svArgs.to_date,
                        pagination: { page: 1, limit: svFetchLimit },
                        includeRows: true,
                      }, authHeader, resolvedCompanyId);
                      const vouchers = ((svResult as any)?.Vouchers || []) as Array<Record<string, unknown>>;
                      const svDisplayLimit = svArgs.limit || 20;
                      const voucherListData = {
                        type: "voucher_list" as const,
                        vouchers: vouchers.slice(0, svDisplayLimit).map((v: any) => {
                          const voucherRows = (v.VoucherRows || []) as Array<Record<string, unknown>>;
                          return {
                            voucherNumber: Number(v.VoucherNumber) || 0,
                            voucherSeries: String(v.VoucherSeries || ""),
                            description: String(v.Description || ""),
                            transactionDate: String(v.TransactionDate || ""),
                            totalDebit: voucherRows.reduce((sum: number, r: any) => sum + (Number(r.Debit) || 0), 0),
                            totalCredit: voucherRows.reduce((sum: number, r: any) => sum + (Number(r.Credit) || 0), 0),
                            rows: voucherRows.map((r: any) => ({
                              account: Number(r.Account) || 0,
                              accountName: String(r.Description || ""),
                              debit: Number(r.Debit) || 0,
                              credit: Number(r.Credit) || 0,
                            })),
                          };
                        }),
                        query: svArgs.series ? `Serie ${svArgs.series}` : undefined,
                      };
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ voucherList: voucherListData })}\n\n`));
                      resultText = `Hittade ${voucherListData.vouchers.length} verifikationer.`;
                      break;
                    }
                    default:
                      resultText =
                        `Okänd åtgärdstyp: ${action.action_type}`;
                  }

                  executionResults.push({
                    action_id: action.id,
                    success: true,
                    result: resultText,
                  });

                  // Stream success
                  controller.enqueue(
                    encoder.encode(
                      `data: ${
                        JSON.stringify({
                          actionStatus: {
                            step: i + 1,
                            total: actions.length,
                            action_id: action.id,
                            description: action.description,
                            status: "completed",
                            result: resultText,
                          },
                        })
                      }\n\n`,
                    ),
                  );
                } catch (actionError) {
                  const errorMsg = actionError instanceof Error
                    ? actionError.message
                    : "Okänt fel";
                  executionResults.push({
                    action_id: action.id,
                    success: false,
                    error: errorMsg,
                  });

                  controller.enqueue(
                    encoder.encode(
                      `data: ${
                        JSON.stringify({
                          actionStatus: {
                            step: i + 1,
                            total: actions.length,
                            action_id: action.id,
                            description: action.description,
                            status: "failed",
                            error: errorMsg,
                          },
                        })
                      }\n\n`,
                    ),
                  );

                  // Abort remaining steps — downstream actions depend on earlier steps succeeding
                  for (let j = i + 1; j < actions.length; j++) {
                    const skipped = actions[j];
                    executionResults.push({
                      action_id: skipped.id,
                      success: false,
                      error: `Avbruten — föregående steg misslyckades`,
                    });
                    controller.enqueue(
                      encoder.encode(
                        `data: ${
                          JSON.stringify({
                            actionStatus: {
                              step: j + 1,
                              total: actions.length,
                              action_id: skipped.id,
                              description: skipped.description,
                              status: "skipped",
                              error: `Avbruten — steg ${i + 1} misslyckades`,
                            },
                          })
                        }\n\n`,
                      ),
                    );
                  }
                  break;
                }
              }

              // Build summary text
              const successCount = executionResults.filter((r) => r.success)
                .length;
              const failCount = executionResults.filter((r) => !r.success)
                .length;
              const summaryLines = executionResults.map((r) =>
                r.success ? `- ${r.result}` : `- Fel: ${r.error}`
              );
              const summaryText = failCount === 0
                ? `Alla ${successCount} åtgärder har utförts:\n${summaryLines.join("\n")}`
                : `${successCount} av ${executionResults.length} åtgärder lyckades:\n${summaryLines.join("\n")}`;

              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ text: summaryText })}\n\n`,
                ),
              );

              // Update plan status
              const newStatus = failCount === 0 ? "executed" : "partial";
              await supabaseAdmin
                .from("messages")
                .update({
                  metadata: {
                    ...plan,
                    status: newStatus,
                    execution_results: executionResults,
                  },
                })
                .eq("id", planMessage.id);

              // Save the execution summary as assistant message
              if (conversationService || conversationId) {
                try {
                  if (!conversationService) {
                    conversationService = new ConversationService(
                      supabaseClient,
                    );
                  }
                  await conversationService.addMessage(
                    conversationId!,
                    "assistant",
                    summaryText,
                  );
                } catch (_saveErr) {
                  logger.warn("Failed to save execution summary");
                }
              }

              // Log AI decision
              void auditService.logAIDecision({
                userId,
                companyId: resolvedCompanyId || undefined,
                aiProvider: "action_plan",
                aiModel: "user_approved",
                aiFunction: "execute_action_plan",
                inputData: {
                  plan_id,
                  decision,
                  action_count: actions.length,
                },
                outputData: {
                  success_count: successCount,
                  fail_count: failCount,
                  results: executionResults,
                },
                confidence: 1.0,
              });

              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
            } catch (streamErr) {
              logger.error("Action plan execution stream error", streamErr);
              controller.enqueue(
                encoder.encode(
                  `data: ${
                    JSON.stringify({
                      text: "Ett fel uppstod vid utförande av handlingsplanen.",
                    })
                  }\n\n`,
                ),
              );
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
            }
          },
        });

        return new Response(execStream, {
          headers: {
            ...responseHeaders,
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      } catch (planError) {
        logger.error("Action plan execution failed", planError);
        return new Response(
          JSON.stringify({
            error: "action_plan_execution_failed",
            message: planError instanceof Error
              ? planError.message
              : "Okänt fel",
          }),
          {
            status: 500,
            headers: {
              ...responseHeaders,
              "Content-Type": "application/json",
            },
          },
        );
      }
    }

    const historyIntent = (hasFileAttachment || isSkillAssist)
      ? { search: false, recent: false }
      : detectHistoryIntent(message);
    if ((historyIntent.search || historyIntent.recent) && conversationId) {
      try {
        const safeLimit = 5;
        const searchResults = historyIntent.search
          ? await searchConversationHistory(
            supabaseAdmin,
            userId,
            resolvedCompanyId,
            message,
            safeLimit,
          )
          : [];
        const recentConversations =
          historyIntent.recent && searchResults.length === 0
            ? await getRecentConversations(
              supabaseAdmin,
              userId,
              resolvedCompanyId,
              safeLimit,
            )
            : [];

        const responseText = formatHistoryResponse(
          message,
          searchResults,
          recentConversations,
        );

        if (!conversationService) {
          const supabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
            global: { headers: { Authorization: authHeader } },
          });
          conversationService = new ConversationService(supabaseClient);
        }

        await conversationService.addMessage(
          conversationId,
          "assistant",
          responseText,
        );
        const resolvedTitle = await generateSmartTitleIfNeeded(
          conversationService,
          supabaseAdmin,
          conversationId,
          message,
          responseText,
          verifiedConversation?.title ?? null,
        );
        if (resolvedTitle && verifiedConversation) {
          verifiedConversation.title = resolvedTitle;
        }
        void triggerMemoryGenerator(
          supabaseUrl,
          supabaseServiceKey,
          conversationId,
        );

        return new Response(
          JSON.stringify({ type: "text", data: responseText }),
          {
            headers: { ...responseHeaders, "Content-Type": "application/json" },
          },
        );
      } catch (historyError) {
        logger.warn("History lookup failed, continuing with normal flow", {
          error: historyError,
        });
      }
    }

    const memoryRequest = isSkillAssist ? null : extractMemoryRequest(message);
    if (memoryRequest && resolvedCompanyId) {
      try {
        const { data: existingMemory } = await supabaseAdmin
          .from("user_memories")
          .select("id")
          .eq("user_id", userId)
          .eq("company_id", resolvedCompanyId)
          .ilike("content", memoryRequest)
          .limit(1);

        if (!existingMemory || existingMemory.length === 0) {
          await supabaseAdmin.from("user_memories").insert({
            user_id: userId,
            company_id: resolvedCompanyId,
            category: "user_defined",
            content: memoryRequest,
            confidence: 1.0,
            memory_tier: "profile",
            importance: 0.9,
          });

          await supabaseAdmin.from("memory_user_edits").insert({
            user_id: userId,
            company_id: resolvedCompanyId,
            edit_type: "add",
            content: memoryRequest,
          });
        }
      } catch (memorySaveError) {
        logger.warn("Failed to save user memory request", {
          userId,
          companyId: resolvedCompanyId,
        });
      }
    }

    // Inject VAT Report Context if available OR fetch from DB
    let finalMessage = message;

    if (isSkillAssist) {
      finalMessage =
        `${buildSkillAssistSystemPrompt()}\n\nAnvändarens önskemål:\n${message}`;
    }

    if (!isSkillAssist && !vatReportContext && conversationId) {
      try {
        const { data: reports, error } = await supabaseAdmin
          .from("vat_reports")
          .select("report_data, period, company_name")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: false })
          .limit(1);

        if (!error && reports && reports.length > 0) {
          const report = reports[0];
          const data = report.report_data;

          vatReportContext = {
            type: "vat_report",
            period: report.period,
            company: {
              name: report.company_name || data.company_name || "Okänt",
              org_number: data.org_number || "Saknas",
            },
            summary: data.summary,
            vat: data.vat,
            validation: data.claude_validation
              ? {
                is_valid: data.claude_validation.validation_passed,
                errors: [],
                warnings: data.claude_validation.warnings || [],
              }
              : undefined,
          };
          logger.info("Fetched VAT report context from DB", { conversationId });
        }
      } catch (fetchError) {
        logger.warn("Failed to fetch VAT report from DB", { conversationId });
      }
    }

    if (!isSkillAssist && vatReportContext) {
      const netVat = vatReportContext.vat?.net ?? 0;
      const contextMessage = `
SYSTEM CONTEXT: Användaren tittar just nu på följande momsredovisning (genererad av ${
        vatReportContext.type === "vat_report" ? "systemet" : "analysverktyget"
      }):

Period: ${vatReportContext.period}
Företag: ${vatReportContext.company?.name ?? "Okänt"} (${
        vatReportContext.company?.org_number ?? "Saknas"
      })

SAMMANFATTNING:
- Försäljning: ${
        vatReportContext.summary?.total_sales ??
          vatReportContext.summary?.total_income ?? 0
      } SEK
- Kostnader: ${vatReportContext.summary?.total_costs ?? 0} SEK
- Resultat: ${vatReportContext.summary?.result ?? 0} SEK

MOMS:
- Utgående (25%): ${vatReportContext.vat?.outgoing_25 ?? 0} SEK
- Ingående: ${vatReportContext.vat?.incoming ?? 0} SEK
- Att ${netVat >= 0 ? "betala" : "återfå"}: ${Math.abs(netVat)} SEK

VALIDERING:
- Status: ${vatReportContext.validation?.is_valid ? "Giltig" : "Ogiltig"}
- Fel: ${vatReportContext.validation?.errors?.join(", ") || "Inga"}
- Varningar: ${vatReportContext.validation?.warnings?.join(", ") || "Inga"}

Användaren kan ställa frågor om denna rapport. Svara baserat på ovanstående data.

ANVÄNDARFRÅGA:
`;
      finalMessage = contextMessage + message;
    }

    const safeDocumentText = (documentText || "").trim();
    if (safeDocumentText && !isSkillAssist) {
      const MAX_DOC_CHARS = 50_000;
      const truncated = safeDocumentText.length > MAX_DOC_CHARS
        ? `${safeDocumentText.slice(0, MAX_DOC_CHARS)}\n\n[...trunkerad...]`
        : safeDocumentText;
      finalMessage =
        `DOKUMENTKONTEXT (text-utdrag från bifogat dokument):\n\n${truncated}\n\n${finalMessage}`;
    }

    const contextBlocks: string[] = [];
    // Track used memories for transparency
    const usedMemories: UsedMemory[] = [];

    if (resolvedCompanyId) {
      try {
        const { data: userMemories, error: userMemoriesError } =
          await supabaseAdmin
            .from("user_memories")
            .select(
              "id, category, content, updated_at, last_used_at, created_at, confidence, memory_tier, importance, expires_at",
            )
            .eq("user_id", userId)
            .eq("company_id", resolvedCompanyId)
            .order("updated_at", { ascending: false })
            .limit(200);

        if (userMemoriesError) {
          logger.warn("Failed to load user memories", {
            userId,
            companyId: resolvedCompanyId,
          });

        } else if (!userMemories || userMemories.length === 0) {
          // First interaction with this company — no memories yet
          contextBlocks.push(
            "SYSTEM CONTEXT: Detta är första interaktionen med detta företag. " +
              "Inga minnen finns ännu. Ställ 1-2 naturliga frågor om verksamheten i ditt svar:\n" +
              "- Vad gör företaget? (bransch, storlek)\n" +
              "- Vilken redovisningsmetod? (faktura/kontant)\n" +
              "- Momsperiod? (månads/kvartals/årsredovisning)\n" +
              "Väv in frågorna naturligt — inte som ett formulär.",
          );
        } else if (userMemories.length > 0) {
          const memoryRows = userMemories as UserMemoryRow[];
          const selection = selectRelevantMemories(memoryRows, message);
          const selectedMemories = selection.selected;

          const memoryContext = formatUserMemoriesForContext(selectedMemories);
          if (memoryContext) {
            contextBlocks.push(memoryContext);

            usedMemories.push(...selection.usedMemories);
          }

          const memoryIds = selectedMemories.map((memory) => memory.id);
          if (memoryIds.length > 0) {
            await supabaseAdmin
              .from("user_memories")
              .update({ last_used_at: new Date().toISOString() })
              .in("id", memoryIds);
          }
        }
      } catch (memoryError) {
        logger.warn("Failed to load user memories", {
          userId,
          companyId: resolvedCompanyId,
        });
      }

      try {
        const { data: accountingMemories, error: accountingMemoriesError } =
          await supabaseAdmin
            .from("accounting_memories")
            .select(
              "id, entity_type, entity_key, label, payload, source_type, source_reliability, confidence, review_status, fiscal_year, period_start, period_end, valid_from, valid_to, last_used_at, updated_at, created_at",
            )
            .eq("user_id", userId)
            .eq("company_id", resolvedCompanyId)
            .order("updated_at", { ascending: false })
            .limit(200);

        if (accountingMemoriesError) {
          logger.warn("Failed to load accounting memories", {
            userId,
            companyId: resolvedCompanyId,
          });
        } else if (accountingMemories && accountingMemories.length > 0) {
          const memoryRows = accountingMemories as AccountingMemoryRow[];
          const selectedMemories = selectAccountingMemoriesForContext(
            memoryRows,
            message,
          );
          const accountingContext = formatAccountingMemoriesForContext(
            selectedMemories,
          );

          if (accountingContext) {
            contextBlocks.push(accountingContext);
          }

          const accountingIds = selectedMemories.map((memory) => memory.id);
          if (accountingIds.length > 0) {
            await supabaseAdmin
              .from("accounting_memories")
              .update({ last_used_at: new Date().toISOString() })
              .in("id", accountingIds);
          }
        }
      } catch (accountingError) {
        logger.warn("Failed to load accounting memories", {
          userId,
          companyId: resolvedCompanyId,
        });
      }

      // Load learned expense patterns (supplier → BAS account mappings)
      try {
        const patternService = new ExpensePatternService(supabaseAdmin);
        const patterns = await patternService.listPatterns(userId, resolvedCompanyId, 20);

        if (patterns.length > 0) {
          const patternLines = patterns
            .filter((p) => p.confirmation_count >= 1)
            .slice(0, 12)
            .map((p) => {
              const vatLabel = p.vat_rate > 0 ? ` (${p.vat_rate}% moms)` : " (momsfri)";
              const usageNote = p.usage_count > 1 ? ` [använt ${p.usage_count}x]` : "";
              return `- ${p.supplier_name} → ${p.bas_account} ${p.bas_account_name}${vatLabel}${usageNote}`;
            });

          if (patternLines.length > 0) {
            contextBlocks.push(
              [
                "SYSTEM CONTEXT: Inlärda konteringsmönster. Använd dessa när du föreslår BAS-konto för kända leverantörer.",
                "Om motparten matchar ett mönster, föreslå det kontot direkt och nämn att du lärt dig det.",
                "Om användaren korrigerar ditt förslag, anropa learn_accounting_pattern för att uppdatera.",
                "<learnedPatterns>",
                ...patternLines,
                "</learnedPatterns>",
              ].join("\n"),
            );
          }
        }
      } catch (patternError) {
        logger.warn("Failed to load expense patterns", {
          userId,
          companyId: resolvedCompanyId,
        });
      }

      try {
        const memoryService = new CompanyMemoryService(supabaseAdmin);
        const memory = await memoryService.get(userId, resolvedCompanyId);
        const memoryContext = memory
          ? buildCompanyMemoryContext(memory, !vatReportContext)
          : null;

        if (memoryContext) {
          contextBlocks.push(memoryContext);
        }
      } catch (memoryError) {
        logger.warn("Failed to load company memory", {
          userId,
          companyId: resolvedCompanyId,
        });
      }
    }

    if (contextBlocks.length > 0) {
      finalMessage = `${contextBlocks.join("\n\n")}\n\n${finalMessage}`;
    }

    const accountingTemplateEnabled = ACCOUNTING_RESPONSE_TEMPLATE_ENABLED &&
      !isSkillAssist;
    const accountingIntent = accountingTemplateEnabled && isAccountingIntent({
      message,
      vatReportContext,
      hasFileAttachment,
    });
    const accountingContract = accountingIntent
      ? buildAccountingContract({
        sourceCitationStyle: "Kort källa + datum (YYYY-MM-DD)",
        assumptionPolicy:
          "Visa antaganden kort och avsluta med en tydlig bekräftelsefråga",
        postingLayout:
          "Markdown-tabell med kolumnerna Konto, Kontonamn, Debet, Kredit, Kommentar",
      })
      : null;
    const withAccountingContract = (prompt: string): string => {
      if (!accountingContract) return prompt;
      return `${accountingContract}\n\n${prompt}`;
    };
    const shouldFormatAccountingToolResponse = (toolName: string): boolean => {
      if (!accountingIntent) return false;
      const normalizedToolName = toolName.trim().toLowerCase();
      if (!ACCOUNTING_TOOL_RESPONSE_NAMES.has(normalizedToolName)) return false;
      return isAccountingIntent({
        message,
        vatReportContext,
        toolName: normalizedToolName,
        hasFileAttachment,
      });
    };

    if (accountingContract) {
      finalMessage = withAccountingContract(finalMessage);
    }

    // Tool usage instructions — always present so Gemini knows how to use Fortnox tools
    if (!isSkillAssist) {
      finalMessage = `[VERKTYGSREGLER]\n` +
        `Du har tillgång till Fortnox-verktyg. Använd dem så här:\n` +
        `- LÄSVERKTYG (search_invoices, search_supplier_invoices, search_customers, get_vat_report, get_company_info, get_financial_summary, get_account_balances, search_vouchers): Använd FRITT utan att fråga. Om användaren frågar om fakturor, leverantörsfakturor, kunder, moms, företagsinfo, ekonomisk översikt, kontosaldon eller verifikationer — anropa verktyget direkt.\n` +
        `- SKRIVVERKTYG (skapa/ändra faktura, bokföra, registrera betalning): Anropa ALLTID propose_action_plan med posting_rows. Utför ALDRIG en skrivoperation direkt.\n` +
        `- LEVERANTÖRSFAKTURA: När du skapar en leverantörsfaktura, inkludera ALLTID ett create_supplier-steg FÖRE create_supplier_invoice i handlingsplanen. Leverantören kanske inte finns i Fortnox. Systemet hanterar dubbletter — om leverantören redan finns skapas ingen ny. Referera ALLTID leverantörer med numeriskt SupplierNumber (t.ex. "1"), ALDRIG med textnamn (t.ex. "GOOGLE_IRELAND_LTD").\n` +
        `- SAKNAD INFO: Om pris, belopp, antal eller annan kritisk info saknas för en skrivoperation → anropa request_clarification.\n\n` +
        finalMessage;
    }

    // Provider switch (default: Gemini)
    const isSupportedFile = fileData?.mimeType?.startsWith("image/") ||
      fileData?.mimeType === "application/pdf";
    const primaryFile = isSupportedFile ? fileData : undefined;
    const imagePages = (fileDataPages || []).filter((p) =>
      p?.mimeType?.startsWith("image/") && !!p.data
    );
    const geminiFileData = primaryFile ||
      (imagePages.length > 0 ? (imagePages[0] as FileData) : undefined);
    if (hasFileAttachment) {
      logger.info("File routing result", {
        hasGeminiFileData: !!geminiFileData,
        mimeType: geminiFileData?.mimeType || "none",
      });
    }
    // When a file is attached, tell Gemini to analyze it before using tools
    if (geminiFileData && geminiFileData.data && geminiFileData.data.length > 0) {
      const safeFileName = fileName || "okänd fil";
      const safeMime = geminiFileData.mimeType || "unknown";
      logger.info("File attached for Gemini", {
        fileName: safeFileName,
        mimeType: safeMime,
        dataLength: geminiFileData.data.length,
      });
      finalMessage = `[BIFOGAD FIL: ${safeFileName} (${safeMime})]\n` +
        `VIKTIGT: Användaren har bifogat en fil. Analysera filinnehållet FÖRST — ` +
        `extrahera all relevant information (belopp, moms, leverantör, datum) ` +
        `innan du använder Fortnox-verktyg. Basera ditt konteringsförslag på filens innehåll.\n\n` +
        finalMessage;
    } else if (geminiFileData) {
      logger.warn("geminiFileData present but data is empty", {
        mimeType: geminiFileData.mimeType,
        fileName: fileName || "unknown",
      });
    }
    const disableTools = isSkillAssist;

    // When a file is attached, restrict tools to only propose_action_plan and request_clarification.
    // This prevents Gemini from ignoring the file and defaulting to Fortnox read-tools (get_suppliers etc.)
    //
    // Also carry forward the restriction for follow-up messages in a file analysis conversation.
    // Without this, a text-only follow-up (e.g. answering a clarification question about a receipt)
    // would lose the restriction and Gemini would call get_suppliers instead of propose_action_plan.
    // Check if a recent message in history had a file attachment.
    // History objects from the frontend include file_name/file_url from the messages table,
    // even though the TypeScript interface only declares { role, content }.
    const recentHistory = Array.isArray(history) ? history.slice(-6) : [];
    const hasRecentFileAnalysis = !geminiFileData && recentHistory.some((msg: any) =>
      msg.role === "user" && (
        // Primary: check file_name field from messages table (always present for file uploads)
        (msg.file_name && msg.file_name.length > 0) ||
        // Fallback: check for [BIFOGAD FIL:] marker (in case message was modified before saving)
        (typeof msg.content === "string" && msg.content.includes("[BIFOGAD FIL:"))
      )
    );

    if (!geminiFileData && Array.isArray(history)) {
      const scanned = recentHistory.map((msg: any) => ({
        role: msg.role,
        hasFileName: Boolean(msg.file_name),
        fileName: msg.file_name || null,
        contentPreview: typeof msg.content === "string" ? msg.content.substring(0, 80) : null,
      }));
      logger.debug("hasRecentFileAnalysis scan", {
        result: hasRecentFileAnalysis,
        scannedMessages: scanned,
      });
    }

    const fileAttachedTools = (geminiFileData || hasRecentFileAnalysis) ? [
      "propose_action_plan",
      "request_clarification",
    ] : undefined;

    if (hasRecentFileAnalysis) {
      logger.info("Carrying forward file analysis tool restriction for follow-up message", {
        historyLength: history?.length,
        restrictedTools: fileAttachedTools,
      });
    }

    const forceNonStreaming = isSkillAssist || streamParam === false;

    // Handle Gemini Streaming
    if (provider === "gemini" && !forceNonStreaming) {
      logger.debug("Starting Gemini streaming", {
        model: effectiveModel || "default",
      });
      try {
        const stream = await sendMessageStreamToGemini(
          finalMessage,
          geminiFileData,
          history,
          undefined,
          effectiveModel,
          { disableTools, allowedTools: fileAttachedTools },
        );
        logger.debug("Gemini stream created successfully");
        const encoder = new TextEncoder();
        let fullText = "";
        let toolCallDetected: any = null;
        let streamingActionPlan: {
          type: string;
          plan_id: string;
          status: string;
          summary: string;
          actions: Array<Record<string, unknown>>;
          assumptions: string[];
        } | null = null;

        const callFortnoxWrite = async (
          fnAction: string,
          fnPayload: Record<string, unknown>,
          operation: string,
          resource: string,
        ): Promise<Record<string, unknown>> => {
          if (!resolvedCompanyId) {
            throw new Error("Bolagskontext saknas — välj ett företag.");
          }
          const idempotencyKey = `streaming_tool:${resolvedCompanyId}:${operation}:${resource}`.slice(0, 200);
          const resp = await fetch(`${supabaseUrl}/functions/v1/fortnox`, {
            method: "POST",
            headers: { Authorization: authHeader, "Content-Type": "application/json" },
            body: JSON.stringify({
              action: fnAction,
              companyId: resolvedCompanyId,
              payload: { ...fnPayload, idempotencyKey, sourceContext: "gemini-chat-streaming-tool" },
            }),
          });
          const result = await resp.json().catch(() => ({}));
          if (!resp.ok) {
            const detail = typeof result?.detail === "string" ? ` (${result.detail})` : "";
            throw new Error(
              (typeof result?.error === "string" ? result.error : `Fortnox write failed (${resp.status})`) + detail,
            );
          }
          return (result || {}) as Record<string, unknown>;
        };

        // Thinking step helpers — emit agentStep SSE events
        let thinkingStepCounter = 0;
        const thinkingStepTimestamps = new Map<string, number>();

        const sendStep = (
          ctrl: ReadableStreamDefaultController,
          enc: TextEncoder,
          label: string,
          opts?: { type?: string; tool?: string; parentId?: string },
        ): string => {
          const id = `thinking-${++thinkingStepCounter}`;
          const startedAt = Date.now();
          thinkingStepTimestamps.set(id, startedAt);
          const step = {
            agentStep: {
              id,
              type: opts?.type ?? "thinking",
              tool: opts?.tool ?? "",
              label,
              status: "running",
              startedAt,
              completedAt: null,
              resultSummary: null,
              parentId: opts?.parentId ?? null,
            },
          };
          ctrl.enqueue(enc.encode(`data: ${JSON.stringify(step)}\n\n`));
          return id;
        };

        // Convenience wrappers
        const sendThinkingStep = (
          ctrl: ReadableStreamDefaultController,
          enc: TextEncoder,
          label: string,
        ) => sendStep(ctrl, enc, label);

        const completeStep = (
          ctrl: ReadableStreamDefaultController,
          enc: TextEncoder,
          id: string,
          label: string,
          opts?: { type?: string; tool?: string; parentId?: string },
        ) => {
          const startedAt = thinkingStepTimestamps.get(id) ?? Date.now();
          const step = {
            agentStep: {
              id,
              type: opts?.type ?? "thinking",
              tool: opts?.tool ?? "",
              label,
              status: "completed",
              startedAt,
              completedAt: Date.now(),
              resultSummary: null,
              parentId: opts?.parentId ?? null,
            },
          };
          ctrl.enqueue(enc.encode(`data: ${JSON.stringify(step)}\n\n`));
        };

        // Convenience wrapper
        const completeThinkingStep = (
          ctrl: ReadableStreamDefaultController,
          enc: TextEncoder,
          id: string,
          label: string,
        ) => completeStep(ctrl, enc, id, label);

        const responseStream = new ReadableStream({
          async start(controller) {
            try {

              // Emit usage warning if approaching monthly limit
              if (usageWarningPayload) {
                controller.enqueue(encoder.encode(
                  `data: ${JSON.stringify({ usageWarning: usageWarningPayload })}\n\n`
                ));
              }

              // Emit first thinking step
              const analyzeStepId = sendThinkingStep(controller, encoder, "Analyserar din fråga...");

              let chunkCount = 0;
              let lastFinishReason: string | undefined;
              let lastPromptFeedback: unknown = undefined;
              const streamStartTime = Date.now();
              let formulerStepId: string | null = null;

              for await (const chunk of stream) {
                chunkCount++;

                // Complete "Analyserar" on first chunk — marks real end of analysis
                if (chunkCount === 1) {
                  completeThinkingStep(controller, encoder, analyzeStepId, "Analyserar din fråga...");
                  formulerStepId = sendThinkingStep(controller, encoder, "Formulerar svar...");
                }

                // Capture diagnostics from chunk
                const candidate = chunk.candidates?.[0];
                if (candidate?.finishReason) lastFinishReason = candidate.finishReason;
                if (chunk.promptFeedback) lastPromptFeedback = chunk.promptFeedback;

                // Check for tool calls first
                const functionCalls = chunk.functionCalls();
                if (functionCalls && functionCalls.length > 0) {
                  toolCallDetected = functionCalls[0];
                  // Stop streaming text if we hit a tool call
                  break;
                }

                const chunkText = chunk.text();
                if (chunkText) {
                  fullText += chunkText;
                  const sseData = `data: ${
                    JSON.stringify({ text: chunkText })
                  }\n\n`;
                  controller.enqueue(encoder.encode(sseData));
                }
              }

              // Log stream diagnostics
              const streamDuration = Date.now() - streamStartTime;
              logger.info("Gemini stream diagnostics", {
                chunkCount,
                fullTextLength: fullText.length,
                toolCallDetected: !!toolCallDetected,
                toolCallName: toolCallDetected?.name || null,
                streamDurationMs: streamDuration,
                lastFinishReason: lastFinishReason || "none",
                promptFeedback: lastPromptFeedback ? JSON.stringify(lastPromptFeedback) : null,
              });

              if (toolCallDetected) {
                // Execute the tool and stream the result
                let toolResponseText = "";
                const toolName = toolCallDetected.name;
                const toolArgs = toolCallDetected.args || {};

                // Emit tool step nested under "Formulerar svar..."
                const TOOL_LABELS: Record<string, string> = {
                  search_invoices: "Hämtar fakturor från Fortnox...",
                  search_supplier_invoices: "Hämtar leverantörsfakturor...",
                  get_financial_summary: "Hämtar ekonomisk översikt...",
                  get_account_balances: "Hämtar kontosaldon...",
                  search_vouchers: "Hämtar verifikationer...",
                  search_customers: "Söker kunder i Fortnox...",
                  get_vat_report: "Genererar momsrapport...",
                  get_company_info: "Hämtar företagsinformation...",
                  create_invoice: "Skapar faktura...",
                  propose_action_plan: "Förbereder handlingsplan...",
                  search_articles: "Söker artiklar...",
                  conversation_search: "Söker i tidigare konversationer...",
                  web_search: "Söker på webben...",
                };
                const toolLabel = TOOL_LABELS[toolName] || `Kör ${toolName}...`;
                const toolStepId = sendStep(controller, encoder, toolLabel, {
                  type: "tool",
                  tool: toolName,
                  parentId: formulerStepId ?? undefined,
                });

                try {
                  if (toolName === "conversation_search") {
                    if (shouldSkipHistorySearch(message)) {
                      const directResponse = await sendMessageToGemini(
                        finalMessage,
                        geminiFileData,
                        history,
                        undefined,
                        effectiveModel,
                        { disableTools: true },
                      );
                      toolResponseText = directResponse.text ||
                        "Jag kan hjälpa dig att sammanfatta redovisningen, men jag behöver mer data.";
                    } else {
                      const searchQuery =
                        (toolArgs as { query?: string }).query || "";
                      const searchResults = await searchConversationHistory(
                        supabaseAdmin,
                        userId,
                        resolvedCompanyId,
                        searchQuery,
                        5,
                      );

                      if (searchResults.length === 0) {
                        const noResultsPrompt =
                          `Jag sökte igenom tidigare konversationer efter "${searchQuery}" men hittade inget relevant. Svara på användarens fråga så gott du kan utan tidigare kontext: "${message}"`;
                        const noResultsResponse = await sendMessageToGemini(
                          withAccountingContract(noResultsPrompt),
                          undefined,
                          history,
                          undefined,
                          effectiveModel,
                          { disableTools: true },
                        );
                        toolResponseText = noResultsResponse.text ||
                          `Jag hittade tyvärr inget i tidigare konversationer som matchar "${searchQuery}".`;
                      } else {
                        const contextLines = searchResults.map((r) =>
                          `[${
                            r.conversation_title || "Konversation"
                          }]: ${r.snippet}`
                        );
                        const contextPrompt =
                          `SÖKRESULTAT FRÅN TIDIGARE KONVERSATIONER:\n${
                            contextLines.join("\n")
                          }\n\nAnvänd denna kontext för att svara naturligt på användarens fråga: "${message}"`;
                        const followUp = await sendMessageToGemini(
                          withAccountingContract(contextPrompt),
                          undefined,
                          history,
                          undefined,
                          effectiveModel,
                          { disableTools: true },
                        );
                        toolResponseText = followUp.text ||
                          formatHistoryResponse(searchQuery, searchResults, []);
                      }
                    }
                  } else if (toolName === "recent_chats") {
                    if (shouldSkipHistorySearch(message)) {
                      const directResponse = await sendMessageToGemini(
                        finalMessage,
                        geminiFileData,
                        history,
                        undefined,
                        effectiveModel,
                        { disableTools: true },
                      );
                      toolResponseText = directResponse.text ||
                        "Jag kan hjälpa dig att sammanfatta redovisningen, men jag behöver mer data.";
                    } else {
                      const limit = (toolArgs as { limit?: number }).limit || 5;
                      const recentConversations = await getRecentConversations(
                        supabaseAdmin,
                        userId,
                        resolvedCompanyId,
                        limit,
                      );

                      if (recentConversations.length === 0) {
                        toolResponseText =
                          "Du har inga tidigare konversationer ännu.";
                      } else {
                        const contextLines = recentConversations.map((c) =>
                          `- ${c.title || "Konversation"}${
                            c.summary ? ` - ${c.summary}` : ""
                          }`
                        );
                        const contextPrompt = `SENASTE KONVERSATIONER:\n${
                          contextLines.join("\n")
                        }\n\nGe en kort överblick baserat på dessa konversationer för att svara på: "${message}"`;
                        const followUp = await sendMessageToGemini(
                          withAccountingContract(contextPrompt),
                          undefined,
                          history,
                          undefined,
                          effectiveModel,
                        );
                        toolResponseText = followUp.text ||
                          formatHistoryResponse(
                            message,
                            [],
                            recentConversations,
                          );
                      }
                    }
                  } else if (toolName === "web_search") {
                    const webResults = await fetchWebSearchResults(
                      toolArgs,
                      authHeader,
                    );
                    if (!webResults || webResults.results.length === 0) {
                      const noResultsPrompt =
                        `Jag hittade inga tillförlitliga webbkällor via webbsökning för frågan. Svara ändå så gott du kan, men var tydlig med osäkerhet och be om förtydligande vid behov. Fråga: "${message}"`;
                      const followUp = await sendMessageToGemini(
                        withAccountingContract(noResultsPrompt),
                        undefined,
                        history,
                        undefined,
                        effectiveModel,
                        { disableTools: true },
                      );
                      toolResponseText = followUp.text ||
                        "Jag hittade tyvärr inga tillförlitliga källor just nu.";
                    } else {
                      const contextPrompt =
                        `WEBBSÖKRESULTAT (uppdaterade, officiella källor):\n${
                          formatWebSearchContext(webResults)
                        }\n\nAnvänd dessa källor för att svara på användarens fråga. Redovisa källa och datum i svaret. Fråga: "${message}"`;
                      const followUp = await sendMessageToGemini(
                        withAccountingContract(contextPrompt),
                        undefined,
                        history,
                        undefined,
                        effectiveModel,
                        { disableTools: true },
                      );
                      toolResponseText = followUp.text ||
                        "Jag kunde inte sammanställa ett svar från webbkällorna.";
                    }
                  } else if (toolName === "propose_action_plan") {
                    // Handle action plan proposal — save to metadata, stream as interactive card
                    const planArgs = toolArgs as {
                      summary?: string;
                      actions?: Array<{
                        action_type: string;
                        description: string;
                        parameters: Record<string, unknown>;
                        posting_rows?: Array<{
                          account: string;
                          accountName: string;
                          debit: number;
                          credit: number;
                          comment?: string;
                        }>;
                        confidence?: number;
                      }>;
                      assumptions?: string[];
                    };
                    const planId = crypto.randomUUID();
                    const actionPlan = {
                      type: "action_plan" as const,
                      plan_id: planId,
                      status: "pending" as const,
                      summary: planArgs.summary || "Handlingsplan",
                      actions: (planArgs.actions || []).map((a, i) => ({
                        id: `${planId}-${i}`,
                        action_type: a.action_type,
                        description: a.description,
                        parameters: a.parameters || {},
                        posting_rows: a.posting_rows || [],
                        confidence: a.confidence ?? 0.8,
                        status: "pending" as const,
                      })),
                      assumptions: planArgs.assumptions || [],
                      source_file: findSourceFile(Array.isArray(history) ? history : []),
                    };

                    // Stream the action plan as a special SSE event
                    const ssePlanData = `data: ${
                      JSON.stringify({ actionPlan })
                    }\n\n`;
                    controller.enqueue(encoder.encode(ssePlanData));

                    // Also set a text summary for the AI to follow up on
                    const actionsDesc = actionPlan.actions
                      .map((a, i) => `${i + 1}. ${a.description}`)
                      .join("\n");
                    toolResponseText =
                      `Jag har förberett en handlingsplan: "${actionPlan.summary}"\n\n${actionsDesc}\n\nGodkänn, ändra eller avbryt planen med knapparna ovan.`;

                    // Save plan metadata for the message (will be stored below)
                    streamingActionPlan = actionPlan;

                    logger.info("Action plan proposed", {
                      planId,
                      actionCount: actionPlan.actions.length,
                      summary: actionPlan.summary,
                    });
                  } else if (toolName === "request_clarification") {
                    // AI needs more info before creating a plan
                    const clarArgs = toolArgs as { message?: string; missing_fields?: string[] };
                    const clarText = clarArgs.message || "Jag behöver mer information för att kunna skapa en handlingsplan.";

                    // Send structured clarification event for AIQuestionCard
                    const clarificationEvent = {
                      clarification: {
                        message: clarText,
                        missing_fields: clarArgs.missing_fields || [],
                      }
                    };
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(clarificationEvent)}\n\n`));

                    // Also send as text for fallback display
                    const sseData = `data: ${JSON.stringify({ text: clarText })}\n\n`;
                    controller.enqueue(encoder.encode(sseData));
                    toolResponseText = clarText;
                    logger.info("Agent requested clarification", {
                      missingFields: clarArgs.missing_fields,
                    });
                  } else if (toolName === "register_payment") {
                    // Handle payment registration via Fortnox
                    const payArgs = toolArgs as Record<string, unknown>;
                    // Resolve casing — AI may send snake_case, camelCase, or PascalCase
                    const paymentDate = (payArgs.payment_date || payArgs.paymentDate || payArgs.PaymentDate) as string ||
                      new Date().toISOString().slice(0, 10);
                    const invoiceNum = String(payArgs.invoice_number || payArgs.invoiceNumber || payArgs.InvoiceNumber || "");
                    const payAmount = (payArgs.amount ?? payArgs.Amount) as number || 0;
                    const payArgType = (payArgs.payment_type || payArgs.paymentType || payArgs.PaymentType) as string;

                    if (payArgType === "supplier") {
                      // Supplier payment is non-critical — approve+pay, but gracefully degrade
                      try {
                        try {
                          await callFortnoxWrite(
                            "approveSupplierInvoiceBookkeep",
                            { givenNumber: Number(invoiceNum) },
                            "approve_supplier_invoice",
                            invoiceNum,
                          );
                          logger.info("Auto-approved supplier invoice before payment", { invoiceNum });
                        } catch (bookErr: unknown) {
                          logger.info("Supplier invoice already booked or approval failed (continuing)", {
                            invoiceNum,
                            error: bookErr instanceof Error ? bookErr.message : "Unknown",
                          });
                        }
                        const result = await callFortnoxWrite(
                          "registerSupplierInvoicePayment",
                          {
                            payment: {
                              InvoiceNumber: invoiceNum,
                              Amount: payAmount,
                              PaymentDate: paymentDate,
                            },
                          },
                          "register_supplier_invoice_payment",
                          invoiceNum,
                        );
                        void auditService.log({
                          userId,
                          companyId: resolvedCompanyId || undefined,
                          actorType: "ai",
                          action: "create",
                          resourceType: "supplier_invoice_payment",
                          resourceId: invoiceNum,
                          newState: result,
                        });
                        toolResponseText =
                          `Betalning på ${payAmount} kr registrerad för leverantörsfaktura ${invoiceNum} (${paymentDate}).`;
                      } catch (payErr: unknown) {
                        logger.warn("register_payment for supplier invoice failed (non-critical)", {
                          invoiceNumber: invoiceNum,
                          error: payErr instanceof Error ? payErr.message : "Unknown",
                        });
                        toolResponseText =
                          `⚠️ Leverantörsfaktura ${invoiceNum} skapad men betalning kunde inte registreras — fakturan behöver attesteras och bokföras först i Fortnox.`;
                        void auditService.log({
                          userId,
                          companyId: resolvedCompanyId || undefined,
                          actorType: "ai",
                          action: "update_skipped",
                          resourceType: "supplier_invoice",
                          resourceId: invoiceNum,
                        });
                      }
                    } else {
                      // Customer payment — graceful degradation like supplier path
                      try {
                        const result = await callFortnoxWrite(
                          "registerInvoicePayment",
                          {
                            payment: {
                              InvoiceNumber: Number(invoiceNum),
                              Amount: payAmount,
                              PaymentDate: paymentDate,
                            },
                          },
                          "register_invoice_payment",
                          invoiceNum,
                        );
                        void auditService.log({
                          userId,
                          companyId: resolvedCompanyId || undefined,
                          actorType: "ai",
                          action: "create",
                          resourceType: "invoice_payment",
                          resourceId: invoiceNum,
                          newState: result,
                        });
                        toolResponseText =
                          `Betalning på ${payAmount} kr registrerad för kundfaktura ${invoiceNum} (${paymentDate}).`;
                      } catch (payErr: unknown) {
                        logger.warn("register_payment for customer invoice failed", {
                          invoiceNumber: invoiceNum,
                          error: payErr instanceof Error ? payErr.message : "Unknown",
                        });
                        toolResponseText =
                          `⚠️ Betalning kunde inte registreras för faktura ${invoiceNum}. Kontrollera att fakturan är bokförd i Fortnox.`;
                      }
                    }
                  } else if (toolName === "search_invoices") {
                    // Read-only: search/list invoices from Fortnox
                    if (!resolvedCompanyId) {
                      toolResponseText = "Fortnox-koppling saknas. Koppla ditt Fortnox-konto under Inställningar.";
                    } else {
                      try {
                        const args = toolArgs as { query?: string; status?: string; limit?: number };
                        const fetchLimit = Math.min(args.limit || 25, 100);
                        const result = await callFortnoxRead("getInvoices", {
                          pagination: { page: 1, limit: fetchLimit },
                        }, authHeader, resolvedCompanyId);

                        let invoices = ((result as any)?.Invoices || []) as Array<Record<string, unknown>>;

                        // Filter by query (customer name or invoice number)
                        if (args.query) {
                          const q = args.query.toLowerCase();
                          invoices = invoices.filter((inv: any) =>
                            (inv.CustomerName || "").toLowerCase().includes(q) ||
                            String(inv.DocumentNumber || "").includes(q)
                          );
                        }

                        // Filter by status
                        if (args.status && args.status !== "all") {
                          invoices = invoices.filter((inv: any) => {
                            const cancelled = inv.Cancelled === true;
                            if (args.status === "cancelled") return cancelled;
                            if (cancelled) return false;
                            const balance = Number(inv.Balance) || 0;
                            const booked = inv.Booked === true || String(inv.Booked).toLowerCase() === "true";
                            const dueDate = inv.DueDate as string;
                            const isOverdue = dueDate ? new Date(dueDate) < new Date() : false;

                            if (args.status === "paid") return balance === 0 && booked;
                            if (args.status === "overdue") return balance > 0 && isOverdue;
                            if (args.status === "unpaid") return balance > 0;
                            return true;
                          });
                        }

                        // Build artifact data
                        const displayLimit = args.limit || 25;
                        const invoiceListData = {
                          type: "invoice_list" as const,
                          invoices: invoices.slice(0, displayLimit).map((inv: any) => ({
                            invoiceNumber: String(inv.DocumentNumber || ""),
                            customerName: String(inv.CustomerName || ""),
                            total: Number(inv.Total) || 0,
                            totalVat: Number(inv.TotalVAT) || 0,
                            status: inv.Cancelled
                              ? "cancelled"
                              : Number(inv.Balance) === 0
                                ? "paid"
                                : (inv.DueDate && new Date(inv.DueDate) < new Date() ? "overdue" : "unpaid"),
                            invoiceDate: String(inv.InvoiceDate || ""),
                            dueDate: String(inv.DueDate || ""),
                          })),
                          query: args.query,
                        };

                        // Stream artifact event
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ invoiceList: invoiceListData })}\n\n`));
                        streamingActionPlan = invoiceListData as any;

                        const count = invoiceListData.invoices.length;
                        toolResponseText = count > 0
                          ? `Jag hittade ${count} fakturor${args.query ? ` som matchar "${args.query}"` : ""}${args.status && args.status !== "all" ? ` med status ${args.status}` : ""}.`
                          : `Inga fakturor hittades${args.query ? ` som matchar "${args.query}"` : ""}.`;
                      } catch (searchErr) {
                        logger.error("search_invoices failed", searchErr);
                        toolResponseText = "Kunde inte hämta fakturor från Fortnox just nu. Försök igen.";
                      }
                    }
                  } else if (toolName === "search_supplier_invoices") {
                    // Read-only: search/list supplier invoices from Fortnox
                    if (!resolvedCompanyId) {
                      toolResponseText = "Fortnox-koppling saknas. Koppla ditt Fortnox-konto under Inställningar.";
                    } else {
                      try {
                        const args = toolArgs as { query?: string; status?: string; from_date?: string; to_date?: string; limit?: number };
                        const fetchLimit = Math.min(args.limit || 25, 100);
                        const result = await callFortnoxRead("getSupplierInvoices", {
                          fromDate: args.from_date,
                          toDate: args.to_date,
                          pagination: { page: 1, limit: fetchLimit },
                        }, authHeader, resolvedCompanyId);

                        let invoices = ((result as any)?.SupplierInvoices || []) as Array<Record<string, unknown>>;

                        // Filter by query (supplier name, given number, or invoice number)
                        if (args.query) {
                          const q = args.query.toLowerCase();
                          invoices = invoices.filter((inv: any) =>
                            (inv.SupplierName || "").toLowerCase().includes(q) ||
                            String(inv.GivenNumber || "").includes(q) ||
                            String(inv.InvoiceNumber || "").includes(q)
                          );
                        }

                        // Filter by status
                        if (args.status && args.status !== "all") {
                          invoices = invoices.filter((inv: any) => {
                            const cancelled = inv.Cancelled === true;
                            if (args.status === "cancelled") return cancelled;
                            if (cancelled) return false;
                            const balance = Number(inv.Balance) || 0;
                            const booked = inv.Booked === true || String(inv.Booked).toLowerCase() === "true";
                            const dueDate = inv.DueDate as string;
                            const isOverdue = dueDate ? new Date(dueDate) < new Date() : false;

                            if (args.status === "paid") return balance === 0 && booked;
                            if (args.status === "overdue") return balance > 0 && isOverdue;
                            if (args.status === "unpaid") return balance > 0;
                            return true;
                          });
                        }

                        // Build artifact data
                        const displayLimit = args.limit || 25;
                        const supplierInvoiceListData = {
                          type: "supplier_invoice_list" as const,
                          invoices: invoices.slice(0, displayLimit).map((inv: any) => ({
                            givenNumber: String(inv.GivenNumber || ""),
                            supplierName: String(inv.SupplierName || ""),
                            invoiceNumber: String(inv.InvoiceNumber || ""),
                            total: Number(inv.Total) || 0,
                            balance: Number(inv.Balance) || 0,
                            status: inv.Cancelled
                              ? "cancelled"
                              : Number(inv.Balance) === 0
                                ? "paid"
                                : (inv.DueDate && new Date(inv.DueDate) < new Date() ? "overdue" : "unpaid"),
                            invoiceDate: String(inv.InvoiceDate || ""),
                            dueDate: String(inv.DueDate || ""),
                          })),
                          query: args.query,
                        };

                        // Stream artifact event
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ supplierInvoiceList: supplierInvoiceListData })}\n\n`));
                        streamingActionPlan = supplierInvoiceListData as any;

                        const count = supplierInvoiceListData.invoices.length;
                        toolResponseText = count > 0
                          ? `Jag hittade ${count} leverantörsfakturor${args.query ? ` som matchar "${args.query}"` : ""}${args.status && args.status !== "all" ? ` med status ${args.status}` : ""}.`
                          : `Inga leverantörsfakturor hittades${args.query ? ` som matchar "${args.query}"` : ""}.`;
                      } catch (searchErr) {
                        logger.error("search_supplier_invoices failed", searchErr);
                        toolResponseText = "Kunde inte hämta leverantörsfakturor från Fortnox just nu. Försök igen.";
                      }
                    }
                  } else if (toolName === "search_customers") {
                    // Read-only: search/list customers from Fortnox
                    if (!resolvedCompanyId) {
                      toolResponseText = "Fortnox-koppling saknas. Koppla ditt Fortnox-konto under Inställningar.";
                    } else {
                      try {
                        const args = toolArgs as { query?: string };
                        const result = await callFortnoxRead("getCustomers", {}, authHeader, resolvedCompanyId);

                        let customers = ((result as any)?.Customers || []) as Array<Record<string, unknown>>;

                        // Filter by query
                        if (args.query) {
                          const q = args.query.toLowerCase();
                          customers = customers.filter((c: any) =>
                            (c.Name || "").toLowerCase().includes(q) ||
                            (c.OrganisationNumber || "").toLowerCase().includes(q) ||
                            String(c.CustomerNumber || "").includes(q)
                          );
                        }

                        const customerListData = {
                          type: "customer_list" as const,
                          customers: customers.slice(0, 20).map((c: any) => ({
                            customerNumber: String(c.CustomerNumber || ""),
                            name: String(c.Name || ""),
                            organisationNumber: c.OrganisationNumber || undefined,
                            email: c.Email || undefined,
                            phone: c.Phone || undefined,
                          })),
                          query: args.query,
                        };

                        // Stream artifact event
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ customerList: customerListData })}\n\n`));
                        streamingActionPlan = customerListData as any;

                        const count = customerListData.customers.length;
                        toolResponseText = count > 0
                          ? `Jag hittade ${count} kunder${args.query ? ` som matchar "${args.query}"` : ""}.`
                          : `Inga kunder hittades${args.query ? ` som matchar "${args.query}"` : ""}.`;
                      } catch (searchErr) {
                        logger.error("search_customers failed", searchErr);
                        toolResponseText = "Kunde inte hämta kunder från Fortnox just nu. Försök igen.";
                      }
                    }
                  } else if (toolName === "get_vat_report") {
                    // Read-only: fetch VAT report from Fortnox
                    if (!resolvedCompanyId) {
                      toolResponseText = "Fortnox-koppling saknas. Koppla ditt Fortnox-konto under Inställningar.";
                    } else {
                      try {
                        const args = toolArgs as { from_date: string; to_date: string };
                        const result = await callFortnoxRead("getVATReport", {
                          fromDate: args.from_date,
                          toDate: args.to_date,
                        }, authHeader, resolvedCompanyId);

                        const report = result as any;
                        const reportData = report?.data || report;

                        // Stream VAT report as vat_summary artifact for VATSummaryCard
                        if (reportData?.vat || reportData?.sales) {
                          const sales = (reportData.sales || []) as Array<{ description: string; rate: number; net: number; vat: number }>;
                          const costs = (reportData.costs || []) as Array<{ description: string; rate: number; net: number; vat: number }>;
                          const allRows = [
                            ...sales.map((r: { description: string; rate: number; net: number; vat: number }) => ({
                              description: r.description,
                              rate: r.rate,
                              net: r.net,
                              vat: r.vat,
                              gross: r.net + r.vat,
                            })),
                            ...costs.map((r: { description: string; rate: number; net: number; vat: number }) => ({
                              description: r.description,
                              rate: r.rate,
                              net: -r.net,
                              vat: -r.vat,
                              gross: -(r.net + r.vat),
                            })),
                          ];
                          const totalNet = allRows.reduce((s, r) => s + r.net, 0);
                          const totalVat = allRows.reduce((s, r) => s + r.vat, 0);
                          const vatSummaryArtifact = {
                            type: "vat_summary" as const,
                            period: reportData.period || `${args.from_date} – ${args.to_date}`,
                            rows: allRows,
                            total_net: totalNet,
                            total_vat: totalVat,
                            total_gross: totalNet + totalVat,
                          };
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ vatReport: vatSummaryArtifact })}\n\n`));
                          streamingActionPlan = vatSummaryArtifact as any;
                        }

                        const vatData = reportData?.vat || {};
                        const outgoingVat = (vatData.outgoing_25 || 0) + (vatData.outgoing_12 || 0) + (vatData.outgoing_6 || 0);
                        const incomingVat = vatData.incoming || 0;
                        const netVat = vatData.net ?? (outgoingVat - incomingVat);

                        toolResponseText = `Momsrapport för ${args.from_date} till ${args.to_date}:\n` +
                          `Utgående moms: ${outgoingVat.toFixed(2)} kr\n` +
                          `Ingående moms: ${incomingVat.toFixed(2)} kr\n` +
                          `Moms att ${netVat >= 0 ? "betala" : "återfå"}: ${Math.abs(netVat).toFixed(2)} kr`;
                      } catch (vatErr) {
                        logger.error("get_vat_report failed", vatErr);
                        toolResponseText = "Kunde inte hämta momsrapport från Fortnox just nu. Försök igen.";
                      }
                    }
                  } else if (toolName === "get_company_info") {
                    // Read-only: fetch company info from Fortnox
                    if (!resolvedCompanyId) {
                      toolResponseText = "Fortnox-koppling saknas. Koppla ditt Fortnox-konto under Inställningar.";
                    } else {
                      try {
                        // Call FortnoxService directly (no dedicated action in fortnox Edge Function)
                        const fnxSupabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
                          global: { headers: { Authorization: authHeader } },
                        });
                        const fortnoxConfig = {
                          clientId: Deno.env.get("FORTNOX_CLIENT_ID") ?? "",
                          clientSecret: Deno.env.get("FORTNOX_CLIENT_SECRET") ?? "",
                          redirectUri: "",
                        };
                        const fortnoxService = new FortnoxService(
                          fortnoxConfig,
                          fnxSupabaseClient,
                          userId,
                          resolvedCompanyId,
                        );

                        const [companyResult, yearsResult] = await Promise.all([
                          fortnoxService.getCompanyInfo(),
                          fortnoxService.getFinancialYears().catch(() => ({ FinancialYears: [] })),
                        ]);

                        const info = (companyResult as any).CompanyInformation || {};
                        const years = (yearsResult as any).FinancialYears || [];
                        const currentYear = years.length > 0 ? years[0] : null;

                        const companyInfoData = {
                          type: "company_info" as const,
                          companyName: info.CompanyName || "",
                          organisationNumber: info.OrganizationNumber || "",
                          address: [info.Address, info.ZipCode, info.City].filter(Boolean).join(", ") || undefined,
                          email: info.Email || undefined,
                          phone: info.Phone1 || info.Phone2 || undefined,
                          fiscalYear: currentYear
                            ? { from: currentYear.FromDate, to: currentYear.ToDate }
                            : undefined,
                        };

                        // Stream artifact event
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ companyInfo: companyInfoData })}\n\n`));
                        streamingActionPlan = companyInfoData as any;

                        toolResponseText = `Företagsinformation: ${companyInfoData.companyName}` +
                          (companyInfoData.organisationNumber ? ` (${companyInfoData.organisationNumber})` : "");
                      } catch (companyErr) {
                        logger.error("get_company_info failed", companyErr);
                        toolResponseText = "Kunde inte hämta företagsinformation från Fortnox just nu. Försök igen.";
                      }
                    }
                  } else if (toolName === "get_financial_summary") {
                    // Read-only: fetch financial statements (P&L + Balance Sheet) from Fortnox
                    if (!resolvedCompanyId) {
                      toolResponseText = "Fortnox-koppling saknas. Koppla ditt Fortnox-konto under Inställningar.";
                    } else {
                      try {
                        const args = toolArgs as { financial_year_id?: number };
                        const result = await callFortnoxRead("getFinancialStatements", {
                          financialYearId: args.financial_year_id,
                        }, authHeader, resolvedCompanyId);

                        const fsResult = result as any;
                        const financialSummaryData = {
                          type: "financial_summary" as const,
                          company: fsResult.company?.name || "",
                          financialYear: {
                            from: fsResult.financialYear?.fromDate || "",
                            to: fsResult.financialYear?.toDate || "",
                          },
                          revenue: fsResult.resultatRakning?.totalRevenue || 0,
                          expenses: fsResult.resultatRakning?.totalExpenses || 0,
                          netResult: fsResult.resultatRakning?.netResult || 0,
                          totalAssets: fsResult.balansRakning?.totalAssets || 0,
                          totalLiabilitiesEquity: fsResult.balansRakning?.totalLiabilitiesEquity || 0,
                          balanced: fsResult.balansRakning?.balanced ?? true,
                          sections: [
                            ...(fsResult.resultatRakning?.sections || []),
                            ...(fsResult.balansRakning?.assets || []),
                            ...(fsResult.balansRakning?.liabilitiesEquity || []),
                          ].map((s: any) => ({
                            title: s.title,
                            total: s.total,
                            accounts: (s.accounts || []).map((a: any) => ({
                              number: a.number,
                              name: a.name,
                              amount: a.closingBalance ?? a.change ?? 0,
                            })),
                          })),
                        };

                        // Stream artifact event
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ financialSummary: financialSummaryData })}\n\n`));
                        streamingActionPlan = financialSummaryData as any;

                        const fsCompanyLabel2 = financialSummaryData.company || "ditt företag";
                        const fsDisplayResult2 = -financialSummaryData.netResult;
                        toolResponseText = `Här är den ekonomiska sammanfattningen för ${fsCompanyLabel2}. Resultat: ${fsDisplayResult2} kr.`;
                      } catch (fsErr) {
                        logger.error("get_financial_summary failed", fsErr);
                        toolResponseText = "Kunde inte hämta ekonomisk sammanfattning från Fortnox just nu. Försök igen.";
                      }
                    }
                  } else if (toolName === "get_account_balances") {
                    // Read-only: fetch account balances from Fortnox
                    if (!resolvedCompanyId) {
                      toolResponseText = "Fortnox-koppling saknas. Koppla ditt Fortnox-konto under Inställningar.";
                    } else {
                      try {
                        const args = toolArgs as { from_account?: number; to_account?: number; financial_year_id?: number; non_zero_only?: boolean };
                        const result = await callFortnoxRead("getFinancialStatements", {
                          financialYearId: args.financial_year_id,
                        }, authHeader, resolvedCompanyId);

                        const fsResult = result as any;
                        const allAccounts: Array<{number: number; name: string; openingBalance: number; closingBalance: number; change: number}> = [];
                        for (const section of [...(fsResult.resultatRakning?.sections || []), ...(fsResult.balansRakning?.assets || []), ...(fsResult.balansRakning?.liabilitiesEquity || [])]) {
                          for (const acc of (section.accounts || [])) {
                            allAccounts.push({
                              number: acc.number,
                              name: acc.name,
                              openingBalance: acc.openingBalance || 0,
                              closingBalance: acc.closingBalance || 0,
                              change: acc.change || 0,
                            });
                          }
                        }

                        let filtered = allAccounts;
                        if (args.from_account) filtered = filtered.filter(a => a.number >= args.from_account!);
                        if (args.to_account) filtered = filtered.filter(a => a.number <= args.to_account!);
                        const nonZeroOnly = args.non_zero_only !== false; // default true
                        if (nonZeroOnly) filtered = filtered.filter(a => a.openingBalance !== 0 || a.closingBalance !== 0 || a.change !== 0);
                        filtered.sort((a, b) => a.number - b.number);

                        const accountBalancesData = {
                          type: "account_balances" as const,
                          accounts: filtered.map(a => ({
                            number: a.number,
                            name: a.name,
                            openingBalance: a.openingBalance,
                            closingBalance: a.closingBalance,
                            change: a.change,
                          })),
                          financialYear: {
                            from: fsResult.financialYear?.fromDate || "",
                            to: fsResult.financialYear?.toDate || "",
                          },
                          filter: args.from_account || args.to_account ? { fromAccount: args.from_account, toAccount: args.to_account } : undefined,
                        };

                        // Stream artifact event
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ accountBalances: accountBalancesData })}\n\n`));
                        streamingActionPlan = accountBalancesData as any;

                        toolResponseText = `Hittade ${filtered.length} konton med saldo.`;
                      } catch (abErr) {
                        logger.error("get_account_balances failed", abErr);
                        toolResponseText = "Kunde inte hämta kontosaldon från Fortnox just nu. Försök igen.";
                      }
                    }
                  } else if (toolName === "search_vouchers") {
                    // Read-only: fetch vouchers from Fortnox
                    if (!resolvedCompanyId) {
                      toolResponseText = "Fortnox-koppling saknas. Koppla ditt Fortnox-konto under Inställningar.";
                    } else {
                      try {
                        const args = toolArgs as { financial_year?: number; series?: string; from_date?: string; to_date?: string; limit?: number };
                        const fetchLimit = Math.min(args.limit || 20, 100);
                        const result = await callFortnoxRead("getVouchers", {
                          financialYear: args.financial_year,
                          voucherSeries: args.series,
                          fromDate: args.from_date,
                          toDate: args.to_date,
                          pagination: { page: 1, limit: fetchLimit },
                          includeRows: true,
                        }, authHeader, resolvedCompanyId);

                        const vouchers = ((result as any)?.Vouchers || []) as Array<Record<string, unknown>>;
                        const displayLimit = args.limit || 20;
                        const voucherListData = {
                          type: "voucher_list" as const,
                          vouchers: vouchers.slice(0, displayLimit).map((v: any) => {
                            const voucherRows = (v.VoucherRows || []) as Array<Record<string, unknown>>;
                            return {
                              voucherNumber: Number(v.VoucherNumber) || 0,
                              voucherSeries: String(v.VoucherSeries || ""),
                              description: String(v.Description || ""),
                              transactionDate: String(v.TransactionDate || ""),
                              totalDebit: voucherRows.reduce((sum: number, r: any) => sum + (Number(r.Debit) || 0), 0),
                              totalCredit: voucherRows.reduce((sum: number, r: any) => sum + (Number(r.Credit) || 0), 0),
                              rows: voucherRows.map((r: any) => ({
                                account: Number(r.Account) || 0,
                                accountName: String(r.Description || ""),
                                debit: Number(r.Debit) || 0,
                                credit: Number(r.Credit) || 0,
                              })),
                            };
                          }),
                          query: args.series ? `Serie ${args.series}` : undefined,
                        };

                        // Stream artifact event
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ voucherList: voucherListData })}\n\n`));
                        streamingActionPlan = voucherListData as any;

                        toolResponseText = `Hittade ${voucherListData.vouchers.length} verifikationer.`;
                      } catch (svErr) {
                        logger.error("search_vouchers failed", svErr);
                        toolResponseText = "Kunde inte hämta verifikationer från Fortnox just nu. Försök igen.";
                      }
                    }
                  } else if (toolName === "learn_accounting_pattern") {
                    // Handle learning a new accounting pattern from user correction
                    const patternArgs = toolArgs as LearnAccountingPatternArgs;
                    try {
                      const patternService = new ExpensePatternService(supabaseAdmin);
                      const patternId = await patternService.confirmPattern(
                        userId,
                        resolvedCompanyId,
                        patternArgs.supplier_name,
                        patternArgs.bas_account,
                        patternArgs.bas_account_name,
                        patternArgs.vat_rate,
                        patternArgs.expense_type || "cost",
                        patternArgs.amount || 0,
                        null,
                        patternArgs.description_keywords || [],
                        false,
                      );
                      if (patternId) {
                        logger.info("Learned accounting pattern", {
                          patternId,
                          supplier: patternArgs.supplier_name,
                          account: patternArgs.bas_account,
                        });
                        const learnPrompt = `SYSTEM: Konteringsregeln har sparats. Leverantör "${patternArgs.supplier_name}" → konto ${patternArgs.bas_account} (${patternArgs.bas_account_name}), ${patternArgs.vat_rate}% moms. Bekräfta kort för användaren att du lärt dig detta och kommer använda det nästa gång. Svara på svenska. Användarens meddelande: "${message}"`;
                        const followUp = await sendMessageToGemini(
                          learnPrompt,
                          undefined,
                          history,
                          undefined,
                          effectiveModel,
                          { disableTools: true },
                        );
                        toolResponseText = followUp.text ||
                          `Jag har lärt mig att ${patternArgs.supplier_name} ska bokföras på konto ${patternArgs.bas_account} (${patternArgs.bas_account_name}). Nästa gång föreslår jag detta automatiskt.`;
                      } else {
                        toolResponseText = `Jag kunde tyvärr inte spara regeln just nu. Försök igen.`;
                      }
                    } catch (learnError) {
                      logger.warn("Failed to learn pattern", { error: String(learnError) });
                      toolResponseText = `Det gick inte att spara konteringsregeln. Försök igen senare.`;
                    }
                  } else {
                    // Execute Fortnox tools server-side
                    const fortnoxToolResult = await executeFortnoxTool(
                      toolName,
                      toolArgs,
                      supabaseAdmin,
                      userId,
                      resolvedCompanyId,
                      req.headers.get("Authorization")!,
                    );
                    if (fortnoxToolResult) {
                      toolResponseText =
                        shouldFormatAccountingToolResponse(toolName)
                          ? formatToolResponse({
                            toolName,
                            rawText: fortnoxToolResult,
                            structuredData: {
                              toolArgs: toolArgs as Record<string, unknown>,
                            },
                          })
                          : fortnoxToolResult;
                    } else {
                      // Unknown tool - send metadata for client handling
                      const sseToolData = `data: ${
                        JSON.stringify({
                          toolCall: { tool: toolName, args: toolArgs },
                        })
                      }\n\n`;
                      controller.enqueue(encoder.encode(sseToolData));
                    }
                  }

                  // Stream the tool response as text
                  if (toolResponseText) {
                    fullText = toolResponseText;
                    const sseData = `data: ${
                      JSON.stringify({ text: toolResponseText })
                    }\n\n`;
                    controller.enqueue(encoder.encode(sseData));
                  }
                } catch (toolErr) {
                  logger.error("Tool execution error in stream", { tool: toolName, error: toolErr instanceof Error ? toolErr.message : "unknown" });
                  // Fallback: ask Gemini to answer from its knowledge — no raw error in prompt
                  try {
                    const fallbackPrompt = `Verktyget "${toolName}" misslyckades. Svara ändå på användarens fråga med din befintliga kunskap om möjligt. Om frågan kräver specifik Fortnox-data som du inte har, förklara kort att Fortnox-kopplingen inte svarar just nu och ge generella råd istället.`;
                    const fallbackResponse = await sendMessageToGemini(
                      fallbackPrompt,
                      undefined,
                      history,
                      undefined,
                      effectiveModel,
                      { disableTools: true },
                    );
                    toolResponseText = fallbackResponse.text ||
                      "Jag kunde inte hämta data från Fortnox just nu, men jag kan hjälpa dig med generella bokföringsfrågor.";
                  } catch {
                    toolResponseText =
                      "Jag kunde inte nå Fortnox just nu. Försök igen om en stund.";
                  }
                  const sseData = `data: ${
                    JSON.stringify({ text: toolResponseText })
                  }\n\n`;
                  controller.enqueue(encoder.encode(sseData));
                  fullText = toolResponseText;
                }

                // Complete the tool step, then its parent "Formulerar svar..."
                completeStep(controller, encoder, toolStepId, toolLabel, {
                  type: "tool",
                  tool: toolName,
                  parentId: formulerStepId ?? undefined,
                });
                if (formulerStepId) completeThinkingStep(controller, encoder, formulerStepId, "Formulerar svar...");
              } else {
                // No tool call — complete "Formulerar svar..." after streaming ends
                if (formulerStepId) completeThinkingStep(controller, encoder, formulerStepId, "Formulerar svar...");
              }

              if (fullText && conversationId && userId !== "anonymous") {
                // Save final assembled message to database
                try {
                  if (!conversationService) {
                    const supabaseClient = createClient(
                      supabaseUrl,
                      supabaseServiceKey,
                      {
                        global: { headers: { Authorization: authHeader } },
                      },
                    );
                    conversationService = new ConversationService(
                      supabaseClient,
                    );
                  }
                  // Include usedMemories and action plan in metadata
                  const messageMetadata: Record<string, unknown> | null =
                    (usedMemories.length > 0 || streamingActionPlan)
                      ? {
                        ...(usedMemories.length > 0 ? { usedMemories } : {}),
                        ...(streamingActionPlan ? streamingActionPlan : {}),
                      }
                      : null;
                  await conversationService.addMessage(
                    conversationId,
                    "assistant",
                    fullText,
                    null,
                    null,
                    messageMetadata,
                  );
                  // Generate smart title - must await to prevent Edge Function terminating early
                  const resolvedTitle = await generateSmartTitleIfNeeded(
                    conversationService,
                    supabaseAdmin,
                    conversationId,
                    message,
                    fullText,
                    verifiedConversation?.title ?? null,
                  );
                  if (resolvedTitle && verifiedConversation) {
                    verifiedConversation.title = resolvedTitle;
                  }
                  void triggerMemoryGenerator(
                    supabaseUrl,
                    supabaseServiceKey,
                    conversationId,
                  );

                  // Log AI decision for BFL compliance (audit trail)
                  void auditService.logAIDecision({
                    userId,
                    companyId: resolvedCompanyId || undefined,
                    aiProvider: "gemini",
                    aiModel: effectiveModel,
                    aiFunction: "chat_response",
                    inputData: {
                      message_preview: message.substring(0, 200),
                      has_file: !!geminiFileData,
                      has_history: (history?.length || 0) > 0,
                      conversation_id: conversationId,
                    },
                    outputData: {
                      response_length: fullText.length,
                      has_tool_call: !!toolCallDetected,
                    },
                    confidence: 0.9, // Chat responses have high confidence
                  });
                } catch (dbError) {
                  logger.error("Failed to save message to DB", dbError);
                }
              }
              // Send used memories for transparency before DONE
              if (usedMemories.length > 0) {
                const memoriesData = `data: ${
                  JSON.stringify({ usedMemories })
                }\n\n`;
                controller.enqueue(encoder.encode(memoriesData));
              }

              // Log AI usage (fire-and-forget)
              usageTracker.logEvent({
                userId,
                companyId: resolvedCompanyId,
                eventType: "ai_message",
              });

              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            } catch (err) {
              logger.error("Stream processing error", err);
              controller.error(err);
            } finally {
              controller.close();
            }
          },
        });

        return new Response(responseStream, {
          headers: {
            ...responseHeaders,
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
          },
        });
      } catch (err) {
        // Re-throw rate limit errors to be handled by the outer catch block
        if (err instanceof GeminiRateLimitError) {
          throw err;
        }
        console.error(
          "[STREAMING] Streaming failed, falling back to non-streaming:",
          err,
        );
        logger.error("Gemini streaming initiation failed", err);
        // Fallback to non-streaming or error response
      }
    } else {
      logger.debug("Skipping streaming for non-Gemini provider", { provider });
    }

    // OpenAI or Fallback
    const geminiResponse = await (provider === "openai"
      ? sendMessageToOpenAI(finalMessage, primaryFile, imagePages, history)
      : sendMessageToGemini(
        finalMessage,
        geminiFileData,
        history,
        undefined,
        effectiveModel,
        { disableTools, allowedTools: fileAttachedTools },
      ));

    // Handle Tool Calls (Non-streaming fallback)
    if (geminiResponse.toolCall) {
      const { tool, args } = geminiResponse.toolCall;
      logger.info(`Executing tool: ${tool}`, { args });

      const supabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
        global: {
          headers: { Authorization: req.headers.get("Authorization")! },
        },
      });

      const fortnoxConfig = {
        clientId: Deno.env.get("FORTNOX_CLIENT_ID") ?? "",
        clientSecret: Deno.env.get("FORTNOX_CLIENT_SECRET") ?? "",
        redirectUri: "",
      };
      const fortnoxCompanyId =
        resolvedCompanyId && resolvedCompanyId.trim().length > 0
          ? resolvedCompanyId.trim()
          : null;
      if (!fortnoxCompanyId) {
        throw new Error("Bolagskontext saknas för Fortnox-verktyg.");
      }
      const fortnoxService = new FortnoxService(
        fortnoxConfig,
        supabaseClient,
        userId,
        fortnoxCompanyId,
      );
      const buildIdempotencyKey = (
        operation: string,
        resource: string,
      ): string =>
        `gemini_tool:${fortnoxCompanyId}:${operation}:${resource}`.slice(
          0,
          200,
        );
      const callFortnoxWrite = async (
        action: string,
        payload: Record<string, unknown>,
        operation: string,
        resource: string,
      ): Promise<Record<string, unknown>> => {
        const response = await fetch(`${supabaseUrl}/functions/v1/fortnox`, {
          method: "POST",
          headers: {
            "Authorization": req.headers.get("Authorization")!,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action,
            companyId: fortnoxCompanyId,
            payload: {
              ...payload,
              idempotencyKey: buildIdempotencyKey(operation, resource),
              sourceContext: "gemini-chat-tool",
            },
          }),
        });

        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          const message = typeof result?.error === "string"
            ? result.error
            : `Fortnox write failed (${response.status})`;
          throw new Error(message);
        }
        return (result || {}) as Record<string, unknown>;
      };

      let toolResult: any;
      let responseText = "";
      let toolStructuredData: Record<string, unknown> | null = null;
      let nonStreamMetadata: Record<string, unknown> | null = null;
      let toolExecutionFailed = false;
      const shouldFormatCurrentToolResponse =
        shouldFormatAccountingToolResponse(tool);

      try {
        switch (tool) {
          case "conversation_search": {
            if (shouldSkipHistorySearch(message)) {
              const directResponse = await sendMessageToGemini(
                finalMessage,
                geminiFileData,
                history,
                undefined,
                effectiveModel,
                { disableTools: true },
              );
              responseText = directResponse.text ||
                "Jag kan hjälpa dig att sammanfatta redovisningen, men jag behöver mer data.";
              break;
            }
            const searchQuery = (args as { query: string }).query;
            const searchResults = await searchConversationHistory(
              supabaseAdmin,
              userId,
              resolvedCompanyId,
              searchQuery,
              5,
            );

            if (searchResults.length === 0) {
              // No results - respond naturally
              const noResultsPrompt =
                `Jag sökte igenom tidigare konversationer efter "${searchQuery}" men hittade inget relevant. Svara på användarens fråga så gott du kan utan tidigare kontext: "${message}"`;
              const noResultsResponse = await sendMessageToGemini(
                withAccountingContract(noResultsPrompt),
                undefined,
                history,
                undefined,
                effectiveModel,
                { disableTools: true },
              );
              responseText = noResultsResponse.text ||
                `Jag hittade tyvärr inget i tidigare konversationer som matchar "${searchQuery}". Kan du förtydliga vad du letar efter?`;
            } else {
              // Format results as context for AI
              const contextLines = searchResults.map((r) => {
                const title = r.conversation_title || "Konversation";
                return `[${title}]: ${r.snippet}`;
              });

              // Send context back to Gemini for natural response
              const contextPrompt =
                `SÖKRESULTAT FRÅN TIDIGARE KONVERSATIONER:\n${
                  contextLines.join("\n")
                }\n\nAnvänd denna kontext för att svara naturligt på användarens fråga: "${message}"`;
              const followUp = await sendMessageToGemini(
                withAccountingContract(contextPrompt),
                undefined,
                history,
                undefined,
                effectiveModel,
                { disableTools: true },
              );
              responseText = followUp.text ||
                formatHistoryResponse(searchQuery, searchResults, []);
            }
            break;
          }
          case "recent_chats": {
            if (shouldSkipHistorySearch(message)) {
              const directResponse = await sendMessageToGemini(
                finalMessage,
                geminiFileData,
                history,
                undefined,
                effectiveModel,
                { disableTools: true },
              );
              responseText = directResponse.text ||
                "Jag kan hjälpa dig att sammanfatta redovisningen, men jag behöver mer data.";
              break;
            }
            const limit = (args as { limit?: number }).limit || 5;
            const recentConversations = await getRecentConversations(
              supabaseAdmin,
              userId,
              resolvedCompanyId,
              limit,
            );

            if (recentConversations.length === 0) {
              responseText = "Du har inga tidigare konversationer ännu.";
            } else {
              // Format for AI context
              const contextLines = recentConversations.map((c) => {
                const title = c.title || "Konversation";
                const summary = c.summary ? ` - ${c.summary}` : "";
                return `- ${title}${summary}`;
              });

              const contextPrompt = `SENASTE KONVERSATIONER:\n${
                contextLines.join("\n")
              }\n\nGe en kort överblick baserat på dessa konversationer för att svara på: "${message}"`;
              const followUp = await sendMessageToGemini(
                withAccountingContract(contextPrompt),
                undefined,
                history,
                undefined,
                effectiveModel,
              );
              responseText = followUp.text ||
                formatHistoryResponse(message, [], recentConversations);
            }
            break;
          }
          case "web_search": {
            const webResults = await fetchWebSearchResults(
              args as Record<string, unknown>,
              authHeader,
            );
            if (!webResults || webResults.results.length === 0) {
              const noResultsPrompt =
                `Jag hittade inga tillförlitliga webbkällor via webbsökning för frågan. Svara ändå så gott du kan, men var tydlig med osäkerhet och be om förtydligande vid behov. Fråga: "${message}"`;
              const followUp = await sendMessageToGemini(
                withAccountingContract(noResultsPrompt),
                undefined,
                history,
                undefined,
                effectiveModel,
                { disableTools: true },
              );
              responseText = followUp.text ||
                "Jag hittade tyvärr inga tillförlitliga källor just nu.";
            } else {
              const contextPrompt =
                `WEBBSÖKRESULTAT (uppdaterade, officiella källor):\n${
                  formatWebSearchContext(webResults)
                }\n\nAnvänd dessa källor för att svara på användarens fråga. Redovisa källa och datum i svaret. Fråga: "${message}"`;
              const followUp = await sendMessageToGemini(
                withAccountingContract(contextPrompt),
                undefined,
                history,
                undefined,
                effectiveModel,
                { disableTools: true },
              );
              responseText = followUp.text ||
                "Jag kunde inte sammanställa ett svar från webbkällorna.";
            }
            break;
          }
          case "company_lookup": {
            const lookupResult = await lookupCompanyOnAllabolag((args as any).company_name);
            const followUp = await sendMessageToGemini(
              withAccountingContract(`FÖRETAGSUPPSLAG:\n${lookupResult}\n\nFortsätt svara på användarens fråga med denna information. Fråga: "${message}"`),
              undefined,
              history,
              undefined,
              effectiveModel,
            );
            responseText = followUp.text || lookupResult;
            break;
          }
          case "create_invoice": {
            // Resolve casing — AI may send snake_case, camelCase, or PascalCase
            const ci3CustNum = ((args as any).customer_number || (args as any).customerNumber || (args as any).CustomerNumber) as string;
            if (!ci3CustNum) {
              responseText = "Kundnummer saknas. Ange kundnummer för att skapa fakturan.";
              break;
            }
            toolResult = await callFortnoxWrite(
              "createInvoice",
              {
                invoice: {
                  CustomerNumber: ci3CustNum,
                  InvoiceRows: (args as any).InvoiceRows || (args as any).invoice_rows || [],
                  InvoiceDate: ((args as any).InvoiceDate || (args as any).invoice_date ||
                    new Date().toISOString().slice(0, 10)) as string,
                  DueDate: ((args as any).DueDate || (args as any).due_date || undefined) as string | undefined,
                  Comments: ((args as any).Comments || (args as any).comments || undefined) as string | undefined,
                },
              },
              "create_invoice",
              String(ci3CustNum),
            );
            const cInv = (toolResult as any)?.Invoice || toolResult;
            responseText = `Kundfaktura skapad som utkast (nr ${cInv.InvoiceNumber || "tilldelas"}) i Fortnox.`;
            void auditService.log({
              userId,
              companyId: resolvedCompanyId || undefined,
              actorType: "ai",
              action: "create",
              resourceType: "invoice",
              resourceId: String(cInv.InvoiceNumber || ""),
              newState: toolResult,
            });
            toolStructuredData = {
              toolArgs: args as Record<string, unknown>,
              toolResult: toolResult as Record<string, unknown>,
            };
            break;
          }
          case "update_invoice": {
            const uDocNum = Number((args as any).DocumentNumber || (args as any).document_number);
            if (!uDocNum) throw new Error("DocumentNumber saknas för update_invoice");

            const uInvoiceUpdate: Record<string, unknown> = {};
            if ((args as any).InvoiceRows && Array.isArray((args as any).InvoiceRows)) uInvoiceUpdate.InvoiceRows = (args as any).InvoiceRows;
            if ((args as any).DueDate) uInvoiceUpdate.DueDate = (args as any).DueDate;
            if ((args as any).Comments) uInvoiceUpdate.Comments = (args as any).Comments;
            if ((args as any).OurReference) uInvoiceUpdate.OurReference = (args as any).OurReference;
            if ((args as any).YourReference) uInvoiceUpdate.YourReference = (args as any).YourReference;
            if ((args as any).InvoiceDate) uInvoiceUpdate.InvoiceDate = (args as any).InvoiceDate;

            toolResult = await callFortnoxWrite(
              "updateInvoice",
              { documentNumber: uDocNum, invoice: uInvoiceUpdate },
              "update_invoice",
              String(uDocNum),
            );
            const uInv = (toolResult as any)?.Invoice || toolResult;
            responseText = `Faktura ${uDocNum} har uppdaterats (ny total: ${uInv.Total || "?"} kr) i Fortnox.`;
            void auditService.log({
              userId,
              companyId: resolvedCompanyId || undefined,
              actorType: "ai",
              action: "update",
              resourceType: "invoice",
              resourceId: String(uDocNum),
              newState: toolResult,
            });
            toolStructuredData = {
              toolArgs: args as Record<string, unknown>,
              toolResult: toolResult as Record<string, unknown>,
            };
            break;
          }
          case "get_customers":
            toolResult = await fortnoxService.getCustomers();
            responseText = `Här är dina kunder: ${
              toolResult.Customers.map((c: any) =>
                c.Name
              ).join(", ")
            }`;
            toolStructuredData = {
              toolArgs: args as Record<string, unknown>,
              toolResult: toolResult as Record<string, unknown>,
            };
            break;
          case "get_articles":
            toolResult = await fortnoxService.getArticles();
            responseText = `Här är dina artiklar: ${
              toolResult.Articles.map((a: any) => a.Description).join(", ")
            }`;
            toolStructuredData = {
              toolArgs: args as Record<string, unknown>,
              toolResult: toolResult as Record<string, unknown>,
            };
            break;
          case "get_suppliers":
            toolResult = await fortnoxService.getSuppliers();
            responseText = toolResult.Suppliers?.length > 0
              ? `Här är dina leverantörer:\n${
                toolResult.Suppliers.map((s: any) =>
                  `- ${s.Name} (nr ${s.SupplierNumber}${
                    s.OrganisationNumber ? `, org: ${s.OrganisationNumber}` : ""
                  })`
                ).join("\n")
              }`
              : "Inga leverantörer hittades i Fortnox.";
            toolStructuredData = {
              toolArgs: args as Record<string, unknown>,
              toolResult: toolResult as Record<string, unknown>,
            };
            break;
          case "get_invoice": {
            const invNum = Number(args.invoice_number);
            toolResult = await fortnoxService.getInvoice(invNum);
            const inv = (toolResult as any).Invoice || toolResult;
            const invId = inv.InvoiceNumber || inv.DocumentNumber || invNum;
            responseText = `Faktura ${invId}:\n` +
              `- DocumentNumber: ${inv.DocumentNumber || invId}\n` +
              `- Kund: ${inv.CustomerName || "—"} (${inv.CustomerNumber})\n` +
              `- Datum: ${inv.InvoiceDate}\n` +
              `- Förfallodatum: ${inv.DueDate}\n` +
              `- Belopp: ${inv.Total} kr (varav moms ${inv.TotalVAT} kr)\n` +
              `- Netto: ${inv.Net} kr\n` +
              `- Bokförd: ${inv.Booked ? "Ja" : "Nej"}\n` +
              `- Status: ${inv.Cancelled ? "Makulerad" : inv.Booked ? "Bokförd" : "Utkast"}`;
            // Include rows for update context
            if (inv.InvoiceRows && Array.isArray(inv.InvoiceRows) && inv.InvoiceRows.length > 0) {
              responseText += `\n- Fakturarader:`;
              inv.InvoiceRows.forEach((row: any, i: number) => {
                responseText += `\n  Rad ${i + 1}: "${row.Description || '-'}" | Antal: ${row.DeliveredQuantity || 1} | À-pris: ${row.Price || 0} kr | Total: ${row.Total || 0} kr`;
              });
            }
            toolStructuredData = {
              toolArgs: args as Record<string, unknown>,
              toolResult: toolResult as Record<string, unknown>,
            };
            break;
          }
          case "get_supplier_invoice": {
            const siNum = Number(args.given_number);
            toolResult = await fortnoxService.getSupplierInvoice(siNum);
            const si = (toolResult as any).SupplierInvoice || toolResult;
            responseText = `Leverantörsfaktura ${si.GivenNumber}:\n` +
              `- Leverantör: ${si.SupplierName || "—"} (${si.SupplierNumber})\n` +
              `- Fakturanr: ${si.InvoiceNumber || "—"}\n` +
              `- Datum: ${si.InvoiceDate}\n` +
              `- Förfallodatum: ${si.DueDate}\n` +
              `- Belopp: ${si.Total} kr (varav moms ${si.VAT || 0} kr)\n` +
              `- Bokförd: ${si.Booked ? "Ja" : "Nej"}`;
            toolStructuredData = {
              toolArgs: args as Record<string, unknown>,
              toolResult: toolResult as Record<string, unknown>,
            };
            break;
          }
          case "create_supplier": {
            const csArgs = args as CreateSupplierArgs;
            toolResult = await callFortnoxWrite(
              "findOrCreateSupplier",
              {
                supplier: {
                  Name: csArgs.name,
                  OrganisationNumber: csArgs.org_number || undefined,
                  Email: csArgs.email || undefined,
                },
              },
              "create_supplier",
              csArgs.org_number || csArgs.name,
            );
            const supplier = toolResult.Supplier || toolResult;
            responseText = `Leverantör: ${
              supplier.Name || csArgs.name
            } (nr ${supplier.SupplierNumber || "tilldelas"})`;
            toolStructuredData = {
              toolArgs: csArgs as Record<string, unknown>,
              toolResult: toolResult as Record<string, unknown>,
            };
            // Audit log
            void auditService.log({
              userId,
              companyId: resolvedCompanyId || undefined,
              actorType: "ai",
              action: "create",
              resourceType: "supplier",
              resourceId: supplier.SupplierNumber || "",
              newState: supplier,
            });
            break;
          }
          case "create_supplier_invoice": {
            const siArgs = args as CreateSupplierInvoiceArgs;
            // Resolve casing — AI may send snake_case, camelCase, or PascalCase
            const si3SupplierRaw = (siArgs.supplier_number || siArgs.supplierNumber || siArgs.SupplierNumber) as string;
            // If AI sent a text name instead of numeric SupplierNumber, resolve it
            const si3SupplierNum = resolvedCompanyId
              ? (await resolveSupplierNumber(si3SupplierRaw, authHeader, resolvedCompanyId)) || si3SupplierRaw
              : si3SupplierRaw;
            const si3InvNum = (siArgs.invoice_number || siArgs.invoiceNumber || siArgs.InvoiceNumber) as string | undefined;
            const si3TotalAmt = (siArgs.total_amount ?? siArgs.totalAmount ?? siArgs.TotalAmount ?? siArgs.Total) as number;
            const si3VatRate = ((siArgs.vat_rate ?? siArgs.vatRate ?? siArgs.VatRate) as number) || 25;
            const si3VatAmt = (siArgs.vat_amount ?? siArgs.vatAmount ?? siArgs.VatAmount) as number | undefined;
            const si3IsRC = (siArgs.is_reverse_charge ?? siArgs.isReverseCharge ?? siArgs.IsReverseCharge) === true;
            const si3Acct = (siArgs.account ?? siArgs.Account) as number;
            const si3Desc = (siArgs.description || siArgs.Description) as string;
            const si3Due = (siArgs.due_date || siArgs.dueDate || siArgs.DueDate) as string | undefined;
            // Use currency from AI parameters — Fortnox handles conversion for foreign currencies
            const si3Curr = ((siArgs.currency || siArgs.Currency) as string) || "SEK";

            const vatMultiplier = 1 + (si3VatRate / 100);
            const netAmount = si3IsRC
              ? si3TotalAmt
              : Math.round((si3TotalAmt / vatMultiplier) * 100) / 100;
            const vatAmount = si3IsRC
              ? 0
              : (typeof si3VatAmt === "number"
                ? si3VatAmt
                : Math.round(
                  (si3TotalAmt - netAmount) * 100,
                ) / 100);
            const rcVat = si3IsRC
              ? Math.round(
                si3TotalAmt * (si3VatRate / 100) * 100,
              ) / 100
              : 0;

            // For reverse charge: Fortnox auto-creates VAT rows (2645/2614)
            const fortnoxRows = si3IsRC
              ? [
                { Account: si3Acct, Debit: netAmount, Credit: 0 },
                { Account: 2440, Debit: 0, Credit: netAmount },
              ]
              : [
                { Account: si3Acct, Debit: netAmount, Credit: 0 },
                { Account: 2640, Debit: vatAmount, Credit: 0 },
                { Account: 2440, Debit: 0, Credit: si3TotalAmt },
              ];

            const vatType = si3IsRC ? "EUINTERNAL" : "NORMAL";

            toolResult = await callFortnoxWrite(
              "exportSupplierInvoice",
              {
                invoice: {
                  SupplierNumber: si3SupplierNum,
                  InvoiceNumber: si3InvNum || undefined,
                  InvoiceDate: new Date().toISOString().slice(0, 10),
                  DueDate: si3Due ||
                    new Date(Date.now() + 30 * 86400000).toISOString().slice(
                      0,
                      10,
                    ),
                  Total: si3TotalAmt,
                  VAT: si3IsRC ? 0 : vatAmount,
                  VATType: vatType,
                  Currency: si3Curr,
                  AccountingMethod: "ACCRUAL",
                  SupplierInvoiceRows: fortnoxRows,
                },
              },
              "export_supplier_invoice",
              si3InvNum || String(si3SupplierNum),
            );

            // Chat display rows: show all rows including RC VAT for transparency
            const displayRows = si3IsRC
              ? [
                {
                  account: si3Acct,
                  accountName: si3Desc,
                  debit: netAmount,
                  credit: 0,
                  comment: "Kostnadsrad (omvänd skattskyldighet)",
                },
                {
                  account: 2645,
                  accountName: "Ingående moms omvänd",
                  debit: rcVat,
                  credit: 0,
                  comment: `Omvänd skattskyldighet ${si3VatRate}%`,
                },
                {
                  account: 2614,
                  accountName: "Utgående moms omvänd",
                  debit: 0,
                  credit: rcVat,
                  comment: `Omvänd skattskyldighet ${si3VatRate}%`,
                },
                {
                  account: 2440,
                  accountName: "Leverantörsskulder",
                  debit: 0,
                  credit: netAmount,
                  comment: "Total leverantörsskuld (exkl. moms)",
                },
              ]
              : [
                {
                  account: si3Acct,
                  accountName: si3Desc,
                  debit: netAmount,
                  credit: 0,
                  comment: "Kostnadsrad",
                },
                {
                  account: 2640,
                  accountName: "Ingående moms",
                  debit: vatAmount,
                  credit: 0,
                  comment: `Moms ${si3VatRate}%`,
                },
                {
                  account: 2440,
                  accountName: "Leverantörsskulder",
                  debit: 0,
                  credit: si3TotalAmt,
                  comment: "Total leverantörsskuld",
                },
              ];

            toolStructuredData = {
              toolArgs: siArgs as Record<string, unknown>,
              toolResult: toolResult as Record<string, unknown>,
              postingRows: displayRows,
            };
            const rcNote = si3IsRC ? " (omvänd skattskyldighet)" : "";
            responseText =
              `Leverantörsfaktura skapad i Fortnox!${rcNote}\n- Belopp: ${si3TotalAmt} kr${si3IsRC ? "" : ` (${netAmount} + ${vatAmount} moms)`}\n- Konto: ${si3Acct} (${si3Desc})\n- Förfallodatum: ${
                si3Due || "30 dagar"
              }`;
            void auditService.log({
              userId,
              companyId: resolvedCompanyId || undefined,
              actorType: "ai",
              action: "create",
              resourceType: "supplier_invoice",
              resourceId: si3InvNum ||
                `supplier-${si3SupplierNum}`,
              newState: toolResult as Record<string, unknown>,
            });
            break;
          }
          case "export_journal_to_fortnox": {
            const ejArgs = args as ExportJournalToFortnoxArgs;
            // Fetch the journal entry from DB
            const { data: journalEntry, error: jeError } = await supabaseAdmin
              .from("journal_entries")
              .select("*")
              .eq("verification_id", ejArgs.journal_entry_id)
              .maybeSingle();

            if (jeError || !journalEntry) {
              responseText =
                `Kunde inte hitta verifikat ${ejArgs.journal_entry_id} i databasen.`;
              break;
            }

            const entries = typeof journalEntry.entries === "string"
              ? JSON.parse(journalEntry.entries)
              : journalEntry.entries;

            const voucherRows = entries.map((e: any) => ({
              Account: e.account,
              Debit: e.debit || 0,
              Credit: e.credit || 0,
              Description: e.accountName || journalEntry.description,
            }));

            toolResult = await callFortnoxWrite(
              "exportVoucher",
              {
                voucher: {
                  Description:
                    `${journalEntry.description} (${ejArgs.journal_entry_id})`,
                  TransactionDate: new Date().toISOString().slice(0, 10),
                  VoucherSeries: "A",
                  VoucherRows: voucherRows,
                },
                vatReportId: `je:${ejArgs.journal_entry_id}`,
              },
              "export_voucher",
              ejArgs.journal_entry_id,
            );
            const voucher = toolResult.Voucher || toolResult;
            toolStructuredData = {
              toolArgs: ejArgs as Record<string, unknown>,
              toolResult: toolResult as Record<string, unknown>,
              postingRows: voucherRows.map((row: any) => ({
                account: row.Account,
                accountName: row.Description || "Verifikationsrad",
                debit: row.Debit || 0,
                credit: row.Credit || 0,
                comment: "Exporterad till Fortnox",
              })),
            };
            responseText =
              `Verifikat exporterat till Fortnox!\n- Fortnox-verifikat: ${
                voucher.VoucherSeries || "A"
              }-${
                voucher.VoucherNumber || "?"
              }\n- Ursprungligt ID: ${ejArgs.journal_entry_id}`;
            void auditService.log({
              userId,
              companyId: resolvedCompanyId || undefined,
              actorType: "ai",
              action: "export",
              resourceType: "voucher",
              resourceId: ejArgs.journal_entry_id,
              newState: voucher,
            });
            break;
          }
          case "book_supplier_invoice": {
            const bsiArgs = args as BookSupplierInvoiceArgs;
            // Resolve casing — AI may send snake_case, camelCase, or PascalCase
            const bsi3InvNum = (bsiArgs.invoice_number || bsiArgs.invoiceNumber || bsiArgs.InvoiceNumber || bsiArgs.given_number || bsiArgs.givenNumber || bsiArgs.GivenNumber) as string;
            // Booking is non-critical — attempt but gracefully degrade if "enkel attest" is disabled
            try {
              try {
                toolResult = await callFortnoxWrite(
                  "approveSupplierInvoiceBookkeep",
                  { givenNumber: Number(bsi3InvNum) },
                  "approve_supplier_invoice",
                  bsi3InvNum,
                );
              } catch {
                toolResult = await callFortnoxWrite(
                  "bookSupplierInvoice",
                  { givenNumber: Number(bsi3InvNum) },
                  "bookkeep_supplier_invoice",
                  bsi3InvNum,
                );
              }
              toolStructuredData = {
                toolArgs: bsiArgs as Record<string, unknown>,
                toolResult: toolResult as Record<string, unknown>,
              };
              responseText =
                `Leverantörsfaktura ${bsi3InvNum} är nu bokförd i Fortnox.`;
              void auditService.log({
                userId,
                companyId: resolvedCompanyId || undefined,
                actorType: "ai",
                action: "update",
                resourceType: "supplier_invoice",
                resourceId: bsi3InvNum,
              });
            } catch (bookingErr: unknown) {
              logger.warn("book_supplier_invoice failed in non-streaming (non-critical)", {
                invoiceNumber: bsi3InvNum,
                error: bookingErr instanceof Error ? bookingErr.message : "Unknown",
              });
              const fallbackMsg = `⚠️ Leverantörsfaktura ${bsi3InvNum} kunde inte bokföras automatiskt. Bokför manuellt i Fortnox under Leverantörsfakturor → Attestera/Bokför.`;
              toolStructuredData = {
                toolArgs: bsiArgs as Record<string, unknown>,
                toolResult: { error: "booking_skipped", message: fallbackMsg },
              };
              responseText = fallbackMsg;
              void auditService.log({
                userId,
                companyId: resolvedCompanyId || undefined,
                actorType: "ai",
                action: "update_skipped",
                resourceType: "supplier_invoice",
                resourceId: bsi3InvNum,
              });
            }
            break;
          }
          case "propose_action_plan": {
            // Non-streaming path: save plan to metadata, return summary
            const planArgs = args as {
              summary?: string;
              actions?: Array<Record<string, unknown>>;
              assumptions?: string[];
            };
            const planId = crypto.randomUUID();
            const actionPlan = {
              type: "action_plan",
              plan_id: planId,
              status: "pending",
              summary: planArgs.summary || "Handlingsplan",
              actions: (planArgs.actions || []).map((a: any, i: number) => ({
                id: `${planId}-${i}`,
                action_type: a.action_type,
                description: a.description,
                parameters: a.parameters || {},
                posting_rows: a.posting_rows || [],
                confidence: a.confidence ?? 0.8,
                status: "pending",
              })),
              assumptions: planArgs.assumptions || [],
              source_file: findSourceFile(Array.isArray(history) ? history : []),
            };
            nonStreamMetadata = actionPlan;
            const actionsDesc = actionPlan.actions
              .map((a: any, i: number) => `${i + 1}. ${a.description}`)
              .join("\n");
            responseText =
              `Jag har förberett en handlingsplan: "${actionPlan.summary}"\n\n${actionsDesc}\n\nGodkänn, ändra eller avbryt planen.`;
            logger.info("Action plan proposed (non-stream)", {
              planId,
              actionCount: actionPlan.actions.length,
            });
            break;
          }
          case "register_payment": {
            const payArgs = args as Record<string, unknown>;
            // Resolve casing — AI may send snake_case, camelCase, or PascalCase
            const paymentDate = (payArgs.payment_date || payArgs.paymentDate || payArgs.PaymentDate) as string ||
              new Date().toISOString().slice(0, 10);
            const invoiceNum = String(payArgs.invoice_number || payArgs.invoiceNumber || payArgs.InvoiceNumber || "");
            const payAmount = (payArgs.amount ?? payArgs.Amount) as number || 0;
            const payArgType = (payArgs.payment_type || payArgs.paymentType || payArgs.PaymentType) as string;

            if (payArgType === "supplier") {
              // Supplier payment is non-critical — approve+pay, but gracefully degrade
              try {
                try {
                  await callFortnoxWrite(
                    "approveSupplierInvoiceBookkeep",
                    { givenNumber: Number(invoiceNum) },
                    "approve_supplier_invoice",
                    invoiceNum,
                  );
                  logger.info("Auto-approved supplier invoice before payment", { invoiceNum });
                } catch (bookErr: unknown) {
                  logger.info("Supplier invoice already booked or approval failed (continuing)", {
                    invoiceNum,
                    error: bookErr instanceof Error ? bookErr.message : "Unknown",
                  });
                }
                toolResult = await callFortnoxWrite(
                  "registerSupplierInvoicePayment",
                  {
                    payment: {
                      InvoiceNumber: invoiceNum,
                      Amount: payAmount,
                      PaymentDate: paymentDate,
                    },
                  },
                  "register_supplier_invoice_payment",
                  invoiceNum,
                );
                void auditService.log({
                  userId,
                  companyId: resolvedCompanyId || undefined,
                  actorType: "ai",
                  action: "create",
                  resourceType: "supplier_invoice_payment",
                  resourceId: invoiceNum,
                  newState: toolResult,
                });
                responseText =
                  `Betalning på ${payAmount} kr registrerad för leverantörsfaktura ${invoiceNum} (${paymentDate}).`;
              } catch (payErr: unknown) {
                logger.warn("register_payment for supplier invoice failed (non-critical)", {
                  invoiceNumber: invoiceNum,
                  error: payErr instanceof Error ? payErr.message : "Unknown",
                });
                responseText =
                  `⚠️ Leverantörsfaktura ${invoiceNum} skapad men betalning kunde inte registreras — fakturan behöver attesteras och bokföras först i Fortnox.`;
                void auditService.log({
                  userId,
                  companyId: resolvedCompanyId || undefined,
                  actorType: "ai",
                  action: "update_skipped",
                  resourceType: "supplier_invoice",
                  resourceId: invoiceNum,
                });
              }
            } else {
              // Customer payment — graceful degradation like supplier path
              try {
                toolResult = await callFortnoxWrite(
                  "registerInvoicePayment",
                  {
                    payment: {
                      InvoiceNumber: Number(invoiceNum),
                      Amount: payAmount,
                      PaymentDate: paymentDate,
                    },
                  },
                  "register_invoice_payment",
                  invoiceNum,
                );
                void auditService.log({
                  userId,
                  companyId: resolvedCompanyId || undefined,
                  actorType: "ai",
                  action: "create",
                  resourceType: "invoice_payment",
                  resourceId: invoiceNum,
                  newState: toolResult,
                });
                responseText =
                  `Betalning på ${payAmount} kr registrerad för kundfaktura ${invoiceNum} (${paymentDate}).`;
              } catch (payErr: unknown) {
                logger.warn("register_payment for customer invoice failed", {
                  invoiceNumber: invoiceNum,
                  error: payErr instanceof Error ? payErr.message : "Unknown",
                });
                responseText =
                  `⚠️ Betalning kunde inte registreras för faktura ${invoiceNum}. Kontrollera att fakturan är bokförd i Fortnox.`;
              }
            }
            toolStructuredData = {
              toolArgs: payArgs as Record<string, unknown>,
              toolResult: (toolResult || {}) as Record<string, unknown>,
            };
            break;
          }
          case "learn_accounting_pattern": {
            const patternArgs = args as LearnAccountingPatternArgs;
            try {
              const patternService = new ExpensePatternService(supabaseAdmin);
              const patternId = await patternService.confirmPattern(
                userId,
                resolvedCompanyId,
                patternArgs.supplier_name,
                patternArgs.bas_account,
                patternArgs.bas_account_name,
                patternArgs.vat_rate,
                patternArgs.expense_type || "cost",
                patternArgs.amount || 0,
                null,
                patternArgs.description_keywords || [],
                false,
              );
              if (patternId) {
                logger.info("Learned accounting pattern (non-stream)", {
                  patternId,
                  supplier: patternArgs.supplier_name,
                  account: patternArgs.bas_account,
                });
                responseText =
                  `Jag har lärt mig att ${patternArgs.supplier_name} ska bokföras på konto ${patternArgs.bas_account} (${patternArgs.bas_account_name}), ${patternArgs.vat_rate}% moms. Nästa gång föreslår jag detta automatiskt.`;
              } else {
                responseText =
                  `Jag kunde tyvärr inte spara regeln just nu. Försök igen.`;
              }
            } catch (learnError) {
              logger.warn("Failed to learn pattern (non-stream)", {
                error: String(learnError),
              });
              responseText =
                `Det gick inte att spara konteringsregeln. Försök igen senare.`;
            }
            break;
          }
          case "create_journal_entry": {
            const journalArgs = args as CreateJournalEntryArgs;
            const {
              type: txType,
              gross_amount,
              vat_rate,
              description: txDescription,
              is_roaming,
            } = journalArgs;

            // Calculate net and VAT amounts with öre precision
            const vatMultiplier = 1 + (vat_rate / 100);
            const netAmount = roundToOre(gross_amount / vatMultiplier);
            const vatAmount = roundToOre(gross_amount - netAmount);

            // Generate journal entries using existing services
            const entries = txType === "revenue"
              ? createSalesJournalEntries(
                netAmount,
                vatAmount,
                vat_rate,
                is_roaming ?? false,
              )
              : createCostJournalEntries(
                netAmount,
                vatAmount,
                vat_rate,
                txDescription,
              );

            // Validate balance
            const validation = validateJournalBalance(entries);

            // Generate verification ID
            const period = new Date().toISOString().slice(0, 7); // YYYY-MM
            let verificationId: string;
            try {
              const { data, error: rpcError } = await supabaseAdmin.rpc(
                "get_next_verification_id",
                {
                  p_period: period,
                  p_company_id: resolvedCompanyId || "default",
                },
              );
              if (rpcError || !data) {
                // Fallback if RPC not yet deployed
                verificationId = generateVerificationId(
                  period,
                  Date.now() % 1000,
                );
              } else {
                verificationId = data;
              }
            } catch {
              verificationId = generateVerificationId(
                period,
                Date.now() % 1000,
              );
            }

            // Save to journal_entries table
            try {
              await supabaseAdmin.from("journal_entries").insert({
                user_id: userId,
                company_id: resolvedCompanyId || null,
                conversation_id: conversationId || null,
                verification_id: verificationId,
                period,
                transaction_type: txType,
                gross_amount,
                net_amount: netAmount,
                vat_amount: vatAmount,
                vat_rate,
                description: txDescription,
                entries: JSON.stringify(entries),
                is_balanced: validation.balanced,
              });
            } catch (dbErr) {
              logger.warn("Could not save journal entry to database", {
                error: dbErr instanceof Error ? dbErr.message : String(dbErr),
              });
            }

            // Build metadata for chat display
            const journalMetadata = {
              type: "journal_entry",
              verification_id: verificationId,
              entries,
              validation,
              transaction: {
                type: txType,
                gross_amount,
                vat_rate,
                description: txDescription,
              },
            };

            // Format response text
            const typeLabel = txType === "revenue" ? "Intäkt" : "Kostnad";
            const entryLines = entries.map((e: any) =>
              `| ${e.account} | ${e.accountName} | ${
                e.debit > 0 ? roundToOre(e.debit).toFixed(2) : "—"
              } | ${e.credit > 0 ? roundToOre(e.credit).toFixed(2) : "—"} |`
            ).join("\n");

            const defaultJournalResponseText =
              `Verifikat **${verificationId}** skapat!\n\n` +
              `**${typeLabel} ${
                gross_amount.toFixed(2)
              } kr inkl moms (${vat_rate}%)**\n\n` +
              `| Konto | Kontonamn | Debet | Kredit |\n` +
              `|-------|-----------|-------|--------|\n` +
              `${entryLines}\n` +
              `| | **Summa** | **${validation.totalDebit.toFixed(2)}** | **${
                validation.totalCredit.toFixed(2)
              }** |\n\n` +
              (validation.balanced
                ? "Bokföringen är balanserad."
                : "Varning: Bokföringen är INTE balanserad!");

            responseText = shouldFormatCurrentToolResponse
              ? formatToolResponse({
                toolName: "create_journal_entry",
                rawText: defaultJournalResponseText,
                structuredData: {
                  toolArgs: journalArgs as unknown as Record<string, unknown>,
                  verificationId,
                  verification_id: verificationId,
                  entries: entries as unknown[],
                  postingRows: entries.map((entry: any) => ({
                    account: entry.account,
                    accountName: entry.accountName,
                    debit: entry.debit || 0,
                    credit: entry.credit || 0,
                    comment: entry.accountName || "Verifikationsrad",
                  })),
                  assumptions: validation.balanced ? [] : [
                    "Debet och kredit är inte i balans och behöver korrigeras innan export.",
                  ],
                  confirmationQuestion:
                    "Ska jag justera verifikatet innan vi går vidare?",
                },
              })
              : defaultJournalResponseText;

            // Save message with metadata for UI rendering
            if (conversationId && conversationService) {
              try {
                await conversationService.addMessage(
                  conversationId,
                  "assistant",
                  responseText,
                  null,
                  null,
                  journalMetadata,
                );
              } catch (msgErr) {
                logger.warn("Could not save journal message", {
                  error: msgErr instanceof Error
                    ? msgErr.message
                    : String(msgErr),
                });
              }
            }

            // Return as journal_entry type for rich UI rendering
            return new Response(
              JSON.stringify({
                type: "text",
                data: responseText,
                metadata: journalMetadata,
                usedMemories: usedMemories.length > 0
                  ? usedMemories
                  : undefined,
              }),
              {
                headers: {
                  ...responseHeaders,
                  "Content-Type": "application/json",
                },
              },
            );
          }
        }
      } catch (err) {
        logger.error("Tool execution failed", err);
        toolExecutionFailed = true;
        const errMsg = err instanceof Error ? err.message : "okänt fel";
        if (tool === "conversation_search" || tool === "recent_chats") {
          responseText =
            "Jag kunde inte söka i tidigare konversationer just nu.";
        } else if (tool === "web_search") {
          responseText =
            "Jag kunde inte hämta uppdaterad information från webben just nu.";
        } else if (tool === "create_journal_entry") {
          responseText =
            "Ett fel uppstod när verifikatet skulle skapas. Försök igen.";
        } else {
          // Fallback: ask Gemini to answer from its knowledge when Fortnox tools fail
          try {
            const fallbackPrompt = `Verktyget "${tool}" misslyckades med felet: "${errMsg}". Svara ändå på användarens fråga med din befintliga kunskap om möjligt. Om frågan kräver specifik Fortnox-data som du inte har, förklara kort att Fortnox-kopplingen inte svarar just nu och ge generella råd istället. Användarens fråga: "${message}"`;
            const fallbackResponse = await sendMessageToGemini(
              fallbackPrompt,
              undefined,
              history,
              undefined,
              effectiveModel,
              { disableTools: true },
            );
            responseText = fallbackResponse.text ||
              `Jag kunde inte hämta data från Fortnox just nu (${errMsg}), men jag kan hjälpa dig med generella bokföringsfrågor.`;
          } catch {
            responseText =
              `Jag kunde inte nå Fortnox just nu (${errMsg}). Försök igen om en stund.`;
          }
        }
      }

      if (
        responseText && !toolExecutionFailed &&
        shouldFormatCurrentToolResponse && tool !== "create_journal_entry"
      ) {
        responseText = formatToolResponse({
          toolName: tool,
          rawText: responseText,
          structuredData: toolStructuredData ?? {
            toolArgs: args as unknown as Record<string, unknown>,
          },
        });
      }

      return new Response(
        JSON.stringify({
          type: "text",
          data: responseText,
          usedMemories: usedMemories.length > 0 ? usedMemories : undefined,
        }),
        {
          headers: { ...responseHeaders, "Content-Type": "application/json" },
        },
      );
    }

    let responseText = geminiResponse.text || "";
    let skillDraft: SkillDraft | null = null;
    if (isSkillAssist && responseText) {
      const parsed = extractSkillDraft(responseText);
      responseText = parsed.cleanText;
      skillDraft = parsed.draft;
    }

    // Save AI response (Non-streaming fallback)
    if (conversationId && userId !== "anonymous" && responseText) {
      try {
        if (!conversationService) {
          const supabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
            global: { headers: { Authorization: authHeader } },
          });
          conversationService = new ConversationService(supabaseClient);
        }
        const messageMetadata = {
          ...(usedMemories.length > 0 ? { usedMemories } : {}),
          ...(skillDraft ? { skillDraft } : {}),
          ...(nonStreamMetadata ? nonStreamMetadata : {}),
        };
        await conversationService.addMessage(
          conversationId,
          "assistant",
          responseText,
          null,
          null,
          Object.keys(messageMetadata).length > 0 ? messageMetadata : null,
        );
        const resolvedTitle = await generateSmartTitleIfNeeded(
          conversationService,
          supabaseAdmin,
          conversationId,
          message,
          responseText,
          verifiedConversation?.title ?? null,
        );
        if (resolvedTitle && verifiedConversation) {
          verifiedConversation.title = resolvedTitle;
        }
        void triggerMemoryGenerator(
          supabaseUrl,
          supabaseServiceKey,
          conversationId,
        );

        // Log AI decision for BFL compliance (audit trail)
        void auditService.logAIDecision({
          userId,
          companyId: resolvedCompanyId || undefined,
          aiProvider: provider === "openai" ? "openai" : "gemini",
          aiModel: provider === "openai" ? "gpt-4o" : "gemini-3-flash-preview",
          aiFunction: "chat_response",
          inputData: {
            message_preview: message.substring(0, 200),
            has_file: !!fileData,
            has_history: (history?.length || 0) > 0,
            conversation_id: conversationId,
          },
          outputData: {
            response_length: responseText.length,
            has_tool_call: !!geminiResponse.toolCall,
          },
          confidence: 0.9, // Chat responses have high confidence
        });
      } catch (saveError) {
        logger.error("Failed to save non-streamed AI response", saveError);
      }
    }

    // Log AI usage for non-streaming path (fire-and-forget)
    usageTracker.logEvent({
      userId,
      companyId: resolvedCompanyId,
      eventType: "ai_message",
    });

    return new Response(
      JSON.stringify({
        type: "text",
        data: responseText,
        usedMemories: usedMemories.length > 0 ? usedMemories : undefined,
        skillDraft: skillDraft ?? undefined,
        usageWarning: usageWarningPayload ?? undefined,
        actionPlan: nonStreamMetadata?.type === "action_plan"
          ? nonStreamMetadata
          : undefined,
      }),
      {
        headers: { ...responseHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    logger.error("Edge Function Error", error);

    // Handle Google API rate limit errors with 429 response
    if (error instanceof GeminiRateLimitError) {
      const retryAfter = error.retryAfter || 30;
      return new Response(
        JSON.stringify({
          error: "google_rate_limit",
          message:
            "Google API är tillfälligt överbelastad. Försök igen om en stund.",
          retryAfter,
        }),
        {
          status: 429,
          headers: {
            ...responseHeaders,
            "Content-Type": "application/json",
            "Retry-After": String(retryAfter),
          },
        },
      );
    }

    return new Response(JSON.stringify({ error: "internal_server_error" }), {
      status: 500,
      headers: { ...responseHeaders, "Content-Type": "application/json" },
    });
  }
});

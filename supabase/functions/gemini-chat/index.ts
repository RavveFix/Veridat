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
  type GetVouchersArgs,
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
type EdgeSupabaseClient = SupabaseClient<any, any, any, any, any>;

const ACCOUNTING_TOOL_RESPONSE_NAMES = new Set([
  "get_customers",
  "get_articles",
  "get_suppliers",
  "get_vouchers",
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
  const mentionsTalk = /(pratade|diskuterade|nämnde|sade|sa)/.test(normalized);
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

function detectAgentNeeds(message: string): { needsCustomers: boolean; needsSuppliers: boolean; needsArticles: boolean } {
  const m = message.toLowerCase();
  return {
    needsCustomers: /kund|faktura|invoice/.test(m) && !/leverantör/.test(m),
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
      conversationId,
      error,
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
      case "get_vouchers": {
        const vArgs = toolArgs as GetVouchersArgs;
        const result = await fortnoxService.getVouchers(
          vArgs.financial_year,
          vArgs.series,
        );
        const vouchers = (result as any).Vouchers || [];
        return vouchers.length > 0
          ? `Hittade ${vouchers.length} verifikationer:\n${
            vouchers.slice(0, 10).map((v: any) =>
              `- ${v.VoucherSeries}${v.VoucherNumber}: ${
                v.Description || "—"
              } (${v.TransactionDate})`
            ).join("\n")
          }`
          : "Inga verifikationer hittades.";
      }
      case "get_invoice": {
        const invNum = Number(toolArgs.invoice_number);
        const resp = await fortnoxService.getInvoice(invNum);
        const inv = (resp as any).Invoice || resp;
        return `Faktura ${inv.InvoiceNumber}:\n` +
          `- Kund: ${inv.CustomerName || "—"} (${inv.CustomerNumber})\n` +
          `- Datum: ${inv.InvoiceDate}\n` +
          `- Förfallodatum: ${inv.DueDate}\n` +
          `- Belopp: ${inv.Total} kr (varav moms ${inv.TotalVAT} kr)\n` +
          `- Netto: ${inv.Net} kr\n` +
          `- Bokförd: ${inv.Booked ? "Ja" : "Nej"}\n` +
          `- Status: ${inv.Cancelled ? "Makulerad" : inv.Booked ? "Bokförd" : "Utkast"}`;
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
          "createSupplier",
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
        return `Leverantör skapad!\n- Namn: ${
          supplier.Name || csArgs.name
        }\n- Nr: ${supplier.SupplierNumber || "tilldelas"}`;
      }
      case "create_supplier_invoice": {
        const siArgs = toolArgs as CreateSupplierInvoiceArgs;
        const isRC = siArgs.is_reverse_charge === true;

        // For reverse charge: total_amount IS the net (no VAT charged by supplier)
        // For normal: calculate net from gross using VAT rate
        const vatMul = 1 + (siArgs.vat_rate / 100);
        const net = isRC
          ? siArgs.total_amount
          : Math.round((siArgs.total_amount / vatMul) * 100) / 100;
        const vat = isRC
          ? 0
          : (typeof siArgs.vat_amount === "number"
            ? siArgs.vat_amount
            : Math.round((siArgs.total_amount - net) * 100) / 100);

        // For reverse charge: Fortnox auto-creates VAT rows (2645/2614)
        // when VATType is EUINTERNAL — send only cost + payables rows
        const fortnoxRows = isRC
          ? [
            { Account: siArgs.account, Debit: net, Credit: 0 },
            { Account: 2440, Debit: 0, Credit: net },
          ]
          : [
            { Account: siArgs.account, Debit: net, Credit: 0 },
            { Account: 2640, Debit: vat, Credit: 0 },
            { Account: 2440, Debit: 0, Credit: siArgs.total_amount },
          ];

        const vatType = isRC ? "EUINTERNAL" : "NORMAL";

        const result = await callFortnoxWrite(
          "exportSupplierInvoice",
          {
            invoice: {
              SupplierNumber: siArgs.supplier_number,
              InvoiceNumber: siArgs.invoice_number || undefined,
              InvoiceDate: new Date().toISOString().slice(0, 10),
              DueDate: siArgs.due_date ||
                new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
              Total: siArgs.total_amount,
              VAT: isRC ? 0 : vat,
              VATType: vatType,
              Currency: siArgs.currency || "SEK",
              AccountingMethod: "ACCRUAL",
              SupplierInvoiceRows: fortnoxRows,
            },
          },
          "export_supplier_invoice",
          siArgs.invoice_number || String(siArgs.supplier_number),
        );
        void auditService.log({
          userId,
          companyId: companyId || undefined,
          actorType: "ai",
          action: "create",
          resourceType: "supplier_invoice",
          resourceId: siArgs.invoice_number ||
            `supplier-${siArgs.supplier_number}`,
          newState: result as unknown as Record<string, unknown>,
        });
        const rcNote = isRC ? " (omvänd skattskyldighet)" : "";
        return `Leverantörsfaktura skapad!${rcNote}\n- Belopp: ${siArgs.total_amount} kr${isRC ? "" : ` (${net} + ${vat} moms)`}\n- Konto: ${siArgs.account}\n- Förfallodatum: ${
          siArgs.due_date || "30 dagar"
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
        await callFortnoxWrite(
          "bookSupplierInvoice",
          { givenNumber: Number(bArgs.invoice_number) },
          "book_supplier_invoice",
          bArgs.invoice_number,
        );
        void auditService.log({
          userId,
          companyId: companyId || undefined,
          actorType: "ai",
          action: "update",
          resourceType: "supplier_invoice",
          resourceId: bArgs.invoice_number,
        });
        return `Leverantörsfaktura ${bArgs.invoice_number} är nu bokförd.`;
      }
      case "create_invoice": {
        const ciArgs = toolArgs as Record<string, unknown>;
        const result = await callFortnoxWrite(
          "createInvoice",
          {
            invoice: {
              CustomerNumber: ciArgs.CustomerNumber,
              InvoiceRows: ciArgs.InvoiceRows || [],
              InvoiceDate: ciArgs.InvoiceDate ||
                new Date().toISOString().slice(0, 10),
              DueDate: ciArgs.DueDate || undefined,
              Comments: ciArgs.Comments || undefined,
            },
          },
          "create_invoice",
          String(ciArgs.CustomerNumber),
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
      default:
        return null;
    }
  } catch (err) {
    logger.error(`Fortnox tool ${toolName} failed`, err);
    return `Ett fel uppstod vid ${toolName}: ${
      err instanceof Error ? err.message : "okänt fel"
    }`;
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
      const errorText = await response.text();
      logger.warn("Web search failed", { status: response.status, errorText });
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
    const isSkillAssist = assistantMode === "skill_assist";
    const isAgentMode = assistantMode === "agent";

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

    // Validate model access based on plan
    // Pro model requires Pro plan
    let effectiveModel = model || undefined;
    if (model?.includes("pro") && plan !== "pro") {
      logger.info(
        "User requested Pro model but has free plan, falling back to Flash",
        { userId, requestedModel: model },
      );
      effectiveModel = "gemini-3-flash-preview";
    }
    // Force Pro for agent mode — tool-calling reliability is critical
    if (isAgentMode) {
      effectiveModel = "gemini-3.1-pro-preview";
      logger.info("Agent mode: forcing Pro model for reliable tool calls");
    }

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
        resolvedCompanyId = String(conversation.company_id);
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

    let _userMessageSaved = false;
    let conversationService: ConversationService | null = null;

    if (conversationId) {
      try {
        const supabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
          global: { headers: { Authorization: authHeader } },
        });

        conversationService = new ConversationService(supabaseClient);

        // Save user message
        await conversationService.addMessage(
          conversationId,
          "user",
          message,
          fileUrl || null,
          fileName || null,
        );
        _userMessageSaved = true;
        logger.info("User message saved to database", { conversationId });
      } catch (saveError) {
        logger.error("Failed to save user message", saveError, {
          conversationId,
          userId,
        });
      }
    }

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
                          : `Fortnox write failed (${response.status})`) + detail,
                      );
                    }
                    return (result || {}) as Record<string, unknown>;
                  };

                  let resultText = "";
                  const params = action.parameters || {};

                  switch (action.action_type) {
                    case "create_supplier_invoice": {
                      const isRC = params.is_reverse_charge === true;
                      const vatMul = 1 +
                        ((params.vat_rate as number || 25) / 100);
                      const totalAmt = params.total_amount as number || 0;
                      const net = isRC
                        ? totalAmt
                        : Math.round((totalAmt / vatMul) * 100) / 100;
                      const vat = isRC
                        ? 0
                        : Math.round((totalAmt - net) * 100) / 100;

                      const result = await callFortnoxWrite(
                        "exportSupplierInvoice",
                        {
                          invoice: {
                            SupplierNumber: params.supplier_number,
                            InvoiceNumber: params.invoice_number || "",
                            InvoiceDate: params.invoice_date ||
                              new Date().toISOString().slice(0, 10),
                            DueDate: params.due_date || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
                            Total: totalAmt,
                            Currency: params.currency || "SEK",
                            VATType: isRC ? "EUINTERNAL" : undefined,
                            SupplierInvoiceRows: [
                              {
                                Account: params.account || 5010,
                                Debit: net,
                                Credit: 0,
                              },
                              ...(isRC ? [] : [
                                {
                                  Account: 2640,
                                  Debit: vat,
                                  Credit: 0,
                                },
                              ]),
                              {
                                Account: 2440,
                                Debit: 0,
                                Credit: totalAmt,
                              },
                            ],
                          },
                        },
                        "create_supplier_invoice",
                        String(params.supplier_number),
                      );
                      const givenNumber =
                        (result as any)?.SupplierInvoice?.GivenNumber || "";
                      resultText =
                        `Leverantörsfaktura skapad (nr ${givenNumber})`;
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
                      await callFortnoxWrite(
                        "bookSupplierInvoice",
                        {
                          givenNumber: Number(params.invoice_number),
                        },
                        "book_supplier_invoice",
                        String(params.invoice_number),
                      );
                      resultText =
                        `Leverantörsfaktura ${params.invoice_number} bokförd`;
                      void auditService.log({
                        userId,
                        companyId: resolvedCompanyId || undefined,
                        actorType: "ai",
                        action: "update",
                        resourceType: "supplier_invoice",
                        resourceId: String(params.invoice_number),
                      });
                      break;
                    }
                    case "create_supplier": {
                      const result = await callFortnoxWrite(
                        "createSupplier",
                        {
                          supplier: {
                            Name: params.name,
                            OrganisationNumber: params.org_number || undefined,
                            Email: params.email || undefined,
                          },
                        },
                        "create_supplier",
                        String(params.org_number || params.name),
                      );
                      const supplier = (result as any).Supplier || result;
                      resultText =
                        `Leverantör skapad: ${supplier.Name || params.name} (nr ${supplier.SupplierNumber || "tilldelas"})`;
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
                      const voucherDesc = action.description || params.voucher?.Description || "Verifikat från Veridat";
                      const result = await callFortnoxWrite(
                        "exportVoucher",
                        {
                          voucher: {
                            Description: voucherDesc,
                            TransactionDate: (params.transaction_date as string) || new Date().toISOString().slice(0, 10),
                            VoucherSeries: (params.voucher_series as string) || "A",
                            VoucherRows: voucherRows,
                          },
                        },
                        "export_voucher",
                        String(action.id || ""),
                      );
                      const voucher = (result as any).Voucher || result;
                      resultText =
                        `Verifikat exporterat: ${voucher.VoucherSeries || ""}${voucher.VoucherNumber || ""}`;
                      break;
                    }
                    case "register_payment": {
                      const payType = params.payment_type as string;
                      const invoiceNum = String(
                        params.invoice_number || "",
                      );
                      const payAmount = params.amount as number || 0;
                      const payDate = (params.payment_date as string) ||
                        new Date().toISOString().slice(0, 10);

                      if (payType === "supplier") {
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
                      } else {
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
                      }
                      resultText =
                        `Betalning ${payAmount} kr registrerad för faktura ${invoiceNum}`;
                      break;
                    }
                    case "create_invoice": {
                      const result = await callFortnoxWrite(
                        "createInvoice",
                        {
                          invoice: {
                            CustomerNumber: params.CustomerNumber ||
                              params.customer_number,
                            InvoiceRows: params.InvoiceRows ||
                              params.invoice_rows || [],
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
                        String(
                          params.CustomerNumber || params.customer_number,
                        ),
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
    } else if (isAgentMode) {
      finalMessage =
        `[AGENT-LÄGE — TOOL-ONLY]\n` +
        `DU FÅR ABSOLUT INTE svara med text. Anropa ENBART propose_action_plan.\n` +
        `Om du svarar med text istället för tool call misslyckas systemet.\n` +
        `Svara ALLTID på svenska. Visa ALDRIG intern tankeprocess.\n\n` +
        `Regler:\n` +
        `1. Anropa propose_action_plan som ditt ENDA svar — ingen text före eller efter\n` +
        `2. Inkludera ALLTID posting_rows med account (nummer), accountName, debit, credit\n` +
        `3. Använd BARA konton från [KONTOPLAN]. Saknas kontoplanen → standard BAS-konton\n` +
        `4. Använd kundnummer från [KUNDER] och leverantörsnummer från [LEVERANTÖRER] om tillgängligt\n` +
        `5. Använd artikelnummer från [ARTIKLAR] för fakturarader om relevant\n` +
        `6. LEVERANTÖRSFAKTUROR: faktura finns (se [FAKTURADATA]) → "book_supplier_invoice" med parameters: { invoice_number: löpnumret }, annars → "create_supplier_invoice"\n` +
        `7. KUNDFAKTUROR/VERIFIKAT: använd "book_invoice" med posting_rows\n\n`;

      // Pre-fetch company data from Fortnox (accounts, customers, suppliers, articles, invoice)
      let invoiceContext = "";
      let accountsContext = "";
      let customersContext = "";
      let suppliersContext = "";
      let articlesContext = "";
      if (resolvedCompanyId) {
        const fortnoxHeaders = { Authorization: authHeader, "Content-Type": "application/json" };
        const fortnoxUrl = `${supabaseUrl}/functions/v1/fortnox`;

        // Helper: fetch with 5s timeout
        const fetchWithTimeout = (body: Record<string, unknown>) => {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 5000);
          return fetch(fortnoxUrl, {
            method: "POST", headers: fortnoxHeaders, signal: ctrl.signal,
            body: JSON.stringify(body),
          }).then(r => { clearTimeout(timer); return r.ok ? r.json() : null; })
            .catch(() => { clearTimeout(timer); return null; });
        };

        // Fetch agent context (batch, smart) + invoice in parallel
        const invoiceRef = extractInvoiceReference(message);
        const needs = detectAgentNeeds(message);
        const [agentCtx, invoiceData] = await Promise.all([
          fetchWithTimeout({
            action: "getAgentContext",
            companyId: resolvedCompanyId,
            payload: {
              includeCustomers: needs.needsCustomers,
              includeSuppliers: needs.needsSuppliers,
              includeArticles: needs.needsArticles,
            },
          }),
          invoiceRef ? fetchWithTimeout({
            action: invoiceRef.type === "supplier" ? "getSupplierInvoice" : "getInvoice",
            companyId: resolvedCompanyId,
            payload: invoiceRef.type === "supplier"
              ? { givenNumber: invoiceRef.number }
              : { invoiceNumber: invoiceRef.number },
          }) : null,
        ]);

        // Build compact chart of accounts (comma-separated, only bookkeeping-relevant)
        if (agentCtx?.Accounts) {
          const active = (agentCtx.Accounts as Array<{ Number: number; Description: string; Active: boolean }>)
            .filter((a: any) => a.Active && a.Number >= 1000 && a.Number <= 8999)
            .map((a: any) => `${a.Number} ${a.Description}`);
          if (active.length > 0) {
            accountsContext = `[KONTOPLAN — ${active.length} konton]\n` + active.join(", ") + "\n\n";
          }
        }

        // Build compact customer list
        if (agentCtx?.Customers) {
          const list = (agentCtx.Customers as Array<{ CustomerNumber: string; Name: string; Active?: boolean }>)
            .filter((c: any) => c.Active !== false)
            .map((c: any) => `${c.CustomerNumber} ${c.Name}`);
          if (list.length > 0) {
            customersContext = `[KUNDER — ${list.length} st]\n` + list.join(", ") + "\n\n";
          }
        }

        // Build compact supplier list
        if (agentCtx?.Suppliers) {
          const list = (agentCtx.Suppliers as Array<{ SupplierNumber: string; Name: string; Active?: boolean }>)
            .filter((s: any) => s.Active !== false)
            .map((s: any) => `${s.SupplierNumber} ${s.Name}`);
          if (list.length > 0) {
            suppliersContext = `[LEVERANTÖRER — ${list.length} st]\n` + list.join(", ") + "\n\n";
          }
        }

        // Build compact article list
        if (agentCtx?.Articles) {
          const list = (agentCtx.Articles as Array<{ ArticleNumber: string; Description: string; SalesPrice?: number }>)
            .map((a: any) => `${a.ArticleNumber} ${a.Description}${a.SalesPrice ? ` (${a.SalesPrice} kr)` : ""}`);
          if (list.length > 0) {
            articlesContext = `[ARTIKLAR — ${list.length} st]\n` + list.join(", ") + "\n\n";
          }
        }

        // Build invoice context
        if (invoiceData) {
          const inv = invoiceData.SupplierInvoice || invoiceData.Invoice;
          if (inv) {
            invoiceContext =
              `[FAKTURADATA FRÅN FORTNOX]\n` +
              `Typ: ${invoiceRef!.type === "supplier" ? "Leverantörsfaktura" : "Kundfaktura"}\n` +
              `Nummer: ${inv.GivenNumber || inv.DocumentNumber}\n` +
              `${invoiceRef!.type === "supplier" ? "Leverantör" : "Kund"}: ${inv.SupplierName || inv.CustomerName} (nr ${inv.SupplierNumber || inv.CustomerNumber})\n` +
              `Fakturanummer: ${inv.InvoiceNumber || ""}\n` +
              `Total: ${inv.Total} kr\n` +
              `Moms: ${inv.VAT || inv.TotalVAT || 0} kr\n` +
              `Datum: ${inv.InvoiceDate}\n` +
              `Förfallodatum: ${inv.DueDate}\n` +
              `Status: ${inv.Booked ? "Bokförd" : "Ej bokförd"}\n` +
              `Använd dessa EXAKTA belopp i ditt förslag.\n\n`;
          }
        }
      }

      finalMessage += accountsContext + customersContext + suppliersContext + articlesContext + invoiceContext + `Användarens meddelande:\n${message}`;
    }

    if (!isSkillAssist && !isAgentMode && !vatReportContext && conversationId) {
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
      !isSkillAssist && !isAgentMode;
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

    // Provider switch (default: Gemini)
    const isSupportedFile = fileData?.mimeType?.startsWith("image/") ||
      fileData?.mimeType === "application/pdf";
    const primaryFile = isSupportedFile ? fileData : undefined;
    const imagePages = (fileDataPages || []).filter((p) =>
      p?.mimeType?.startsWith("image/") && !!p.data
    );
    const geminiFileData = primaryFile ||
      (imagePages.length > 0 ? (imagePages[0] as FileData) : undefined);
    const disableTools = isSkillAssist || (!isAgentMode && (shouldSkipHistorySearch(message) ||
      hasFileAttachment));

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
          { disableTools, forceToolCall: isAgentMode ? "propose_action_plan" : undefined },
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

        const responseStream = new ReadableStream({
          async start(controller) {
            try {
              for await (const chunk of stream) {
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

              if (toolCallDetected) {
                // Execute the tool and stream the result
                let toolResponseText = "";
                const toolName = toolCallDetected.name;
                const toolArgs = toolCallDetected.args || {};

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
                  } else if (toolName === "register_payment") {
                    // Handle payment registration via Fortnox
                    const payArgs = toolArgs as {
                      payment_type?: string;
                      invoice_number?: string;
                      amount?: number;
                      payment_date?: string;
                    };
                    const paymentDate = payArgs.payment_date ||
                      new Date().toISOString().slice(0, 10);
                    const invoiceNum = payArgs.invoice_number || "";
                    const payAmount = payArgs.amount || 0;

                    if (payArgs.payment_type === "supplier") {
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
                    } else {
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
                  logger.error("Tool execution error in stream", toolErr);
                  toolResponseText =
                    "Ett fel uppstod när jag försökte använda ett verktyg. Försök igen.";
                  const sseData = `data: ${
                    JSON.stringify({ text: toolResponseText })
                  }\n\n`;
                  controller.enqueue(encoder.encode(sseData));
                  fullText = toolResponseText;
                }
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
                    aiModel: effectiveModel || "gemini-3-flash-preview",
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
        undefined,
        { disableTools },
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
                undefined,
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
                undefined,
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
                undefined,
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
                undefined,
                { disableTools: true },
              );
              responseText = followUp.text ||
                "Jag kunde inte sammanställa ett svar från webbkällorna.";
            }
            break;
          }
          case "create_invoice": {
            toolResult = await callFortnoxWrite(
              "createInvoice",
              {
                invoice: {
                  CustomerNumber: args.CustomerNumber,
                  InvoiceRows: args.InvoiceRows || [],
                  InvoiceDate: (args as any).InvoiceDate ||
                    new Date().toISOString().slice(0, 10),
                  DueDate: (args as any).DueDate || undefined,
                  Comments: (args as any).Comments || undefined,
                },
              },
              "create_invoice",
              String(args.CustomerNumber),
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
          case "get_vouchers": {
            const vArgs = args as GetVouchersArgs;
            toolResult = await fortnoxService.getVouchers(
              vArgs.financial_year,
              vArgs.series,
            );
            const vouchers = toolResult.Vouchers || [];
            responseText = vouchers.length > 0
              ? `Hittade ${vouchers.length} verifikationer:\n${
                vouchers.slice(0, 10).map((v: any) =>
                  `- ${v.VoucherSeries}${v.VoucherNumber}: ${
                    v.Description || "Ingen beskrivning"
                  } (${v.TransactionDate})`
                ).join("\n")
              }${
                vouchers.length > 10
                  ? `\n...och ${vouchers.length - 10} till`
                  : ""
              }`
              : "Inga verifikationer hittades.";
            toolStructuredData = {
              toolArgs: vArgs as Record<string, unknown>,
              toolResult: toolResult as Record<string, unknown>,
            };
            break;
          }
          case "get_invoice": {
            const invNum = Number(args.invoice_number);
            toolResult = await fortnoxService.getInvoice(invNum);
            const inv = (toolResult as any).Invoice || toolResult;
            responseText = `Faktura ${inv.InvoiceNumber}:\n` +
              `- Kund: ${inv.CustomerName || "—"} (${inv.CustomerNumber})\n` +
              `- Datum: ${inv.InvoiceDate}\n` +
              `- Förfallodatum: ${inv.DueDate}\n` +
              `- Belopp: ${inv.Total} kr (varav moms ${inv.TotalVAT} kr)\n` +
              `- Netto: ${inv.Net} kr\n` +
              `- Bokförd: ${inv.Booked ? "Ja" : "Nej"}\n` +
              `- Status: ${inv.Cancelled ? "Makulerad" : inv.Booked ? "Bokförd" : "Utkast"}`;
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
              "createSupplier",
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
            responseText = `Leverantör skapad i Fortnox!\n- Namn: ${
              supplier.Name || csArgs.name
            }\n- Leverantörsnr: ${supplier.SupplierNumber || "tilldelas"}`;
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
            const isRC = siArgs.is_reverse_charge === true;

            const vatMultiplier = 1 + (siArgs.vat_rate / 100);
            const netAmount = isRC
              ? siArgs.total_amount
              : Math.round((siArgs.total_amount / vatMultiplier) * 100) / 100;
            const vatAmount = isRC
              ? 0
              : (typeof siArgs.vat_amount === "number"
                ? siArgs.vat_amount
                : Math.round(
                  (siArgs.total_amount - netAmount) * 100,
                ) / 100);
            const rcVat = isRC
              ? Math.round(
                siArgs.total_amount * (siArgs.vat_rate / 100) * 100,
              ) / 100
              : 0;

            // For reverse charge: Fortnox auto-creates VAT rows (2645/2614)
            const fortnoxRows = isRC
              ? [
                { Account: siArgs.account, Debit: netAmount, Credit: 0 },
                { Account: 2440, Debit: 0, Credit: netAmount },
              ]
              : [
                { Account: siArgs.account, Debit: netAmount, Credit: 0 },
                { Account: 2640, Debit: vatAmount, Credit: 0 },
                { Account: 2440, Debit: 0, Credit: siArgs.total_amount },
              ];

            const vatType = isRC ? "EUINTERNAL" : "NORMAL";

            toolResult = await callFortnoxWrite(
              "exportSupplierInvoice",
              {
                invoice: {
                  SupplierNumber: siArgs.supplier_number,
                  InvoiceNumber: siArgs.invoice_number || undefined,
                  InvoiceDate: new Date().toISOString().slice(0, 10),
                  DueDate: siArgs.due_date ||
                    new Date(Date.now() + 30 * 86400000).toISOString().slice(
                      0,
                      10,
                    ),
                  Total: siArgs.total_amount,
                  VAT: isRC ? 0 : vatAmount,
                  VATType: vatType,
                  Currency: siArgs.currency || "SEK",
                  AccountingMethod: "ACCRUAL",
                  SupplierInvoiceRows: fortnoxRows,
                },
              },
              "export_supplier_invoice",
              siArgs.invoice_number || String(siArgs.supplier_number),
            );

            // Chat display rows: show all rows including RC VAT for transparency
            const displayRows = isRC
              ? [
                {
                  account: siArgs.account,
                  accountName: siArgs.description,
                  debit: netAmount,
                  credit: 0,
                  comment: "Kostnadsrad (omvänd skattskyldighet)",
                },
                {
                  account: 2645,
                  accountName: "Ingående moms omvänd",
                  debit: rcVat,
                  credit: 0,
                  comment: `Omvänd skattskyldighet ${siArgs.vat_rate}%`,
                },
                {
                  account: 2614,
                  accountName: "Utgående moms omvänd",
                  debit: 0,
                  credit: rcVat,
                  comment: `Omvänd skattskyldighet ${siArgs.vat_rate}%`,
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
                  account: siArgs.account,
                  accountName: siArgs.description,
                  debit: netAmount,
                  credit: 0,
                  comment: "Kostnadsrad",
                },
                {
                  account: 2640,
                  accountName: "Ingående moms",
                  debit: vatAmount,
                  credit: 0,
                  comment: `Moms ${siArgs.vat_rate}%`,
                },
                {
                  account: 2440,
                  accountName: "Leverantörsskulder",
                  debit: 0,
                  credit: siArgs.total_amount,
                  comment: "Total leverantörsskuld",
                },
              ];

            toolStructuredData = {
              toolArgs: siArgs as Record<string, unknown>,
              toolResult: toolResult as Record<string, unknown>,
              postingRows: displayRows,
            };
            const rcNote = isRC ? " (omvänd skattskyldighet)" : "";
            responseText =
              `Leverantörsfaktura skapad i Fortnox!${rcNote}\n- Belopp: ${siArgs.total_amount} kr${isRC ? "" : ` (${netAmount} + ${vatAmount} moms)`}\n- Konto: ${siArgs.account} (${siArgs.description})\n- Förfallodatum: ${
                siArgs.due_date || "30 dagar"
              }`;
            void auditService.log({
              userId,
              companyId: resolvedCompanyId || undefined,
              actorType: "ai",
              action: "create",
              resourceType: "supplier_invoice",
              resourceId: siArgs.invoice_number ||
                `supplier-${siArgs.supplier_number}`,
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
            toolResult = await callFortnoxWrite(
              "bookSupplierInvoice",
              { givenNumber: Number(bsiArgs.invoice_number) },
              "book_supplier_invoice",
              bsiArgs.invoice_number,
            );
            toolStructuredData = {
              toolArgs: bsiArgs as Record<string, unknown>,
              toolResult: toolResult as Record<string, unknown>,
            };
            responseText =
              `Leverantörsfaktura ${bsiArgs.invoice_number} är nu bokförd i Fortnox.`;
            void auditService.log({
              userId,
              companyId: resolvedCompanyId || undefined,
              actorType: "ai",
              action: "update",
              resourceType: "supplier_invoice",
              resourceId: bsiArgs.invoice_number,
            });
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
            const payArgs = args as {
              payment_type?: string;
              invoice_number?: string;
              amount?: number;
              payment_date?: string;
            };
            const paymentDate = payArgs.payment_date ||
              new Date().toISOString().slice(0, 10);
            const invoiceNum = payArgs.invoice_number || "";
            const payAmount = payArgs.amount || 0;

            if (payArgs.payment_type === "supplier") {
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
            } else {
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
          responseText =
            `Ett fel uppstod när jag försökte nå Fortnox (${tool}). ${
              err instanceof Error ? err.message : "Försök igen."
            }`;
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

    return new Response(
      JSON.stringify({
        type: "text",
        data: responseText,
        usedMemories: usedMemories.length > 0 ? usedMemories : undefined,
        skillDraft: skillDraft ?? undefined,
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

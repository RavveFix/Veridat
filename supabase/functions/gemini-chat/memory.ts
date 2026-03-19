// Memory system: user memories + accounting memories selection and formatting
/// <reference path="../types/deno.d.ts" />

import type {
  AccountingMemoryRow,
  MemoryTier,
  ScoredMemory,
  UsedMemory,
  UserMemoryRow,
} from "./types.ts";
import type { CompanyMemory } from "../../services/CompanyMemoryService.ts";
import { clampScore, formatSek, parseDate, truncateText } from "./utils.ts";

// ── Constants ──────────────────────────────────────────────────

export const MEMORY_TIER_BY_CATEGORY: Record<string, MemoryTier> = {
  work_context: "fact",
  preferences: "profile",
  history: "episodic",
  top_of_mind: "project",
  user_defined: "profile",
};

export const MEMORY_STOP_WORDS = new Set([
  "och", "att", "som", "det", "den", "detta", "har", "hade", "ska", "kan",
  "inte", "med", "för", "till", "från", "på", "av", "om", "ni", "vi",
  "jag", "du", "är", "var", "vara", "the", "and", "or",
]);

const MAX_MEMORY_CONTEXT = 10;
const MAX_STABLE_MEMORIES = 4;
const MAX_CONTEXTUAL_MEMORIES = 6;

export const ACCOUNTING_CONTEXT_MAX = 6;
const ACCOUNTING_RELIABILITY_THRESHOLD = 0.6;
const ACCOUNTING_ALLOWED_STATUSES = new Set(["auto", "confirmed"]);
export const ACCOUNTING_CONTEXT_ENTITY_TYPES = new Set([
  "company_profile", "account_policy", "supplier_profile", "tax_profile",
  "period_summary", "annual_report", "journal_summary", "rule", "other",
]);
const ACCOUNTING_PERIOD_BOUND_TYPES = new Set([
  "period_summary", "annual_report", "journal_summary",
]);
const ACCOUNTING_HIGH_RELIABILITY_SOURCES = new Set([
  "ledger", "annual_report",
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

// ── User Memory Functions ──────────────────────────────────────

export function normalizeTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9åäö]+/gi, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !MEMORY_STOP_WORDS.has(token));
}

export function resolveMemoryTier(memory: UserMemoryRow): MemoryTier {
  const tier = memory.memory_tier || "";
  if (
    tier === "profile" || tier === "project" || tier === "episodic" ||
    tier === "fact"
  ) {
    return tier;
  }
  return MEMORY_TIER_BY_CATEGORY[memory.category] || "fact";
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

export function computeRecencyScore(
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

export function computeOverlapScore(
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

export function isMemoryExpired(memory: UserMemoryRow): boolean {
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

export function selectRelevantMemories(memories: UserMemoryRow[], message: string): {
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

export function formatUserMemoriesForContext(
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

// ── Accounting Memory Functions ──────────────────────────────

function extractYearHint(message: string): string | null {
  const match = message.match(/\b(20\d{2})\b/);
  return match ? match[1] : null;
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

export function selectAccountingMemoriesForContext(
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
    "company_profile", "account_policy", "tax_profile", "supplier_profile",
    "period_summary", "annual_report", "journal_summary", "rule", "other",
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

export function formatAccountingMemoriesForContext(
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

// ── Company Memory Context ──────────────────────────────────

export function buildCompanyMemoryContext(
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

// ── Memory Request Extraction ──────────────────────────────

export function extractMemoryRequest(message: string): string | null {
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

// Supabase Edge Function for Gemini Chat
/// <reference path="../types/deno.d.ts" />

import { sendMessageToGemini, sendMessageStreamToGemini, generateConversationTitle, GeminiRateLimitError, type FileData, type ConversationSearchArgs, type RecentChatsArgs, type WebSearchArgs, type CreateJournalEntryArgs, type GetVouchersArgs, type CreateSupplierArgs, type CreateSupplierInvoiceArgs, type ExportJournalToFortnoxArgs, type BookSupplierInvoiceArgs } from "../../services/GeminiService.ts";
import { sendMessageToOpenAI } from "../../services/OpenAIService.ts";
import { createSalesJournalEntries, createCostJournalEntries, validateJournalBalance, generateVerificationId } from "../../services/JournalService.ts";
import { roundToOre } from "../../services/SwedishRounding.ts";
import { RateLimiterService } from "../../services/RateLimiterService.ts";
import { CompanyMemoryService, type CompanyMemory } from "../../services/CompanyMemoryService.ts";
import { getRateLimitConfigForPlan, getUserPlan } from "../../services/PlanService.ts";
import { ConversationService } from "../../services/ConversationService.ts";
import { getCorsHeaders, createOptionsResponse } from "../../services/CorsService.ts";
import { createLogger } from "../../services/LoggerService.ts";
import { AuditService } from "../../services/AuditService.ts";

import { createClient } from "npm:@supabase/supabase-js@2";
import { FortnoxService } from "../../services/FortnoxService.ts";

const logger = createLogger('gemini-chat');
const RATE_LIMIT_ENDPOINT = 'ai';

function getEnv(keys: string[]): string | undefined {
    for (const key of keys) {
        const value = Deno.env.get(key);
        if (value && value.trim()) return value.trim();
    }
    return undefined;
}

function truncateText(value: string, maxChars: number): string {
    const trimmed = value.trim();
    if (trimmed.length <= maxChars) return trimmed;
    return `${trimmed.slice(0, maxChars)}…`;
}

function formatSek(value: number | null | undefined): string {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
    return new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 0 }).format(value);
}

function buildSkillAssistSystemPrompt(): string {
    return [
        'SYSTEM: Du är Veridats Skill-assistent.',
        'Hjälp en icke-teknisk användare att skapa eller förbättra en automation för bokföringen i Sverige.',
        'Skriv på enkel svenska, kort och tydligt. Undvik tekniska ord.',
        'Fokusera på: vad som ska hända, när det ska hända och om det kräver godkännande.',
        'Hitta inte på organisationsnummer, konton, datum, eller systemdata. Om något saknas: ställ en fråga.',
        'Nämn inte tekniska actions, JSON eller interna verktyg om inte användaren specifikt ber om det.',
        'Lägg sist en dold systemrad som börjar med <skill_draft> och slutar med </skill_draft>.',
        'I taggen ska det finnas JSON med fälten: name, description, schedule, requires_approval, data_needed.',
        'Om information saknas: lämna fälten tomma och ställ frågor i punkt 3.',
        'Denna rad ska inte nämnas i texten och ska vara sista raden.',
        '',
        'Svara exakt i detta format:',
        '1) Kort sammanfattning (max 2 meningar).',
        '2) Förslag på automation:',
        '- Namn',
        '- Vad händer?',
        '- När körs den? (t.ex. varje månad, vid ny faktura, vid bankhändelse)',
        '- Behöver godkännande? (Ja/Nej + kort varför)',
        '- Vilken data behövs från användaren?',
        '3) Frågor (max 3 korta frågor om något saknas).'
    ].join('\n');
}

type SkillDraft = {
    name?: string;
    description?: string;
    schedule?: string;
    requires_approval?: boolean;
    data_needed?: string[];
};

function extractSkillDraft(text: string): { cleanText: string; draft: SkillDraft | null } {
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

    const cleanText = text.replace(draftMatch[0], '').trim();
    return { cleanText, draft };
}

function buildCompanyMemoryContext(memory: CompanyMemory, includeVat: boolean): string | null {
    const lines: string[] = [];

    const companyBits: string[] = [];
    if (memory.company_name) companyBits.push(memory.company_name);
    if (memory.org_number) companyBits.push(memory.org_number);
    if (companyBits.length > 0) {
        lines.push(`Bolag: ${companyBits.join(' • ')}`);
    }

    if (includeVat && memory.last_vat_report) {
        const vat = memory.last_vat_report;
        const period = vat.period || 'okänd period';
        const netVat = vat.net_vat;
        const direction = typeof netVat === 'number' ? (netVat >= 0 ? 'betala' : 'återfå') : null;
        const absNet = typeof netVat === 'number' ? Math.abs(netVat) : null;

        lines.push(
            `Senaste momsrapport: ${period} — moms att ${direction ?? 'hantera'}: ${formatSek(absNet)} SEK (utgående ${formatSek(vat.outgoing_vat)} / ingående ${formatSek(vat.incoming_vat)})`
        );
    }

    if (memory.notes) {
        lines.push(`Noteringar: ${truncateText(memory.notes, 800)}`);
    }

    if (lines.length === 0) return null;

    return `SYSTEM CONTEXT: Företagsminne för detta bolag (gäller bara detta bolag):\n- ${lines.join('\n- ')}`;
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
    preview: string;  // First 50 chars of content
    reason?: string;
    confidenceLevel?: 'high' | 'medium';
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

function formatUserMemoriesForContext(memories: UserMemoryRow[]): string | null {
    if (!memories.length) return null;

    const categories: Record<string, string[]> = {
        work_context: [],
        preferences: [],
        history: [],
        top_of_mind: [],
        user_defined: []
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
        { title: "Användardefinierat", items: categories.user_defined }
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
        "</userMemories>"
    ].join("\n");
}

type MemoryTier = "profile" | "project" | "episodic" | "fact";

const MEMORY_TIER_BY_CATEGORY: Record<string, MemoryTier> = {
    work_context: "fact",
    preferences: "profile",
    history: "episodic",
    top_of_mind: "project",
    user_defined: "profile"
};

const MEMORY_STOP_WORDS = new Set([
    "och", "att", "som", "det", "den", "detta", "har", "hade", "ska", "kan", "inte", "med", "för",
    "till", "från", "på", "av", "om", "ni", "vi", "jag", "du", "är", "var", "vara", "the", "and", "or"
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
    "other"
]);
const ACCOUNTING_PERIOD_BOUND_TYPES = new Set([
    "period_summary",
    "annual_report",
    "journal_summary"
]);
const ACCOUNTING_HIGH_RELIABILITY_SOURCES = new Set([
    "ledger",
    "annual_report"
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
    other: "Övrigt"
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

function isAccountingMemoryActive(memory: AccountingMemoryRow, now: Date): boolean {
    const validFrom = parseDate(memory.valid_from);
    const validTo = parseDate(memory.valid_to);
    if (validFrom && validFrom.getTime() > now.getTime()) return false;
    if (validTo && validTo.getTime() < now.getTime()) return false;
    return true;
}

function isAccountingMemoryPeriodMatch(memory: AccountingMemoryRow, yearHint: string | null): boolean {
    const isPeriodBound = ACCOUNTING_PERIOD_BOUND_TYPES.has(memory.entity_type);
    if (!isPeriodBound) return true;
    if (!memory.fiscal_year) return false;
    if (!yearHint) return false;
    return memory.fiscal_year.includes(yearHint);
}

function isAccountingMemoryReliable(memory: AccountingMemoryRow): boolean {
    const status = memory.review_status || "auto";
    if (!ACCOUNTING_ALLOWED_STATUSES.has(status)) return false;

    const reliability = typeof memory.source_reliability === "number" ? memory.source_reliability : 0.0;
    if (reliability < ACCOUNTING_RELIABILITY_THRESHOLD) return false;

    if (ACCOUNTING_PERIOD_BOUND_TYPES.has(memory.entity_type)) {
        if (!ACCOUNTING_HIGH_RELIABILITY_SOURCES.has(memory.source_type)) return false;
    }

    return true;
}

function selectAccountingMemoriesForContext(
    memories: AccountingMemoryRow[],
    message: string
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
        "other"
    ];

    const toTime = (memory: AccountingMemoryRow): number => {
        const timestamp = memory.last_used_at || memory.updated_at || memory.created_at || null;
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

function formatAccountingMemoriesForContext(memories: AccountingMemoryRow[]): string | null {
    if (!memories.length) return null;

    const sections: Record<string, string[]> = {};

    for (const memory of memories) {
        const rawLabel = memory.label?.trim() || "";
        const payload = memory.payload || {};
        const payloadSummary = typeof payload.summary === "string" ? payload.summary.trim() : "";
        const fallback = payloadSummary || (Object.keys(payload).length > 0 ? JSON.stringify(payload) : "");
        const content = rawLabel || fallback;
        if (!content) continue;

        const suffixParts: string[] = [];
        if (ACCOUNTING_PERIOD_BOUND_TYPES.has(memory.entity_type) && memory.fiscal_year) {
            suffixParts.push(`År ${memory.fiscal_year}`);
        }
        const sourceLabel = memory.source_type ? `Källa: ${memory.source_type}` : "";
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
        "</accountingMemories>"
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
    if (tier === "profile" || tier === "project" || tier === "episodic" || tier === "fact") {
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

function computeRecencyScore(dateString: string | null | undefined, tier: MemoryTier): number {
    if (!dateString) return 0.3;
    const parsed = new Date(dateString);
    if (Number.isNaN(parsed.getTime())) return 0.3;
    const diffMs = Date.now() - parsed.getTime();
    const diffDays = Math.max(0, diffMs / (1000 * 60 * 60 * 24));
    const halfLife = getHalfLifeDays(tier);
    return Math.exp(-diffDays / halfLife);
}

function computeOverlapScore(queryTokens: string[], contentTokens: string[]): number {
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
    recencyScore: number
): string {
    if (overlapScore >= 0.2) return "Matchade frågan";
    if (tier === "project") return recencyScore > 0.5 ? "Aktuellt projekt" : "Projektminne";
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
        const recencyScore = computeRecencyScore(memory.last_used_at || memory.updated_at || memory.created_at, tier);
        const overlapScore = computeOverlapScore(queryTokens, normalizeTokens(memory.content));
        const importance = clampScore(memory.importance, isStable ? 0.7 : 0.6);
        const confidence = clampScore(memory.confidence, 0.7);
        const tierBoost = isStable ? 0.2 : 0;

        if (!isStable && overlapScore === 0 && recencyScore < 0.35) {
            continue;
        }

        const score = overlapScore * 2
            + recencyScore * 0.9
            + importance * 0.8
            + confidence * 0.4
            + tierBoost;

        scored.push({
            memory,
            tier,
            isStable,
            score,
            overlapScore,
            recencyScore,
            reason: buildMemoryReason(tier, overlapScore, recencyScore)
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
        preview: item.memory.content.substring(0, 50) + (item.memory.content.length > 50 ? "..." : ""),
        reason: item.reason,
        confidenceLevel: (clampScore(item.memory.importance, 0.6) >= 0.7 ? 'high' : 'medium') as 'high' | 'medium'
    }));

    return {
        selected: selected.map((item) => item.memory),
        usedMemories
    };
}

function extractSnippet(content: string, query: string, contextLength = 90): string {
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

function detectHistoryIntent(message: string): { search: boolean; recent: boolean } {
    const normalized = message.toLowerCase();
    const explicitHistory = /(tidigare konversation|förra chatten|förra gången|pratade vi|diskuterade vi|sade du|sa du)/.test(normalized);
    if (shouldSkipHistorySearch(message)) {
        return { search: false, recent: false };
    }
    const mentionsRecent = /(förra veckan|förra månaden|förra kvartalet|senast|sist|tidigare|förut)/.test(normalized);
    const mentionsTalk = /(pratade|diskuterade|nämnde|sade|sa)/.test(normalized);
    const mentionsWe = /\bvi\b/.test(normalized);
    const mentionsHowWeDid = /(hur\s+.*(bokförde|gjorde|löste)|bokförde vi)/.test(normalized);

    const search = mentionsTalk || mentionsHowWeDid || (mentionsRecent && mentionsWe);
    const recent = mentionsRecent && (mentionsWe || mentionsTalk);

    return { search, recent };
}

function shouldSkipHistorySearch(message: string): boolean {
    const normalized = message.toLowerCase();
    const explicitHistory = /(tidigare konversation|förra chatten|förra gången|pratade vi|diskuterade vi|sade du|sa du)/.test(normalized);
    if (explicitHistory) return false;

    const hasYear = /\b20\d{2}\b/.test(normalized);
    const accountingTerms = /(årsredovisning|bokslut|momsrapport|momsredovisning|balansräkning|resultaträkning|sie|bas|räkenskapsår|period|omsättning|nettoomsättning|resultat|verifikation|bokföring|faktura|leverantörsfaktura|konto|kontera|bokföra|kvitto)/.test(normalized);
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
        /lägg till i minnet\s*[:\-]?\s*(.+)/i
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
    supabaseAdmin: ReturnType<typeof createClient>,
    userId: string,
    companyId: string | null,
    query: string,
    limit: number
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
        .textSearch("search_vector", query, { type: "websearch", config: "swedish" })
        .limit(limit);

    if (companyId) {
        searchQuery = searchQuery.eq("conversation.company_id", companyId);
    }

    const { data, error } = await searchQuery;
    if (error) throw error;

    type MessageRow = {
        content: string;
        created_at: string;
        conversation: { id: string; title: string | null; company_id: string; user_id: string };
    };
    return (data as MessageRow[] || []).map((row) => ({
        conversation_id: row.conversation.id,
        conversation_title: row.conversation.title,
        snippet: extractSnippet(row.content, query),
        created_at: row.created_at
    }));
}

async function getRecentConversations(
    supabaseAdmin: ReturnType<typeof createClient>,
    userId: string,
    companyId: string | null,
    limit: number
): Promise<Array<{ id: string; title: string | null; summary: string | null; updated_at: string | null }>> {
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
    recent: Array<{ id: string; title: string | null; summary: string | null; updated_at: string | null }>
): string {
    if (results.length === 0 && recent.length === 0) {
        return `Jag hittade inget som matchar "${query}" i tidigare konversationer.`;
    }

    const formatDate = (value: string | null) => {
        if (!value) return "";
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return "";
        return parsed.toLocaleDateString("sv-SE", { day: "numeric", month: "short" });
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
            const summary = conv.summary ? ` — ${truncateText(conv.summary, 160)}` : "";
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
        return parsed.toLocaleDateString("sv-SE", { year: "numeric", month: "short", day: "numeric" });
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
        const snippetLine = result.snippet ? `Utdrag: ${result.snippet}` : "Utdrag: (saknas)";
        return `${index + 1}. ${result.title}\n${sourceLine}\n${dateLine}\n${snippetLine}`;
    });

    return `${header}\n\n${resultLines.join("\n\n")}`;
}

async function triggerMemoryGenerator(
    supabaseUrl: string,
    serviceKey: string,
    conversationId: string
): Promise<void> {
    if (!supabaseUrl || !serviceKey || !conversationId) return;
    try {
        await fetch(`${supabaseUrl}/functions/v1/memory-generator`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${serviceKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ conversation_id: conversationId })
        });
    } catch (error) {
        logger.warn("Failed to trigger memory generator", { conversationId, error });
    }
}

/**
 * Generate a smart title for new conversations using AI
 * Only generates if conversation has no real title yet (null or "Ny konversation")
 */
async function generateSmartTitleIfNeeded(
    _conversationService: ConversationService,
    supabaseAdmin: ReturnType<typeof createClient>,
    conversationId: string,
    userMessage: string,
    aiResponse: string
): Promise<void> {
    console.log('[TITLE] generateSmartTitleIfNeeded called', { conversationId, userMessage: userMessage?.substring(0, 50) });

    try {
        // Check current title using service role
        const { data: conv, error: fetchError } = await supabaseAdmin
            .from('conversations')
            .select('title')
            .eq('id', conversationId)
            .single();

        console.log('[TITLE] Current title check', { conversationId, title: conv?.title, error: fetchError?.message });

        if (fetchError || !conv) {
            console.log('[TITLE] Could not fetch conversation', { conversationId, error: fetchError?.message });
            return;
        }

        // Only generate if title is missing or default
        const currentTitle = conv.title?.trim();
        if (currentTitle && currentTitle !== 'Ny konversation') {
            console.log('[TITLE] Title already set, skipping', { conversationId, currentTitle });
            return;
        }

        // Use AI to generate a smart title (falls back to truncation on error)
        const apiKey = Deno.env.get('GEMINI_API_KEY');
        const generatedTitle = await generateConversationTitle(userMessage, aiResponse, apiKey);
        console.log('[TITLE] AI generated title:', generatedTitle, { conversationId });

        // Use supabaseAdmin directly (service role) to bypass any RLS issues
        const { error: updateError } = await supabaseAdmin
            .from('conversations')
            .update({ title: generatedTitle, updated_at: new Date().toISOString() })
            .eq('id', conversationId);

        if (updateError) {
            console.log('[TITLE] Update failed', { conversationId, error: updateError.message });
        } else {
            console.log('[TITLE] Title updated successfully!', { conversationId, title: generatedTitle });
        }
    } catch (error) {
        console.log('[TITLE] Exception caught', { conversationId, error: String(error) });
    }
}
interface RequestBody {
    action?: 'generate_title' | null;
    message: string;
    fileData?: FileData;
    fileDataPages?: Array<FileData & { pageNumber?: number }>;
    documentText?: string | null;
    history?: Array<{ role: string, content: string }>;
    conversationId?: string;
    companyId?: string | null;
    fileUrl?: string | null;
    fileName?: string | null;
    vatReportContext?: VATReportContext | null;
    model?: string | null;
    titleContext?: string | null;
    assistantMode?: 'skill_assist' | null;
}

// Proper type for VAT report context instead of 'any'
interface VATReportContext {
    type: string;
    period: string;
    company?: { name: string; org_number: string };
    summary?: { total_income: number; total_costs: number; result: number };
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
    authHeader: string
): Promise<string | null> {
    const supabaseUrl = getEnv(['SUPABASE_URL', 'SB_URL']);
    const supabaseServiceKey = getEnv(['SUPABASE_SERVICE_ROLE_KEY', 'SB_SERVICE_ROLE_KEY']);
    if (!supabaseUrl || !supabaseServiceKey) return null;

    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
        global: { headers: { Authorization: authHeader } }
    });
    const fortnoxConfig = {
        clientId: Deno.env.get('FORTNOX_CLIENT_ID') ?? '',
        clientSecret: Deno.env.get('FORTNOX_CLIENT_SECRET') ?? '',
        redirectUri: '',
    };
    const fortnoxService = new FortnoxService(fortnoxConfig, supabaseClient, userId);
    const auditService = new AuditService(supabaseAdmin);

    try {
        switch (toolName) {
            case 'get_customers': {
                const result = await fortnoxService.getCustomers();
                return `Här är dina kunder: ${(result as any).Customers.map((c: any) => c.Name).join(', ')}`;
            }
            case 'get_articles': {
                const result = await fortnoxService.getArticles();
                return `Här är dina artiklar: ${(result as any).Articles.map((a: any) => a.Description).join(', ')}`;
            }
            case 'get_suppliers': {
                const result = await fortnoxService.getSuppliers();
                const suppliers = (result as any).Suppliers || [];
                return suppliers.length > 0
                    ? `Här är dina leverantörer:\n${suppliers.map((s: any) => `- ${s.Name} (nr ${s.SupplierNumber})`).join('\n')}`
                    : 'Inga leverantörer hittades i Fortnox.';
            }
            case 'get_vouchers': {
                const vArgs = toolArgs as GetVouchersArgs;
                const result = await fortnoxService.getVouchers(vArgs.financial_year, vArgs.series);
                const vouchers = (result as any).Vouchers || [];
                return vouchers.length > 0
                    ? `Hittade ${vouchers.length} verifikationer:\n${vouchers.slice(0, 10).map((v: any) => `- ${v.VoucherSeries}${v.VoucherNumber}: ${v.Description || '—'} (${v.TransactionDate})`).join('\n')}`
                    : 'Inga verifikationer hittades.';
            }
            case 'create_supplier': {
                const csArgs = toolArgs as CreateSupplierArgs;
                const result = await fortnoxService.createSupplier({
                    Name: csArgs.name,
                    OrganisationNumber: csArgs.org_number || undefined,
                    Email: csArgs.email || undefined,
                } as any);
                const supplier = (result as any).Supplier || result;
                void auditService.log({ userId, companyId: companyId || undefined, actorType: 'ai', action: 'create', resourceType: 'supplier', resourceId: supplier.SupplierNumber || '', newState: supplier });
                return `Leverantör skapad!\n- Namn: ${supplier.Name || csArgs.name}\n- Nr: ${supplier.SupplierNumber || 'tilldelas'}`;
            }
            case 'create_supplier_invoice': {
                const siArgs = toolArgs as CreateSupplierInvoiceArgs;
                const vatMul = 1 + (siArgs.vat_rate / 100);
                const net = Math.round((siArgs.total_amount / vatMul) * 100) / 100;
                const vat = Math.round((siArgs.total_amount - net) * 100) / 100;
                const result = await fortnoxService.createSupplierInvoice({
                    SupplierNumber: siArgs.supplier_number,
                    InvoiceNumber: siArgs.invoice_number || undefined,
                    InvoiceDate: new Date().toISOString().slice(0, 10),
                    DueDate: siArgs.due_date || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
                    Total: siArgs.total_amount, VAT: vat, VATType: 'NORMAL', AccountingMethod: 'ACCRUAL',
                    SupplierInvoiceRows: [
                        { Account: siArgs.account, Debit: net, Credit: 0 },
                        { Account: 2640, Debit: vat, Credit: 0 },
                        { Account: 2440, Debit: 0, Credit: siArgs.total_amount },
                    ],
                } as any);
                void auditService.log({ userId, companyId: companyId || undefined, actorType: 'ai', action: 'create', resourceType: 'supplier_invoice', newState: result });
                return `Leverantörsfaktura skapad!\n- Belopp: ${siArgs.total_amount} kr (${net} + ${vat} moms)\n- Konto: ${siArgs.account}\n- Förfallodatum: ${siArgs.due_date || '30 dagar'}`;
            }
            case 'export_journal_to_fortnox': {
                const ejArgs = toolArgs as ExportJournalToFortnoxArgs;
                const { data: je } = await supabaseAdmin.from('journal_entries').select('*').eq('verification_id', ejArgs.journal_entry_id).maybeSingle();
                if (!je) return `Kunde inte hitta verifikat ${ejArgs.journal_entry_id}.`;
                const entries = typeof je.entries === 'string' ? JSON.parse(je.entries) : je.entries;
                const rows = entries.map((e: any) => ({ Account: e.account, Debit: e.debit || 0, Credit: e.credit || 0, Description: e.accountName || je.description }));
                const result = await fortnoxService.createVoucher({ Description: `${je.description} (${ejArgs.journal_entry_id})`, TransactionDate: new Date().toISOString().slice(0, 10), VoucherSeries: 'A', VoucherRows: rows } as any);
                const v = (result as any).Voucher || result;
                void auditService.log({ userId, companyId: companyId || undefined, actorType: 'ai', action: 'export', resourceType: 'voucher', resourceId: ejArgs.journal_entry_id, newState: v });
                return `Exporterat till Fortnox! Verifikat: ${v.VoucherSeries || 'A'}-${v.VoucherNumber || '?'}`;
            }
            case 'book_supplier_invoice': {
                const bArgs = toolArgs as BookSupplierInvoiceArgs;
                await fortnoxService.bookSupplierInvoice(bArgs.invoice_number);
                void auditService.log({ userId, companyId: companyId || undefined, actorType: 'ai', action: 'update', resourceType: 'supplier_invoice', resourceId: bArgs.invoice_number });
                return `Leverantörsfaktura ${bArgs.invoice_number} är nu bokförd.`;
            }
            case 'create_invoice':
                return null; // Handled by client
            default:
                return null;
        }
    } catch (err) {
        logger.error(`Fortnox tool ${toolName} failed`, err);
        return `Ett fel uppstod vid ${toolName}: ${err instanceof Error ? err.message : 'okänt fel'}`;
    }
}

async function fetchWebSearchResults(
    toolArgs: Record<string, unknown>,
    authHeader: string
): Promise<WebSearchResponse | null> {
    const args = toolArgs as WebSearchArgs;
    const query = typeof args?.query === "string" ? args.query.trim() : "";
    if (!query) return null;

    const supabaseUrl = getEnv(["SUPABASE_URL", "SB_SUPABASE_URL", "API_URL"]);
    if (!supabaseUrl) return null;

    const payload: Record<string, unknown> = { query };
    if (typeof args.max_results === "number") payload.max_results = args.max_results;
    if (typeof args.recency_days === "number") payload.recency_days = args.recency_days;

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
    const corsHeaders = getCorsHeaders();
    const provider = (Deno.env.get('LLM_PROVIDER') || 'gemini').toLowerCase();
    console.log('[INIT] LLM_PROVIDER env value:', Deno.env.get('LLM_PROVIDER'), '-> provider:', provider);
    const responseHeaders = {
        ...corsHeaders,
        'X-LLM-Provider': provider
    };

    // Handle CORS preflight
    if (req.method === "OPTIONS") {
        return createOptionsResponse();
    }

    try {
        let { action, message, fileData, fileDataPages, documentText, history, conversationId, companyId, fileUrl, fileName, vatReportContext, model, titleContext, assistantMode }: RequestBody = await req.json();
        const hasFileAttachment = Boolean(fileData || fileDataPages || documentText || fileUrl || fileName);
        const isSkillAssist = assistantMode === 'skill_assist';
        
        // Log which model is requested
        if (model) {
            logger.info('Client requested model:', { model });
        }

        if (!message) {
            return new Response(
                JSON.stringify({ error: "Message is required" }),
                {
                    status: 400,
                    headers: { ...responseHeaders, "Content-Type": "application/json" },
                }
            );
        }

        // Require auth for AI calls to prevent anonymous abuse/costs
        const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
        if (!authHeader) {
            return new Response(
                JSON.stringify({ error: "Unauthorized" }),
                {
                    status: 401,
                    headers: { ...responseHeaders, "Content-Type": "application/json" },
                }
            );
        }

        // Initialize Supabase client with service role for rate limiting
        const supabaseUrl = getEnv(['SUPABASE_URL', 'SB_SUPABASE_URL', 'API_URL']);
        const supabaseServiceKey = getEnv(['SUPABASE_SERVICE_ROLE_KEY', 'SB_SERVICE_ROLE_KEY', 'SERVICE_ROLE_KEY', 'SECRET_KEY']);
        if (!supabaseUrl || !supabaseServiceKey) {
            throw new Error('Missing Supabase service role configuration');
        }
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

        // Initialize AuditService for BFL compliance logging
        const auditService = new AuditService(supabaseAdmin);

        // Resolve actual user id from the access token (don't trust client-provided IDs)
        const token = authHeader.replace(/^Bearer\s+/i, '');
        const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
        if (userError || !user) {
            return new Response(
                JSON.stringify({ error: "Unauthorized" }),
                {
                    status: 401,
                    headers: { ...responseHeaders, "Content-Type": "application/json" },
                }
            );
        }
        const userId = user.id;
        let resolvedCompanyId: string | null = typeof companyId === 'string' && companyId.trim() ? companyId.trim() : null;

        // Check rate limit
        const plan = await getUserPlan(supabaseAdmin, userId);
        logger.debug('Resolved plan', { userId, plan });

        // Validate model access based on plan
        // Pro model requires Pro plan
        let effectiveModel = model || undefined;
        if (model?.includes('pro') && plan !== 'pro') {
            logger.info('User requested Pro model but has free plan, falling back to Flash', { userId, requestedModel: model });
            effectiveModel = 'gemini-3-flash-preview';
        }

        const rateLimiter = new RateLimiterService(supabaseAdmin, getRateLimitConfigForPlan(plan));
        const rateLimit = await rateLimiter.checkAndIncrement(userId, RATE_LIMIT_ENDPOINT);

        if (!rateLimit.allowed) {
            logger.warn('Rate limit exceeded', { userId });
            return new Response(
                JSON.stringify({
                    error: 'rate_limit_exceeded',
                    message: rateLimit.message,
                    remaining: rateLimit.remaining,
                    resetAt: rateLimit.resetAt.toISOString()
                }),
                {
                    status: 429,
                    headers: {
                        ...responseHeaders,
                        'Content-Type': 'application/json',
                        'X-RateLimit-Remaining': String(rateLimit.remaining),
                        'X-RateLimit-Reset': rateLimit.resetAt.toISOString()
                    }
                }
            );
        }

        logger.info('Rate limit check passed', { userId, remaining: rateLimit.remaining });

        // Verify that the conversation (if provided) belongs to the authenticated user.
        if (conversationId) {
            const { data: conversation, error: conversationError } = await supabaseAdmin
                .from('conversations')
                .select('id, company_id')
                .eq('id', conversationId)
                .eq('user_id', userId)
                .maybeSingle();

            if (conversationError) {
                logger.error('Failed to verify conversation ownership', conversationError, { conversationId, userId });
                return new Response(
                    JSON.stringify({ error: 'conversation_verification_failed' }),
                    {
                        status: 500,
                        headers: { ...responseHeaders, "Content-Type": "application/json" },
                    }
                );
            }

            if (!conversation) {
                return new Response(
                    JSON.stringify({ error: 'conversation_not_found' }),
                    {
                        status: 404,
                        headers: { ...responseHeaders, "Content-Type": "application/json" },
                    }
                );
            }

            if (conversation.company_id) {
                resolvedCompanyId = String(conversation.company_id);
            }
        }

        if (action === 'generate_title') {
            if (!conversationId) {
                return new Response(
                    JSON.stringify({ error: 'conversation_id_required' }),
                    {
                        status: 400,
                        headers: { ...responseHeaders, "Content-Type": "application/json" },
                    }
                );
            }

            const { data: conv, error: titleFetchError } = await supabaseAdmin
                .from('conversations')
                .select('title')
                .eq('id', conversationId)
                .eq('user_id', userId)
                .single();

            if (titleFetchError || !conv) {
                logger.error('Failed to fetch conversation for title generation', { conversationId, error: titleFetchError?.message });
                return new Response(
                    JSON.stringify({ error: 'conversation_not_found' }),
                    {
                        status: 404,
                        headers: { ...responseHeaders, "Content-Type": "application/json" },
                    }
                );
            }

            const currentTitle = conv.title?.trim();
            if (currentTitle && currentTitle !== 'Ny konversation') {
                return new Response(JSON.stringify({
                    title: currentTitle,
                    updated: false
                }), {
                    headers: { ...responseHeaders, "Content-Type": "application/json" }
                });
            }

            const safeContext = typeof titleContext === 'string' ? titleContext : '';
            const generatedTitle = await generateConversationTitle(message, safeContext, Deno.env.get('GEMINI_API_KEY'));

            const { error: updateError } = await supabaseAdmin
                .from('conversations')
                .update({ title: generatedTitle, updated_at: new Date().toISOString() })
                .eq('id', conversationId)
                .eq('user_id', userId);

            if (updateError) {
                logger.error('Title update failed', { conversationId, error: updateError.message });
                return new Response(JSON.stringify({
                    title: generatedTitle,
                    updated: false
                }), {
                    headers: { ...responseHeaders, "Content-Type": "application/json" }
                });
            }

            return new Response(JSON.stringify({
                title: generatedTitle,
                updated: true
            }), {
                headers: { ...responseHeaders, "Content-Type": "application/json" }
            });
        }

        let _userMessageSaved = false;
        let conversationService: ConversationService | null = null;

        if (conversationId) {
            try {
                const supabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
                    global: { headers: { Authorization: authHeader } }
                });

                conversationService = new ConversationService(supabaseClient);

                // Save user message
                await conversationService.addMessage(
                    conversationId,
                    'user',
                    message,
                    fileUrl || null,
                    fileName || null
                );
                _userMessageSaved = true;
                logger.info('User message saved to database', { conversationId });
            } catch (saveError) {
                logger.error('Failed to save user message', saveError, { conversationId, userId });
            }
        }

        const historyIntent = (hasFileAttachment || isSkillAssist)
            ? { search: false, recent: false }
            : detectHistoryIntent(message);
        if ((historyIntent.search || historyIntent.recent) && conversationId) {
            try {
                const safeLimit = 5;
                const searchResults = historyIntent.search
                    ? await searchConversationHistory(supabaseAdmin, userId, resolvedCompanyId, message, safeLimit)
                    : [];
                const recentConversations = historyIntent.recent && searchResults.length === 0
                    ? await getRecentConversations(supabaseAdmin, userId, resolvedCompanyId, safeLimit)
                    : [];

                const responseText = formatHistoryResponse(message, searchResults, recentConversations);

                if (!conversationService) {
                    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
                        global: { headers: { Authorization: authHeader } }
                    });
                    conversationService = new ConversationService(supabaseClient);
                }

                await conversationService.addMessage(conversationId, 'assistant', responseText);
                await generateSmartTitleIfNeeded(conversationService, supabaseAdmin, conversationId, message, responseText);
                void triggerMemoryGenerator(supabaseUrl, supabaseServiceKey, conversationId);

                return new Response(JSON.stringify({ type: 'text', data: responseText }), {
                    headers: { ...responseHeaders, "Content-Type": "application/json" }
                });
            } catch (historyError) {
                logger.warn('History lookup failed, continuing with normal flow', { error: historyError });
            }
        }

        const memoryRequest = isSkillAssist ? null : extractMemoryRequest(message);
        if (memoryRequest && resolvedCompanyId) {
            try {
                const { data: existingMemory } = await supabaseAdmin
                    .from('user_memories')
                    .select('id')
                    .eq('user_id', userId)
                    .eq('company_id', resolvedCompanyId)
                    .ilike('content', memoryRequest)
                    .limit(1);

                if (!existingMemory || existingMemory.length === 0) {
                    await supabaseAdmin.from('user_memories').insert({
                        user_id: userId,
                        company_id: resolvedCompanyId,
                        category: 'user_defined',
                        content: memoryRequest,
                        confidence: 1.0,
                        memory_tier: 'profile',
                        importance: 0.9
                    });

                    await supabaseAdmin.from('memory_user_edits').insert({
                        user_id: userId,
                        company_id: resolvedCompanyId,
                        edit_type: 'add',
                        content: memoryRequest
                    });
                }
            } catch (memorySaveError) {
                logger.warn('Failed to save user memory request', { userId, companyId: resolvedCompanyId });
            }
        }

        // Inject VAT Report Context if available OR fetch from DB
        let finalMessage = message;

        if (isSkillAssist) {
            finalMessage = `${buildSkillAssistSystemPrompt()}\n\nAnvändarens önskemål:\n${message}`;
        } else if (!vatReportContext && conversationId) {
            try {
                const { data: reports, error } = await supabaseAdmin
                    .from('vat_reports')
                    .select('report_data, period, company_name')
                    .eq('conversation_id', conversationId)
                    .order('created_at', { ascending: false })
                    .limit(1);

                if (!error && reports && reports.length > 0) {
                    const report = reports[0];
                    const data = report.report_data;

                    vatReportContext = {
                        type: 'vat_report',
                        period: report.period,
                        company: {
                            name: report.company_name || data.company_name || 'Okänt',
                            org_number: data.org_number || 'Saknas'
                        },
                        summary: data.summary,
                        vat: data.vat,
                        validation: data.claude_validation ? {
                            is_valid: data.claude_validation.validation_passed,
                            errors: [],
                            warnings: data.claude_validation.warnings || []
                        } : undefined
                    };
                    logger.info('Fetched VAT report context from DB', { conversationId });
                }
            } catch (fetchError) {
                logger.warn('Failed to fetch VAT report from DB', { conversationId });
            }
        }

        if (!isSkillAssist && vatReportContext) {
            const netVat = vatReportContext.vat?.net ?? 0;
            const contextMessage = `
SYSTEM CONTEXT: Användaren tittar just nu på följande momsredovisning (genererad av ${vatReportContext.type === 'vat_report' ? 'systemet' : 'analysverktyget'}):

Period: ${vatReportContext.period}
Företag: ${vatReportContext.company?.name ?? 'Okänt'} (${vatReportContext.company?.org_number ?? 'Saknas'})

SAMMANFATTNING:
- Försäljning: ${vatReportContext.summary?.total_sales ?? vatReportContext.summary?.total_income ?? 0} SEK
- Kostnader: ${vatReportContext.summary?.total_costs ?? 0} SEK
- Resultat: ${vatReportContext.summary?.result ?? 0} SEK

MOMS:
- Utgående (25%): ${vatReportContext.vat?.outgoing_25 ?? 0} SEK
- Ingående: ${vatReportContext.vat?.incoming ?? 0} SEK
- Att ${netVat >= 0 ? 'betala' : 'återfå'}: ${Math.abs(netVat)} SEK

VALIDERING:
- Status: ${vatReportContext.validation?.is_valid ? 'Giltig' : 'Ogiltig'}
- Fel: ${vatReportContext.validation?.errors?.join(', ') || 'Inga'}
- Varningar: ${vatReportContext.validation?.warnings?.join(', ') || 'Inga'}

Användaren kan ställa frågor om denna rapport. Svara baserat på ovanstående data.

ANVÄNDARFRÅGA:
`;
            finalMessage = contextMessage + message;
        }

        const safeDocumentText = (documentText || '').trim();
        if (safeDocumentText && !isSkillAssist) {
            const MAX_DOC_CHARS = 50_000;
            const truncated = safeDocumentText.length > MAX_DOC_CHARS
                ? `${safeDocumentText.slice(0, MAX_DOC_CHARS)}\n\n[...trunkerad...]`
                : safeDocumentText;
            finalMessage = `DOKUMENTKONTEXT (text-utdrag från bifogat dokument):\n\n${truncated}\n\n${finalMessage}`;
        }

        const contextBlocks: string[] = [];
        // Track used memories for transparency
        const usedMemories: UsedMemory[] = [];

        if (resolvedCompanyId) {
            try {
                const { data: userMemories, error: userMemoriesError } = await supabaseAdmin
                    .from('user_memories')
                    .select('id, category, content, updated_at, last_used_at, created_at, confidence, memory_tier, importance, expires_at')
                    .eq('user_id', userId)
                    .eq('company_id', resolvedCompanyId)
                    .order('updated_at', { ascending: false })
                    .limit(200);

                if (userMemoriesError) {
                    logger.warn('Failed to load user memories', { userId, companyId: resolvedCompanyId });
                } else if (!userMemories || userMemories.length === 0) {
                    // First interaction with this company — no memories yet
                    contextBlocks.push(
                        'SYSTEM CONTEXT: Detta är första interaktionen med detta företag. ' +
                        'Inga minnen finns ännu. Ställ 1-2 naturliga frågor om verksamheten i ditt svar:\n' +
                        '- Vad gör företaget? (bransch, storlek)\n' +
                        '- Vilken redovisningsmetod? (faktura/kontant)\n' +
                        '- Momsperiod? (månads/kvartals/årsredovisning)\n' +
                        'Väv in frågorna naturligt — inte som ett formulär.'
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
                            .from('user_memories')
                            .update({ last_used_at: new Date().toISOString() })
                            .in('id', memoryIds);
                    }
                }
            } catch (memoryError) {
                logger.warn('Failed to load user memories', { userId, companyId: resolvedCompanyId });
            }

            try {
                const { data: accountingMemories, error: accountingMemoriesError } = await supabaseAdmin
                    .from('accounting_memories')
                    .select('id, entity_type, entity_key, label, payload, source_type, source_reliability, confidence, review_status, fiscal_year, period_start, period_end, valid_from, valid_to, last_used_at, updated_at, created_at')
                    .eq('user_id', userId)
                    .eq('company_id', resolvedCompanyId)
                    .order('updated_at', { ascending: false })
                    .limit(200);

                if (accountingMemoriesError) {
                    logger.warn('Failed to load accounting memories', { userId, companyId: resolvedCompanyId });
                } else if (accountingMemories && accountingMemories.length > 0) {
                    const memoryRows = accountingMemories as AccountingMemoryRow[];
                    const selectedMemories = selectAccountingMemoriesForContext(memoryRows, message);
                    const accountingContext = formatAccountingMemoriesForContext(selectedMemories);

                    if (accountingContext) {
                        contextBlocks.push(accountingContext);
                    }

                    const accountingIds = selectedMemories.map((memory) => memory.id);
                    if (accountingIds.length > 0) {
                        await supabaseAdmin
                            .from('accounting_memories')
                            .update({ last_used_at: new Date().toISOString() })
                            .in('id', accountingIds);
                    }
                }
            } catch (accountingError) {
                logger.warn('Failed to load accounting memories', { userId, companyId: resolvedCompanyId });
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
                logger.warn('Failed to load company memory', { userId, companyId: resolvedCompanyId });
            }
        }

        if (contextBlocks.length > 0) {
            finalMessage = `${contextBlocks.join('\n\n')}\n\n${finalMessage}`;
        }

        // Provider switch (default: Gemini)
        const primaryImage = fileData?.mimeType?.startsWith('image/') ? fileData : undefined;
        const imagePages = (fileDataPages || []).filter((p) => p?.mimeType?.startsWith('image/') && !!p.data);
        const geminiFileData = primaryImage || (imagePages.length > 0 ? (imagePages[0] as FileData) : undefined);
        const disableTools = isSkillAssist || shouldSkipHistorySearch(message) || hasFileAttachment;

        const forceNonStreaming = isSkillAssist;

        // Handle Gemini Streaming
        if (provider === 'gemini' && !forceNonStreaming) {
            console.log('[STREAMING] Starting Gemini streaming... (model:', effectiveModel || 'default', ')');
            try {
                const stream = await sendMessageStreamToGemini(finalMessage, geminiFileData, history, undefined, effectiveModel, { disableTools });
                console.log('[STREAMING] Stream created successfully');
                const encoder = new TextEncoder();
                let fullText = "";
                let toolCallDetected: any = null;

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
                                    const sseData = `data: ${JSON.stringify({ text: chunkText })}\n\n`;
                                    controller.enqueue(encoder.encode(sseData));
                                }
                            }

                            if (toolCallDetected) {
                                // Execute the tool and stream the result
                                let toolResponseText = "";
                                const toolName = toolCallDetected.name;
                                const toolArgs = toolCallDetected.args || {};

                                try {
                                if (toolName === 'conversation_search') {
                                    if (shouldSkipHistorySearch(message)) {
                                        const directResponse = await sendMessageToGemini(finalMessage, geminiFileData, history, undefined, effectiveModel, { disableTools: true });
                                        toolResponseText = directResponse.text || "Jag kan hjälpa dig att sammanfatta redovisningen, men jag behöver mer data.";
                                    } else {
                                    const searchQuery = (toolArgs as { query?: string }).query || '';
                                    const searchResults = await searchConversationHistory(supabaseAdmin, userId, resolvedCompanyId, searchQuery, 5);

                                    if (searchResults.length === 0) {
                                        const noResultsPrompt = `Jag sökte igenom tidigare konversationer efter "${searchQuery}" men hittade inget relevant. Svara på användarens fråga så gott du kan utan tidigare kontext: "${message}"`;
                                        const noResultsResponse = await sendMessageToGemini(noResultsPrompt, undefined, history, undefined, effectiveModel);
                                        toolResponseText = noResultsResponse.text || `Jag hittade tyvärr inget i tidigare konversationer som matchar "${searchQuery}".`;
                                    } else {
                                        const contextLines = searchResults.map(r => `[${r.conversation_title || 'Konversation'}]: ${r.snippet}`);
                                        const contextPrompt = `SÖKRESULTAT FRÅN TIDIGARE KONVERSATIONER:\n${contextLines.join('\n')}\n\nAnvänd denna kontext för att svara naturligt på användarens fråga: "${message}"`;
                                        const followUp = await sendMessageToGemini(contextPrompt, undefined, history, undefined, effectiveModel);
                                        toolResponseText = followUp.text || formatHistoryResponse(searchQuery, searchResults, []);
                                    }
                                    }
                                } else if (toolName === 'recent_chats') {
                                    if (shouldSkipHistorySearch(message)) {
                                        const directResponse = await sendMessageToGemini(finalMessage, geminiFileData, history, undefined, effectiveModel, { disableTools: true });
                                        toolResponseText = directResponse.text || "Jag kan hjälpa dig att sammanfatta redovisningen, men jag behöver mer data.";
                                    } else {
                                    const limit = (toolArgs as { limit?: number }).limit || 5;
                                    const recentConversations = await getRecentConversations(supabaseAdmin, userId, resolvedCompanyId, limit);

                                    if (recentConversations.length === 0) {
                                        toolResponseText = "Du har inga tidigare konversationer ännu.";
                                    } else {
                                        const contextLines = recentConversations.map(c => `- ${c.title || 'Konversation'}${c.summary ? ` - ${c.summary}` : ''}`);
                                        const contextPrompt = `SENASTE KONVERSATIONER:\n${contextLines.join('\n')}\n\nGe en kort överblick baserat på dessa konversationer för att svara på: "${message}"`;
                                        const followUp = await sendMessageToGemini(contextPrompt, undefined, history, undefined, effectiveModel);
                                        toolResponseText = followUp.text || formatHistoryResponse(message, [], recentConversations);
                                    }
                                    }
                                } else if (toolName === 'web_search') {
                                    const webResults = await fetchWebSearchResults(toolArgs, authHeader);
                                    if (!webResults || webResults.results.length === 0) {
                                        const noResultsPrompt = `Jag hittade inga tillförlitliga webbkällor via webbsökning för frågan. Svara ändå så gott du kan, men var tydlig med osäkerhet och be om förtydligande vid behov. Fråga: "${message}"`;
                                        const followUp = await sendMessageToGemini(noResultsPrompt, undefined, history, undefined, effectiveModel, { disableTools: true });
                                        toolResponseText = followUp.text || "Jag hittade tyvärr inga tillförlitliga källor just nu.";
                                    } else {
                                        const contextPrompt = `WEBBSÖKRESULTAT (uppdaterade, officiella källor):\n${formatWebSearchContext(webResults)}\n\nAnvänd dessa källor för att svara på användarens fråga. Redovisa källa och datum i svaret. Fråga: "${message}"`;
                                        const followUp = await sendMessageToGemini(contextPrompt, undefined, history, undefined, effectiveModel, { disableTools: true });
                                        toolResponseText = followUp.text || "Jag kunde inte sammanställa ett svar från webbkällorna.";
                                    }
                                } else {
                                        // Execute Fortnox tools server-side
                                        const fortnoxToolResult = await executeFortnoxTool(toolName, toolArgs, supabaseAdmin, userId, resolvedCompanyId, req.headers.get('Authorization')!);
                                        if (fortnoxToolResult) {
                                            toolResponseText = fortnoxToolResult;
                                        } else {
                                            // Unknown tool - send metadata for client handling
                                            const sseToolData = `data: ${JSON.stringify({ toolCall: { tool: toolName, args: toolArgs } })}\n\n`;
                                            controller.enqueue(encoder.encode(sseToolData));
                                        }
                                    }

                                    // Stream the tool response as text
                                    if (toolResponseText) {
                                        fullText = toolResponseText;
                                        const sseData = `data: ${JSON.stringify({ text: toolResponseText })}\n\n`;
                                        controller.enqueue(encoder.encode(sseData));
                                    }
                                } catch (toolErr) {
                                    logger.error('Tool execution error in stream', toolErr);
                                    toolResponseText = "Ett fel uppstod när jag försökte använda ett verktyg. Försök igen.";
                                    const sseData = `data: ${JSON.stringify({ text: toolResponseText })}\n\n`;
                                    controller.enqueue(encoder.encode(sseData));
                                    fullText = toolResponseText;
                                }
                            }

                            if (fullText && conversationId && userId !== 'anonymous') {
                                // Save final assembled message to database
                                try {
                                    if (!conversationService) {
                                        const supabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
                                            global: { headers: { Authorization: authHeader } }
                                        });
                                        conversationService = new ConversationService(supabaseClient);
                                    }
                                    // Include usedMemories in metadata for transparency
                                    const messageMetadata = usedMemories.length > 0
                                        ? { usedMemories }
                                        : null;
                                    await conversationService.addMessage(conversationId, 'assistant', fullText, null, null, messageMetadata);
                                    // Generate smart title - must await to prevent Edge Function terminating early
                                    await generateSmartTitleIfNeeded(conversationService, supabaseAdmin, conversationId, message, fullText);
                                    void triggerMemoryGenerator(supabaseUrl, supabaseServiceKey, conversationId);

                                    // Log AI decision for BFL compliance (audit trail)
                                    void auditService.logAIDecision({
                                        userId,
                                        companyId: resolvedCompanyId || undefined,
                                        aiProvider: 'gemini',
                                        aiModel: effectiveModel || 'gemini-3-flash-preview',
                                        aiFunction: 'chat_response',
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
                                    logger.error('Failed to save message to DB', dbError);
                                }
                            }
                            // Send used memories for transparency before DONE
                            if (usedMemories.length > 0) {
                                const memoriesData = `data: ${JSON.stringify({ usedMemories })}\n\n`;
                                controller.enqueue(encoder.encode(memoriesData));
                            }
                            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                        } catch (err) {
                            logger.error('Stream processing error', err);
                            controller.error(err);
                        } finally {
                            controller.close();
                        }
                    }
                });

                return new Response(responseStream, {
                    headers: {
                        ...responseHeaders,
                        "Content-Type": "text/event-stream",
                        "Cache-Control": "no-cache",
                        "Connection": "keep-alive",
                    }
                });
            } catch (err) {
                // Re-throw rate limit errors to be handled by the outer catch block
                if (err instanceof GeminiRateLimitError) {
                    throw err;
                }
                console.error('[STREAMING] Streaming failed, falling back to non-streaming:', err);
                logger.error('Gemini streaming initiation failed', err);
                // Fallback to non-streaming or error response
            }
        } else {
            console.log('[STREAMING] Provider is not gemini, skipping streaming. Provider:', provider);
        }

        // OpenAI or Fallback
        const geminiResponse = await (provider === 'openai'
            ? sendMessageToOpenAI(finalMessage, primaryImage, imagePages, history)
            : sendMessageToGemini(finalMessage, geminiFileData, history, undefined, undefined, { disableTools }));

        // Handle Tool Calls (Non-streaming fallback)
        if (geminiResponse.toolCall) {
            const { tool, args } = geminiResponse.toolCall;
            logger.info(`Executing tool: ${tool}`, { args });

            const supabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
                global: { headers: { Authorization: req.headers.get('Authorization')! } }
            });

            const fortnoxConfig = {
                clientId: Deno.env.get('FORTNOX_CLIENT_ID') ?? '',
                clientSecret: Deno.env.get('FORTNOX_CLIENT_SECRET') ?? '',
                redirectUri: '',
            };
            const fortnoxService = new FortnoxService(fortnoxConfig, supabaseClient, userId);

            let toolResult: any;
            let responseText = "";

            try {
                switch (tool) {
                    case 'conversation_search': {
                        if (shouldSkipHistorySearch(message)) {
                            const directResponse = await sendMessageToGemini(finalMessage, geminiFileData, history, undefined, undefined, { disableTools: true });
                            responseText = directResponse.text || "Jag kan hjälpa dig att sammanfatta redovisningen, men jag behöver mer data.";
                            break;
                        }
                        const searchQuery = (args as { query: string }).query;
                        const searchResults = await searchConversationHistory(
                            supabaseAdmin,
                            userId,
                            resolvedCompanyId,
                            searchQuery,
                            5
                        );

                        if (searchResults.length === 0) {
                            // No results - respond naturally
                            const noResultsPrompt = `Jag sökte igenom tidigare konversationer efter "${searchQuery}" men hittade inget relevant. Svara på användarens fråga så gott du kan utan tidigare kontext: "${message}"`;
                            const noResultsResponse = await sendMessageToGemini(noResultsPrompt, undefined, history);
                            responseText = noResultsResponse.text || `Jag hittade tyvärr inget i tidigare konversationer som matchar "${searchQuery}". Kan du förtydliga vad du letar efter?`;
                        } else {
                            // Format results as context for AI
                            const contextLines = searchResults.map(r => {
                                const title = r.conversation_title || 'Konversation';
                                return `[${title}]: ${r.snippet}`;
                            });

                            // Send context back to Gemini for natural response
                            const contextPrompt = `SÖKRESULTAT FRÅN TIDIGARE KONVERSATIONER:\n${contextLines.join('\n')}\n\nAnvänd denna kontext för att svara naturligt på användarens fråga: "${message}"`;
                            const followUp = await sendMessageToGemini(contextPrompt, undefined, history);
                            responseText = followUp.text || formatHistoryResponse(searchQuery, searchResults, []);
                        }
                        break;
                    }
                    case 'recent_chats': {
                        if (shouldSkipHistorySearch(message)) {
                            const directResponse = await sendMessageToGemini(finalMessage, geminiFileData, history, undefined, undefined, { disableTools: true });
                            responseText = directResponse.text || "Jag kan hjälpa dig att sammanfatta redovisningen, men jag behöver mer data.";
                            break;
                        }
                        const limit = (args as { limit?: number }).limit || 5;
                        const recentConversations = await getRecentConversations(
                            supabaseAdmin,
                            userId,
                            resolvedCompanyId,
                            limit
                        );

                        if (recentConversations.length === 0) {
                            responseText = "Du har inga tidigare konversationer ännu.";
                        } else {
                            // Format for AI context
                            const contextLines = recentConversations.map(c => {
                                const title = c.title || 'Konversation';
                                const summary = c.summary ? ` - ${c.summary}` : '';
                                return `- ${title}${summary}`;
                            });

                            const contextPrompt = `SENASTE KONVERSATIONER:\n${contextLines.join('\n')}\n\nGe en kort överblick baserat på dessa konversationer för att svara på: "${message}"`;
                            const followUp = await sendMessageToGemini(contextPrompt, undefined, history);
                            responseText = followUp.text || formatHistoryResponse(message, [], recentConversations);
                        }
                        break;
                    }
                    case 'web_search': {
                        const webResults = await fetchWebSearchResults(args as Record<string, unknown>, authHeader);
                        if (!webResults || webResults.results.length === 0) {
                            const noResultsPrompt = `Jag hittade inga tillförlitliga webbkällor via webbsökning för frågan. Svara ändå så gott du kan, men var tydlig med osäkerhet och be om förtydligande vid behov. Fråga: "${message}"`;
                            const followUp = await sendMessageToGemini(noResultsPrompt, undefined, history, undefined, undefined, { disableTools: true });
                            responseText = followUp.text || "Jag hittade tyvärr inga tillförlitliga källor just nu.";
                        } else {
                            const contextPrompt = `WEBBSÖKRESULTAT (uppdaterade, officiella källor):\n${formatWebSearchContext(webResults)}\n\nAnvänd dessa källor för att svara på användarens fråga. Redovisa källa och datum i svaret. Fråga: "${message}"`;
                            const followUp = await sendMessageToGemini(contextPrompt, undefined, history, undefined, undefined, { disableTools: true });
                            responseText = followUp.text || "Jag kunde inte sammanställa ett svar från webbkällorna.";
                        }
                        break;
                    }
                    case 'create_invoice':
                        return new Response(JSON.stringify({ type: 'json', data: args }), {
                            status: 200, headers: { ...responseHeaders, "Content-Type": "application/json" }
                        });
                    case 'get_customers':
                        toolResult = await fortnoxService.getCustomers();
                        responseText = `Här är dina kunder: ${toolResult.Customers.map((c: any) => c.Name).join(', ')}`;
                        break;
                    case 'get_articles':
                        toolResult = await fortnoxService.getArticles();
                        responseText = `Här är dina artiklar: ${toolResult.Articles.map((a: any) => a.Description).join(', ')}`;
                        break;
                    case 'get_suppliers':
                        toolResult = await fortnoxService.getSuppliers();
                        responseText = toolResult.Suppliers?.length > 0
                            ? `Här är dina leverantörer:\n${toolResult.Suppliers.map((s: any) => `- ${s.Name} (nr ${s.SupplierNumber}${s.OrganisationNumber ? `, org: ${s.OrganisationNumber}` : ''})`).join('\n')}`
                            : 'Inga leverantörer hittades i Fortnox.';
                        break;
                    case 'get_vouchers': {
                        const vArgs = args as GetVouchersArgs;
                        toolResult = await fortnoxService.getVouchers(vArgs.financial_year, vArgs.series);
                        const vouchers = toolResult.Vouchers || [];
                        responseText = vouchers.length > 0
                            ? `Hittade ${vouchers.length} verifikationer:\n${vouchers.slice(0, 10).map((v: any) => `- ${v.VoucherSeries}${v.VoucherNumber}: ${v.Description || 'Ingen beskrivning'} (${v.TransactionDate})`).join('\n')}${vouchers.length > 10 ? `\n...och ${vouchers.length - 10} till` : ''}`
                            : 'Inga verifikationer hittades.';
                        break;
                    }
                    case 'create_supplier': {
                        const csArgs = args as CreateSupplierArgs;
                        toolResult = await fortnoxService.createSupplier({
                            Name: csArgs.name,
                            OrganisationNumber: csArgs.org_number || undefined,
                            Email: csArgs.email || undefined,
                        } as any);
                        const supplier = toolResult.Supplier || toolResult;
                        responseText = `Leverantör skapad i Fortnox!\n- Namn: ${supplier.Name || csArgs.name}\n- Leverantörsnr: ${supplier.SupplierNumber || 'tilldelas'}`;
                        // Audit log
                        void auditService.log({
                            userId,
                            companyId: resolvedCompanyId || undefined,
                            actorType: 'ai',
                            action: 'create',
                            resourceType: 'supplier',
                            resourceId: supplier.SupplierNumber || '',
                            newState: supplier,
                        });
                        break;
                    }
                    case 'create_supplier_invoice': {
                        const siArgs = args as CreateSupplierInvoiceArgs;
                        const vatMultiplier = 1 + (siArgs.vat_rate / 100);
                        const netAmount = Math.round((siArgs.total_amount / vatMultiplier) * 100) / 100;
                        const vatAmount = Math.round((siArgs.total_amount - netAmount) * 100) / 100;

                        toolResult = await fortnoxService.createSupplierInvoice({
                            SupplierNumber: siArgs.supplier_number,
                            InvoiceNumber: siArgs.invoice_number || undefined,
                            InvoiceDate: new Date().toISOString().slice(0, 10),
                            DueDate: siArgs.due_date || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
                            Total: siArgs.total_amount,
                            VAT: vatAmount,
                            VATType: 'NORMAL',
                            AccountingMethod: 'ACCRUAL',
                            SupplierInvoiceRows: [
                                { Account: siArgs.account, Debit: netAmount, Credit: 0 },
                                { Account: 2640, Debit: vatAmount, Credit: 0 },
                                { Account: 2440, Debit: 0, Credit: siArgs.total_amount },
                            ],
                        } as any);
                        responseText = `Leverantörsfaktura skapad i Fortnox!\n- Belopp: ${siArgs.total_amount} kr (${netAmount} + ${vatAmount} moms)\n- Konto: ${siArgs.account} (${siArgs.description})\n- Förfallodatum: ${siArgs.due_date || '30 dagar'}`;
                        void auditService.log({
                            userId,
                            companyId: resolvedCompanyId || undefined,
                            actorType: 'ai',
                            action: 'create',
                            resourceType: 'supplier_invoice',
                            newState: toolResult,
                        });
                        break;
                    }
                    case 'export_journal_to_fortnox': {
                        const ejArgs = args as ExportJournalToFortnoxArgs;
                        // Fetch the journal entry from DB
                        const { data: journalEntry, error: jeError } = await supabaseAdmin
                            .from('journal_entries')
                            .select('*')
                            .eq('verification_id', ejArgs.journal_entry_id)
                            .maybeSingle();

                        if (jeError || !journalEntry) {
                            responseText = `Kunde inte hitta verifikat ${ejArgs.journal_entry_id} i databasen.`;
                            break;
                        }

                        const entries = typeof journalEntry.entries === 'string'
                            ? JSON.parse(journalEntry.entries)
                            : journalEntry.entries;

                        const voucherRows = entries.map((e: any) => ({
                            Account: e.account,
                            Debit: e.debit || 0,
                            Credit: e.credit || 0,
                            Description: e.accountName || journalEntry.description,
                        }));

                        toolResult = await fortnoxService.createVoucher({
                            Description: `${journalEntry.description} (${ejArgs.journal_entry_id})`,
                            TransactionDate: new Date().toISOString().slice(0, 10),
                            VoucherSeries: 'A',
                            VoucherRows: voucherRows,
                        } as any);
                        const voucher = toolResult.Voucher || toolResult;
                        responseText = `Verifikat exporterat till Fortnox!\n- Fortnox-verifikat: ${voucher.VoucherSeries || 'A'}-${voucher.VoucherNumber || '?'}\n- Ursprungligt ID: ${ejArgs.journal_entry_id}`;
                        void auditService.log({
                            userId,
                            companyId: resolvedCompanyId || undefined,
                            actorType: 'ai',
                            action: 'export',
                            resourceType: 'voucher',
                            resourceId: ejArgs.journal_entry_id,
                            newState: voucher,
                        });
                        break;
                    }
                    case 'book_supplier_invoice': {
                        const bsiArgs = args as BookSupplierInvoiceArgs;
                        toolResult = await fortnoxService.bookSupplierInvoice(bsiArgs.invoice_number);
                        responseText = `Leverantörsfaktura ${bsiArgs.invoice_number} är nu bokförd i Fortnox.`;
                        void auditService.log({
                            userId,
                            companyId: resolvedCompanyId || undefined,
                            actorType: 'ai',
                            action: 'update',
                            resourceType: 'supplier_invoice',
                            resourceId: bsiArgs.invoice_number,
                        });
                        break;
                    }
                    case 'create_journal_entry': {
                        const journalArgs = args as CreateJournalEntryArgs;
                        const { type: txType, gross_amount, vat_rate, description: txDescription, is_roaming } = journalArgs;

                        // Calculate net and VAT amounts with öre precision
                        const vatMultiplier = 1 + (vat_rate / 100);
                        const netAmount = roundToOre(gross_amount / vatMultiplier);
                        const vatAmount = roundToOre(gross_amount - netAmount);

                        // Generate journal entries using existing services
                        const entries = txType === 'revenue'
                            ? createSalesJournalEntries(netAmount, vatAmount, vat_rate, is_roaming ?? false)
                            : createCostJournalEntries(netAmount, vatAmount, vat_rate, txDescription);

                        // Validate balance
                        const validation = validateJournalBalance(entries);

                        // Generate verification ID
                        const period = new Date().toISOString().slice(0, 7); // YYYY-MM
                        let verificationId: string;
                        try {
                            const { data, error: rpcError } = await supabaseAdmin.rpc('get_next_verification_id', {
                                p_period: period,
                                p_company_id: resolvedCompanyId || 'default'
                            });
                            if (rpcError || !data) {
                                // Fallback if RPC not yet deployed
                                verificationId = generateVerificationId(period, Date.now() % 1000);
                            } else {
                                verificationId = data;
                            }
                        } catch {
                            verificationId = generateVerificationId(period, Date.now() % 1000);
                        }

                        // Save to journal_entries table
                        try {
                            await supabaseAdmin.from('journal_entries').insert({
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
                                is_balanced: validation.balanced
                            });
                        } catch (dbErr) {
                            logger.warn('Could not save journal entry to database', dbErr);
                        }

                        // Build metadata for chat display
                        const journalMetadata = {
                            type: 'journal_entry',
                            verification_id: verificationId,
                            entries,
                            validation,
                            transaction: { type: txType, gross_amount, vat_rate, description: txDescription }
                        };

                        // Format response text
                        const typeLabel = txType === 'revenue' ? 'Intäkt' : 'Kostnad';
                        const entryLines = entries.map((e: any) =>
                            `| ${e.account} | ${e.accountName} | ${e.debit > 0 ? roundToOre(e.debit).toFixed(2) : '—'} | ${e.credit > 0 ? roundToOre(e.credit).toFixed(2) : '—'} |`
                        ).join('\n');

                        responseText = `Verifikat **${verificationId}** skapat!\n\n` +
                            `**${typeLabel} ${gross_amount.toFixed(2)} kr inkl moms (${vat_rate}%)**\n\n` +
                            `| Konto | Kontonamn | Debet | Kredit |\n` +
                            `|-------|-----------|-------|--------|\n` +
                            `${entryLines}\n` +
                            `| | **Summa** | **${validation.totalDebit.toFixed(2)}** | **${validation.totalCredit.toFixed(2)}** |\n\n` +
                            (validation.balanced ? 'Bokföringen är balanserad.' : 'Varning: Bokföringen är INTE balanserad!');

                        // Save message with metadata for UI rendering
                        if (conversationId && conversationService) {
                            try {
                                await conversationService.addMessage(conversationId, 'assistant', responseText, null, null, journalMetadata);
                            } catch (msgErr) {
                                logger.warn('Could not save journal message', msgErr);
                            }
                        }

                        // Return as journal_entry type for rich UI rendering
                        return new Response(JSON.stringify({
                            type: 'text',
                            data: responseText,
                            metadata: journalMetadata,
                            usedMemories: usedMemories.length > 0 ? usedMemories : undefined
                        }), {
                            headers: { ...responseHeaders, "Content-Type": "application/json" }
                        });
                    }
                }
            } catch (err) {
                logger.error('Tool execution failed', err);
                if (tool === 'conversation_search' || tool === 'recent_chats') {
                    responseText = "Jag kunde inte söka i tidigare konversationer just nu.";
                } else if (tool === 'web_search') {
                    responseText = "Jag kunde inte hämta uppdaterad information från webben just nu.";
                } else if (tool === 'create_journal_entry') {
                    responseText = "Ett fel uppstod när verifikatet skulle skapas. Försök igen.";
                } else {
                    responseText = `Ett fel uppstod när jag försökte nå Fortnox (${tool}). ${err instanceof Error ? err.message : 'Försök igen.'}`;
                }
            }

            return new Response(JSON.stringify({
                type: 'text',
                data: responseText,
                usedMemories: usedMemories.length > 0 ? usedMemories : undefined
            }), {
                headers: { ...responseHeaders, "Content-Type": "application/json" }
            });
        }

        let responseText = geminiResponse.text || '';
        let skillDraft: SkillDraft | null = null;
        if (isSkillAssist && responseText) {
            const parsed = extractSkillDraft(responseText);
            responseText = parsed.cleanText;
            skillDraft = parsed.draft;
        }

        // Save AI response (Non-streaming fallback)
        if (conversationId && userId !== 'anonymous' && responseText) {
            try {
                if (!conversationService) {
                    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
                        global: { headers: { Authorization: authHeader } }
                    });
                    conversationService = new ConversationService(supabaseClient);
                }
                const messageMetadata = {
                    ...(usedMemories.length > 0 ? { usedMemories } : {}),
                    ...(skillDraft ? { skillDraft } : {})
                };
                await conversationService.addMessage(
                    conversationId,
                    'assistant',
                    responseText,
                    null,
                    null,
                    Object.keys(messageMetadata).length > 0 ? messageMetadata : null
                );
                await generateSmartTitleIfNeeded(conversationService, supabaseAdmin, conversationId, message, responseText);
                void triggerMemoryGenerator(supabaseUrl, supabaseServiceKey, conversationId);

                // Log AI decision for BFL compliance (audit trail)
                void auditService.logAIDecision({
                    userId,
                    companyId: resolvedCompanyId || undefined,
                    aiProvider: provider === 'openai' ? 'openai' : 'gemini',
                    aiModel: provider === 'openai' ? 'gpt-4o' : 'gemini-3-flash-preview',
                    aiFunction: 'chat_response',
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
                logger.error('Failed to save non-streamed AI response', saveError);
            }
        }

        return new Response(JSON.stringify({
            type: 'text',
            data: responseText,
            usedMemories: usedMemories.length > 0 ? usedMemories : undefined,
            skillDraft: skillDraft ?? undefined
        }), {
            headers: { ...responseHeaders, "Content-Type": "application/json" }
        });

    } catch (error) {
        logger.error('Edge Function Error', error);

        // Handle Google API rate limit errors with 429 response
        if (error instanceof GeminiRateLimitError) {
            const retryAfter = error.retryAfter || 30;
            return new Response(JSON.stringify({
                error: 'google_rate_limit',
                message: 'Google API är tillfälligt överbelastad. Försök igen om en stund.',
                retryAfter
            }), {
                status: 429,
                headers: {
                    ...responseHeaders,
                    "Content-Type": "application/json",
                    "Retry-After": String(retryAfter)
                }
            });
        }

        return new Response(JSON.stringify({ error: 'internal_server_error' }), {
            status: 500, headers: { ...responseHeaders, "Content-Type": "application/json" }
        });
    }
});

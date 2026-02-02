// Supabase Edge Function for Gemini Chat
/// <reference path="../types/deno.d.ts" />

import { sendMessageToGemini, sendMessageStreamToGemini, generateConversationTitle, GeminiRateLimitError, type FileData, type ConversationSearchArgs, type RecentChatsArgs, type CreateJournalEntryArgs } from "../../services/GeminiService.ts";
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

// For transparency: track which memories were used in the response
type UsedMemory = {
    id: string;
    category: string;
    preview: string;  // First 50 chars of content
    reason?: string;
};

type HistorySearchResult = {
    conversation_id: string;
    conversation_title: string | null;
    snippet: string;
    created_at: string;
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
        "SYSTEM CONTEXT: Användarminnen att använda naturligt (nämn aldrig att du minns).",
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
        reason: item.reason
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
    const mentionsRecent = /(förra veckan|förra månaden|förra kvartalet|senast|sist|tidigare|förut)/.test(normalized);
    const mentionsTalk = /(pratade|diskuterade|nämnde|sade|sa)/.test(normalized);
    const mentionsWe = /\bvi\b/.test(normalized);
    const mentionsHowWeDid = /(hur\s+.*(bokförde|gjorde|löste)|bokförde vi)/.test(normalized);

    const search = mentionsTalk || mentionsHowWeDid || (mentionsRecent && mentionsWe);
    const recent = mentionsRecent && (mentionsWe || mentionsTalk);

    return { search, recent };
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
        let { action, message, fileData, fileDataPages, documentText, history, conversationId, companyId, fileUrl, fileName, vatReportContext, model, titleContext }: RequestBody = await req.json();
        
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

        const historyIntent = detectHistoryIntent(message);
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

        const memoryRequest = extractMemoryRequest(message);
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

        if (!vatReportContext && conversationId) {
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

        if (vatReportContext) {
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
        if (safeDocumentText) {
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
                } else if (userMemories && userMemories.length > 0) {
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

        // Handle Gemini Streaming
        if (provider === 'gemini') {
            console.log('[STREAMING] Starting Gemini streaming... (model:', effectiveModel || 'default', ')');
            try {
                const stream = await sendMessageStreamToGemini(finalMessage, geminiFileData, history, undefined, effectiveModel);
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
                                    } else if (toolName === 'recent_chats') {
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
                                    } else {
                                        // For other tools (Fortnox), send metadata for client handling
                                        const sseToolData = `data: ${JSON.stringify({ toolCall: { tool: toolName, args: toolArgs } })}\n\n`;
                                        controller.enqueue(encoder.encode(sseToolData));
                                    }

                                    // Stream the tool response as text
                                    if (toolResponseText) {
                                        fullText = toolResponseText;
                                        const sseData = `data: ${JSON.stringify({ text: toolResponseText })}\n\n`;
                                        controller.enqueue(encoder.encode(sseData));
                                    }
                                } catch (toolErr) {
                                    logger.error('Tool execution error in stream', toolErr);
                                    toolResponseText = "Ett fel uppstod när jag försökte söka i tidigare konversationer.";
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
            : sendMessageToGemini(finalMessage, geminiFileData, history));

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
            const fortnoxService = new FortnoxService(fortnoxConfig, supabaseClient);

            let toolResult: any;
            let responseText = "";

            try {
                switch (tool) {
                    case 'conversation_search': {
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
                responseText = tool === 'conversation_search' || tool === 'recent_chats'
                    ? "Jag kunde inte söka i tidigare konversationer just nu."
                    : tool === 'create_journal_entry'
                    ? "Ett fel uppstod när verifikatet skulle skapas. Försök igen."
                    : "Ett fel uppstod när jag försökte nå Fortnox.";
            }

            return new Response(JSON.stringify({
                type: 'text',
                data: responseText,
                usedMemories: usedMemories.length > 0 ? usedMemories : undefined
            }), {
                headers: { ...responseHeaders, "Content-Type": "application/json" }
            });
        }

        // Save AI response (Non-streaming fallback)
        if (conversationId && userId !== 'anonymous' && geminiResponse.text) {
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
                await conversationService.addMessage(conversationId, 'assistant', geminiResponse.text, null, null, messageMetadata);
                await generateSmartTitleIfNeeded(conversationService, supabaseAdmin, conversationId, message, geminiResponse.text);
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
                        response_length: geminiResponse.text.length,
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
            data: geminiResponse.text,
            usedMemories: usedMemories.length > 0 ? usedMemories : undefined
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

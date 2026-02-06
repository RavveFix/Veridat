/// <reference path="../types/deno.d.ts" />

import { createClient } from "npm:@supabase/supabase-js@2";
import { GoogleGenerativeAI } from "npm:@google/generative-ai@0.21.0";
import { createLogger } from "../../services/LoggerService.ts";
import { createOptionsResponse, getCorsHeaders } from "../../services/CorsService.ts";
import { extractGoogleRateLimitInfo } from "../../services/GeminiService.ts";
import { RateLimiterService } from "../../services/RateLimiterService.ts";
import { getRateLimitConfigForPlan, getUserPlan } from "../../services/PlanService.ts";
import { CompanyMemoryService, mergeCompanyMemory } from "../../services/CompanyMemoryService.ts";

const logger = createLogger("memory-generator");

// Delay before Gemini API call to avoid concurrent requests with main chat
const GEMINI_API_DELAY_MS = 2500; // 2.5 seconds
const RATE_LIMIT_ENDPOINT = "memory-generator";

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const ALLOWED_CATEGORIES = new Set([
    "work_context",
    "preferences",
    "history",
    "top_of_mind"
]);

const ALLOWED_TIERS = new Set([
    "profile",
    "project",
    "episodic",
    "fact"
]);

const MEMORY_SYSTEM_INSTRUCTION = `Du är en svensk AI-assistent som sammanfattar konversationer och extraherar relevanta minnen.
Svara alltid med ett ENDAST giltigt JSON-objekt utan extra text eller markdown.
JSON måste vara strikt (endast dubbla citattecken, inga trailing commas).`;

const MEMORY_REPAIR_INSTRUCTION = `Du är en strikt JSON-reparatör.
Returnera ENDAST giltig JSON utan extra text eller markdown.`;

const MEMORY_PROMPT_HEADER = `Analysera konversationen och extrahera:

1. EN kort sammanfattning (max 100 ord)
2. Viktiga fakta om användaren/företaget som bör sparas som "minnen"

Svara i JSON:
{
  "summary": "...",
  "memories": [
    {
      "category": "work_context|preferences|history|top_of_mind",
      "content": "...",
      "tier": "profile|project|episodic|fact",
      "importance": 0.0-1.0,
      "ttl_days": 30
    }
  ]
}

Kategorier:
- work_context: Fakta om företaget, org.nr, bransch, kontaktinfo
- preferences: Hur användaren vill ha saker (avrundning, format, etc)
- history: Viktiga händelser, tidigare analyser
- top_of_mind: Pågående projekt, aktuella frågor

Tier:
- profile: Stabilt om användarens preferenser/identitet
- fact: Stabil fakta om bolaget (kan behöva uppdateras)
- episodic: Händelser/utfall som är historiska
- project: Pågående arbete (kortlivat)

VIKTIGT:
- Extrahera ENDAST specifika, unika fakta som är värda att minnas
- Undvik generella påståenden som "Användaren gillar att ställa frågor"
- Fokusera på: specifika org.nummer, belopp, perioder, namn, preferenser
- Max 2-3 minnen per kategori
- Varje minne ska vara minst 20 tecken långt
- Ange importance (0.4-1.0) baserat på nytta
- Ange ttl_days endast om minnet är kortlivat (t.ex. top_of_mind ~30 dagar, history ~180 dagar)
`;

const MEMORY_REPAIR_PROMPT_HEADER = `Reparera texten till giltig JSON enligt exakt schema:
{
  "summary": "...",
  "memories": [
    {
      "category": "work_context|preferences|history|top_of_mind",
      "content": "...",
      "tier": "profile|project|episodic|fact",
      "importance": 0.0-1.0,
      "ttl_days": 30
    }
  ]
}

Text att reparera:`;

const MAX_MESSAGES = 60;
const MAX_MESSAGE_CHARS = 900;
const MAX_MEMORIES = 8;
const MIN_MEMORY_LENGTH = 20;
const MAX_MEMORIES_PER_CATEGORY = 3;
const MIN_IMPORTANCE = 0.4;
const MAX_TTL_DAYS = 365;

type MemoryEntry = {
    category?: string;
    content?: string;
    tier?: string;
    importance?: number;
    ttl_days?: number;
    confidence?: number;
};

type MemoryResponse = {
    summary?: string;
    memories?: MemoryEntry[];
};

type ConversationRow = {
    id: string;
    user_id: string;
    company_id: string | null;
};

function truncateMessage(content: string): string {
    const trimmed = content.trim();
    if (trimmed.length <= MAX_MESSAGE_CHARS) return trimmed;
    return `${trimmed.slice(0, MAX_MESSAGE_CHARS)}…`;
}

function extractJson(text: string): string | null {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    return text.slice(start, end + 1);
}

function stripCodeFences(text: string): string {
    let trimmed = text.trim();
    if (trimmed.startsWith("```")) {
        trimmed = trimmed.replace(/^```(?:json)?/i, "").trim();
        if (trimmed.endsWith("```")) {
            trimmed = trimmed.slice(0, -3).trim();
        }
    }
    return trimmed;
}

function repairJsonText(text: string): string {
    let repaired = text.trim();
    repaired = repaired.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
    // Remove trailing commas
    repaired = repaired.replace(/,\s*([}\]])/g, "$1");
    // Insert missing commas between object blocks (common LLM slip)
    repaired = repaired.replace(/}\s*{/g, "},{");
    return repaired;
}

function parseMemoryResponse(text: string): MemoryResponse | null {
    const candidates: string[] = [];
    const stripped = stripCodeFences(text);
    candidates.push(stripped);

    const extracted = extractJson(stripped);
    if (extracted && extracted !== stripped) {
        candidates.push(extracted);
    }

    const repaired = repairJsonText(extracted ?? stripped);
    if (repaired !== (extracted ?? stripped)) {
        candidates.push(repaired);
    }

    for (const candidate of candidates) {
        try {
            return JSON.parse(candidate) as MemoryResponse;
        } catch {
            continue;
        }
    }

    return null;
}

async function repairMemoryResponse(
    model: { generateContent: (request: unknown) => Promise<{ response: { text: () => string } }> },
    rawText: string
): Promise<string | null> {
    const snippet = rawText.length > 4000 ? `${rawText.slice(0, 4000)}…` : rawText;
    const repairPrompt = `${MEMORY_REPAIR_PROMPT_HEADER}\n${snippet}`;

    try {
        const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: repairPrompt }] }],
            generationConfig: {
                temperature: 0,
                maxOutputTokens: 1024,
                responseMimeType: "application/json"
            }
        });
        return result.response.text();
    } catch {
        return null;
    }
}

function normalizeContent(content: string): string {
    return content.toLowerCase().replace(/\s+/g, " ").trim();
}

function getEnv(keys: string[]): string | undefined {
    for (const key of keys) {
        const value = Deno.env.get(key);
        if (value && value.trim()) return value.trim();
    }
    return undefined;
}

const CATEGORY_TIER_MAP: Record<string, string> = {
    work_context: "fact",
    preferences: "profile",
    history: "episodic",
    top_of_mind: "project"
};

const CATEGORY_DEFAULT_IMPORTANCE: Record<string, number> = {
    work_context: 0.75,
    preferences: 0.7,
    history: 0.6,
    top_of_mind: 0.6
};

const GENERIC_MEMORY_PATTERNS: RegExp[] = [
    /^hej/i,
    /^hejsan/i,
    /^tack/i,
    /^ok(ey)?\b/i,
    /^bra\b/i,
    /^toppen\b/i,
    /^perfekt\b/i
];

function toNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return null;
}

function clampNumber(value: unknown, min: number, max: number): number | null {
    const parsed = toNumber(value);
    if (parsed === null) return null;
    return Math.min(max, Math.max(min, parsed));
}

function resolveTier(category?: string, tier?: string): string {
    if (tier && ALLOWED_TIERS.has(tier)) return tier;
    if (category && CATEGORY_TIER_MAP[category]) return CATEGORY_TIER_MAP[category];
    return "fact";
}

function resolveImportance(category?: string, importance?: number): number {
    const fallback = category ? (CATEGORY_DEFAULT_IMPORTANCE[category] ?? 0.6) : 0.6;
    const normalized = clampNumber(importance, 0, 1);
    return normalized ?? fallback;
}

function resolveTtlDays(ttlDays?: number): number | null {
    const normalized = clampNumber(ttlDays, 1, MAX_TTL_DAYS);
    if (normalized === null) return null;
    return Math.round(normalized);
}

function defaultTtlDays(category?: string): number | null {
    if (category === "top_of_mind") return 30;
    if (category === "history") return 180;
    return null;
}

function computeExpiry(ttlDays?: number | null): string | null {
    if (!ttlDays || ttlDays <= 0) return null;
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
    return expiresAt.toISOString();
}

function isGenericMemory(content: string): boolean {
    const normalized = content.trim().toLowerCase();
    if (normalized.length >= 25) return false;
    return GENERIC_MEMORY_PATTERNS.some((pattern) => pattern.test(normalized));
}

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return createOptionsResponse();
    }

    const corsHeaders = getCorsHeaders();

    try {
        const supabaseUrl = getEnv(["SUPABASE_URL", "SB_SUPABASE_URL", "API_URL"]);
        const supabaseServiceKey = getEnv(["SUPABASE_SERVICE_ROLE_KEY", "SB_SERVICE_ROLE_KEY", "SERVICE_ROLE_KEY", "SECRET_KEY"]);
        const geminiKey = Deno.env.get("GEMINI_API_KEY");

        if (!supabaseUrl || !supabaseServiceKey) {
            return new Response(JSON.stringify({ error: "Missing Supabase configuration" }), {
                status: 500,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        if (!geminiKey) {
            return new Response(JSON.stringify({ error: "GEMINI_API_KEY not configured" }), {
                status: 500,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
        if (!authHeader) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), {
                status: 401,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        const { conversation_id } = await req.json() as { conversation_id?: string };
        if (!conversation_id) {
            return new Response(JSON.stringify({ error: "conversation_id is required" }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        const token = authHeader.replace(/^Bearer\s+/i, "");
        const { data: { user }, error: userError } = await supabase.auth.getUser(token);
        if (userError || !user) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), {
                status: 401,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        const plan = await getUserPlan(supabase, user.id);
        const rateLimiter = new RateLimiterService(supabase, getRateLimitConfigForPlan(plan));
        const rateLimit = await rateLimiter.checkAndIncrement(user.id, RATE_LIMIT_ENDPOINT);

        if (!rateLimit.allowed) {
            return new Response(
                JSON.stringify({
                    error: "rate_limit_exceeded",
                    message: rateLimit.message,
                    remaining: rateLimit.remaining,
                    resetAt: rateLimit.resetAt.toISOString()
                }),
                {
                    status: 429,
                    headers: {
                        ...corsHeaders,
                        "Content-Type": "application/json",
                        "X-RateLimit-Remaining": String(rateLimit.remaining),
                        "X-RateLimit-Reset": rateLimit.resetAt.toISOString()
                    }
                }
            );
        }

        const { data: conversation, error: conversationError } = await supabase
            .from("conversations")
            .select("id, user_id, company_id")
            .eq("id", conversation_id)
            .maybeSingle() as { data: ConversationRow | null; error: Error | null };

        if (conversationError) throw conversationError;
        if (!conversation) {
            return new Response(JSON.stringify({ error: "Conversation not found" }), {
                status: 404,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        if (conversation.user_id !== user.id) {
            return new Response(JSON.stringify({ error: "Forbidden" }), {
                status: 403,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        if (!conversation.company_id) {
            return new Response(JSON.stringify({ error: "Conversation has no company_id" }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        const { data: messages, error: messagesError } = await supabase
            .from("messages")
            .select("role, content, created_at")
            .eq("conversation_id", conversation_id)
            .order("created_at", { ascending: false })
            .limit(MAX_MESSAGES);

        if (messagesError) throw messagesError;

        const orderedMessages = (messages || []).reverse();
        if (orderedMessages.length === 0) {
            return new Response(JSON.stringify({ error: "No messages found" }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        const transcript = orderedMessages
            .map((msg) => `${msg.role}: ${truncateMessage(msg.content)}`)
            .join("\n\n");

        const isEarlyConversation = orderedMessages.length < 10;
        const onboardingHint = isEarlyConversation
            ? '\n\nOBS: Detta verkar vara en tidig konversation (< 10 meddelanden). ' +
              'Prioritera att extrahera grundläggande verksamhetsinfo: ' +
              'företagsnamn, bransch, antal anställda, redovisningsmetod, momsperiod. ' +
              'Sätt importance = 0.9 för dessa.'
            : '';

        const prompt = `${MEMORY_PROMPT_HEADER}${onboardingHint}\nKonversation:\n${transcript}`;

        // Delay to avoid concurrent API calls with main chat response
        logger.debug('Delaying Gemini API call to avoid rate limits', { delayMs: GEMINI_API_DELAY_MS });
        await delay(GEMINI_API_DELAY_MS);

        const genAI = new GoogleGenerativeAI(geminiKey);
        const modelName = Deno.env.get("MEMORY_MODEL") || Deno.env.get("GEMINI_MODEL") || "gemini-2.0-flash";
        const model = genAI.getGenerativeModel({
            model: modelName,
            systemInstruction: MEMORY_SYSTEM_INSTRUCTION
        });
        const repairModel = genAI.getGenerativeModel({
            model: modelName,
            systemInstruction: MEMORY_REPAIR_INSTRUCTION
        });

        const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0,
                maxOutputTokens: 1024,
                responseMimeType: "application/json"
            }
        });

        const responseText = result.response.text();
        let parsed = parseMemoryResponse(responseText);

        if (!parsed) {
            const repairedText = await repairMemoryResponse(repairModel, responseText);
            if (repairedText) {
                parsed = parseMemoryResponse(repairedText);
            }
        }

        if (!parsed) {
            logger.warn("Memory response parse failed", { responseLength: responseText.length });
            return new Response(JSON.stringify({
                success: false,
                summary_updated: false,
                memories_added: 0,
                error: "parse_failed"
            }), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }
        const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
        const memories = Array.isArray(parsed.memories) ? parsed.memories : [];

        if (summary) {
            await supabase
                .from("conversations")
                .update({ summary })
                .eq("id", conversation_id);
        }

        const { data: existingMemories } = await supabase
            .from("user_memories")
            .select("content")
            .eq("user_id", conversation.user_id)
            .eq("company_id", conversation.company_id);

        const { data: removedEdits } = await supabase
            .from("memory_user_edits")
            .select("content")
            .eq("user_id", conversation.user_id)
            .eq("company_id", conversation.company_id)
            .eq("edit_type", "remove");

        const existingSet = new Set(
            (existingMemories || [])
                .map((memory) => normalizeContent(memory.content || ""))
                .filter(Boolean)
        );

        const removedSet = new Set(
            (removedEdits || [])
                .map((edit) => normalizeContent(edit.content || ""))
                .filter(Boolean)
        );

        // Group by category to limit per-category count
        const categoryCount: Record<string, number> = {};

        const inserts = memories
            .map((memory) => {
                const category = typeof memory?.category === "string" ? memory.category.trim() : undefined;
                const content = typeof memory?.content === "string" ? memory.content.trim() : undefined;
                const tierInput = typeof memory?.tier === "string" ? memory.tier.trim() : undefined;
                const tier = resolveTier(category, tierInput);
                const importance = resolveImportance(category, memory?.importance);
                const ttlDays = resolveTtlDays(memory?.ttl_days) ?? defaultTtlDays(category);
                const expiresAt = computeExpiry(ttlDays);
                const confidence = clampNumber(memory?.confidence, 0.3, 1.0) ?? 0.8;

                return {
                    category,
                    content,
                    tier,
                    importance,
                    ttlDays,
                    expiresAt,
                    confidence
                };
            })
            .filter((memory) => {
                // Basic validation
                if (!memory.content || !memory.category || !ALLOWED_CATEGORIES.has(memory.category)) {
                    return false;
                }
                if (!ALLOWED_TIERS.has(memory.tier)) {
                    return false;
                }
                if (isGenericMemory(memory.content)) {
                    return false;
                }
                // Minimum length filter
                if (memory.content.length < MIN_MEMORY_LENGTH) {
                    return false;
                }
                // Minimum importance filter
                if (memory.importance < MIN_IMPORTANCE) {
                    return false;
                }
                // Per-category limit
                const count = categoryCount[memory.category] || 0;
                if (count >= MAX_MEMORIES_PER_CATEGORY) {
                    return false;
                }
                categoryCount[memory.category] = count + 1;
                return true;
            })
            .filter((memory) => {
                const normalized = normalizeContent(memory.content as string);
                if (!normalized || existingSet.has(normalized) || removedSet.has(normalized)) {
                    return false;
                }
                existingSet.add(normalized);
                return true;
            })
            .map((memory) => ({
                user_id: conversation.user_id,
                company_id: conversation.company_id,
                category: memory.category,
                content: memory.content,
                source_conversation_id: conversation_id,
                confidence: memory.confidence,
                memory_tier: memory.tier,
                importance: memory.importance,
                expires_at: memory.expiresAt
            }))
            .slice(0, MAX_MEMORIES);

        if (inserts.length > 0) {
            const { error: insertError } = await supabase
                .from("user_memories")
                .insert(inserts);
            if (insertError) throw insertError;

            // Auto-populate company_memory from work_context memories
            const workContextInserts = inserts.filter((m) => m.category === "work_context");
            if (workContextInserts.length > 0) {
                try {
                    const companyMemoryService = new CompanyMemoryService(supabase);
                    const existing = await companyMemoryService.get(conversation.user_id, conversation.company_id);

                    // Extract company name and org number from memory content
                    const allContent = workContextInserts.map((m) => m.content).join(" ");
                    const orgMatch = allContent.match(/\b(\d{6}-?\d{4})\b/);
                    const patch: Record<string, string> = {};
                    if (orgMatch) patch.org_number = orgMatch[1];

                    // Only update if we found new data and company_memory is sparse
                    if (Object.keys(patch).length > 0 && (!existing?.org_number)) {
                        const merged = mergeCompanyMemory(existing, patch);
                        await companyMemoryService.upsert(conversation.user_id, conversation.company_id, merged);
                        logger.info("Auto-populated company_memory from work_context", { companyId: conversation.company_id });
                    }
                } catch (companyMemoryError) {
                    logger.warn("Failed to auto-populate company_memory", { error: String(companyMemoryError) });
                }
            }
        }

        return new Response(JSON.stringify({
            success: true,
            summary_updated: !!summary,
            memories_added: inserts.length
        }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
    } catch (error) {
        logger.error("Memory generator error", error);

        // Check for Google API rate limit errors
        const rateLimitInfo = extractGoogleRateLimitInfo(error);
        if (rateLimitInfo.isRateLimit) {
            const retryAfter = rateLimitInfo.retryAfter || 30;
            return new Response(JSON.stringify({
                error: 'google_rate_limit',
                message: 'Google API är tillfälligt överbelastad.',
                retryAfter
            }), {
                status: 429,
                headers: {
                    ...getCorsHeaders(),
                    "Content-Type": "application/json",
                    "Retry-After": String(retryAfter)
                }
            });
        }

        const message = error instanceof Error ? error.message : "Unknown error";
        return new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { ...getCorsHeaders(), "Content-Type": "application/json" }
        });
    }
});

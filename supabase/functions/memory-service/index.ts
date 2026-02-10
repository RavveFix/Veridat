/// <reference path="../types/deno.d.ts" />

import { createClient } from "npm:@supabase/supabase-js@2";
import { createLogger } from "../../services/LoggerService.ts";
import {
    createOptionsResponse,
    getCorsHeaders,
    isOriginAllowed,
    createForbiddenOriginResponse
} from "../../services/CorsService.ts";
import { RateLimiterService } from "../../services/RateLimiterService.ts";
import { getRateLimitConfigForPlan, getUserPlan } from "../../services/PlanService.ts";

const logger = createLogger("memory-service");

type MemoryAction =
    | "get_memories"
    | "search_conversations"
    | "get_recent"
    | "add_memory"
    | "remove_memory"
    | "get_memory_items"
    | "add_memory_item"
    | "update_memory_item"
    | "remove_memory_item"
    | "log_memory_usage";

interface MemoryRequest {
    action: MemoryAction;
    company_id?: string;
    query?: string;
    limit?: number;
    before?: string;
    after?: string;
    category?: string;
    status?: string;
    memory_id?: string;
    memory?: Record<string, unknown>;
    patch?: Record<string, unknown>;
    conversation_id?: string;
    skill_run_id?: string;
}

type MemoryRow = {
    id: string;
    category: string;
    content: string;
    updated_at: string | null;
    last_used_at?: string | null;
    created_at?: string | null;
    confidence?: number | null;
    memory_tier?: string | null;
    importance?: number | null;
    expires_at?: string | null;
};

type MemoryItemRow = {
    id: string;
    category: string;
    content: string;
    scope: string;
    memory_type: string;
    status: string;
    metadata?: Record<string, unknown> | null;
    importance?: number | null;
    confidence?: number | null;
    source_type?: string | null;
    source_id?: string | null;
    created_by?: string | null;
    last_used_at?: string | null;
    expires_at?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
};

const ALLOWED_CATEGORIES = new Set([
    "work_context",
    "preferences",
    "history",
    "top_of_mind",
    "user_defined"
]);

const MEMORY_ITEM_SCOPES = new Set([
    "user",
    "company",
    "org"
]);

const MEMORY_ITEM_TYPES = new Set([
    "explicit",
    "inferred",
    "policy"
]);

const MEMORY_ITEM_STATUSES = new Set([
    "draft",
    "approved",
    "active",
    "expired",
    "rejected"
]);

const MEMORY_ITEM_SOURCE_TYPES = new Set([
    "conversation",
    "skill_run",
    "manual",
    "system",
    "import",
    "other"
]);

const MEMORY_ITEM_CREATED_BY = new Set([
    "user",
    "ai",
    "system"
]);

const CATEGORY_TIER_MAP: Record<string, string> = {
    work_context: "fact",
    preferences: "profile",
    history: "episodic",
    top_of_mind: "project",
    user_defined: "profile"
};

const CATEGORY_IMPORTANCE_MAP: Record<string, number> = {
    work_context: 0.8,
    preferences: 0.8,
    history: 0.7,
    top_of_mind: 0.7,
    user_defined: 0.9
};

function normalizeCategory(category?: string): string {
    if (!category) return "user_defined";
    return ALLOWED_CATEGORIES.has(category) ? category : "user_defined";
}

function normalizeEnum(value: string | undefined, allowed: Set<string>, fallback: string): string {
    if (!value) return fallback;
    return allowed.has(value) ? value : fallback;
}

function clamp01(value: number | undefined, fallback: number): number {
    if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
    return Math.min(1, Math.max(0, value));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validateUUID(value: string | undefined, field: string): string {
    const trimmed = value?.trim();
    if (!trimmed) throw new Error(`${field} is required`);
    if (!UUID_RE.test(trimmed)) throw new Error(`${field} must be a valid UUID`);
    return trimmed;
}

function resolveTier(category: string): string {
    return CATEGORY_TIER_MAP[category] || "fact";
}

function resolveImportance(category: string): number {
    return CATEGORY_IMPORTANCE_MAP[category] ?? 0.7;
}

function computeExpiry(category: string): string | null {
    if (category !== "top_of_mind") return null;
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    return expiresAt.toISOString();
}

function formatMemoriesForPrompt(memories: MemoryRow[]): string {
    if (!memories?.length) return "";

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

    return sections
        .filter((section) => section.items.length > 0)
        .map((section) => `**${section.title}**\n${section.items.join("\n")}`)
        .join("\n\n")
        .trim();
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

function getEnv(keys: string[]): string | undefined {
    for (const key of keys) {
        const value = Deno.env.get(key);
        if (value && value.trim()) return value.trim();
    }
    return undefined;
}

Deno.serve(async (req: Request) => {
    const requestOrigin = req.headers.get('origin') || req.headers.get('Origin');

    if (req.method === "OPTIONS") {
        return createOptionsResponse(req);
    }

    if (requestOrigin && !isOriginAllowed(requestOrigin)) {
        return createForbiddenOriginResponse(requestOrigin);
    }

    const corsHeaders = getCorsHeaders(requestOrigin);

    try {
        const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
        if (!authHeader) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), {
                status: 401,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        const supabaseUrl = getEnv(["SUPABASE_URL", "SB_SUPABASE_URL", "API_URL"]);
        const supabaseAnonKey = getEnv(["SUPABASE_ANON_KEY", "SB_SUPABASE_ANON_KEY", "ANON_KEY"]);

        if (!supabaseUrl || !supabaseAnonKey) {
            return new Response(JSON.stringify({ error: "Missing Supabase configuration" }), {
                status: 500,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        const supabase = createClient(supabaseUrl, supabaseAnonKey, {
            global: { headers: { Authorization: authHeader } }
        });

        const token = authHeader.replace(/^Bearer\s+/i, "");
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);
        if (authError || !user) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), {
                status: 401,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        const supabaseServiceKey = getEnv(["SUPABASE_SERVICE_ROLE_KEY", "SB_SERVICE_ROLE_KEY", "SERVICE_ROLE_KEY", "SECRET_KEY"]);
        if (supabaseServiceKey) {
            const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
            const plan = await getUserPlan(supabaseAdmin, user.id);
            const rateLimiter = new RateLimiterService(supabaseAdmin, getRateLimitConfigForPlan(plan));
            const rateLimit = await rateLimiter.checkAndIncrement(user.id, "memory-service");
            if (!rateLimit.allowed) {
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
                            ...corsHeaders,
                            "Content-Type": "application/json",
                            "X-RateLimit-Remaining": String(rateLimit.remaining),
                            "X-RateLimit-Reset": rateLimit.resetAt.toISOString(),
                        },
                    }
                );
            }
        }

        const body = await req.json() as MemoryRequest;
        const {
            action,
            company_id,
            query,
            limit = 10,
            before,
            after,
            category,
            status,
            memory_id,
            memory,
            patch,
            conversation_id,
            skill_run_id
        } = body;

        let result: Record<string, unknown> = {};

        switch (action) {
            case "get_memories": {
                if (!company_id) {
                    throw new Error("company_id is required");
                }

                const { data: memories, error } = await supabase
                    .from("user_memories")
                    .select("id, category, content, updated_at, last_used_at, created_at, confidence, memory_tier, importance, expires_at")
                    .eq("user_id", user.id)
                    .eq("company_id", company_id)
                    .order("category", { ascending: true })
                    .order("updated_at", { ascending: false });

                if (error) throw error;

                const memoryRows = (memories || []) as MemoryRow[];

                result = {
                    memories: formatMemoriesForPrompt(memoryRows),
                    raw: memoryRows
                };
                break;
            }

            case "search_conversations": {
                if (!query) throw new Error("query is required");

                const safeLimit = Math.min(Math.max(limit, 1), 25);

                // 1. Search in messages (full-text search)
                let messageSearchQuery = supabase
                    .from("messages")
                    .select(`
                        id,
                        content,
                        created_at,
                        conversation:conversations!inner(
                            id,
                            title,
                            company_id,
                            user_id
                        )
                    `)
                    .eq("conversation.user_id", user.id)
                    .textSearch("search_vector", query, { type: "websearch", config: "swedish" })
                    .limit(safeLimit);

                if (company_id) {
                    messageSearchQuery = messageSearchQuery.eq("conversation.company_id", company_id);
                }

                // 2. Search in conversation titles and summaries (ILIKE)
                const escapedQuery = query.replace(/[%_]/g, "\\$&");
                let titleSearchQuery = supabase
                    .from("conversations")
                    .select("id, title, summary, created_at, updated_at")
                    .eq("user_id", user.id)
                    .or(`title.ilike.%${escapedQuery}%,summary.ilike.%${escapedQuery}%`)
                    .order("updated_at", { ascending: false })
                    .limit(safeLimit);

                if (company_id) {
                    titleSearchQuery = titleSearchQuery.eq("company_id", company_id);
                }

                // Run both searches in parallel
                const [messageResponse, titleResponse] = await Promise.all([
                    messageSearchQuery,
                    titleSearchQuery
                ]);

                if (messageResponse.error) throw messageResponse.error;
                if (titleResponse.error) throw titleResponse.error;

                // 3. Combine and deduplicate results
                const seenConversationIds = new Set<string>();
                const combinedResults: Array<{
                    conversation_id: string;
                    conversation_title: string | null;
                    snippet: string;
                    created_at: string;
                    match_type: "title" | "message";
                }> = [];

                // Title matches first (prioritized)
                for (const row of titleResponse.data || []) {
                    if (!seenConversationIds.has(row.id)) {
                        seenConversationIds.add(row.id);
                        combinedResults.push({
                            conversation_id: row.id,
                            conversation_title: row.title,
                            snippet: row.summary || "Matchade konversationstitel",
                            created_at: row.updated_at || row.created_at,
                            match_type: "title"
                        });
                    }
                }

                // Then message matches
                for (const row of messageResponse.data || []) {
                    const conv = row.conversation as unknown as { id: string; title: string };
                    if (!seenConversationIds.has(conv.id)) {
                        seenConversationIds.add(conv.id);
                        combinedResults.push({
                            conversation_id: conv.id,
                            conversation_title: conv.title,
                            snippet: extractSnippet(row.content, query),
                            created_at: row.created_at,
                            match_type: "message"
                        });
                    }
                }

                result = {
                    results: combinedResults.slice(0, safeLimit)
                };
                break;
            }

            case "get_recent": {
                const safeLimit = Math.min(Math.max(limit, 1), 25);

                let recentQuery = supabase
                    .from("conversations")
                    .select("id, title, summary, message_count, has_vat_report, updated_at, company_id")
                    .eq("user_id", user.id)
                    .order("updated_at", { ascending: false })
                    .limit(safeLimit);

                if (company_id) {
                    recentQuery = recentQuery.eq("company_id", company_id);
                }
                if (before) {
                    recentQuery = recentQuery.lt("updated_at", before);
                }
                if (after) {
                    recentQuery = recentQuery.gt("updated_at", after);
                }

                const { data: recentChats, error } = await recentQuery;
                if (error) throw error;

                result = { conversations: recentChats || [] };
                break;
            }

            case "add_memory": {
                if (!company_id) {
                    throw new Error("company_id is required");
                }
                const content = query?.trim();
                if (!content) throw new Error("content is required");

                const normalizedCategory = normalizeCategory(category);
                const memoryTier = resolveTier(normalizedCategory);
                const importance = resolveImportance(normalizedCategory);
                const expiresAt = computeExpiry(normalizedCategory);

                const { data: newMemory, error: addError } = await supabase
                    .from("user_memories")
                    .insert({
                        user_id: user.id,
                        company_id,
                        category: normalizedCategory,
                        content,
                        confidence: 1.0,
                        memory_tier: memoryTier,
                        importance,
                        expires_at: expiresAt
                    })
                    .select()
                    .single();

                if (addError) throw addError;

                await supabase.from("memory_user_edits").insert({
                    user_id: user.id,
                    company_id,
                    edit_type: "add",
                    content
                });

                result = { success: true, memory: newMemory };
                break;
            }

            case "remove_memory": {
                const memoryId = query?.trim();
                if (!memoryId) throw new Error("memory id is required");

                const { data: memory, error: fetchError } = await supabase
                    .from("user_memories")
                    .select("id, content, company_id")
                    .eq("id", memoryId)
                    .eq("user_id", user.id)
                    .maybeSingle();

                if (fetchError) throw fetchError;
                if (!memory) throw new Error("Memory not found");

                const { error: removeError } = await supabase
                    .from("user_memories")
                    .delete()
                    .eq("id", memoryId)
                    .eq("user_id", user.id);

                if (removeError) throw removeError;

                await supabase.from("memory_user_edits").insert({
                    user_id: user.id,
                    company_id: memory.company_id,
                    edit_type: "remove",
                    content: memory.content
                });

                result = { success: true };
                break;
            }

            case "get_memory_items": {
                if (!company_id) {
                    throw new Error("company_id is required");
                }

                let itemsQuery = supabase
                    .from("memory_items")
                    .select("*")
                    .eq("user_id", user.id)
                    .eq("company_id", company_id)
                    .order("updated_at", { ascending: false });

                if (category) {
                    itemsQuery = itemsQuery.eq("category", normalizeCategory(category));
                }
                if (status) {
                    itemsQuery = itemsQuery.eq("status", status);
                }

                const { data: items, error } = await itemsQuery;
                if (error) throw error;

                result = { items: (items || []) as MemoryItemRow[] };
                break;
            }

            case "add_memory_item": {
                if (!company_id) {
                    throw new Error("company_id is required");
                }

                const memoryPayload = memory ?? {};
                const content = typeof memoryPayload.content === "string" ? memoryPayload.content.trim() : "";
                if (!content) throw new Error("content is required");

                const normalizedCategory = normalizeCategory(memoryPayload.category as string | undefined);
                const scope = normalizeEnum(memoryPayload.scope as string | undefined, MEMORY_ITEM_SCOPES, "company");
                const memoryType = normalizeEnum(memoryPayload.memory_type as string | undefined, MEMORY_ITEM_TYPES, "explicit");
                const memoryStatus = normalizeEnum(memoryPayload.status as string | undefined, MEMORY_ITEM_STATUSES, "active");
                const sourceType = normalizeEnum(memoryPayload.source_type as string | undefined, MEMORY_ITEM_SOURCE_TYPES, "manual");
                const createdBy = normalizeEnum(memoryPayload.created_by as string | undefined, MEMORY_ITEM_CREATED_BY, "user");
                const importance = clamp01(memoryPayload.importance as number | undefined, 0.7);
                const confidence = clamp01(memoryPayload.confidence as number | undefined, 0.7);
                const metadata = (memoryPayload.metadata && typeof memoryPayload.metadata === "object") ? memoryPayload.metadata : {};

                const { data: newItem, error: addError } = await supabase
                    .from("memory_items")
                    .insert({
                        user_id: user.id,
                        company_id,
                        category: normalizedCategory,
                        scope,
                        memory_type: memoryType,
                        status: memoryStatus,
                        content,
                        metadata,
                        importance,
                        confidence,
                        source_type: sourceType,
                        source_id: memoryPayload.source_id ?? null,
                        created_by: createdBy,
                        expires_at: memoryPayload.expires_at ?? null
                    })
                    .select()
                    .single();

                if (addError) throw addError;

                result = { success: true, item: newItem };
                break;
            }

            case "update_memory_item": {
                const memoryId = validateUUID(memory_id, "memory_id");

                const patchData = patch ?? {};
                const updatePayload: Record<string, unknown> = {};

                if (typeof patchData.content === "string") {
                    const trimmed = patchData.content.trim();
                    if (!trimmed) throw new Error("content cannot be empty");
                    updatePayload.content = trimmed;
                }
                if (patchData.category) {
                    updatePayload.category = normalizeCategory(patchData.category as string);
                }
                if (patchData.scope) {
                    updatePayload.scope = normalizeEnum(patchData.scope as string, MEMORY_ITEM_SCOPES, "company");
                }
                if (patchData.memory_type) {
                    updatePayload.memory_type = normalizeEnum(patchData.memory_type as string, MEMORY_ITEM_TYPES, "explicit");
                }
                if (patchData.status) {
                    updatePayload.status = normalizeEnum(patchData.status as string, MEMORY_ITEM_STATUSES, "active");
                }
                if (patchData.source_type) {
                    updatePayload.source_type = normalizeEnum(patchData.source_type as string, MEMORY_ITEM_SOURCE_TYPES, "manual");
                }
                if (patchData.created_by) {
                    updatePayload.created_by = normalizeEnum(patchData.created_by as string, MEMORY_ITEM_CREATED_BY, "user");
                }
                if (patchData.importance !== undefined) {
                    updatePayload.importance = clamp01(patchData.importance as number, 0.7);
                }
                if (patchData.confidence !== undefined) {
                    updatePayload.confidence = clamp01(patchData.confidence as number, 0.7);
                }
                if (patchData.metadata && typeof patchData.metadata === "object") {
                    updatePayload.metadata = patchData.metadata;
                }
                if (patchData.source_id !== undefined) {
                    updatePayload.source_id = patchData.source_id as string | null;
                }
                if (patchData.expires_at !== undefined) {
                    updatePayload.expires_at = patchData.expires_at as string | null;
                }

                if (Object.keys(updatePayload).length === 0) {
                    throw new Error("No valid fields to update");
                }

                const { data: updatedItem, error: updateError } = await supabase
                    .from("memory_items")
                    .update(updatePayload)
                    .eq("id", memoryId)
                    .eq("user_id", user.id)
                    .select()
                    .single();

                if (updateError) throw updateError;

                result = { success: true, item: updatedItem };
                break;
            }

            case "remove_memory_item": {
                const memoryId = validateUUID(memory_id, "memory_id");

                const { error: removeError } = await supabase
                    .from("memory_items")
                    .delete()
                    .eq("id", memoryId)
                    .eq("user_id", user.id);

                if (removeError) throw removeError;

                result = { success: true };
                break;
            }

            case "log_memory_usage": {
                const memoryId = validateUUID(memory_id, "memory_id");

                const { error: logError } = await supabase
                    .from("memory_usage")
                    .insert({
                        memory_id: memoryId,
                        skill_run_id: skill_run_id ?? null,
                        conversation_id: conversation_id ?? null
                    });

                if (logError) throw logError;

                result = { success: true };
                break;
            }

            default:
                throw new Error(`Unknown action: ${action}`);
        }

        return new Response(JSON.stringify(result), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
    } catch (error) {
        logger.error("Memory service error", error);
        const message = error instanceof Error ? error.message : "Unknown error";
        return new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { ...getCorsHeaders(), "Content-Type": "application/json" }
        });
    }
});

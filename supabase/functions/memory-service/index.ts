/// <reference path="../../types/deno.d.ts" />

import { createClient } from "npm:@supabase/supabase-js@2";
import { createLogger } from "../../services/LoggerService.ts";
import { createOptionsResponse, getCorsHeaders } from "../../services/CorsService.ts";

const logger = createLogger("memory-service");

type MemoryAction =
    | "get_memories"
    | "search_conversations"
    | "get_recent"
    | "add_memory"
    | "remove_memory";

interface MemoryRequest {
    action: MemoryAction;
    company_id?: string;
    query?: string;
    limit?: number;
    before?: string;
    after?: string;
    category?: string;
}

type MemoryRow = {
    id: string;
    category: string;
    content: string;
    updated_at: string | null;
};

const ALLOWED_CATEGORIES = new Set([
    "work_context",
    "preferences",
    "history",
    "top_of_mind",
    "user_defined"
]);

function normalizeCategory(category?: string): string {
    if (!category) return "user_defined";
    return ALLOWED_CATEGORIES.has(category) ? category : "user_defined";
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

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return createOptionsResponse();
    }

    const corsHeaders = getCorsHeaders();

    try {
        const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
        if (!authHeader) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), {
                status: 401,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        const supabaseUrl = Deno.env.get("SUPABASE_URL");
        const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

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

        const body = await req.json() as MemoryRequest;
        const { action, company_id, query, limit = 10, before, after, category } = body;

        let result: Record<string, unknown> = {};

        switch (action) {
            case "get_memories": {
                if (!company_id) {
                    throw new Error("company_id is required");
                }

                const { data: memories, error } = await supabase
                    .from("user_memories")
                    .select("id, category, content, updated_at")
                    .eq("user_id", user.id)
                    .eq("company_id", company_id)
                    .order("category", { ascending: true })
                    .order("updated_at", { ascending: false });

                if (error) throw error;

                const memoryRows = (memories || []) as MemoryRow[];

                if (memoryRows.length > 0) {
                    const memoryIds = memoryRows.map((memory) => memory.id);
                    const { error: updateError } = await supabase
                        .from("user_memories")
                        .update({ last_used_at: new Date().toISOString() })
                        .in("id", memoryIds);
                    if (updateError) {
                        logger.warn("Failed to update memory last_used_at", { error: updateError.message });
                    }
                }

                result = {
                    memories: formatMemoriesForPrompt(memoryRows),
                    raw: memoryRows
                };
                break;
            }

            case "search_conversations": {
                if (!query) throw new Error("query is required");

                const safeLimit = Math.min(Math.max(limit, 1), 25);

                let searchQuery = supabase
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
                    searchQuery = searchQuery.eq("conversation.company_id", company_id);
                }

                const { data: searchResults, error } = await searchQuery;
                if (error) throw error;

                result = {
                    results: (searchResults || []).map((row) => {
                        // Supabase returns !inner joins as single objects, but types say array
                        const conv = row.conversation as unknown as { id: string; title: string };
                        return {
                            conversation_id: conv.id,
                            conversation_title: conv.title,
                            snippet: extractSnippet(row.content, query),
                            created_at: row.created_at
                        };
                    })
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

                const { data: newMemory, error: addError } = await supabase
                    .from("user_memories")
                    .insert({
                        user_id: user.id,
                        company_id,
                        category: normalizeCategory(category),
                        content,
                        confidence: 1.0
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

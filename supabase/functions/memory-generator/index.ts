/// <reference path="../../types/deno.d.ts" />

import { createClient } from "npm:@supabase/supabase-js@2";
import { GoogleGenerativeAI } from "npm:@google/generative-ai@0.21.0";
import { createLogger } from "../../services/LoggerService.ts";
import { createOptionsResponse, getCorsHeaders } from "../../services/CorsService.ts";

const logger = createLogger("memory-generator");

const ALLOWED_CATEGORIES = new Set([
    "work_context",
    "preferences",
    "history",
    "top_of_mind"
]);

const MEMORY_SYSTEM_INSTRUCTION = `Du är en svensk AI-assistent som sammanfattar konversationer och extraherar relevanta minnen.
Svara alltid med ett ENDAST giltigt JSON-objekt utan extra text eller markdown.`;

const MEMORY_PROMPT_HEADER = `Analysera konversationen och extrahera:

1. EN kort sammanfattning (max 100 ord)
2. Viktiga fakta om användaren/företaget som bör sparas som "minnen"

Svara i JSON:
{
  "summary": "...",
  "memories": [
    { "category": "work_context|preferences|history|top_of_mind", "content": "..." }
  ]
}

Kategorier:
- work_context: Fakta om företaget, org.nr, bransch, kontaktinfo
- preferences: Hur användaren vill ha saker (avrundning, format, etc)
- history: Viktiga händelser, tidigare analyser
- top_of_mind: Pågående projekt, aktuella frågor
`;

const MAX_MESSAGES = 60;
const MAX_MESSAGE_CHARS = 900;
const MAX_MEMORIES = 8;

type MemoryEntry = {
    category?: string;
    content?: string;
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

function normalizeContent(content: string): string {
    return content.toLowerCase().replace(/\s+/g, " ").trim();
}

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return createOptionsResponse();
    }

    const corsHeaders = getCorsHeaders();

    try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL");
        const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
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

        const { conversation_id } = await req.json() as { conversation_id?: string };
        if (!conversation_id) {
            return new Response(JSON.stringify({ error: "conversation_id is required" }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        const supabase = createClient(supabaseUrl, supabaseServiceKey);

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

        const prompt = `${MEMORY_PROMPT_HEADER}\nKonversation:\n${transcript}`;

        const genAI = new GoogleGenerativeAI(geminiKey);
        const modelName = Deno.env.get("MEMORY_MODEL") || Deno.env.get("GEMINI_MODEL") || "gemini-2.0-flash";
        const model = genAI.getGenerativeModel({
            model: modelName,
            systemInstruction: MEMORY_SYSTEM_INSTRUCTION
        });

        const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.2,
                maxOutputTokens: 1024
            }
        });

        const responseText = result.response.text();
        const jsonText = extractJson(responseText);
        if (!jsonText) {
            throw new Error("Failed to parse memory response");
        }

        const parsed = JSON.parse(jsonText) as MemoryResponse;
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

        const existingSet = new Set(
            (existingMemories || [])
                .map((memory) => normalizeContent(memory.content || ""))
                .filter(Boolean)
        );

        const inserts = memories
            .map((memory) => ({
                category: memory?.category?.trim(),
                content: memory?.content?.trim()
            }))
            .filter((memory) => memory.content && memory.category && ALLOWED_CATEGORIES.has(memory.category))
            .filter((memory) => {
                const normalized = normalizeContent(memory.content as string);
                if (!normalized || existingSet.has(normalized)) {
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
                confidence: 0.8
            }))
            .slice(0, MAX_MEMORIES);

        if (inserts.length > 0) {
            const { error: insertError } = await supabase
                .from("user_memories")
                .insert(inserts);
            if (insertError) throw insertError;
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
        const message = error instanceof Error ? error.message : "Unknown error";
        return new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { ...getCorsHeaders(), "Content-Type": "application/json" }
        });
    }
});

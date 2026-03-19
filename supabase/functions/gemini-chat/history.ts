// Conversation history search, recent chats, web search formatting
/// <reference path="../types/deno.d.ts" />

import type {
  EdgeSupabaseClient,
  HistorySearchResult,
  WebSearchResponse,
} from "./types.ts";
import { truncateText } from "./utils.ts";
import { createLogger } from "../../services/LoggerService.ts";

const logger = createLogger("gemini-chat:history");

export function extractSnippet(
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

export function detectHistoryIntent(
  message: string,
): { search: boolean; recent: boolean } {
  const normalized = message.toLowerCase();
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

export function extractInvoiceReference(message: string): { type: "supplier" | "customer"; number: number } | null {
  const n = message.toLowerCase();
  const supplierMatch = n.match(/leverantörs?faktura\s+(?:nr\.?\s*)?(\d+)/);
  if (supplierMatch) return { type: "supplier", number: Number(supplierMatch[1]) };
  const customerMatch = n.match(/(?:kund)?faktura\s+(?:nr\.?\s*)?(\d+)/);
  if (customerMatch) return { type: "customer", number: Number(customerMatch[1]) };
  return null;
}

export function extractInvoiceByCustomerName(message: string): string | null {
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

export function detectAgentNeeds(message: string): { needsCustomers: boolean; needsSuppliers: boolean; needsArticles: boolean } {
  const m = message.toLowerCase();
  const isSupplierInvoice = /leverantörsfaktura|lev\.?faktura|supplier invoice/.test(m);
  return {
    needsCustomers: /kund|faktura|invoice/.test(m) && !isSupplierInvoice,
    needsSuppliers: /leverantör|supplier|lev\.?faktura/.test(m),
    needsArticles: /artikel|produkt|vara|article/.test(m),
  };
}

export function shouldSkipHistorySearch(message: string): boolean {
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

export async function searchConversationHistory(
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

export async function getRecentConversations(
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

export function formatHistoryResponse(
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

export function formatWebSearchContext(response: WebSearchResponse): string {
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

export async function triggerMemoryGenerator(
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

export async function generateSmartTitleIfNeeded(
  _conversationService: any,
  supabaseAdmin: EdgeSupabaseClient,
  conversationId: string,
  userMessage: string,
  aiResponse: string,
  currentTitleHint?: string | null,
  generateConversationTitle?: (msg: string, resp: string, apiKey?: string) => Promise<string>,
): Promise<string | null> {
  try {
    const hintedTitle = currentTitleHint?.trim() || null;
    if (hintedTitle && hintedTitle !== "Ny konversation") {
      return hintedTitle;
    }

    if (!hintedTitle) {
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

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!generateConversationTitle) return null;
    const generatedTitle = await generateConversationTitle(
      userMessage,
      aiResponse,
      apiKey,
    );

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

export async function fetchWebSearchResults(
  toolArgs: Record<string, unknown>,
  authHeader: string,
): Promise<WebSearchResponse | null> {
  const args = toolArgs as { query?: string; max_results?: number; recency_days?: number };
  const query = typeof args?.query === "string" ? args.query.trim() : "";
  if (!query) return null;

  const supabaseUrl = (await import("./utils.ts")).getEnv(["SUPABASE_URL", "SB_SUPABASE_URL", "API_URL"]);
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

// OpenAI Service for Supabase Edge Functions
// Provides a GeminiResponse-compatible interface (text + tool calls)
/// <reference path="../types/deno.d.ts" />

import { createLogger } from "./LoggerService.ts";
import type { CreateInvoiceArgs, FileData, GeminiResponse, ToolCall } from "./GeminiService.ts";
import { SYSTEM_INSTRUCTION } from "./GeminiService.ts";

const logger = createLogger("openai");

type OpenAITool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
};

function usesMaxCompletionTokens(model: string): boolean {
  return /^gpt-5/i.test(model) || /^o\d/i.test(model);
}

const tools: OpenAITool[] = [
  {
    type: "function",
    function: {
      name: "create_invoice",
      description: "Skapar ett fakturautkast i Fortnox. Använd detta när användaren vill fakturera.",
      parameters: {
        type: "object",
        properties: {
          CustomerNumber: {
            type: "string",
            description: "Kundnumret i Fortnox (t.ex. '1001')",
          },
          InvoiceRows: {
            type: "array",
            description: "Lista på fakturarader",
            items: {
              type: "object",
              properties: {
                ArticleNumber: {
                  type: "string",
                  description: "Artikelnumret (t.ex. 'ART1')",
                },
                DeliveredQuantity: {
                  type: "string",
                  description: "Antal levererade enheter (t.ex. '10')",
                },
              },
              required: ["ArticleNumber", "DeliveredQuantity"],
              additionalProperties: true,
            },
          },
        },
        required: ["CustomerNumber", "InvoiceRows"],
        additionalProperties: true,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_customers",
      description: "Hämtar lista på kunder från Fortnox. Används för att slå upp kundnummer.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "get_articles",
      description: "Hämtar lista på artiklar från Fortnox. Används för att slå upp artikelnummer och priser.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
];

type OpenAIMessage = {
  role: "system" | "user" | "assistant";
  // OpenAI supports multi-modal content via an array; we only use it for images.
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      >;
};

type OpenAIChatCompletion = {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
  error?: { message?: string };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeCreateInvoiceArgs(value: unknown): CreateInvoiceArgs | null {
  if (!isRecord(value)) return null;

  const rawCustomerNumber = value.CustomerNumber;
  const rawRows = value.InvoiceRows;

  const customerNumber = (typeof rawCustomerNumber === "string" || typeof rawCustomerNumber === "number")
    ? String(rawCustomerNumber).trim()
    : "";
  if (!customerNumber) return null;

  if (!Array.isArray(rawRows) || rawRows.length === 0) return null;

  const rows: CreateInvoiceArgs["InvoiceRows"] = [];
  for (const row of rawRows) {
    if (!isRecord(row)) continue;
    const rawArticleNumber = row.ArticleNumber;
    const rawDeliveredQuantity = row.DeliveredQuantity;

    const articleNumber = (typeof rawArticleNumber === "string" || typeof rawArticleNumber === "number")
      ? String(rawArticleNumber).trim()
      : "";
    const deliveredQuantity = (typeof rawDeliveredQuantity === "string" || typeof rawDeliveredQuantity === "number")
      ? String(rawDeliveredQuantity).trim()
      : "";

    if (!articleNumber || !deliveredQuantity) continue;
    rows.push({ ...row, ArticleNumber: articleNumber, DeliveredQuantity: deliveredQuantity });
  }

  if (rows.length === 0) return null;

  return {
    ...value,
    CustomerNumber: customerNumber,
    InvoiceRows: rows,
  } as CreateInvoiceArgs;
}

function toToolCall(name: string, args: unknown): ToolCall | null {
  if (name === "get_customers" || name === "get_articles") return { tool: name, args: {} };

  if (name === "create_invoice") {
    const normalized = normalizeCreateInvoiceArgs(args);
    if (!normalized) return null;
    return { tool: "create_invoice", args: normalized };
  }

  return null;
}

export async function sendMessageToOpenAI(
  message: string,
  fileData?: FileData,
  fileDataPages?: Array<FileData & { pageNumber?: number }>,
  history?: Array<{ role: string; content: string }>,
): Promise<GeminiResponse> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not found in environment");
  }

  const baseUrl = (Deno.env.get("OPENAI_BASE_URL") || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = Deno.env.get("OPENAI_MODEL") || "gpt-4o-mini";

  const messages: OpenAIMessage[] = [
    { role: "system", content: SYSTEM_INSTRUCTION },
  ];

  if (history && history.length > 0) {
    for (const msg of history) {
      if (msg.role === "user" || msg.role === "assistant") {
        messages.push({ role: msg.role, content: msg.content });
      }
    }
  }

  // Current user message + optional images (single image or multi-page PDF rendered to images)
  const contentParts: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> = [];
  contentParts.push({ type: "text", text: message });

  const pageImages = (fileDataPages || []).filter((p) => p?.mimeType?.startsWith("image/") && p.data);
  if (pageImages.length > 0) {
    for (const p of pageImages) {
      if (typeof p.pageNumber === "number") {
        contentParts.push({ type: "text", text: `Sida ${p.pageNumber}` });
      }
      contentParts.push({
        type: "image_url",
        image_url: { url: `data:${p.mimeType};base64,${p.data}` },
      });
    }
  } else if (fileData?.mimeType?.startsWith("image/") && fileData.data) {
    contentParts.push({
      type: "image_url",
      image_url: { url: `data:${fileData.mimeType};base64,${fileData.data}` },
    });
  }

  messages.push({
    role: "user",
    content: contentParts,
  });

  const payload: Record<string, unknown> = {
    model,
    messages,
    tools,
    tool_choice: "auto",
    temperature: 0.4,
  };

  const maxCompletionTokens = 2048;
  if (usesMaxCompletionTokens(model)) {
    payload.max_completion_tokens = maxCompletionTokens;
    payload.reasoning_effort = "none";
  } else {
    payload.max_tokens = maxCompletionTokens;
  }

  const url = `${baseUrl}/chat/completions`;
  logger.info("Calling OpenAI", { model });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    throw new Error(`OpenAI API error (${res.status}): ${errorText || res.statusText}`);
  }

  const data = (await res.json()) as OpenAIChatCompletion;
  const choice = data.choices?.[0]?.message;

  const toolCalls = choice?.tool_calls;
  if (toolCalls && toolCalls.length > 0) {
    const call = toolCalls[0];
    const name = call.function?.name || "";
    const rawArgs = call.function?.arguments || "{}";
    try {
      const parsedArgs = JSON.parse(rawArgs);
      const toolCall = toToolCall(name, parsedArgs);
      if (toolCall) return { toolCall };
    } catch (err) {
      logger.warn("Failed to parse tool arguments", { name, rawArgs });
    }
  }

  const text = choice?.content ?? "";
  return { text: text || "Jag kunde inte generera ett svar just nu." };
}

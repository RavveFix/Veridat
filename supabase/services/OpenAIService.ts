// OpenAI Service for Supabase Edge Functions
// Provides a GeminiResponse-compatible interface (text + tool calls)
/// <reference path="../types/deno.d.ts" />

import { createLogger } from "./LoggerService.ts";
import type { FileData, GeminiResponse, ToolCall } from "./GeminiService.ts";
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

function toToolCall(name: string, args: unknown): ToolCall | null {
  if (name === "create_invoice" || name === "get_customers" || name === "get_articles") {
    return { tool: name, args: (args ?? {}) as any };
  }
  return null;
}

export async function sendMessageToOpenAI(
  message: string,
  fileData?: FileData,
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

  // Current user message + optional image
  if (fileData?.mimeType?.startsWith("image/") && fileData.data) {
    const dataUrl = `data:${fileData.mimeType};base64,${fileData.data}`;
    messages.push({
      role: "user",
      content: [
        { type: "image_url", image_url: { url: dataUrl } },
        { type: "text", text: message },
      ],
    });
  } else {
    // For non-image attachments (PDF, etc), OpenAI chat-completions support varies.
    // Let caller decide whether to fall back to Gemini.
    messages.push({ role: "user", content: message });
  }

  const payload: Record<string, unknown> = {
    model,
    messages,
    tools,
    tool_choice: "auto",
    temperature: 0.4,
    max_tokens: 2048,
  };

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


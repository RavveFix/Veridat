// SSE (Server-Sent Events) helpers for thinking steps and streaming
/// <reference path="../types/deno.d.ts" />

import type { ConversationState, EdgeSupabaseClient } from "./types.ts";
import { createLogger } from "../../services/LoggerService.ts";

const logger = createLogger("gemini-chat:sse");

export async function updateConversationState(
  supabase: any,
  conversationId: string | null,
  state: ConversationState,
): Promise<void> {
  if (!conversationId) return;
  try {
    await supabase.rpc("set_conversation_state", {
      p_conversation_id: conversationId,
      p_state: state,
    });
  } catch (err) {
    logger.warn("Failed to update conversation state", { error: String(err), state });
  }
}

export class ThinkingStepTracker {
  private counter = 0;
  private timestamps = new Map<string, number>();

  sendStep(
    controller: ReadableStreamDefaultController,
    encoder: TextEncoder,
    label: string,
    opts?: { type?: string; tool?: string; parentId?: string },
  ): string {
    const id = `thinking-${++this.counter}`;
    const startedAt = Date.now();
    this.timestamps.set(id, startedAt);
    const step = {
      agentStep: {
        id,
        type: opts?.type ?? "thinking",
        tool: opts?.tool ?? "",
        label,
        status: "running",
        startedAt,
        completedAt: null,
        resultSummary: null,
        parentId: opts?.parentId ?? null,
      },
    };
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(step)}\n\n`));
    return id;
  }

  sendThinkingStep(
    controller: ReadableStreamDefaultController,
    encoder: TextEncoder,
    label: string,
  ): string {
    return this.sendStep(controller, encoder, label);
  }

  completeStep(
    controller: ReadableStreamDefaultController,
    encoder: TextEncoder,
    id: string,
    label: string,
    opts?: { type?: string; tool?: string; parentId?: string },
  ): void {
    const startedAt = this.timestamps.get(id) ?? Date.now();
    const step = {
      agentStep: {
        id,
        type: opts?.type ?? "thinking",
        tool: opts?.tool ?? "",
        label,
        status: "completed",
        startedAt,
        completedAt: Date.now(),
        resultSummary: null,
        parentId: opts?.parentId ?? null,
      },
    };
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(step)}\n\n`));
  }

  completeThinkingStep(
    controller: ReadableStreamDefaultController,
    encoder: TextEncoder,
    id: string,
    label: string,
  ): void {
    this.completeStep(controller, encoder, id, label);
  }
}

/** Tool labels for SSE thinking steps */
export const TOOL_LABELS: Record<string, string> = {
  search_invoices: "Hämtar fakturor från Fortnox...",
  search_supplier_invoices: "Hämtar leverantörsfakturor...",
  get_financial_summary: "Hämtar ekonomisk översikt...",
  get_account_balances: "Hämtar kontosaldon...",
  search_vouchers: "Hämtar verifikationer...",
  search_customers: "Söker kunder i Fortnox...",
  get_vat_report: "Genererar momsrapport...",
  get_company_info: "Hämtar företagsinformation...",
  create_invoice: "Skapar faktura...",
  propose_action_plan: "Förbereder handlingsplan...",
  search_articles: "Söker artiklar...",
  conversation_search: "Söker i tidigare konversationer...",
  web_search: "Söker på webben...",
};

// Context builder: assembles memory context, VAT context, and tool rules
/// <reference path="../types/deno.d.ts" />

import type {
  AccountingMemoryRow,
  EdgeSupabaseClient,
  UsedMemory,
  UserMemoryRow,
  VATReportContext,
} from "./types.ts";
import {
  buildCompanyMemoryContext,
  extractMemoryRequest,
  formatAccountingMemoriesForContext,
  formatUserMemoriesForContext,
  selectAccountingMemoriesForContext,
  selectRelevantMemories,
} from "./memory.ts";
import { CompanyMemoryService } from "../../services/CompanyMemoryService.ts";
import { ExpensePatternService } from "../../services/ExpensePatternService.ts";
import { createLogger } from "../../services/LoggerService.ts";

const logger = createLogger("gemini-chat:context");

export interface ContextResult {
  contextBlocks: string[];
  usedMemories: UsedMemory[];
}

/**
 * Load all memory context for the current user/company.
 * Returns context blocks to prepend to the message and used memory metadata.
 */
export async function loadMemoryContext(
  supabaseAdmin: EdgeSupabaseClient,
  userId: string,
  companyId: string,
  message: string,
  vatReportContext: VATReportContext | null,
): Promise<ContextResult> {
  const contextBlocks: string[] = [];
  const usedMemories: UsedMemory[] = [];

  // Load user memories
  try {
    const { data: userMemories, error: userMemoriesError } =
      await supabaseAdmin
        .from("user_memories")
        .select(
          "id, category, content, updated_at, last_used_at, created_at, confidence, memory_tier, importance, expires_at",
        )
        .eq("user_id", userId)
        .eq("company_id", companyId)
        .order("updated_at", { ascending: false })
        .limit(200);

    if (userMemoriesError) {
      logger.warn("Failed to load user memories", {
        userId,
        companyId,
      });
    } else if (!userMemories || userMemories.length === 0) {
      contextBlocks.push(
        "SYSTEM CONTEXT: Detta är första interaktionen med detta företag. " +
          "Inga minnen finns ännu. Ställ 1-2 naturliga frågor om verksamheten i ditt svar:\n" +
          "- Vad gör företaget? (bransch, storlek)\n" +
          "- Vilken redovisningsmetod? (faktura/kontant)\n" +
          "- Momsperiod? (månads/kvartals/årsredovisning)\n" +
          "Väv in frågorna naturligt — inte som ett formulär.",
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
          .from("user_memories")
          .update({ last_used_at: new Date().toISOString() })
          .in("id", memoryIds);
      }
    }
  } catch (memoryError) {
    logger.warn("Failed to load user memories", {
      userId,
      companyId,
    });
  }

  // Load accounting memories
  try {
    const { data: accountingMemories, error: accountingMemoriesError } =
      await supabaseAdmin
        .from("accounting_memories")
        .select(
          "id, entity_type, entity_key, label, payload, source_type, source_reliability, confidence, review_status, fiscal_year, period_start, period_end, valid_from, valid_to, last_used_at, updated_at, created_at",
        )
        .eq("user_id", userId)
        .eq("company_id", companyId)
        .order("updated_at", { ascending: false })
        .limit(200);

    if (accountingMemoriesError) {
      logger.warn("Failed to load accounting memories", {
        userId,
        companyId,
      });
    } else if (accountingMemories && accountingMemories.length > 0) {
      const memoryRows = accountingMemories as AccountingMemoryRow[];
      const selectedMemories = selectAccountingMemoriesForContext(
        memoryRows,
        message,
      );
      const accountingContext = formatAccountingMemoriesForContext(
        selectedMemories,
      );

      if (accountingContext) {
        contextBlocks.push(accountingContext);
      }

      const accountingIds = selectedMemories.map((memory) => memory.id);
      if (accountingIds.length > 0) {
        await supabaseAdmin
          .from("accounting_memories")
          .update({ last_used_at: new Date().toISOString() })
          .in("id", accountingIds);
      }
    }
  } catch (accountingError) {
    logger.warn("Failed to load accounting memories", {
      userId,
      companyId,
    });
  }

  // Load learned expense patterns
  try {
    const patternService = new ExpensePatternService(supabaseAdmin);
    const patterns = await patternService.listPatterns(userId, companyId, 20);

    if (patterns.length > 0) {
      const patternLines = patterns
        .filter((p) => p.confirmation_count >= 1)
        .slice(0, 12)
        .map((p) => {
          const vatLabel = p.vat_rate > 0 ? ` (${p.vat_rate}% moms)` : " (momsfri)";
          const usageNote = p.usage_count > 1 ? ` [använt ${p.usage_count}x]` : "";
          return `- ${p.supplier_name} → ${p.bas_account} ${p.bas_account_name}${vatLabel}${usageNote}`;
        });

      if (patternLines.length > 0) {
        contextBlocks.push(
          [
            "SYSTEM CONTEXT: Inlärda konteringsmönster. Använd dessa när du föreslår BAS-konto för kända leverantörer.",
            "Om motparten matchar ett mönster, föreslå det kontot direkt och nämn att du lärt dig det.",
            "Om användaren korrigerar ditt förslag, anropa learn_accounting_pattern för att uppdatera.",
            "<learnedPatterns>",
            ...patternLines,
            "</learnedPatterns>",
          ].join("\n"),
        );
      }
    }
  } catch (patternError) {
    logger.warn("Failed to load expense patterns", {
      userId,
      companyId,
    });
  }

  // Load company memory
  try {
    const memoryService = new CompanyMemoryService(supabaseAdmin);
    const memory = await memoryService.get(userId, companyId);
    const memoryContext = memory
      ? buildCompanyMemoryContext(memory, !vatReportContext)
      : null;

    if (memoryContext) {
      contextBlocks.push(memoryContext);
    }
  } catch (memoryError) {
    logger.warn("Failed to load company memory", {
      userId,
      companyId,
    });
  }

  return { contextBlocks, usedMemories };
}

/**
 * Build VAT report context string to inject into the message.
 */
export function buildVatReportContextString(
  vatReportContext: VATReportContext,
): string {
  const netVat = vatReportContext.vat?.net ?? 0;
  return `
SYSTEM CONTEXT: Användaren tittar just nu på följande momsredovisning (genererad av ${
    vatReportContext.type === "vat_report" ? "systemet" : "analysverktyget"
  }):

Period: ${vatReportContext.period}
Företag: ${vatReportContext.company?.name ?? "Okänt"} (${
    vatReportContext.company?.org_number ?? "Saknas"
  })

SAMMANFATTNING:
- Försäljning: ${
    vatReportContext.summary?.total_sales ??
      vatReportContext.summary?.total_income ?? 0
  } SEK
- Kostnader: ${vatReportContext.summary?.total_costs ?? 0} SEK
- Resultat: ${vatReportContext.summary?.result ?? 0} SEK

MOMS:
- Utgående (25%): ${vatReportContext.vat?.outgoing_25 ?? 0} SEK
- Ingående: ${vatReportContext.vat?.incoming ?? 0} SEK
- Att ${netVat >= 0 ? "betala" : "återfå"}: ${Math.abs(netVat)} SEK

VALIDERING:
- Status: ${vatReportContext.validation?.is_valid ? "Giltig" : "Ogiltig"}
- Fel: ${vatReportContext.validation?.errors?.join(", ") || "Inga"}
- Varningar: ${vatReportContext.validation?.warnings?.join(", ") || "Inga"}

Användaren kan ställa frågor om denna rapport. Svara baserat på ovanstående data.

ANVÄNDARFRÅGA:
`;
}

/**
 * Build tool usage rules string for the message.
 */
export function buildToolRules(hasFortnoxConnection: boolean): string {
  if (hasFortnoxConnection) {
    return `[VERKTYGSREGLER]\n` +
      `Du har tillgång till Fortnox-verktyg. Använd dem så här:\n` +
      `- LÄSVERKTYG (search_invoices, search_supplier_invoices, search_customers, get_vat_report, get_company_info, get_financial_summary, get_account_balances, search_vouchers): Använd FRITT utan att fråga. Om användaren frågar om fakturor, leverantörsfakturor, kunder, moms, företagsinfo, ekonomisk översikt, kontosaldon eller verifikationer — anropa verktyget direkt.\n` +
      `- SKRIVVERKTYG (skapa/ändra faktura): Anropa ALLTID propose_action_plan med posting_rows. Utför ALDRIG en skrivoperation direkt. Leverantörsfakturor skapas som UTKAST — användaren bokför och betalar själv i Fortnox.\n` +
      `- LEVERANTÖRSFAKTURA: När du skapar en leverantörsfaktura, inkludera ALLTID ett create_supplier-steg FÖRE create_supplier_invoice i handlingsplanen. Leverantören kanske inte finns i Fortnox. Systemet hanterar dubbletter — om leverantören redan finns skapas ingen ny. Referera ALLTID leverantörer med numeriskt SupplierNumber (t.ex. "1"), ALDRIG med textnamn (t.ex. "GOOGLE_IRELAND_LTD").\n` +
      `- SAKNAD INFO: Om pris, belopp, antal eller annan kritisk info saknas för en skrivoperation → anropa request_clarification.\n\n`;
  } else {
    return `[VERKTYGSREGLER — FORTNOX EJ KOPPLAT]\n` +
      `Användaren har INTE kopplat Fortnox. Du har INGA Fortnox-verktyg.\n` +
      `Skapa ALDRIG handlingsplan med Fortnox-åtgärder (create_supplier, create_supplier_invoice, create_invoice etc).\n` +
      `Visa konteringsförslag som text med kontonummer, debet/kredit och förklaring.\n` +
      `Avsluta med: 'Vill du koppla Fortnox kan jag skapa fakturan direkt åt dig. Gå till Inställningar → Integrationer.'\n\n`;
  }
}

/**
 * Handle "remember this" user requests — save to user_memories.
 */
export async function handleMemoryRequest(
  supabaseAdmin: EdgeSupabaseClient,
  userId: string,
  companyId: string,
  message: string,
): Promise<void> {
  const memoryRequest = extractMemoryRequest(message);
  if (!memoryRequest) return;

  try {
    const { data: existingMemory } = await supabaseAdmin
      .from("user_memories")
      .select("id")
      .eq("user_id", userId)
      .eq("company_id", companyId)
      .ilike("content", memoryRequest)
      .limit(1);

    if (!existingMemory || existingMemory.length === 0) {
      await supabaseAdmin.from("user_memories").insert({
        user_id: userId,
        company_id: companyId,
        category: "user_defined",
        content: memoryRequest,
        confidence: 1.0,
        memory_tier: "profile",
        importance: 0.9,
      });

      await supabaseAdmin.from("memory_user_edits").insert({
        user_id: userId,
        company_id: companyId,
        edit_type: "add",
        content: memoryRequest,
      });
    }
  } catch (memorySaveError) {
    logger.warn("Failed to save user memory request", {
      userId,
      companyId,
    });
  }
}

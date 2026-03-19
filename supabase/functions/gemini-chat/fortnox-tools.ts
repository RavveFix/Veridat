// Fortnox tool execution — direct tool calls from Gemini
/// <reference path="../types/deno.d.ts" />

import type { EdgeSupabaseClient } from "./types.ts";
import type {
  CreateSupplierArgs,
  CreateSupplierInvoiceArgs,
  ExportJournalToFortnoxArgs,
} from "../../services/GeminiService.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { FortnoxService } from "../../services/FortnoxService.ts";
import { AuditService } from "../../services/AuditService.ts";
import { createLogger } from "../../services/LoggerService.ts";
import { getEnv } from "./utils.ts";

const logger = createLogger("gemini-chat:fortnox-tools");

export async function lookupCompanyOnAllabolag(companyName: string): Promise<string> {
  if (!companyName) return "Företagsnamn saknas.";
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    try {
      const searchUrl = `https://www.allabolag.se/find?what=${encodeURIComponent(companyName)}`;
      const resp = await fetch(searchUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; Veridat/1.0)" },
        signal: controller.signal,
      });
      if (!resp.ok) {
        return `Kunde inte söka på allabolag.se (status ${resp.status}). Skapa kunden utan uppslag.`;
      }
      const html = await resp.text();
      const ndMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (!ndMatch) {
        return `Hittade ingen data på allabolag.se för "${companyName}". Skapa kunden utan uppslag.`;
      }
      let nextData;
      try {
        nextData = JSON.parse(ndMatch[1]);
      } catch {
        return `Kunde inte tolka data från allabolag.se. Skapa kunden utan uppslag.`;
      }
      const hits = nextData?.props?.pageProps?.hits
        || nextData?.props?.pageProps?.searchResult?.hits
        || [];
      if (hits.length === 0) {
        return `Inga träffar på allabolag.se för "${companyName}".`;
      }
      const results = hits.slice(0, 3).map((h: any) => {
        const name = h.name || h.companyName || "";
        const orgNr = h.orgnr || h.organisationNumber || "";
        const address = h.address || h.visitingAddress || "";
        const zipCode = h.zipCode || h.postalCode || "";
        const city = h.city || h.town || "";
        const status = h.status || h.companyStatus || "";
        return `- ${name} (${orgNr}): ${address}, ${zipCode} ${city} [${status}]`;
      }).join("\n");
      return `Sökresultat från allabolag.se för "${companyName}":\n${results}\n\nAnvänd organisationsnummer, adress och stad från träffen ovan i create_customer-parametrarna.`;
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (err) {
    logger.warn("Allabolag lookup failed", { error: err instanceof Error ? err.message : "unknown" });
    return `Uppslag på allabolag.se misslyckades. Skapa kunden utan företagsuppgifter.`;
  }
}

export async function callFortnoxRead(
  action: string,
  payload: Record<string, unknown>,
  authHeader: string,
  companyId: string,
): Promise<Record<string, unknown>> {
  const supabaseUrl = getEnv(["SUPABASE_URL", "SB_URL", "SB_SUPABASE_URL", "API_URL"]);
  const response = await fetch(`${supabaseUrl}/functions/v1/fortnox`, {
    method: "POST",
    headers: {
      "Authorization": authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action, companyId, payload }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      typeof result?.error === "string"
        ? result.error
        : `Fortnox-anrop misslyckades (${response.status})`,
    );
  }
  return result as Record<string, unknown>;
}

/**
 * Resolve a supplier identifier to a numeric SupplierNumber.
 * If the value is already numeric, return as-is.
 * If it looks like a text name (e.g. "GOOGLE_IRELAND_LTD"), search Fortnox suppliers by name.
 */
export async function resolveSupplierNumber(
  supplierRef: string,
  authHeader: string,
  companyId: string,
): Promise<string | null> {
  if (!supplierRef) return null;
  if (/^\d+$/.test(supplierRef)) return supplierRef;

  try {
    const result = await callFortnoxRead("getSuppliers", {}, authHeader, companyId);
    const suppliers = (result as any)?.Suppliers || (result as any)?.suppliers || [];
    const normalize = (s: string) => s.toLowerCase().replace(/[_\s-]+/g, "");
    const needle = normalize(supplierRef);
    const match = suppliers.find((s: any) =>
      normalize(s.Name || "") === needle ||
      normalize(s.SupplierNumber || "") === needle
    );
    if (match?.SupplierNumber) {
      logger.info("Resolved supplier name to number", {
        input: supplierRef,
        resolved: match.SupplierNumber,
        name: match.Name,
      });
      return String(match.SupplierNumber);
    }
  } catch (err) {
    logger.warn("Supplier lookup failed", {
      supplierRef,
      error: err instanceof Error ? err.message : "Unknown",
    });
  }
  return null;
}

/** Build a Fortnox write caller with idempotency */
export function createFortnoxWriteCaller(
  supabaseUrl: string,
  authHeader: string,
  companyId: string,
  sourceContext: string,
) {
  const buildIdempotencyKey = (operation: string, resource: string): string =>
    `${sourceContext}:${companyId}:${operation}:${resource}`.slice(0, 200);

  return async (
    action: string,
    payload: Record<string, unknown>,
    operation: string,
    resource: string,
  ): Promise<Record<string, unknown>> => {
    const response = await fetch(`${supabaseUrl}/functions/v1/fortnox`, {
      method: "POST",
      headers: {
        "Authorization": authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action,
        companyId,
        payload: {
          ...payload,
          idempotencyKey: buildIdempotencyKey(operation, resource),
          sourceContext,
        },
      }),
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = typeof result?.detail === "string" ? ` (${result.detail})` : "";
      const message = typeof result?.error === "string"
        ? result.error
        : `Fortnox write failed (${response.status})`;
      throw new Error(message + detail);
    }
    return (result || {}) as Record<string, unknown>;
  };
}

/**
 * Execute a Fortnox tool call server-side.
 * Returns the response text, or null if the tool is unrecognized.
 */
export async function executeFortnoxTool(
  toolName: string,
  toolArgs: Record<string, unknown>,
  supabaseAdmin: any,
  userId: string,
  companyId: string | null,
  authHeader: string,
): Promise<string | null> {
  const supabaseUrl = getEnv(["SUPABASE_URL", "SB_URL"]);
  const supabaseServiceKey = getEnv([
    "SUPABASE_SERVICE_ROLE_KEY",
    "SB_SERVICE_ROLE_KEY",
  ]);
  if (!supabaseUrl || !supabaseServiceKey) return null;
  const resolvedCompanyId =
    typeof companyId === "string" && companyId.trim().length > 0
      ? companyId.trim()
      : null;
  if (!resolvedCompanyId) {
    throw new Error("Bolagskontext saknas för Fortnox-verktyg.");
  }

  const supabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const fortnoxConfig = {
    clientId: Deno.env.get("FORTNOX_CLIENT_ID") ?? "",
    clientSecret: Deno.env.get("FORTNOX_CLIENT_SECRET") ?? "",
    redirectUri: "",
  };
  const fortnoxService = new FortnoxService(
    fortnoxConfig,
    supabaseClient,
    userId,
    resolvedCompanyId,
  );
  const auditService = new AuditService(supabaseAdmin);
  const callFortnoxWrite = createFortnoxWriteCaller(
    supabaseUrl,
    authHeader,
    resolvedCompanyId,
    "gemini-chat-tool",
  );

  try {
    switch (toolName) {
      case "get_customers": {
        const result = await fortnoxService.getCustomers();
        return `Här är dina kunder: ${
          (result as any).Customers.map((c: any) => c.Name).join(", ")
        }`;
      }
      case "get_articles": {
        const result = await fortnoxService.getArticles();
        return `Här är dina artiklar: ${
          (result as any).Articles.map((a: any) => a.Description).join(", ")
        }`;
      }
      case "get_suppliers": {
        const result = await fortnoxService.getSuppliers();
        const suppliers = (result as any).Suppliers || [];
        return suppliers.length > 0
          ? `Här är dina leverantörer:\n${
            suppliers.map((s: any) => `- ${s.Name} (nr ${s.SupplierNumber})`)
              .join("\n")
          }`
          : "Inga leverantörer hittades i Fortnox.";
      }
      case "get_invoice": {
        const invNum = Number(toolArgs.invoice_number);
        const resp = await fortnoxService.getInvoice(invNum);
        const inv = (resp as any).Invoice || resp;
        const invId = inv.InvoiceNumber || inv.DocumentNumber || invNum;
        let invoiceText = `Faktura ${invId}:\n` +
          `- DocumentNumber: ${inv.DocumentNumber || invId}\n` +
          `- Kund: ${inv.CustomerName || "—"} (${inv.CustomerNumber})\n` +
          `- Datum: ${inv.InvoiceDate}\n` +
          `- Förfallodatum: ${inv.DueDate}\n` +
          `- Belopp: ${inv.Total} kr (varav moms ${inv.TotalVAT} kr)\n` +
          `- Netto: ${inv.Net} kr\n` +
          `- Bokförd: ${inv.Booked ? "Ja" : "Nej"}\n` +
          `- Status: ${inv.Cancelled ? "Makulerad" : inv.Booked ? "Bokförd" : "Utkast"}`;
        if (inv.InvoiceRows && Array.isArray(inv.InvoiceRows) && inv.InvoiceRows.length > 0) {
          invoiceText += `\n- Fakturarader:`;
          inv.InvoiceRows.forEach((row: any, i: number) => {
            invoiceText += `\n  Rad ${i + 1}: "${row.Description || '-'}" | Antal: ${row.DeliveredQuantity || 1} | À-pris: ${row.Price || 0} kr | Total: ${row.Total || 0} kr`;
          });
        }
        return invoiceText;
      }
      case "get_supplier_invoice": {
        const siNum = Number(toolArgs.given_number);
        const resp = await fortnoxService.getSupplierInvoice(siNum);
        const si = (resp as any).SupplierInvoice || resp;
        return `Leverantörsfaktura ${si.GivenNumber}:\n` +
          `- Leverantör: ${si.SupplierName || "—"} (${si.SupplierNumber})\n` +
          `- Fakturanr: ${si.InvoiceNumber || "—"}\n` +
          `- Datum: ${si.InvoiceDate}\n` +
          `- Förfallodatum: ${si.DueDate}\n` +
          `- Belopp: ${si.Total} kr (varav moms ${si.VAT || 0} kr)\n` +
          `- Bokförd: ${si.Booked ? "Ja" : "Nej"}`;
      }
      case "create_supplier": {
        const csArgs = toolArgs as CreateSupplierArgs;
        const result = await callFortnoxWrite(
          "findOrCreateSupplier",
          {
            supplier: {
              Name: csArgs.name,
              OrganisationNumber: csArgs.org_number || undefined,
              Email: csArgs.email || undefined,
            },
          },
          "create_supplier",
          csArgs.org_number || csArgs.name,
        );
        const supplier = (result as any).Supplier || result;
        void auditService.log({
          userId,
          companyId: companyId || undefined,
          actorType: "ai",
          action: "create",
          resourceType: "supplier",
          resourceId: supplier.SupplierNumber || "",
          newState: supplier,
        });
        return `Leverantör: ${
          supplier.Name || csArgs.name
        } (nr ${supplier.SupplierNumber || "tilldelas"})`;
      }
      case "create_supplier_invoice": {
        const siArgs = toolArgs as CreateSupplierInvoiceArgs;
        const siSupplierRaw = (siArgs.supplier_number || siArgs.supplierNumber || siArgs.SupplierNumber) as string;
        const siSupplierNum = companyId
          ? (await resolveSupplierNumber(siSupplierRaw, authHeader, companyId)) || siSupplierRaw
          : siSupplierRaw;
        if (siSupplierNum !== siSupplierRaw) {
          logger.info("Resolved supplier name to number for direct tool call", { from: siSupplierRaw, to: siSupplierNum });
        }
        const siInvNumRaw = siArgs.invoice_number || siArgs.invoiceNumber || siArgs.InvoiceNumber;
        const siInvNum = siInvNumRaw ? String(siInvNumRaw) : undefined;
        logger.info("[create_supplier_invoice] InvoiceNumber from tool args", {
          raw: siInvNumRaw,
          rawType: typeof siInvNumRaw,
          resolved: siInvNum,
        });
        const siTotalAmt = (siArgs.total_amount ?? siArgs.totalAmount ?? siArgs.TotalAmount ?? siArgs.Total) as number;
        const siVatRate = ((siArgs.vat_rate ?? siArgs.vatRate ?? siArgs.VatRate) as number) || 25;
        const siVatAmt = (siArgs.vat_amount ?? siArgs.vatAmount ?? siArgs.VatAmount) as number | undefined;
        const siIsRC = (siArgs.is_reverse_charge ?? siArgs.isReverseCharge ?? siArgs.IsReverseCharge) === true;
        const siAcct = (siArgs.account ?? siArgs.Account) as number;
        const siDue = (siArgs.due_date || siArgs.dueDate || siArgs.DueDate) as string | undefined;
        const siCurr = "SEK";

        const vatMul = 1 + (siVatRate / 100);
        const net = siIsRC
          ? siTotalAmt
          : Math.round((siTotalAmt / vatMul) * 100) / 100;
        const vat = siIsRC
          ? 0
          : (typeof siVatAmt === "number"
            ? siVatAmt
            : Math.round((siTotalAmt - net) * 100) / 100);

        const fortnoxRows = siIsRC
          ? [
            { Account: siAcct, Debit: net, Credit: 0 },
            { Account: 2440, Debit: 0, Credit: net },
          ]
          : [
            { Account: siAcct, Debit: net, Credit: 0 },
            { Account: 2640, Debit: vat, Credit: 0 },
            { Account: 2440, Debit: 0, Credit: siTotalAmt },
          ];

        const vatType = siIsRC ? "EUINTERNAL" : "NORMAL";

        const result = await callFortnoxWrite(
          "exportSupplierInvoice",
          {
            invoice: {
              SupplierNumber: siSupplierNum,
              InvoiceNumber: siInvNum || undefined,
              InvoiceDate: new Date().toISOString().slice(0, 10),
              DueDate: siDue ||
                new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
              Total: siTotalAmt,
              VAT: siIsRC ? 0 : vat,
              VATType: vatType,
              Currency: siCurr,
              AccountingMethod: "ACCRUAL",
              SupplierInvoiceRows: fortnoxRows,
            },
          },
          "export_supplier_invoice",
          siInvNum || String(siSupplierNum),
        );
        void auditService.log({
          userId,
          companyId: companyId || undefined,
          actorType: "ai",
          action: "create",
          resourceType: "supplier_invoice",
          resourceId: siInvNum ||
            `supplier-${siSupplierNum}`,
          newState: result as unknown as Record<string, unknown>,
        });
        const rcNote = siIsRC ? " (omvänd skattskyldighet)" : "";
        return `Leverantörsfaktura skapad!${rcNote}\n- Belopp: ${siTotalAmt} kr${siIsRC ? "" : ` (${net} + ${vat} moms)`}\n- Konto: ${siAcct}\n- Förfallodatum: ${
          siDue || "30 dagar"
        }`;
      }
      case "export_journal_to_fortnox": {
        const ejArgs = toolArgs as ExportJournalToFortnoxArgs;
        const { data: je } = await supabaseAdmin.from("journal_entries").select(
          "*",
        ).eq("verification_id", ejArgs.journal_entry_id).maybeSingle();
        if (!je) {
          return `Kunde inte hitta verifikat ${ejArgs.journal_entry_id}.`;
        }
        const entries = typeof je.entries === "string"
          ? JSON.parse(je.entries)
          : je.entries;
        const rows = entries.map((e: any) => ({
          Account: e.account,
          Debit: e.debit || 0,
          Credit: e.credit || 0,
          Description: e.accountName || je.description,
        }));
        const result = await callFortnoxWrite(
          "exportVoucher",
          {
            voucher: {
              Description: `${je.description} (${ejArgs.journal_entry_id})`,
              TransactionDate: new Date().toISOString().slice(0, 10),
              VoucherSeries: "A",
              VoucherRows: rows,
            },
            vatReportId: `je:${ejArgs.journal_entry_id}`,
          },
          "export_voucher",
          ejArgs.journal_entry_id,
        );
        const v = (result as any).Voucher || result;
        void auditService.log({
          userId,
          companyId: companyId || undefined,
          actorType: "ai",
          action: "export",
          resourceType: "voucher",
          resourceId: ejArgs.journal_entry_id,
          newState: v,
        });
        return `Exporterat till Fortnox! Verifikat: ${v.VoucherSeries || "A"}-${
          v.VoucherNumber || "?"
        }`;
      }
      case "create_invoice": {
        const ciArgs = toolArgs as Record<string, unknown>;
        const ciCustNum = (ciArgs.customer_number || ciArgs.customerNumber || ciArgs.CustomerNumber) as string;
        if (!ciCustNum) {
          return "Kundnummer saknas. Ange kundnummer för att skapa fakturan.";
        }
        const result = await callFortnoxWrite(
          "createInvoice",
          {
            invoice: {
              CustomerNumber: ciCustNum,
              InvoiceRows: ciArgs.InvoiceRows || ciArgs.invoice_rows || [],
              InvoiceDate: (ciArgs.InvoiceDate || ciArgs.invoice_date ||
                new Date().toISOString().slice(0, 10)) as string,
              DueDate: (ciArgs.DueDate || ciArgs.due_date || undefined) as string | undefined,
              Comments: (ciArgs.Comments || ciArgs.comments || undefined) as string | undefined,
            },
          },
          "create_invoice",
          String(ciCustNum),
        );
        const inv = (result as any)?.Invoice || result;
        void auditService.log({
          userId,
          companyId: companyId || undefined,
          actorType: "ai",
          action: "create",
          resourceType: "invoice",
          resourceId: String(inv.InvoiceNumber || ""),
          newState: result,
        });
        return `Kundfaktura skapad som utkast (nr ${inv.InvoiceNumber || "tilldelas"}) i Fortnox.`;
      }
      case "update_invoice": {
        const uiArgs = toolArgs as Record<string, unknown>;
        const docNum = Number(uiArgs.DocumentNumber || uiArgs.document_number);
        if (!docNum) throw new Error("DocumentNumber saknas för update_invoice");

        const invoiceUpdate: Record<string, unknown> = {};
        if (uiArgs.InvoiceRows && Array.isArray(uiArgs.InvoiceRows)) invoiceUpdate.InvoiceRows = uiArgs.InvoiceRows;
        if (uiArgs.DueDate) invoiceUpdate.DueDate = uiArgs.DueDate;
        if (uiArgs.Comments) invoiceUpdate.Comments = uiArgs.Comments;
        if (uiArgs.OurReference) invoiceUpdate.OurReference = uiArgs.OurReference;
        if (uiArgs.YourReference) invoiceUpdate.YourReference = uiArgs.YourReference;
        if (uiArgs.InvoiceDate) invoiceUpdate.InvoiceDate = uiArgs.InvoiceDate;

        const result = await callFortnoxWrite(
          "updateInvoice",
          { documentNumber: docNum, invoice: invoiceUpdate },
          "update_invoice",
          String(docNum),
        );
        const updatedInv = (result as any)?.Invoice || result;
        void auditService.log({
          userId,
          companyId: companyId || undefined,
          actorType: "ai",
          action: "update",
          resourceType: "invoice",
          resourceId: String(docNum),
          newState: result,
        });
        return `Faktura ${docNum} har uppdaterats (ny total: ${updatedInv.Total || "?"} kr) i Fortnox.`;
      }
      case "company_lookup": {
        return await lookupCompanyOnAllabolag((toolArgs as any).company_name);
      }
      case "create_customer": {
        const ccArgs = toolArgs as Record<string, unknown>;
        const customerName = (ccArgs.name || ccArgs.Name) as string;
        if (!customerName) {
          return "Kundnamn saknas. Ange name för att skapa kunden.";
        }
        let orgNr = (ccArgs.org_number || ccArgs.OrganisationNumber) as string | undefined;
        let address = (ccArgs.Address1 || ccArgs.address) as string | undefined;
        let zipCode = (ccArgs.ZipCode || ccArgs.zip_code) as string | undefined;
        let city = (ccArgs.City || ccArgs.city) as string | undefined;

        // Auto-enrich from allabolag.se if org number is missing
        if (!orgNr && customerName) {
          try {
            const lookupText = await lookupCompanyOnAllabolag(customerName);
            const lineMatch = lookupText.match(/^- .+?\((\d{6}-?\d{4})\):\s*(.+?),\s*(\d{3}\s?\d{2})\s+(.+?)\s*\[/m);
            if (lineMatch) {
              orgNr = orgNr || lineMatch[1];
              address = address || lineMatch[2].trim();
              zipCode = zipCode || lineMatch[3].trim();
              city = city || lineMatch[4].trim();
              logger.info("Auto-enriched customer from allabolag", { customerName, orgNr, city });
            }
          } catch (lookupErr) {
            logger.warn("Allabolag enrichment failed for create_customer", { error: lookupErr instanceof Error ? lookupErr.message : "unknown" });
          }
        }

        const result = await callFortnoxWrite(
          "findOrCreateCustomer",
          {
            customer: {
              Name: customerName,
              OrganisationNumber: orgNr || undefined,
              Email: (ccArgs.email || ccArgs.Email) as string | undefined,
              Address1: address || undefined,
              ZipCode: zipCode || undefined,
              City: city || undefined,
            },
          },
          "create_customer",
          String(orgNr || customerName),
        );
        const customer = (result as any).Customer || result;
        void auditService.log({
          userId,
          companyId: companyId || undefined,
          actorType: "ai",
          action: "create",
          resourceType: "customer",
          resourceId: String(customer.CustomerNumber || ""),
          newState: customer,
        });
        return `Kund skapad: ${customer.Name || customerName} (kundnr ${customer.CustomerNumber || "tilldelas"})`;
      }
      default:
        return null;
    }
  } catch (err) {
    logger.error(`Fortnox tool ${toolName} failed`, { error: err instanceof Error ? err.message : "unknown" });
    const friendlyNames: Record<string, string> = {
      get_customers: "hämtning av kunder",
      get_suppliers: "hämtning av leverantörer",
      get_articles: "hämtning av artiklar",
      get_invoice: "hämtning av faktura",
      get_supplier_invoice: "hämtning av leverantörsfaktura",
      create_invoice: "skapande av faktura",
      get_vat_report: "hämtning av momsrapport",
      get_company_info: "hämtning av företagsinfo",
      get_financial_summary: "hämtning av ekonomisk sammanfattning",
      get_account_balances: "hämtning av kontosaldon",
      create_voucher: "skapande av verifikation",
      lookup_company: "sökning av företag",
    };
    const friendly = friendlyNames[toolName] || "åtgärden";
    return `Ett fel uppstod vid ${friendly}. Försök igen om en stund.`;
  }
}

/** Fortnox read and write tool name lists for filtering */
export const FORTNOX_READ_TOOLS = [
  "get_suppliers", "get_customers", "get_articles",
  "search_invoices", "get_invoice", "search_supplier_invoices",
  "get_supplier_invoice", "get_company_info", "get_financial_summary",
  "search_vouchers", "get_vouchers", "get_account_balances",
  "get_vat_report", "search_customers",
];
export const FORTNOX_WRITE_TOOLS = [
  "create_invoice", "create_supplier", "create_supplier_invoice",
  "create_customer", "create_journal_entry", "export_journal_to_fortnox",
  "register_payment",
];
export const ALL_FORTNOX_TOOLS = [...FORTNOX_READ_TOOLS, ...FORTNOX_WRITE_TOOLS];

/** Accounting tool names that get template formatting */
export const ACCOUNTING_TOOL_RESPONSE_NAMES = new Set([
  "create_supplier",
  "create_supplier_invoice",
  "create_journal_entry",
  "export_journal_to_fortnox",
]);
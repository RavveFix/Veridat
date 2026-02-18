import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";

import {
  buildAccountingContract,
  formatToolResponse,
  isAccountingIntent,
} from "./AccountingResponseContract.ts";

Deno.test("isAccountingIntent skiljer hälsning från ekonomifråga", () => {
  assertEquals(isAccountingIntent({ message: "hej" }), false);
  assertEquals(
    isAccountingIntent({ message: "Hur bokför jag moms för februari?" }),
    true,
  );
});

Deno.test("isAccountingIntent blir true med VAT-kontext även vid kort fråga", () => {
  assertEquals(
    isAccountingIntent({
      message: "hur",
      vatReportContext: { type: "vat_report", period: "2026-02" },
    }),
    true,
  );
});

Deno.test("buildAccountingContract innehåller sektioner i rätt ordning", () => {
  const contract = buildAccountingContract({
    sourceCitationStyle: "Kort källa + datum",
    assumptionPolicy: "Visa antaganden + fråga",
    postingLayout: "Markdown-tabell",
  });

  const shortIndex = contract.indexOf("### Kort svar");
  const postingIndex = contract.indexOf("### Kontering");
  const assumptionsIndex = contract.indexOf(
    "### Antaganden / behöver bekräftas",
  );
  const nextStepsIndex = contract.indexOf("### Nästa steg");
  const sourceIndex = contract.indexOf("### Källa + datum");

  assert(shortIndex >= 0);
  assert(postingIndex > shortIndex);
  assert(assumptionsIndex > postingIndex);
  assert(nextStepsIndex > assumptionsIndex);
  assert(sourceIndex > nextStepsIndex);
});

Deno.test("formatToolResponse visar antaganden och bekräftelsefråga när underlag saknas", () => {
  const formatted = formatToolResponse({
    toolName: "create_supplier_invoice",
    rawText: "Leverantörsfaktura skapad.",
    structuredData: {
      toolArgs: {
        account: 6540,
        total_amount: 1250,
        vat_rate: 25,
      },
      assumptions: ["Fakturadatum saknas i underlaget."],
    },
  });

  assertStringIncludes(formatted, "### Antaganden / behöver bekräftas");
  assertStringIncludes(formatted, "Fakturadatum saknas i underlaget.");
  assertStringIncludes(formatted, "Kan du bekräfta");
});

Deno.test("formatToolResponse visar kort källrad med datum", () => {
  const formatted = formatToolResponse({
    toolName: "web_search",
    rawText: "Regler uppdaterade.",
    structuredData: {
      source: "Skatteverket",
      date: "2026-02-17",
    },
  });

  assertStringIncludes(formatted, "### Källa + datum");
  assertStringIncludes(formatted, "Källa: Skatteverket, 2026-02-17");
});

Deno.test("formatToolResponse sektionerar Fortnox-tool-svar", () => {
  const formatted = formatToolResponse({
    toolName: "get_vouchers",
    rawText: "Hittade 3 verifikationer.",
    structuredData: {
      toolArgs: {
        financial_year: 2026,
      },
    },
  });

  assertStringIncludes(formatted, "### Kort svar");
  assertStringIncludes(formatted, "### Kontering");
  assertStringIncludes(
    formatted,
    "| Konto | Kontonamn | Debet | Kredit | Kommentar |",
  );
  assertStringIncludes(formatted, "### Nästa steg");
});

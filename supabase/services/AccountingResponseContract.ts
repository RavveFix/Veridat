export type AccountingIntentInput = {
  message: string;
  vatReportContext?: unknown | null;
  toolName?: string | null;
  hasFileAttachment?: boolean;
};

export type AccountingContractInput = {
  sourceCitationStyle: string;
  assumptionPolicy: string;
  postingLayout: string;
};

type PostingRow = {
  account: string;
  accountName: string;
  debit: number | string | null;
  credit: number | string | null;
  comment: string;
};

export type FormatToolResponseInput = {
  toolName: string;
  rawText: string;
  structuredData?: Record<string, unknown> | null;
};

const ACCOUNTING_TOOLS = new Set([
  "get_customers",
  "get_articles",
  "get_suppliers",
  "get_vouchers",
  "create_supplier",
  "create_supplier_invoice",
  "create_journal_entry",
  "export_journal_to_fortnox",
  "book_supplier_invoice",
  "web_search",
]);

const ACCOUNTING_SIGNAL_REGEX =
  /(moms|bokfor|verifikat|faktur|leverantor|fortnox|skatt|deklaration|konto|kontoplan|arsredovisning|balansrakning|resultatrakning|bokslut|vat|underlag)/;
const ATTACHMENT_SIGNAL_REGEX =
  /(faktur|kvitto|underlag|verifikat|leverantor|skattekonto|pdf|bilaga)/;

function normalizeSwedish(value: string): string {
  return value
    .toLowerCase()
    .replace(/[åä]/g, "a")
    .replace(/ö/g, "o");
}

export function isAccountingIntent(input: AccountingIntentInput): boolean {
  const message = input.message?.trim() || "";
  const toolName = (input.toolName || "").trim().toLowerCase();

  if (input.vatReportContext) return true;
  if (toolName && ACCOUNTING_TOOLS.has(toolName)) return true;
  if (!message) return false;

  const normalizedMessage = normalizeSwedish(message);
  const hasAccountingSignal = ACCOUNTING_SIGNAL_REGEX.test(normalizedMessage);

  if (!hasAccountingSignal) {
    if (
      input.hasFileAttachment && ATTACHMENT_SIGNAL_REGEX.test(normalizedMessage)
    ) {
      return true;
    }
    return false;
  }

  return true;
}

function cleanContractOption(
  value: string | undefined,
  fallback: string,
): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

export function buildAccountingContract(
  input: AccountingContractInput,
): string {
  const sourceCitationStyle = cleanContractOption(
    input.sourceCitationStyle,
    "Kort källa + datum (YYYY-MM-DD).",
  );
  const assumptionPolicy = cleanContractOption(
    input.assumptionPolicy,
    "Visa antaganden kort och ställ en bekräftelsefråga.",
  );
  const postingLayout = cleanContractOption(
    input.postingLayout,
    "Markdown-tabell med Konto, Kontonamn, Debet, Kredit, Kommentar.",
  );

  return [
    "SYSTEM FORMATKONTRAKT: Ekonomi och redovisning (mjuk, intent-styrd).",
    "Använd detta enbart för ekonomi/redovisning. För hälsningar eller småprat: svara kort och naturligt utan mall.",
    "",
    "Regler för svar:",
    "- Svara på svenska utan emoji.",
    "- Följ sektionerna i exakt ordning nedan.",
    "- Skriv sektionerna som Markdown-rubriker, inte som numrerad lista.",
    "- Använd exakt dessa rubriker:",
    "  ### Kort svar",
    "  ### Kontering",
    "  ### Antaganden / behöver bekräftas",
    "  ### Nästa steg",
    "  ### Källa + datum",
    "",
    "Kort svar",
    "- 1-2 meningar med beslut eller rekommendation.",
    "",
    "Kontering",
    `- Layout: ${postingLayout}`,
    "- Om exakt kontering saknas, visa ändå tabellen och markera osäkerhet i Kommentar.",
    "",
    "Antaganden / behöver bekräftas",
    `- Policy: ${assumptionPolicy}`,
    "- Ta bara med sektionen när underlag saknas eller osäkerhet finns.",
    "",
    "Nästa steg",
    "- Använd en numrerad lista med formatet 1. 2. 3.",
    "- Var konkret och handlingsinriktad.",
    "",
    "Källa + datum",
    `- Stil: ${sourceCitationStyle}`,
    "- Visa endast för regel- eller tidskänsliga påståenden.",
  ].join("\n");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const normalized = value.trim().replace(",", ".");
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatAmount(value: number | string | null): string {
  if (value === null) return "—";
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : "—";
  }
  if (!Number.isFinite(value)) return "—";

  return new Intl.NumberFormat("sv-SE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|");
}

function parseEntryRows(value: unknown): PostingRow[] {
  if (!Array.isArray(value)) return [];

  const rows: PostingRow[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (!record) continue;

    const account =
      asString(record.account ?? record.Account ?? record.konto) || "—";
    const accountName = asString(
      record.accountName ?? record.Kontonamn ?? record.account_name ??
        record.Description ?? record.description,
    ) || "—";
    const debit = asNumber(record.debit ?? record.Debit);
    const credit = asNumber(record.credit ?? record.Credit);
    const comment = asString(
      record.comment ?? record.Kommentar ?? record.Description ??
        record.description,
    ) || "";

    rows.push({
      account,
      accountName,
      debit,
      credit,
      comment,
    });
  }

  return rows;
}

function buildSupplierInvoiceRows(
  structuredData: Record<string, unknown>,
): PostingRow[] {
  const toolArgs = asRecord(structuredData.toolArgs) ?? structuredData;
  const account = asString(toolArgs.account) || "—";
  const totalAmount = asNumber(toolArgs.total_amount);
  const vatRate = asNumber(toolArgs.vat_rate);

  if (totalAmount === null || vatRate === null) {
    return [];
  }

  const vatMultiplier = 1 + (vatRate / 100);
  const netAmount = Math.round((totalAmount / vatMultiplier) * 100) / 100;
  const vatAmount = Math.round((totalAmount - netAmount) * 100) / 100;

  return [
    {
      account,
      accountName: "Kostnad",
      debit: netAmount,
      credit: null,
      comment: "Kostnadsrad från leverantörsfaktura",
    },
    {
      account: "2640",
      accountName: "Ingående moms",
      debit: vatAmount,
      credit: null,
      comment: `Moms ${vatRate}%`,
    },
    {
      account: "2440",
      accountName: "Leverantörsskulder",
      debit: null,
      credit: totalAmount,
      comment: "Total skuld till leverantören",
    },
  ];
}

function resolvePostingRows(
  toolName: string,
  structuredData: Record<string, unknown>,
): PostingRow[] {
  const explicitRows = parseEntryRows(
    structuredData.postingRows ?? structuredData.entries ?? structuredData.rows,
  );
  if (explicitRows.length > 0) {
    return explicitRows;
  }

  if (toolName === "create_supplier_invoice") {
    return buildSupplierInvoiceRows(structuredData);
  }

  return [];
}

function extractFirstSentence(value: string): string | null {
  const cleaned = value
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;

  const sentenceMatch = cleaned.match(/^(.{1,240}?[.!?])(\s|$)/);
  if (sentenceMatch) return sentenceMatch[1].trim();

  return cleaned.length > 240 ? `${cleaned.slice(0, 237)}...` : cleaned;
}

function buildShortAnswer(
  toolName: string,
  rawText: string,
  structuredData: Record<string, unknown>,
): string {
  const verificationId = asString(
    structuredData.verificationId ?? structuredData.verification_id,
  );

  switch (toolName) {
    case "get_customers":
      return "Jag har hämtat kundinformationen i Fortnox och sammanfattat nästa steg nedan.";
    case "get_articles":
      return "Jag har hämtat artikelinformationen i Fortnox och sammanfattat vad du kan göra härnäst.";
    case "get_suppliers":
      return "Jag har hämtat leverantörerna från Fortnox och sammanfattat nästa steg.";
    case "get_vouchers":
      return "Jag har hämtat verifikationerna från Fortnox och sammanfattat hur du går vidare.";
    case "create_supplier":
      return "Leverantören är skapad i Fortnox och kan nu användas i leverantörsfakturor.";
    case "create_supplier_invoice":
      return "Leverantörsfakturan är skapad och konteringsförslaget visas nedan för snabb kontroll.";
    case "export_journal_to_fortnox":
      return "Verifikatet är exporterat till Fortnox och redo för vidare hantering där.";
    case "book_supplier_invoice":
      return "Leverantörsfakturan är nu bokförd i Fortnox.";
    case "create_journal_entry":
      return verificationId
        ? `Verifikat ${verificationId} är skapat och sammanfattat nedan.`
        : "Verifikatet är skapat och sammanfattat nedan.";
    case "web_search":
      return "Jag har sammanfattat den relevanta regelinformationen och vad du bör göra nu.";
    default:
      return extractFirstSentence(rawText) ||
        "Jag har sammanfattat resultatet och nästa steg nedan.";
  }
}

function buildAssumptions(
  toolName: string,
  structuredData: Record<string, unknown>,
): { items: string[]; question: string | null } {
  const assumptions = new Set<string>();

  const explicitAssumptions = structuredData.assumptions;
  if (Array.isArray(explicitAssumptions)) {
    for (const item of explicitAssumptions) {
      const text = asString(item);
      if (text) assumptions.add(text);
    }
  }

  if (toolName === "create_supplier_invoice") {
    const toolArgs = asRecord(structuredData.toolArgs) ?? structuredData;
    if (!asString(toolArgs.invoice_number)) {
      assumptions.add(
        "Fakturanummer saknas i underlaget och behöver bekräftas.",
      );
    }
    if (!asString(toolArgs.due_date)) {
      assumptions.add(
        "Förfallodatum saknas i underlaget och antas enligt standardvillkor.",
      );
    }
  }

  if (
    toolName === "create_journal_entry" &&
    !asString(structuredData.verificationId ?? structuredData.verification_id)
  ) {
    assumptions.add(
      "Verifikations-ID kunde inte valideras mot ett externt underlag.",
    );
  }

  if (assumptions.size === 0) {
    return { items: [], question: null };
  }

  const question = asString(structuredData.confirmationQuestion) ||
    "Kan du bekräfta att antagandena ovan stämmer innan vi går vidare?";

  return {
    items: Array.from(assumptions),
    question,
  };
}

function buildNextSteps(toolName: string): string[] {
  switch (toolName) {
    case "create_supplier_invoice":
      return [
        "Bekräfta konto, momssats och förfallodatum mot fakturaunderlaget.",
        "Godkänn fakturan i Fortnox när uppgifterna är verifierade.",
        "Säg till om du vill att jag bokför fakturan direkt efter kontrollen.",
      ];
    case "create_journal_entry":
      return [
        "Kontrollera att konteringsraderna matchar verifikationsunderlaget.",
        "Bekräfta att debet och kredit är balanserade.",
        "Säg till om verifikatet ska exporteras till Fortnox.",
      ];
    case "export_journal_to_fortnox":
      return [
        "Öppna verifikatet i Fortnox och kontrollera att datum och serie är korrekta.",
        "Matcha verifikatet mot underlaget i bokföringen.",
        "Säg till om du vill fortsätta med nästa verifikat.",
      ];
    case "book_supplier_invoice":
      return [
        "Kontrollera att fakturan har rätt betalstatus i Fortnox.",
        "Matcha bokföringen mot leverantörsreskontran.",
        "Säg till om du vill gå vidare med nästa faktura.",
      ];
    default:
      return [
        "Bekräfta att resultatet stämmer med ditt underlag.",
        "Säg till vilket nästa bokföringssteg du vill att jag gör i Fortnox.",
      ];
  }
}

function normalizeDate(value: string | null): string {
  if (!value) return new Date().toISOString().slice(0, 10);
  const datePart = value.trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    return datePart;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return parsed.toISOString().slice(0, 10);
}

function buildSourceLine(
  toolName: string,
  structuredData: Record<string, unknown>,
): string | null {
  const explicitLine = asString(structuredData.sourceLine);
  if (explicitLine) return explicitLine;

  const source = asString(structuredData.source);
  const date = normalizeDate(
    asString(
      structuredData.date ?? structuredData.fetchedAt ??
        structuredData.fetched_at,
    ),
  );

  if (source) {
    return `Källa: ${source}, ${date}`;
  }

  if (toolName === "web_search") {
    return `Källa: Webbsökning, ${date}`;
  }

  return null;
}

function renderPostingTable(rows: PostingRow[]): string {
  const normalizedRows = rows.length > 0 ? rows : [{
    account: "—",
    accountName: "Ej tillämpligt",
    debit: null,
    credit: null,
    comment: "Ingen kontering skapades i detta steg.",
  }];

  const lines = [
    "| Konto | Kontonamn | Debet | Kredit | Kommentar |",
    "|---|---|---:|---:|---|",
  ];

  for (const row of normalizedRows) {
    lines.push(
      `| ${escapeCell(row.account)} | ${escapeCell(row.accountName)} | ${
        formatAmount(row.debit)
      } | ${formatAmount(row.credit)} | ${escapeCell(row.comment || "—")} |`,
    );
  }

  return lines.join("\n");
}

export function formatToolResponse(input: FormatToolResponseInput): string {
  const toolName = (input.toolName || "").trim().toLowerCase();
  const rawText = input.rawText?.trim() || "";
  const structuredData = asRecord(input.structuredData) || {};

  const shortAnswer = buildShortAnswer(toolName, rawText, structuredData);
  const postingRows = resolvePostingRows(toolName, structuredData);
  const assumptions = buildAssumptions(toolName, structuredData);
  const nextSteps = buildNextSteps(toolName);
  const sourceLine = buildSourceLine(toolName, structuredData);

  const sections: string[] = [];

  sections.push(`### Kort svar\n${shortAnswer}`);
  sections.push(`### Kontering\n${renderPostingTable(postingRows)}`);

  if (assumptions.items.length > 0) {
    const assumptionLines = assumptions.items.map((item) => `- ${item}`);
    if (assumptions.question) {
      assumptionLines.push("", assumptions.question);
    }
    sections.push(
      `### Antaganden / behöver bekräftas\n${assumptionLines.join("\n")}`,
    );
  }

  sections.push(
    `### Nästa steg\n${
      nextSteps.map((step, index) => `${index + 1}. ${step}`).join("\n")
    }`,
  );

  if (sourceLine) {
    sections.push(`### Källa + datum\n${sourceLine}`);
  }

  return sections.join("\n\n");
}

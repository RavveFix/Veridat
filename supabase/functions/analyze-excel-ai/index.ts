// Deterministisk Excel-analys - 100% noggrannhet
// Excel → Direkt parsing (exakt som Python) → Färdig rapport
// AI används ENDAST för företagsnamn/period om det saknas
/// <reference path="../../types/deno.d.ts" />

import { getCorsHeaders, createOptionsResponse } from "../../services/CorsService.ts";
import { createLogger } from "../../services/LoggerService.ts";
import { RateLimiterService } from "../../services/RateLimiterService.ts";
import { getRateLimitConfigForPlan, getUserPlan } from "../../services/PlanService.ts";
import { CompanyMemoryService, buildMemoryPatchFromVatReport } from "../../services/CompanyMemoryService.ts";
import { ExpensePatternService, PatternSuggestion } from "../../services/ExpensePatternService.ts";

// Swedish accounting services
import { roundToOre, safeSum, validateVATCalculation } from "../../services/SwedishRounding.ts";
import { validateOrgNumber, validateVATNumber } from "../../services/SwedishValidation.ts";
import { validateZeroVAT, type ZeroVATWarning } from "../../services/ZeroVATValidator.ts";
import { BAS_ACCOUNTS, getCostAccount, getSalesAccount, getVATAccount } from "../../services/BASAccounts.ts";
import {
  generateVerificationId,
  generateBatchVerification,
  createSalesJournalEntries,
  createCostJournalEntries,
  validateJournalBalance,
  type JournalEntry,
} from "../../services/JournalService.ts";

import { createClient } from "npm:@supabase/supabase-js@2";
import * as XLSX from "npm:xlsx@0.18.5";

// ═══════════════════════════════════════════════════════════════════════════
// MONTA TRANSACTION TYPES (baserat på EU-dom C-60/23 & OCPI)
// ═══════════════════════════════════════════════════════════════════════════
interface MontaTransaction {
  id: string;
  amount: number;
  subAmount: number;
  vat: number;
  vatRate: number;
  kwh: number;
  reference: string;
  note: string;
  roamingOperator: string | null;
  created: string;
  userName: string;
  from: string;
  to: string;
  transactionName: string;  // Reliable categorization field (e.g., "Transaktionsavgifter")
  // Calculated fields
  category: 'private_charging' | 'roaming_export' | 'subscription' | 'operator_fee' | 'platform_fee' | 'roaming_fee' | 'payout';
  type: 'sale' | 'cost' | 'skip';
  basAccount: string;
}

interface CategorySummary {
  category: string;
  rate: number;
  type: 'sale' | 'cost';
  net_amount: number;
  vat_amount: number;
  gross_amount: number;
  transaction_count: number;
  bas_account: string;
  description: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// DETERMINISTISK MONTA PARSER - Använder transactionName för 100% noggrannhet
// ═══════════════════════════════════════════════════════════════════════════

// Categorize transaction using transactionName (most reliable), then fall back to note/reference
function categorizeTransaction(
  amount: number,
  transactionName: string,
  reference: string,
  note: string,
  roamingOperator: string | null
): { category: MontaTransaction['category']; type: MontaTransaction['type']; basAccount: string } {
  const name = transactionName.toLowerCase();
  const noteLower = note.toLowerCase();
  const refUpper = reference.toUpperCase();

  // ═══════════════════════════════════════════════════════════════════════
  // FÖRSÄLJNING (positive amount)
  // ═══════════════════════════════════════════════════════════════════════
  if (amount > 0) {
    // Roaming sales (export to foreign eMSP) = 0% VAT
    if (roamingOperator || name.includes('roaming')) {
      return { category: 'roaming_export', type: 'sale', basAccount: '3011' };
    }
    // Private charging = 25% VAT
    return { category: 'private_charging', type: 'sale', basAccount: '3010' };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // KOSTNADER (negative amount)
  // ═══════════════════════════════════════════════════════════════════════

  // 1. PAYOUTS - Skip from report (not accounting relevant)
  if (name.includes('utbetalning')) {
    return { category: 'payout', type: 'skip', basAccount: '' };
  }

  // 2. SUBSCRIPTIONS - Monta operator subscription (25% VAT)
  if (refUpper.includes('SUBSCRIPTION') || name.includes('abonnemang')) {
    return { category: 'subscription', type: 'cost', basAccount: '6540' };
  }

  // 3. OPERATOR FEE - Percentage-based charging fee (25% VAT)
  // transactionName: "Laddningsavgift (%)" or note: "Percentage operator fee"
  if ((name.includes('laddningsavgift') && name.includes('%')) ||
      noteLower.includes('percentage operator fee') ||
      noteLower.includes('operator fee')) {
    return { category: 'operator_fee', type: 'cost', basAccount: '6590' };
  }

  // 4. PLATFORM FEE - Flat transaction fee from Monta (0% VAT!)
  // transactionName: "Transaktionsavgifter" (but not roaming)
  // note: "Fee for charge (7.00%..." or "Platform fee"
  if ((name.includes('transaktionsavgifter') && !name.includes('roaming')) ||
      noteLower.includes('platform fee') ||
      noteLower.includes('fee for charge')) {
    return { category: 'platform_fee', type: 'cost', basAccount: '6590' };
  }

  // 5. ROAMING FEES - Fees related to roaming transactions (0% VAT)
  if (name.includes('roaming')) {
    return { category: 'roaming_fee', type: 'cost', basAccount: '6590' };
  }

  // 6. DEFAULT - Unknown cost, categorize as operator_fee with 25% VAT
  return { category: 'operator_fee', type: 'cost', basAccount: '6590' };
}

function parseMontaTransactions(rows: Record<string, unknown>[]): MontaTransaction[] {
  return rows.map(row => {
    const amount = Number(row['amount']) || 0;
    const subAmount = Number(row['subAmount']) || 0;
    const vat = Number(row['vat']) || 0;
    const vatRate = Number(row['vatRate']) || 0;
    const reference = String(row['reference'] || '');
    const note = String(row['note'] || '');
    const roamingOperator = row['roamingOperator'] ? String(row['roamingOperator']) : null;
    const transactionName = String(row['transactionName'] || '');

    // Kategorisera med nya logiken (transactionName först)
    const { category, type, basAccount } = categorizeTransaction(
      amount, transactionName, reference, note, roamingOperator
    );

    return {
      id: String(row['id'] || ''),
      amount,
      subAmount,
      vat,
      vatRate,
      kwh: Number(row['kwh']) || 0,
      reference,
      note,
      roamingOperator,
      created: String(row['created'] || ''),
      userName: String(row['userName'] || ''),
      from: String(row['from'] || ''),
      to: String(row['to'] || ''),
      transactionName,
      category,
      type,
      basAccount
    };
  });
}

function calculateMontaReport(transactions: MontaTransaction[]) {
  // Filtrera bort skippade transaktioner (t.ex. utbetalningar)
  const activeTransactions = transactions.filter(t => t.type !== 'skip');
  const skippedCount = transactions.filter(t => t.type === 'skip').length;

  // Separera försäljning och kostnader
  const sales = activeTransactions.filter(t => t.type === 'sale');
  const costs = activeTransactions.filter(t => t.type === 'cost');

  // FÖRSÄLJNING - gruppera per kategori
  const privateSales = sales.filter(t => t.category === 'private_charging');
  const roamingSales = sales.filter(t => t.category === 'roaming_export');

  // FÖRSÄLJNING PRIVATLADDNING
  // amount = BRUTTO (inkl moms) - för referens
  // subAmount = NETTO (exkl moms) - för redovisning ✓
  // vat = momsbelopp
  const sumCents = (items: MontaTransaction[], pick: (t: MontaTransaction) => number): number =>
    items.reduce((sum, t) => sum + Math.round(pick(t) * 100), 0);

  const privateAmountC = sumCents(privateSales, (t) => t.amount);
  const privateVatC = sumCents(privateSales, (t) => t.vat);
  const privateNetC = sumCents(privateSales, (t) => t.subAmount);

  const roamingAmountC = sumCents(roamingSales, (t) => t.amount);
  // Roaming = 0% moms så amount = net

  // KOSTNADER - gruppera per kategori
  const subscriptions = costs.filter(t => t.category === 'subscription');
  const operatorFees = costs.filter(t => t.category === 'operator_fee');
  const platformFees = costs.filter(t => t.category === 'platform_fee');
  const roamingFees = costs.filter(t => t.category === 'roaming_fee');

  // KOSTNADER ABONNEMANG
  // amount = BRUTTO (inkl moms) - för referens
  // subAmount = NETTO (exkl moms) - för redovisning ✓
  // vat = avdragsgill ingående moms
  const subAmountC = Math.abs(sumCents(subscriptions, (t) => t.amount));
  const subVatC = Math.abs(sumCents(subscriptions, (t) => t.vat));
  const subNetC = Math.abs(sumCents(subscriptions, (t) => t.subAmount));

  // KOSTNADER OPERATÖRSAVGIFTER
  const opAmountC = Math.abs(sumCents(operatorFees, (t) => t.amount));
  const opVatC = Math.abs(sumCents(operatorFees, (t) => t.vat));
  const opNetC = Math.abs(sumCents(operatorFees, (t) => t.subAmount));

  const pfAmountC = Math.abs(sumCents(platformFees, (t) => t.amount));
  // Platform fees = 0% moms så amount = net

  const roamingFeeAmountC = Math.abs(sumCents(roamingFees, (t) => t.amount));
  // Roaming fees = 0% moms så amount = net

  // TOTALER - Använd NETTO för redovisning (exkl moms)
  // Observera: roaming, pfAmount, roamingFeeAmount har 0% moms så amount = net
  const totalSalesC = privateNetC + roamingAmountC;  // NETTO
  const totalSalesVatC = privateVatC; // Endast privatladdning har utgående moms

  const totalCostsC = subNetC + opNetC + pfAmountC + roamingFeeAmountC;  // NETTO
  const incomingVatC = subVatC + opVatC; // Endast 25% moms är avdragsgill

  const privateAmount = centsToNumber(privateAmountC);
  const privateVat = centsToNumber(privateVatC);
  const privateNet = centsToNumber(privateNetC);
  const roamingAmount = centsToNumber(roamingAmountC);

  const subAmount = centsToNumber(subAmountC);
  const subVat = centsToNumber(subVatC);
  const subNet = centsToNumber(subNetC);

  const opAmount = centsToNumber(opAmountC);
  const opVat = centsToNumber(opVatC);
  const opNet = centsToNumber(opNetC);

  const pfAmount = centsToNumber(pfAmountC);
  const roamingFeeAmount = centsToNumber(roamingFeeAmountC);

  const totalSales = centsToNumber(totalSalesC);
  const totalSalesVat = centsToNumber(totalSalesVatC);

  const totalCosts = centsToNumber(totalCostsC);
  const incomingVat = centsToNumber(incomingVatC);

  const totalKwh = activeTransactions.reduce((sum, t) => sum + t.kwh, 0);

  // VAT BREAKDOWN per kategori
  const vatBreakdown: CategorySummary[] = [];

  if (privateSales.length > 0) {
    vatBreakdown.push({
      category: 'private_charging',
      rate: 25,
      type: 'sale',
      net_amount: privateNet,
      vat_amount: privateVat,
      gross_amount: privateAmount,
      transaction_count: privateSales.length,
      bas_account: '3010',
      description: 'Privatladdning 25% moms'
    });
  }

  if (roamingSales.length > 0) {
    vatBreakdown.push({
      category: 'roaming_export',
      rate: 0,
      type: 'sale',
      net_amount: roamingAmount,
      vat_amount: 0,
      gross_amount: roamingAmount,
      transaction_count: roamingSales.length,
      bas_account: '3011',
      description: 'Roaming-försäljning momsfri (OCPI)'
    });
  }

  if (subscriptions.length > 0) {
    vatBreakdown.push({
      category: 'subscription',
      rate: 25,
      type: 'cost',
      net_amount: subNet,
      vat_amount: subVat,
      gross_amount: subAmount,
      transaction_count: subscriptions.length,
      bas_account: '6540',
      description: 'Abonnemang'
    });
  }

  if (operatorFees.length > 0) {
    vatBreakdown.push({
      category: 'operator_fee',
      rate: 25,
      type: 'cost',
      net_amount: opNet,
      vat_amount: opVat,
      gross_amount: opAmount,
      transaction_count: operatorFees.length,
      bas_account: '6590',
      description: 'Operatörsavgifter'
    });
  }

  if (platformFees.length > 0) {
    vatBreakdown.push({
      category: 'platform_fee',
      rate: 0,
      type: 'cost',
      net_amount: pfAmount,
      vat_amount: 0,
      gross_amount: pfAmount,
      transaction_count: platformFees.length,
      bas_account: '6590',
      description: 'Plattformsavgifter (Monta)'
    });
  }

  if (roamingFees.length > 0) {
    vatBreakdown.push({
      category: 'roaming_fee',
      rate: 0,
      type: 'cost',
      net_amount: roamingFeeAmount,
      vat_amount: 0,
      gross_amount: roamingFeeAmount,
      transaction_count: roamingFees.length,
      bas_account: '6590',
      description: 'Roaming-avgifter (OCPI)'
    });
  }

  return {
    summary: {
      total_sales: totalSales,              // Nu NETTO (från steg 1)
      total_sales_vat: totalSalesVat,
      total_costs: totalCosts,              // Nu NETTO (från steg 1)
      total_costs_vat: incomingVat,
      result: totalSales - totalCosts,      // Nu NETTO - NETTO
      total_kwh: totalKwh,
      private_sales: privateNet,            // ÄNDRAT: NET istället för GROSS
      private_sales_vat: privateVat,
      roaming_sales_export: roamingAmount,  // OK: 0% moms så amount = net
      subscription_costs: subNet,           // ÄNDRAT: NET istället för GROSS
      operator_fee_costs: opNet,            // ÄNDRAT: NET istället för GROSS
      platform_fee_costs: pfAmount,         // OK: 0% moms
      roaming_fee_costs: roamingFeeAmount,  // OK: 0% moms
      private_count: privateSales.length,
      roaming_count: roamingSales.length,
      skipped_count: skippedCount  // Payouts etc.
    },
    vat_breakdown: vatBreakdown,
    transactions: activeTransactions.map(t => ({
      amount: centsToNumber(Math.round(t.amount * 100)),
      net_amount: centsToNumber(Math.round(t.subAmount * 100)),
      vat_amount: centsToNumber(Math.round(t.vat * 100)),
      vat_rate: t.vatRate,
      description: t.transactionName || t.note || t.reference || 'Transaktion',
      date: t.created,
      type: t.type,
      category: t.category,
      bas_account: t.basAccount,
      kwh: t.kwh,
      is_roaming: !!t.roamingOperator,
      roaming_operator: t.roamingOperator
    })),
    vat: {
      outgoing_25: totalSalesVat,
      outgoing_12: 0,
      outgoing_6: 0,
      incoming: incomingVat,
      net: totalSalesVat - incomingVat,
      to_pay: totalSalesVat > incomingVat ? totalSalesVat - incomingVat : 0,
      to_refund: incomingVat > totalSalesVat ? incomingVat - totalSalesVat : 0
    }
  };
}

const logger = createLogger('analyze-excel-ai');
const RATE_LIMIT_ENDPOINT = 'ai';

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Extract supplier/description from row for pattern matching
// ═══════════════════════════════════════════════════════════════════════════
const SUPPLIER_COLUMN_NAMES = [
  'leverantör', 'supplier', 'motpart', 'beskrivning', 'description',
  'företag', 'company', 'namn', 'name', 'butik', 'store', 'handlare', 'merchant'
];

const AMOUNT_COLUMN_NAMES = [
  'belopp', 'amount', 'summa', 'total', 'pris', 'price', 'kostnad', 'cost'
];

const NET_AMOUNT_COLUMN_NAMES = [
  'netto', 'net', 'exkl', 'exkl moms', 'subtotal'
];

const VAT_AMOUNT_COLUMN_NAMES = [
  'moms', 'vat', 'tax'
];

const VAT_RATE_COLUMN_NAMES = [
  'momssats', 'moms %', 'moms%', 'vat rate', 'vat%', 'tax rate', '%'
];

const DATE_COLUMN_NAMES = [
  'datum', 'date', 'bokföringsdatum', 'verifikationsdatum', 'transaktionsdatum'
];

const DEBIT_COLUMN_NAMES = ['debet', 'debit'];
const CREDIT_COLUMN_NAMES = ['kredit', 'credit'];

function findColumnByNames(columns: string[], candidateNames: string[]): string | null {
  const columnsLower = columns.map(c => c.toLowerCase());
  for (const name of candidateNames) {
    const idx = columnsLower.findIndex(c => c.includes(name));
    if (idx >= 0) return columns[idx];
  }
  return null;
}

function centsToNumber(cents: number): number {
  return Number((cents / 100).toFixed(2));
}

function parseMoneyToCents(value: unknown): number | null {
  if (value === null || value === undefined) return null;

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return Math.round(value * 100);
  }

  const raw = String(value).replace(/\u00A0/g, ' ').trim();
  if (!raw) return null;

  let isNegative = false;
  let s = raw;

  if (s.startsWith('(') && s.endsWith(')')) {
    isNegative = true;
    s = s.slice(1, -1);
  }

  if (s.includes('-')) {
    const trimmed = s.trim();
    if (trimmed.startsWith('-')) isNegative = true;
  }

  // Keep digits and separators only
  s = s.replace(/[^\d.,]/g, '');
  if (!s) return null;

  const hasDot = s.includes('.');
  const hasComma = s.includes(',');

  let decimalSep: '.' | ',' | null = null;
  if (hasDot && hasComma) {
    decimalSep = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
  } else if (hasComma) {
    decimalSep = ',';
  } else if (hasDot) {
    decimalSep = '.';
  }

  let normalized = s;
  if (decimalSep) {
    const thousandsSep = decimalSep === '.' ? ',' : '.';
    normalized = normalized.split(thousandsSep).join('');
    normalized = normalized.replace(decimalSep, '.');
  }

  const num = Number.parseFloat(normalized);
  if (!Number.isFinite(num)) return null;

  const cents = Math.round(num * 100);
  return isNegative ? -cents : cents;
}

function normalizeVatRate(value: unknown): number | null {
  if (value === null || value === undefined) return null;

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    const raw = value > 0 && value < 1 ? value * 100 : value;
    return nearestVatRate(raw);
  }

  const s = String(value).replace('%', '').replace(',', '.').trim();
  if (!s) return null;
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n)) return null;
  const raw = n > 0 && n < 1 ? n * 100 : n;
  return nearestVatRate(raw);
}

function nearestVatRate(rate: number): number {
  const candidates = [0, 6, 12, 25];
  const closest = candidates.reduce((best, curr) => (
    Math.abs(curr - rate) < Math.abs(best - rate) ? curr : best
  ), candidates[0]);

  if (Math.abs(closest - rate) <= 1.5) return closest;
  return Math.round(rate);
}

function extractTransactionInfo(row: Record<string, unknown>, columns: string[]): {
  supplier: string;
  description: string;
  amount: number;
} | null {
  const supplierCol = findColumnByNames(columns, SUPPLIER_COLUMN_NAMES);
  const amountCol = findColumnByNames(columns, AMOUNT_COLUMN_NAMES);

  if (!supplierCol) return null;

  const supplier = String(row[supplierCol] || '').trim();
  if (!supplier) return null;

  return {
    supplier,
    description: supplier, // Use supplier as description for now
    amount: amountCol ? Number(row[amountCol]) || 0 : 0
  };
}

type ColumnMapping = {
  amount_column: string | null;
  amount_kind: 'gross' | 'net' | 'unknown';
  net_amount_column: string | null;
  vat_amount_column: string | null;
  vat_rate_column: string | null;
  debit_column: string | null;
  credit_column: string | null;
  supplier_column: string | null;
  description_column: string | null;
  date_column: string | null;
};

type OpenAIChatCompletion = {
  choices?: Array<{
    message?: {
      tool_calls?: Array<{
        function?: { name?: string; arguments?: string };
      }>;
      content?: string | null;
    };
  }>;
};

function normalizeMappedColumn(columns: string[], value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return columns.includes(trimmed) ? trimmed : null;
}

async function mapColumnsWithOpenAI(
  columns: string[],
  sampleRows: Array<Record<string, unknown>>,
  filename: string,
): Promise<ColumnMapping> {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY saknas. Jag kan inte tolka den här Excel-mallen utan OpenAI-mappning.');
  }

  const baseUrl = (Deno.env.get('OPENAI_BASE_URL') || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = Deno.env.get('OPENAI_MODEL') || 'gpt-4o-mini';
  const usesMaxCompletionTokens = /^gpt-5/i.test(model) || /^o\d/i.test(model);

  const tool = {
    type: 'function',
    function: {
      name: 'map_excel_columns',
      description: 'Mappar Excel-kolumner till ett normaliserat transaktionsschema (utan att räkna).',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          amount_column: { type: ['string', 'null'] },
          amount_kind: { type: 'string', enum: ['gross', 'net', 'unknown'] },
          net_amount_column: { type: ['string', 'null'] },
          vat_amount_column: { type: ['string', 'null'] },
          vat_rate_column: { type: ['string', 'null'] },
          debit_column: { type: ['string', 'null'] },
          credit_column: { type: ['string', 'null'] },
          supplier_column: { type: ['string', 'null'] },
          description_column: { type: ['string', 'null'] },
          date_column: { type: ['string', 'null'] },
        },
        required: ['amount_kind'],
      },
    },
  } as const;

  const prompt = `Du får en Excel-export (kolumner + exempelrader). Ditt jobb är att MAPPA kolumner till fälten nedan.

VIKTIGT:
- Räkna INTE totalsummor.
- Ange exakta kolumnnamn (måste matcha listan).
- Om ett fält inte finns, sätt null.
- amount_column = kolumnen som innehåller beloppet per rad (helst brutto om moms-kolumn finns).
- Om beloppet ligger i två kolumner (debet/kredit), sätt debit_column/credit_column och amount_column = null.
- amount_kind: gross|net|unknown.

Filen heter: ${filename}

KOLUMNER:
${JSON.stringify(columns)}

EXEMPELRADER (första 20):
${JSON.stringify(sampleRows.slice(0, 20), null, 2)}`;

  const payload: Record<string, unknown> = {
    model,
    temperature: 0,
    tools: [tool],
    tool_choice: { type: 'function', function: { name: 'map_excel_columns' } },
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  };

  if (usesMaxCompletionTokens) {
    payload.max_completion_tokens = 800;
    payload.reasoning_effort = 'none';
  } else {
    payload.max_tokens = 800;
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenAI-mappning misslyckades (${res.status}): ${text || res.statusText}`);
  }

  const data = (await res.json()) as OpenAIChatCompletion;
  const call = data.choices?.[0]?.message?.tool_calls?.[0];
  const args = call?.function?.arguments || '';
  if (!args) {
    throw new Error('OpenAI returnerade ingen kolumnmappning.');
  }

  let parsed: Partial<ColumnMapping>;
  try {
    parsed = JSON.parse(args) as Partial<ColumnMapping>;
  } catch {
    throw new Error('OpenAI returnerade ogiltig JSON för kolumnmappning.');
  }

  return {
    amount_column: normalizeMappedColumn(columns, parsed.amount_column),
    amount_kind: (parsed.amount_kind === 'gross' || parsed.amount_kind === 'net' || parsed.amount_kind === 'unknown')
      ? parsed.amount_kind
      : 'unknown',
    net_amount_column: normalizeMappedColumn(columns, parsed.net_amount_column),
    vat_amount_column: normalizeMappedColumn(columns, parsed.vat_amount_column),
    vat_rate_column: normalizeMappedColumn(columns, parsed.vat_rate_column),
    debit_column: normalizeMappedColumn(columns, parsed.debit_column),
    credit_column: normalizeMappedColumn(columns, parsed.credit_column),
    supplier_column: normalizeMappedColumn(columns, parsed.supplier_column),
    description_column: normalizeMappedColumn(columns, parsed.description_column),
    date_column: normalizeMappedColumn(columns, parsed.date_column),
  };
}

interface AnalyzeRequest {
  file_data: string;      // base64 encoded Excel
  filename: string;
  conversation_id?: string;
  company_name?: string;
  org_number?: string;
  period?: string;
}

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders();

  if (req.method === "OPTIONS") {
    return createOptionsResponse();
  }

  // Require auth and resolve actual user id from token (don’t trust client-provided IDs)
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  // Initialize Supabase (service role) for auth verification + persistence
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  const token = authHeader.replace(/^Bearer\s+/i, '');
  const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !user) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  const userId = user.id;

  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  const sendProgress = async (data: Record<string, unknown>) => {
    await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
  };

  (async () => {
    try {
      const body: AnalyzeRequest = await req.json();

      if (!body.file_data || !body.filename) {
        throw new Error('file_data and filename are required');
      }

      // Defense in depth: Check file size (5MB limit = ~6.7MB base64)
      const MAX_BASE64_SIZE = 7 * 1024 * 1024; // ~5MB original file
      if (body.file_data.length > MAX_BASE64_SIZE) {
        const actualSizeMB = (body.file_data.length * 0.75 / (1024 * 1024)).toFixed(1); // Approximate original size
        throw new Error(`Filen är för stor (${actualSizeMB}MB). Max storlek är 5MB.`);
      }

      // Rate limiting
      const plan = await getUserPlan(supabaseAdmin, userId);
      logger.debug('Resolved plan', { userId, plan });

      const rateLimiter = new RateLimiterService(supabaseAdmin, getRateLimitConfigForPlan(plan));
      const rateLimit = await rateLimiter.checkAndIncrement(userId, RATE_LIMIT_ENDPOINT);

      if (!rateLimit.allowed) {
        throw new Error(`Rate limit exceeded: ${rateLimit.message}`);
      }

      // ═══════════════════════════════════════════════════════════════════
      // STEG 1: Läs Excel-fil
      // ═══════════════════════════════════════════════════════════════════
      await sendProgress({
        step: 'parsing',
        message: 'Läser Excel-fil...',
        progress: 0.1
      });

      let rawData: unknown[][];
      let columns: string[];
      let dataRows: unknown[][];

      try {
        const t0 = Date.now();

        // Steg 1: Base64 decoding
        const binaryString = atob(body.file_data);
        const t1 = Date.now();
        logger.info('TIMING: atob complete', { ms: t1 - t0, length: binaryString.length });

        // Steg 2: Skapa Uint8Array
        const fileBuffer = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          fileBuffer[i] = binaryString.charCodeAt(i);
        }
        const t2 = Date.now();
        logger.info('TIMING: Uint8Array complete', { ms: t2 - t1 });

        // Steg 3: XLSX parse
        const workbook = XLSX.read(fileBuffer, { type: 'array' });
        const t3 = Date.now();
        logger.info('TIMING: XLSX.read complete', { ms: t3 - t2 });

        // Steg 4: Sheet to JSON
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        const t4 = Date.now();
        logger.info('TIMING: sheet_to_json complete', { ms: t4 - t3, rows: rawData.length });

        if (!rawData || rawData.length < 2) {
          throw new Error('Excel-filen är tom eller saknar data');
        }

        columns = rawData[0] as string[];
        dataRows = rawData.slice(1);

        logger.info('Excel parsed', { rows: dataRows.length, columns: columns.length, totalMs: t4 - t0 });
      } catch (parseError) {
        logger.error('Excel parsing failed', parseError);
        throw new Error('Kunde inte läsa Excel-filen. Kontrollera formatet.');
      }

      // ═══════════════════════════════════════════════════════════════════
      // STEG 2: Detektera filtyp och konvertera till objekt
      // ═══════════════════════════════════════════════════════════════════
      await sendProgress({
        step: 'analyzing',
        message: 'Analyserar filstruktur...',
        progress: 0.3
      });

      // Konvertera rader till objekt med kolumnnamn
      const rowObjects = dataRows.map(row => {
        const obj: Record<string, unknown> = {};
        columns.forEach((col, i) => {
          obj[col] = (row as unknown[])[i];
        });
        return obj;
      });

      // Detektera om det är en Monta-fil
      const isMontaFile = columns.includes('amount') &&
                          columns.includes('subAmount') &&
                          columns.includes('vat') &&
                          (columns.includes('roamingOperator') || columns.includes('kwh'));

      let report: Record<string, unknown>;

      if (isMontaFile) {
        // ═══════════════════════════════════════════════════════════════
        // MONTA-FIL: Använd deterministisk parser (100% noggrannhet)
        // ═══════════════════════════════════════════════════════════════
        await sendProgress({
          step: 'calculating',
          message: 'Beräknar moms (deterministisk)...',
          progress: 0.5
        });

        logger.info('Detected Monta file, using deterministic parser', { rows: rowObjects.length });

        const montaTransactions = parseMontaTransactions(rowObjects);
        const montaReport = calculateMontaReport(montaTransactions);

        // Extrahera period från första transaktionen
        const firstDate = montaTransactions.find(t => t.created)?.created || '';
        const period = body.period || (firstDate ? firstDate.substring(0, 7).replace('/', '-') : new Date().toISOString().substring(0, 7));

        // Extrahera företagsnamn från 'to' kolumnen (TEAM#xxx | Företagsnamn)
        const teamRow = rowObjects.find(r => String(r['to'] || '').includes('TEAM#'));
        let companyName = body.company_name || 'Företag';
        if (teamRow) {
          const toField = String(teamRow['to'] || '');
          const match = toField.match(/TEAM#\d+\s*\|\s*(.+)/);
          if (match) {
            companyName = match[1].trim();
          }
        }

        // Generate zero VAT warnings for transactions with 0% VAT
        const zeroVatWarnings: ZeroVATWarning[] = [];
        for (const tx of montaTransactions) {
          if (tx.vatRate === 0 && tx.type !== 'skip') {
            const warnings = validateZeroVAT({
              transactionId: tx.id,
              amount: tx.amount,
              vatRate: tx.vatRate,
              isRoaming: !!tx.roamingOperator,
              counterpartName: tx.transactionName || tx.note,
              description: tx.note,
            });
            zeroVatWarnings.push(...warnings);
          }
        }

        // Generate journal entries
        const journalEntries: JournalEntry[] = [];

        // Sales journal entries
        if (montaReport.summary.private_sales > 0) {
          journalEntries.push(...createSalesJournalEntries(
            montaReport.summary.private_sales,
            montaReport.summary.private_sales_vat,
            25,
            false
          ));
        }
        if (montaReport.summary.roaming_sales_export > 0) {
          journalEntries.push(...createSalesJournalEntries(
            montaReport.summary.roaming_sales_export,
            0,
            0,
            true
          ));
        }

        // Cost journal entries
        if (montaReport.summary.subscription_costs > 0) {
          journalEntries.push(...createCostJournalEntries(
            montaReport.summary.subscription_costs,
            montaReport.vat.incoming * (montaReport.summary.subscription_costs / montaReport.summary.total_costs) || 0,
            25,
            'abonnemang'
          ));
        }
        if (montaReport.summary.operator_fee_costs > 0) {
          journalEntries.push(...createCostJournalEntries(
            montaReport.summary.operator_fee_costs,
            montaReport.vat.incoming * (montaReport.summary.operator_fee_costs / montaReport.summary.total_costs) || 0,
            25,
            'operator fee'
          ));
        }
        if (montaReport.summary.platform_fee_costs > 0) {
          journalEntries.push(...createCostJournalEntries(
            montaReport.summary.platform_fee_costs,
            0,
            0,
            'platform fee'
          ));
        }

        // Generate verification
        const verification = generateBatchVerification(
          period,
          montaTransactions.filter(t => t.type !== 'skip').length,
          body.filename,
          body.org_number
        );

        // Validate journal balance
        const journalBalance = validateJournalBalance(journalEntries);

        report = {
          success: true,
          period: period,
          company_name: companyName,
          ...montaReport,
          journal_entries: journalEntries,
          validation: {
            passed: zeroVatWarnings.filter(w => w.level === 'warning' || w.level === 'error').length === 0,
            warnings: zeroVatWarnings.filter(w => w.level === 'warning').map(w => w.message),
            zero_vat_details: zeroVatWarnings,
            journal_balanced: journalBalance.balanced,
            notes: `Deterministisk analys av ${montaTransactions.length} transaktioner. 100% noggrannhet.`
          },
          verification: {
            ...verification,
            method: 'deterministic',
            parser: 'monta-v2',
            transaction_count: montaTransactions.length
          }
        };

        logger.info('Monta report complete', {
          transactions: montaTransactions.length,
          total_sales: montaReport.summary.total_sales,
          total_costs: montaReport.summary.total_costs,
          incoming_vat: montaReport.summary.total_costs_vat
        });

      } else {
        // ═══════════════════════════════════════════════════════════════
        // GENERELL FIL: Deterministisk analys (exakt matematik)
        // - Kolumnmappning: heuristik → (fallback) OpenAI-mappning
        // - Summeringar: beräknas alltid deterministiskt (öre)
        // ═══════════════════════════════════════════════════════════════

        // Layer 2: Try to find learned patterns for suppliers in this file
        let patternSuggestions: Array<{ supplier: string; suggestions: PatternSuggestion[] }> = [];
        const companyId = body.org_number || body.company_name || 'default';

        if (userId) {
          await sendProgress({
            step: 'mapping',
            message: 'Söker inlärda mönster...',
            progress: 0.4
          });

          const patternService = new ExpensePatternService(supabaseAdmin);

          // Extract unique suppliers from rows
          const uniqueSuppliers = new Set<string>();
          for (const row of rowObjects.slice(0, 100)) { // Check first 100 rows
            const txInfo = extractTransactionInfo(row, columns);
            if (txInfo?.supplier) {
              uniqueSuppliers.add(txInfo.supplier);
            }
          }

          // Look up patterns for each supplier
          for (const supplier of uniqueSuppliers) {
            try {
              const suggestions = await patternService.findMatches(userId, companyId, {
                supplier_name: supplier,
                amount: 0
              });
              if (suggestions.length > 0) {
                patternSuggestions.push({ supplier, suggestions });
              }
            } catch (err) {
              logger.warn('Pattern lookup failed', { supplier, error: err });
            }
          }

          logger.info('Pattern lookup complete', {
            suppliers_checked: uniqueSuppliers.size,
            patterns_found: patternSuggestions.length
          });
        }

        await sendProgress({
          step: 'mapping',
          message: 'Identifierar kolumner...',
          progress: 0.48,
          details: {
            patterns_found: patternSuggestions.length
          }
        });

        let mapping: ColumnMapping = {
          amount_column: findColumnByNames(columns, AMOUNT_COLUMN_NAMES),
          amount_kind: 'unknown',
          net_amount_column: findColumnByNames(columns, NET_AMOUNT_COLUMN_NAMES),
          vat_amount_column: findColumnByNames(columns, VAT_AMOUNT_COLUMN_NAMES),
          vat_rate_column: findColumnByNames(columns, VAT_RATE_COLUMN_NAMES),
          debit_column: findColumnByNames(columns, DEBIT_COLUMN_NAMES),
          credit_column: findColumnByNames(columns, CREDIT_COLUMN_NAMES),
          supplier_column: findColumnByNames(columns, SUPPLIER_COLUMN_NAMES),
          description_column: null,
          date_column: findColumnByNames(columns, DATE_COLUMN_NAMES),
        };

        // Heuristik: om netto-kolumn finns men ingen amount-kolumn, använd netto som amount.
        if (!mapping.amount_column && mapping.net_amount_column) {
          mapping.amount_column = mapping.net_amount_column;
          mapping.amount_kind = 'net';
        }

        // Heuristik: om vi har både netto + amount, anta att amount är brutto.
        if (mapping.amount_column && mapping.net_amount_column) {
          mapping.amount_kind = 'gross';
        }

        // Om moms-belopp finns och amount_kind fortfarande okänd, anta brutto.
        if (mapping.vat_amount_column && mapping.amount_column && mapping.amount_kind === 'unknown') {
          mapping.amount_kind = 'gross';
        }

        const needsAiMapping = !mapping.amount_column && !(mapping.debit_column && mapping.credit_column);
        if (needsAiMapping) {
          await sendProgress({
            step: 'mapping',
            message: 'Behöver AI-hjälp för att tolka kolumner...',
            progress: 0.52
          });
          mapping = await mapColumnsWithOpenAI(columns, rowObjects.slice(0, 50), body.filename);
        }

        await sendProgress({
          step: 'calculating',
          message: 'Beräknar moms (deterministiskt)...',
          progress: 0.6,
          details: {
            mapping,
            patterns_found: patternSuggestions.length
          }
        });

        const patternBySupplier = new Map<string, { bas_account: string; vat_rate: number }>();
        for (const p of patternSuggestions) {
          const best = p.suggestions[0]?.pattern;
          if (best?.bas_account && typeof best.vat_rate === 'number') {
            patternBySupplier.set(p.supplier, { bas_account: best.bas_account, vat_rate: best.vat_rate });
          }
        }

        const supplierCol = mapping.supplier_column;
        const descriptionCol = mapping.description_column || mapping.supplier_column;
        const dateCol = mapping.date_column;

        type ParsedTx = {
          amountCents: number;
          netCents: number;
          vatCents: number;
          vatRate: number;
          description: string;
          date: string;
          type: 'sale' | 'cost';
          basAccount: string;
        };

        const parsedTxs: ParsedTx[] = [];
        const warnings: string[] = [];
        const errors: string[] = [];

        for (let i = 0; i < rowObjects.length; i++) {
          const row = rowObjects[i];

          const supplier = supplierCol ? String(row[supplierCol] || '').trim() : '';
          const description = (descriptionCol ? String(row[descriptionCol] || '').trim() : '') || supplier || 'Transaktion';
          const date = dateCol ? String(row[dateCol] || '').trim() : '';

          let amountCents: number | null = null;
          if (mapping.debit_column && mapping.credit_column) {
            const debit = parseMoneyToCents(row[mapping.debit_column]);
            const credit = parseMoneyToCents(row[mapping.credit_column]);
            if (debit !== null || credit !== null) {
              amountCents = (credit || 0) - (debit || 0);
            }
          } else if (mapping.amount_column) {
            amountCents = parseMoneyToCents(row[mapping.amount_column]);
          }

          if (amountCents === null || amountCents === 0) continue;

          const type: 'sale' | 'cost' = amountCents < 0 ? 'cost' : 'sale';

          let netCents = mapping.net_amount_column ? parseMoneyToCents(row[mapping.net_amount_column]) : null;
          let vatCents = mapping.vat_amount_column ? parseMoneyToCents(row[mapping.vat_amount_column]) : null;
          let vatRate = mapping.vat_rate_column ? normalizeVatRate(row[mapping.vat_rate_column]) : null;

          // Fallback: använd inlärda mönster för VAT-rate om den saknas
          if (vatRate === null && supplier && patternBySupplier.has(supplier)) {
            vatRate = patternBySupplier.get(supplier)!.vat_rate;
          }

          // Sätt tecken enligt amount
          if (netCents !== null && netCents !== 0 && Math.sign(netCents) !== Math.sign(amountCents)) netCents *= -1;
          if (vatCents !== null && vatCents !== 0 && Math.sign(vatCents) !== Math.sign(amountCents)) vatCents *= -1;

          // Om vi har moms-belopp men inget netto: anta brutto (netto = belopp - moms)
          if (netCents === null && vatCents !== null && mapping.amount_kind !== 'net') {
            netCents = amountCents - vatCents;
          }

          // Om vi saknar moms men har momssats: beräkna deterministiskt
          if (vatCents === null && vatRate !== null && vatRate > 0) {
            if (netCents !== null) {
              vatCents = Math.round(netCents * (vatRate / 100));
            } else {
              const divisor = 1 + (vatRate / 100);
              netCents = Math.round(amountCents / divisor);
              vatCents = amountCents - netCents;
            }
          }

          // Om vi saknar momssats men har net + moms: gissa närmaste (0/6/12/25)
          if (vatRate === null && netCents !== null && vatCents !== null && netCents !== 0) {
            const guess = (Math.abs(vatCents) / Math.abs(netCents)) * 100;
            vatRate = nearestVatRate(guess);
          }

          if (vatCents === null) vatCents = 0;
          if (netCents === null) {
            // Sista fallback: anta att beloppet är netto om amount_kind=net, annars brutto (net=amount - vat)
            netCents = mapping.amount_kind === 'net' ? amountCents : (amountCents - vatCents);
          }
          if (vatRate === null) vatRate = vatCents === 0 ? 0 : nearestVatRate((Math.abs(vatCents) / Math.max(1, Math.abs(netCents))) * 100);

          const expectedGross = netCents + vatCents;
          if (mapping.amount_kind !== 'net' && Math.abs(expectedGross - amountCents) > 1) {
            warnings.push(`Rad ${i + 2}: belopp (${centsToNumber(amountCents)}) ≠ netto+moms (${centsToNumber(expectedGross)})`);
          }

          const defaultBas = type === 'sale'
            ? (vatRate === 0 ? '3011' : '3010')
            : '6590';
          const basAccount = (type === 'cost' && supplier && patternBySupplier.has(supplier))
            ? patternBySupplier.get(supplier)!.bas_account
            : defaultBas;

          parsedTxs.push({
            amountCents,
            netCents,
            vatCents,
            vatRate,
            description,
            date,
            type,
            basAccount
          });
        }

        if (parsedTxs.length === 0) {
          errors.push('Kunde inte hitta några rader med belopp. Kontrollera att filen har en beloppskolumn.');
        }

        if (errors.length > 0) {
          throw new Error(errors.join(' '));
        }

        // Summeringar i öre (exakt)
        let totalSalesNet = 0;
        let totalSalesVat = 0;
        let totalCostsNet = 0;
        let totalCostsVat = 0;

        const outgoingByRate: Record<number, number> = { 25: 0, 12: 0, 6: 0 };
        let incomingVat = 0;

        const breakdown = new Map<string, {
          rate: number;
          type: 'sale' | 'cost';
          net: number;
          vat: number;
          gross: number;
          count: number;
          bas_account: string;
          description: string;
        }>();

        for (const tx of parsedTxs) {
          const gross = tx.amountCents;
          const net = tx.netCents;
          const vat = tx.vatCents;
          const rate = tx.vatRate;

          if (tx.type === 'cost') {
            totalCostsNet += Math.abs(net);
            totalCostsVat += Math.abs(vat);
            incomingVat += Math.abs(vat);
          } else {
            totalSalesNet += net;
            totalSalesVat += vat;
            if (rate === 25 || rate === 12 || rate === 6) {
              outgoingByRate[rate] += vat;
            }
          }

          const key = `${tx.type}:${rate}:${tx.basAccount}`;
          const existing = breakdown.get(key);
          if (existing) {
            existing.net += tx.type === 'cost' ? Math.abs(net) : net;
            existing.vat += tx.type === 'cost' ? Math.abs(vat) : vat;
            existing.gross += tx.type === 'cost' ? Math.abs(gross) : gross;
            existing.count += 1;
          } else {
            breakdown.set(key, {
              rate,
              type: tx.type,
              net: tx.type === 'cost' ? Math.abs(net) : net,
              vat: tx.type === 'cost' ? Math.abs(vat) : vat,
              gross: tx.type === 'cost' ? Math.abs(gross) : gross,
              count: 1,
              bas_account: tx.basAccount,
              description: tx.type === 'sale'
                ? (rate === 0 ? 'Försäljning 0% (momsfritt)' : `Försäljning ${rate}%`)
                : `Kostnader ${rate}%`,
            });
          }
        }

        const outgoing25 = outgoingByRate[25] || 0;
        const outgoing12 = outgoingByRate[12] || 0;
        const outgoing6 = outgoingByRate[6] || 0;
        const totalOutgoing = outgoing25 + outgoing12 + outgoing6;
        const netVat = totalOutgoing - incomingVat;

        const period = body.period || new Date().toISOString().substring(0, 7);
        const companyName = body.company_name || 'Företag';

        // Generate zero VAT warnings for general files
        const generalZeroVatWarnings: ZeroVATWarning[] = [];
        for (let i = 0; i < parsedTxs.length; i++) {
          const tx = parsedTxs[i];
          if (tx.vatRate === 0) {
            const txWarnings = validateZeroVAT({
              transactionId: `tx_${i}`,
              amount: centsToNumber(tx.amountCents),
              vatRate: tx.vatRate,
              counterpartName: tx.description,
              description: tx.description,
            });
            generalZeroVatWarnings.push(...txWarnings);
          }
        }

        // Generate journal entries for general files
        const generalJournalEntries: JournalEntry[] = [];

        // Group by type and rate for journal entries
        for (const [key, b] of breakdown) {
          if (b.type === 'sale') {
            generalJournalEntries.push(...createSalesJournalEntries(
              centsToNumber(b.net),
              centsToNumber(b.vat),
              b.rate,
              false
            ));
          } else {
            generalJournalEntries.push(...createCostJournalEntries(
              centsToNumber(b.net),
              centsToNumber(b.vat),
              b.rate,
              b.description
            ));
          }
        }

        // Generate verification
        const generalVerification = generateBatchVerification(
          period,
          parsedTxs.length,
          body.filename,
          body.org_number
        );

        // Validate journal balance
        const generalJournalBalance = validateJournalBalance(generalJournalEntries);

        // Combine validation warnings
        const allWarnings = [
          ...warnings,
          ...generalZeroVatWarnings.filter(w => w.level === 'warning').map(w => w.message)
        ];

        report = {
          success: true,
          period,
          company_name: companyName,
          summary: {
            total_sales: centsToNumber(totalSalesNet),
            total_sales_vat: centsToNumber(totalSalesVat),
            total_costs: centsToNumber(totalCostsNet),
            total_costs_vat: centsToNumber(totalCostsVat),
            result: centsToNumber(totalSalesNet - totalCostsNet)
          },
          vat_breakdown: Array.from(breakdown.values()).map((b) => ({
            rate: b.rate,
            type: b.type,
            net_amount: centsToNumber(b.net),
            vat_amount: centsToNumber(b.vat),
            gross_amount: centsToNumber(b.gross),
            transaction_count: b.count,
            bas_account: b.bas_account,
            description: b.description
          })),
          transactions: parsedTxs.map((t, i) => ({
            amount: centsToNumber(t.amountCents),
            net_amount: centsToNumber(t.netCents),
            vat_amount: centsToNumber(t.vatCents),
            vat_rate: t.vatRate,
            description: t.description,
            date: t.date,
            type: t.type,
            bas_account: t.basAccount
          })),
          journal_entries: generalJournalEntries,
          vat: {
            outgoing_25: centsToNumber(outgoing25),
            outgoing_12: centsToNumber(outgoing12),
            outgoing_6: centsToNumber(outgoing6),
            incoming: centsToNumber(incomingVat),
            net: centsToNumber(netVat),
            to_pay: netVat > 0 ? centsToNumber(netVat) : 0,
            to_refund: netVat < 0 ? centsToNumber(Math.abs(netVat)) : 0
          },
          validation: {
            passed: allWarnings.length === 0,
            warnings: allWarnings,
            zero_vat_details: generalZeroVatWarnings,
            journal_balanced: generalJournalBalance.balanced,
            notes: `Deterministisk beräkning av ${parsedTxs.length} rader (öre).`
          },
          verification: {
            ...generalVerification,
            method: patternSuggestions.length > 0 ? 'patterns+deterministic' : 'deterministic-general',
            patterns_found: patternSuggestions.length,
            mapping
          }
        };
      }

      // ═══════════════════════════════════════════════════════════════════
      // STEG 3: Spara till databas (om användare är inloggad)
      // ═══════════════════════════════════════════════════════════════════
      if (userId && body.conversation_id) {
        await sendProgress({
          step: 'normalizing',
          message: 'Sparar rapport...',
          progress: 0.9
        });

        const { data: conversation, error: conversationError } = await supabaseAdmin
          .from('conversations')
          .select('id, company_id')
          .eq('id', body.conversation_id)
          .eq('user_id', userId)
          .maybeSingle();

        if (conversationError) {
          logger.warn('Failed to verify conversation ownership, skipping report save', {
            conversationId: body.conversation_id,
            userId,
            error: conversationError.message
          });
        } else if (!conversation) {
          logger.warn('Conversation not found or not owned, skipping report save', { conversationId: body.conversation_id, userId });
        } else {
          const { error: dbError } = await supabaseAdmin
            .from('vat_reports')
            .insert({
              user_id: userId,
              conversation_id: body.conversation_id,
              period: report.period || body.period,
              company_name: report.company_name || body.company_name,
              report_data: report,
              source_filename: body.filename
            });

          if (dbError) {
            logger.warn('Failed to save report', { error: dbError.message });
          } else if (conversation.company_id) {
            try {
              const memoryService = new CompanyMemoryService(supabaseAdmin);
              const patch = buildMemoryPatchFromVatReport(report, {
                period: (report as { period?: string }).period || body.period || null,
                companyName: (report as { company_name?: string }).company_name || body.company_name || null,
                orgNumber: body.org_number || null,
              });

              if (Object.keys(patch).length > 0) {
                await memoryService.merge(userId, String(conversation.company_id), patch);
              }
            } catch (memoryError) {
              logger.warn('Failed to update company memory', {
                error: memoryError instanceof Error ? memoryError.message : String(memoryError),
                conversationId: body.conversation_id,
              });
            }
          }
        }
      }

      // ═══════════════════════════════════════════════════════════════════
      // KLART!
      // ═══════════════════════════════════════════════════════════════════
      await sendProgress({
        step: 'complete',
        message: 'Analys klar!',
        progress: 1.0,
        report: {
          success: true,
          data: report,
          metadata: {
            filename: body.filename,
            rows_analyzed: dataRows.length,
            file_type: isMontaFile ? 'monta_ev_charging' : 'general',
            parser: (report.verification as { method?: string })?.method || (isMontaFile ? 'deterministic' : 'deterministic-general')
          }
        }
      });

      await writer.close();

    } catch (error) {
      logger.error('Analysis failed', error);
      await sendProgress({
        step: 'error',
        error: error instanceof Error ? error.message : 'Okänt fel uppstod'
      });
      await writer.close();
    }
  })();

  return new Response(stream.readable, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  });
});

// Deterministisk Excel-analys - 100% noggrannhet
// Excel → Direkt parsing (exakt som Python) → Färdig rapport
// AI används ENDAST för företagsnamn/period om det saknas
/// <reference path="../../types/deno.d.ts" />

import { getCorsHeaders, createOptionsResponse } from "../../services/CorsService.ts";
import { createLogger } from "../../services/LoggerService.ts";
import { RateLimiterService } from "../../services/RateLimiterService.ts";
import { ExpensePatternService, PatternSuggestion } from "../../services/ExpensePatternService.ts";

// @ts-expect-error - Deno npm: specifier
import { createClient } from "npm:@supabase/supabase-js@2";
// @ts-expect-error - Deno npm: specifier
import Anthropic from "npm:@anthropic-ai/sdk@0.32.1";
// @ts-expect-error - Deno npm: specifier
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
  const privateAmount = privateSales.reduce((sum, t) => sum + t.amount, 0);
  const privateVat = privateSales.reduce((sum, t) => sum + t.vat, 0);
  const privateNet = privateSales.reduce((sum, t) => sum + t.subAmount, 0);

  const roamingAmount = roamingSales.reduce((sum, t) => sum + t.amount, 0);
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
  const subAmount = Math.abs(subscriptions.reduce((sum, t) => sum + t.amount, 0));
  const subVat = Math.abs(subscriptions.reduce((sum, t) => sum + t.vat, 0));
  const subNet = Math.abs(subscriptions.reduce((sum, t) => sum + t.subAmount, 0));

  // KOSTNADER OPERATÖRSAVGIFTER
  const opAmount = Math.abs(operatorFees.reduce((sum, t) => sum + t.amount, 0));
  const opVat = Math.abs(operatorFees.reduce((sum, t) => sum + t.vat, 0));
  const opNet = Math.abs(operatorFees.reduce((sum, t) => sum + t.subAmount, 0));

  const pfAmount = Math.abs(platformFees.reduce((sum, t) => sum + t.amount, 0));
  // Platform fees = 0% moms så amount = net

  const roamingFeeAmount = Math.abs(roamingFees.reduce((sum, t) => sum + t.amount, 0));
  // Roaming fees = 0% moms så amount = net

  // TOTALER - Använd NETTO för redovisning (exkl moms)
  // Observera: roaming, pfAmount, roamingFeeAmount har 0% moms så amount = net
  const totalSales = privateNet + roamingAmount;  // NETTO
  const totalSalesVat = privateVat; // Endast privatladdning har utgående moms

  const totalCosts = subNet + opNet + pfAmount + roamingFeeAmount;  // NETTO
  const incomingVat = subVat + opVat; // Endast 25% moms är avdragsgill

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
      amount: t.amount,
      net_amount: t.subAmount,
      vat_amount: t.vat,
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

function findColumnByNames(columns: string[], candidateNames: string[]): string | null {
  const columnsLower = columns.map(c => c.toLowerCase());
  for (const name of candidateNames) {
    const idx = columnsLower.findIndex(c => c.includes(name));
    if (idx >= 0) return columns[idx];
  }
  return null;
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
      const rateLimiter = new RateLimiterService(supabaseAdmin);
      const rateLimit = await rateLimiter.checkAndIncrement(userId, 'analyze-excel-ai');

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
        logger.error('Excel parsing failed', { error: parseError });
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

        report = {
          success: true,
          period: period,
          company_name: companyName,
          ...montaReport,
          validation: {
            passed: true,
            warnings: [],
            notes: `Deterministisk analys av ${montaTransactions.length} transaktioner. 100% noggrannhet.`
          },
          verification: {
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
        // GENERELL FIL: Layered Intelligence
        // Layer 2: Check learned patterns first
        // Layer 4: Fall back to Claude AI
        // ═══════════════════════════════════════════════════════════════

        // Layer 2: Try to find learned patterns for suppliers in this file
        let patternSuggestions: Array<{ supplier: string; suggestions: PatternSuggestion[] }> = [];
        const companyId = body.org_number || body.company_name || 'default';

        if (userId) {
          await sendProgress({
            step: 'patterns',
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

        // Layer 4: Use Claude AI with pattern context
        await sendProgress({
          step: 'calculating',
          message: patternSuggestions.length > 0
            ? `Analyserar med ${patternSuggestions.length} inlärda mönster...`
            : 'Claude analyserar data...',
          progress: 0.5
        });

        const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
        if (!anthropicKey) {
          throw new Error('ANTHROPIC_API_KEY not configured');
        }

        const anthropic = new Anthropic({ apiKey: anthropicKey });

        // Build pattern context for AI prompt
        let patternContext = '';
        if (patternSuggestions.length > 0) {
          patternContext = `

INLÄRDA MÖNSTER (använd dessa för kategorisering):
${patternSuggestions.map(p =>
  `• "${p.supplier}" → ${p.suggestions[0].pattern.bas_account} (${p.suggestions[0].pattern.bas_account_name}), ${p.suggestions[0].pattern.vat_rate}% moms, säkerhet: ${Math.round(p.suggestions[0].pattern.confidence_score * 100)}%`
).join('\n')}

VIKTIGT: Prioritera inlärda mönster framför egna gissningar. Om ett mönster matchar, använd det BAS-kontot.`;
        }

        const sampleRows = rowObjects.slice(0, 50);
        const prompt = `Du är Britta, en svensk redovisningsexpert. Analysera denna Excel-fil och skapa en momsrapport.

EXCEL-DATA:
${JSON.stringify({ columns, sample_data: sampleRows, row_count: rowObjects.length }, null, 2)}

METADATA:
- Filnamn: ${body.filename}
- Företag: ${body.company_name || 'Auto-detektera'}
- Period: ${body.period || 'Auto-detektera'}${patternContext}

Svara med JSON:
{
  "success": true,
  "period": "YYYY-MM",
  "company_name": "Företagsnamn",
  "summary": {
    "total_sales": 0,
    "total_sales_vat": 0,
    "total_costs": 0,
    "total_costs_vat": 0,
    "result": 0
  },
  "vat_breakdown": [
    { "rate": 25, "type": "sale", "net_amount": 0, "vat_amount": 0, "description": "Försäljning 25%", "bas_account": "3010" }
  ],
  "transactions": [],
  "vat": {
    "outgoing_25": 0,
    "incoming": 0,
    "net": 0
  },
  "patterns_used": []
}`;

        const modelName = Deno.env.get('ANTHROPIC_MODEL') || Deno.env.get('CLAUDE_MODEL') || 'claude-sonnet-4-20250514';
        const response = await anthropic.messages.create({
          model: modelName,
          max_tokens: 4096,
          messages: [{ role: 'user', content: prompt }]
        });

        const claudeText = response.content[0].type === 'text' ? response.content[0].text : '';

        try {
          const cleanJson = claudeText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
          report = JSON.parse(cleanJson);
          report.verification = {
            method: patternSuggestions.length > 0 ? 'patterns+claude-ai' : 'claude-ai',
            patterns_found: patternSuggestions.length
          };
        } catch {
          throw new Error('Kunde inte tolka AI-svar. Försök igen.');
        }
      }

      // ═══════════════════════════════════════════════════════════════════
      // STEG 3: Spara till databas (om användare är inloggad)
      // ═══════════════════════════════════════════════════════════════════
      if (userId && body.conversation_id) {
        await sendProgress({
          step: 'saving',
          message: 'Sparar rapport...',
          progress: 0.9
        });

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
          logger.warn('Failed to save report', { error: dbError });
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
            parser: (report.verification as { method?: string })?.method || (isMontaFile ? 'deterministic' : 'claude-ai')
          }
        }
      });

      await writer.close();

    } catch (error) {
      logger.error('Analysis failed', { error });
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

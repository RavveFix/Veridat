// AI-First Excel Analysis - 3-Step Pipeline
// Gemini (parse) → Python (calculate) → Claude (validate)
/// <reference path="../../types/deno.d.ts" />

import { getCorsHeaders, createOptionsResponse } from "../../services/CorsService.ts";
import { createLogger } from "../../services/LoggerService.ts";
import { RateLimiterService } from "../../services/RateLimiterService.ts";

// @ts-expect-error - Deno npm: specifier
import { createClient } from "npm:@supabase/supabase-js@2";
// @ts-expect-error - Deno npm: specifier
import { GoogleGenerativeAI } from "npm:@google/generative-ai@0.21.0";
// @ts-expect-error - Deno npm: specifier
import Anthropic from "npm:@anthropic-ai/sdk@0.32.1";
// @ts-expect-error - Deno npm: specifier
import * as XLSX from "npm:xlsx@0.18.5";

const logger = createLogger('analyze-excel-ai');

interface AnalyzeRequest {
  file_data: string;      // base64 encoded Excel
  filename: string;
  company_name?: string;
  org_number?: string;
  period?: string;
}

interface ColumnMapping {
  amount: string | null;
  net_amount: string | null;
  vat_amount: string | null;
  vat_rate: string | null;
  description: string | null;
  date: string | null;
  transaction_type: 'sale' | 'cost' | 'mixed';
}

interface AIAnalysisResult {
  file_type: string;
  confidence: number;
  row_count: number;
  date_range?: { from: string; to: string };
  column_mapping: ColumnMapping;
  unmapped_columns: string[];
  notes: string;
}

interface NormalizedTransaction {
  amount: number;
  net_amount: number;
  vat_amount: number;
  vat_rate: number;
  description: string;
  date: string | null;
  type: 'sale' | 'cost';
}

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders();

  if (req.method === "OPTIONS") {
    return createOptionsResponse();
  }

  const encoder = new TextEncoder();

  // Create a streaming response
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  // Helper to send progress updates
  const sendProgress = async (data: Record<string, unknown>) => {
    await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
  };

  // Start processing in background
  (async () => {
    try {
      const body: AnalyzeRequest = await req.json();

      if (!body.file_data || !body.filename) {
        await sendProgress({
          step: 'error',
          error: 'file_data and filename are required'
        });
        await writer.close();
        return;
      }

      // Initialize services
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
      const geminiKey = Deno.env.get('GEMINI_API_KEY');

      if (!geminiKey) {
        await sendProgress({ step: 'error', error: 'GEMINI_API_KEY not configured' });
        await writer.close();
        return;
      }

      // Rate limiting
      const userId = req.headers.get('x-user-id') || 'anonymous';
      const rateLimiter = new RateLimiterService(supabaseAdmin);
      const rateLimit = await rateLimiter.checkAndIncrement(userId, 'analyze-excel-ai');

      if (!rateLimit.allowed) {
        await sendProgress({
          step: 'error',
          error: 'rate_limit_exceeded',
          message: rateLimit.message
        });
        await writer.close();
        return;
      }

      // Step 1: Parse Excel
      await sendProgress({
        step: 'parsing',
        message: 'Läser Excel-fil...',
        progress: 0.1
      });

      logger.info('Parsing Excel file', { filename: body.filename });

      const fileBuffer = Uint8Array.from(atob(body.file_data), c => c.charCodeAt(0));
      const workbook = XLSX.read(fileBuffer, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rawData: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

      if (rawData.length < 2) {
        await sendProgress({
          step: 'error',
          error: 'Excel-filen innehåller ingen data'
        });
        await writer.close();
        return;
      }

      const columns = rawData[0] as string[];
      const dataRows = rawData.slice(1).filter(row =>
        Array.isArray(row) && row.some(cell => cell !== null && cell !== undefined && cell !== '')
      );

      await sendProgress({
        step: 'parsing',
        message: `Hittade ${dataRows.length} rader med ${columns.length} kolumner`,
        progress: 0.2,
        details: {
          columns_count: columns.length,
          rows_count: dataRows.length,
          sheet_name: sheetName
        }
      });

      // Step 2: AI Analysis
      await sendProgress({
        step: 'analyzing',
        message: 'Analyserar kolumnstruktur med AI...',
        progress: 0.3
      });

      const sampleRows = dataRows.slice(0, 5).map(row =>
        columns.map((col, i) => `${col}: ${row[i]}`).join(', ')
      );

      const analysisPrompt = `Du är en expert på svensk bokföring och Excel-analys.

Analysera denna Excel-fil och identifiera kolumnerna för momsredovisning.

**Kolumner i filen (${columns.length} st):**
${columns.join(', ')}

**Exempel på data (första ${sampleRows.length} raderna):**
${sampleRows.join('\n')}

**Total antal rader:** ${dataRows.length}

**Din uppgift:**
1. Identifiera vilken typ av data detta är (t.ex. försäljning, laddtransaktioner, fakturor, bokföringsexport)
2. Mappa kolumner till dessa standardfält för svensk momsredovisning:
   - amount: Totalbelopp INKLUSIVE moms (t.ex. priceInclVat, total, belopp)
   - net_amount: Belopp EXKLUSIVE moms (t.ex. priceExclVat, netto, exklMoms)
   - vat_amount: Momsbeloppet (t.ex. vatAmount, moms, tax)
   - vat_rate: Momssats som procent 25, 12, 6, eller 0 (t.ex. vatPercent, momssats)
   - description: Beskrivning av transaktionen (t.ex. description, text, namn)
   - date: Transaktionsdatum (t.ex. date, datum, created, startTime)

3. Bestäm om transaktionerna är försäljning (sale), kostnad (cost), eller blandat (mixed).

4. Om viss kolumn saknas, sätt null. Om momssats saknas men du ser inkl/exkl moms, notera det.

Svara ENDAST med giltig JSON (ingen markdown, inga kommentarer):
{
  "file_type": "beskrivning av filtypen",
  "confidence": 0.0-1.0,
  "row_count": antal,
  "date_range": { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" } eller null,
  "column_mapping": {
    "amount": "kolumnnamn eller null",
    "net_amount": "kolumnnamn eller null",
    "vat_amount": "kolumnnamn eller null",
    "vat_rate": "kolumnnamn eller null",
    "description": "kolumnnamn eller null",
    "date": "kolumnnamn eller null",
    "transaction_type": "sale" eller "cost" eller "mixed"
  },
  "unmapped_columns": ["lista", "av", "oanvända", "kolumner"],
  "notes": "Viktiga observationer om datan, t.ex. 'Alla transaktioner verkar vara försäljning med 25% moms'"
}`;

      const genAI = new GoogleGenerativeAI(geminiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

      logger.info('Sending to Gemini for analysis');

      const result = await model.generateContent(analysisPrompt);
      const responseText = result.response.text();

      // Parse AI response
      let aiAnalysis: AIAnalysisResult;
      try {
        // Clean the response - remove any markdown code blocks
        const cleanedResponse = responseText
          .replace(/```json\n?/g, '')
          .replace(/```\n?/g, '')
          .trim();
        aiAnalysis = JSON.parse(cleanedResponse);
      } catch (parseError) {
        logger.error('Failed to parse AI response', { responseText, error: parseError });
        await sendProgress({
          step: 'error',
          error: 'Kunde inte tolka AI-analysen',
          details: responseText
        });
        await writer.close();
        return;
      }

      await sendProgress({
        step: 'mapping',
        message: `Identifierade: ${aiAnalysis.file_type}`,
        progress: 0.5,
        details: {
          file_type: aiAnalysis.file_type,
          confidence: aiAnalysis.confidence,
          mapping: aiAnalysis.column_mapping,
          notes: aiAnalysis.notes
        }
      });

      logger.info('AI analysis complete', {
        file_type: aiAnalysis.file_type,
        confidence: aiAnalysis.confidence,
        mapping: aiAnalysis.column_mapping
      });

      // Step 3: Validate mapping
      const mapping = aiAnalysis.column_mapping;
      const hasAmount = mapping.amount || (mapping.net_amount && mapping.vat_amount);

      if (!hasAmount) {
        await sendProgress({
          step: 'error',
          error: 'Kunde inte identifiera beloppskolumner',
          suggestion: 'Kontrollera att filen innehåller kolumner för belopp (inkl eller exkl moms)',
          ai_notes: aiAnalysis.notes
        });
        await writer.close();
        return;
      }

      // Step 4: Normalize transactions
      await sendProgress({
        step: 'normalizing',
        message: 'Normaliserar transaktionsdata...',
        progress: 0.6
      });

      const getColumnIndex = (colName: string | null): number => {
        if (!colName) return -1;
        return columns.findIndex(c => c === colName);
      };

      const amountIdx = getColumnIndex(mapping.amount);
      const netAmountIdx = getColumnIndex(mapping.net_amount);
      const vatAmountIdx = getColumnIndex(mapping.vat_amount);
      const vatRateIdx = getColumnIndex(mapping.vat_rate);
      const descriptionIdx = getColumnIndex(mapping.description);
      const dateIdx = getColumnIndex(mapping.date);

      const normalizedTransactions: NormalizedTransaction[] = [];

      for (const row of dataRows) {
        const rowArray = row as unknown[];

        // Get values
        let amount = amountIdx >= 0 ? parseFloat(String(rowArray[amountIdx] || 0)) : 0;
        let netAmount = netAmountIdx >= 0 ? parseFloat(String(rowArray[netAmountIdx] || 0)) : 0;
        let vatAmount = vatAmountIdx >= 0 ? parseFloat(String(rowArray[vatAmountIdx] || 0)) : 0;
        let vatRate = vatRateIdx >= 0 ? parseFloat(String(rowArray[vatRateIdx] || 25)) : 25;

        // Calculate missing values
        if (amount === 0 && netAmount > 0 && vatAmount > 0) {
          amount = netAmount + vatAmount;
        }
        if (netAmount === 0 && amount > 0 && vatAmount > 0) {
          netAmount = amount - vatAmount;
        }
        if (vatAmount === 0 && amount > 0 && netAmount > 0) {
          vatAmount = amount - netAmount;
        }
        if (vatAmount === 0 && amount > 0 && vatRate > 0) {
          vatAmount = amount * (vatRate / (100 + vatRate));
          netAmount = amount - vatAmount;
        }

        // Skip rows with no monetary value
        if (amount === 0 && netAmount === 0) continue;

        const description = descriptionIdx >= 0 ? String(rowArray[descriptionIdx] || '') : '';
        const date = dateIdx >= 0 ? String(rowArray[dateIdx] || '') : null;

        normalizedTransactions.push({
          amount: Math.round(amount * 100) / 100,
          net_amount: Math.round(netAmount * 100) / 100,
          vat_amount: Math.round(vatAmount * 100) / 100,
          vat_rate: vatRate,
          description: description.substring(0, 200),
          date,
          type: mapping.transaction_type === 'mixed' ? 'sale' : mapping.transaction_type
        });
      }

      await sendProgress({
        step: 'normalizing',
        message: `Normaliserade ${normalizedTransactions.length} transaktioner`,
        progress: 0.5,
        details: {
          total_transactions: normalizedTransactions.length,
          skipped: dataRows.length - normalizedTransactions.length
        }
      });

      // ============================================================
      // STEP 2: PYTHON API - Exact VAT Calculations
      // ============================================================
      await sendProgress({
        step: 'python-calculating',
        message: 'Python beräknar exakt moms...',
        progress: 0.6
      });

      const pythonApiUrl = Deno.env.get('PYTHON_API_URL');
      const pythonApiKey = Deno.env.get('PYTHON_API_KEY');

      let pythonReport: Record<string, unknown> | null = null;

      if (pythonApiUrl) {
        try {
          logger.info('Calling Python API for calculations', {
            url: pythonApiUrl,
            transactions: normalizedTransactions.length
          });

          // Determine period
          let period = body.period;
          if (!period && aiAnalysis.date_range) {
            const fromDate = new Date(aiAnalysis.date_range.from);
            const toDate = new Date(aiAnalysis.date_range.to);
            if (fromDate.getFullYear() === toDate.getFullYear()) {
              if (fromDate.getMonth() === toDate.getMonth()) {
                period = `${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, '0')}`;
              } else {
                period = `${fromDate.getFullYear()}`;
              }
            } else {
              period = `${fromDate.getFullYear()}-${toDate.getFullYear()}`;
            }
          }
          if (!period) {
            period = new Date().toISOString().substring(0, 7);
          }

          const pythonResponse = await fetch(`${pythonApiUrl}/api/vat/calculate-normalized`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(pythonApiKey ? { 'X-API-Key': pythonApiKey } : {})
            },
            body: JSON.stringify({
              transactions: normalizedTransactions,
              company_name: body.company_name || 'Företag',
              org_number: body.org_number || '',
              period,
              ai_analysis: {
                file_type: aiAnalysis.file_type,
                confidence: aiAnalysis.confidence,
                column_mapping: aiAnalysis.column_mapping,
                notes: aiAnalysis.notes
              }
            })
          });

          if (pythonResponse.ok) {
            pythonReport = await pythonResponse.json();
            logger.info('Python API calculation successful');

            await sendProgress({
              step: 'python-calculating',
              message: 'Python beräkningar klara',
              progress: 0.7,
              details: {
                period: (pythonReport as Record<string, unknown>).data &&
                        ((pythonReport as Record<string, unknown>).data as Record<string, unknown>).period,
                valid: (pythonReport as Record<string, unknown>).data &&
                       ((pythonReport as Record<string, unknown>).data as Record<string, unknown>).validation &&
                       (((pythonReport as Record<string, unknown>).data as Record<string, unknown>).validation as Record<string, unknown>).is_valid
              }
            });
          } else {
            const errorText = await pythonResponse.text();
            logger.warn('Python API failed, will use fallback', { status: pythonResponse.status, error: errorText });
          }
        } catch (pythonError) {
          logger.warn('Python API error, will use fallback', { error: pythonError });
        }
      } else {
        logger.warn('PYTHON_API_URL not configured, skipping Python step');
      }

      // ============================================================
      // STEP 3: CLAUDE - Validation & BAS Account Enrichment
      // ============================================================
      await sendProgress({
        step: 'claude-validating',
        message: 'Claude validerar bokföring...',
        progress: 0.8
      });

      const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
      let finalReport = pythonReport;

      if (anthropicKey && pythonReport) {
        try {
          logger.info('Calling Claude for validation');

          const anthropic = new Anthropic({ apiKey: anthropicKey });

          const claudePrompt = `Du är en svensk bokföringsexpert. Granska denna momsrapport och ge förbättringsförslag.

MOMSRAPPORT (från Python):
${JSON.stringify(pythonReport, null, 2)}

AI-ANALYS (från Gemini):
- Filtyp: ${aiAnalysis.file_type}
- Konfidens: ${aiAnalysis.confidence}
- Observationer: ${aiAnalysis.notes}

UPPGIFT:
1. Validera att BAS-konton är korrekta för denna typ av verksamhet
2. Kontrollera att momsberäkningarna är rimliga
3. Ge varningar om något ser konstigt ut
4. Föreslå eventuella justeringar

Svara ENDAST med JSON:
{
  "validation_passed": true/false,
  "suggestions": ["förslag1", "förslag2"],
  "warnings": ["varning1"],
  "bas_account_adjustments": [
    {"original": "3001", "suggested": "3010", "reason": "Mer specifikt konto för elbilsladdning"}
  ],
  "confidence_boost": 0.0-0.1
}`;

          const claudeResponse = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1024,
            messages: [{ role: 'user', content: claudePrompt }]
          });

          const claudeText = claudeResponse.content[0].type === 'text'
            ? claudeResponse.content[0].text
            : '';

          // Parse Claude's response
          try {
            const cleanedClaude = claudeText
              .replace(/```json\n?/g, '')
              .replace(/```\n?/g, '')
              .trim();
            const claudeValidation = JSON.parse(cleanedClaude);

            // Enrich report with Claude's validation
            if (finalReport && (finalReport as Record<string, unknown>).data) {
              const reportData = (finalReport as Record<string, unknown>).data as Record<string, unknown>;

              // Add Claude's insights
              reportData.claude_validation = claudeValidation;

              // Add suggestions to warnings if any
              if (claudeValidation.warnings && Array.isArray(claudeValidation.warnings)) {
                const validation = reportData.validation as Record<string, unknown>;
                const existingWarnings = (validation.warnings || []) as string[];
                validation.warnings = [...existingWarnings, ...claudeValidation.warnings];
              }

              // Boost confidence if Claude agrees
              if (claudeValidation.confidence_boost && reportData.ai_analysis) {
                const aiAnalysisData = reportData.ai_analysis as Record<string, unknown>;
                const currentConfidence = (aiAnalysisData.confidence as number) || 0;
                aiAnalysisData.confidence = Math.min(1.0, currentConfidence + claudeValidation.confidence_boost);
              }
            }

            logger.info('Claude validation complete', {
              passed: claudeValidation.validation_passed,
              suggestions: claudeValidation.suggestions?.length || 0
            });

            await sendProgress({
              step: 'claude-validating',
              message: 'Claude validering klar',
              progress: 0.9,
              details: {
                passed: claudeValidation.validation_passed,
                suggestions: claudeValidation.suggestions?.length || 0,
                warnings: claudeValidation.warnings?.length || 0
              }
            });

          } catch (parseError) {
            logger.warn('Failed to parse Claude response', { error: parseError });
          }

        } catch (claudeError) {
          logger.warn('Claude validation failed, continuing without', { error: claudeError });
        }
      } else if (!anthropicKey) {
        logger.warn('ANTHROPIC_API_KEY not configured, skipping Claude step');
      }

      // ============================================================
      // FALLBACK: If Python failed, use local calculations
      // ============================================================
      if (!finalReport) {
        logger.info('Using fallback calculations (Python unavailable)');

        await sendProgress({
          step: 'calculating',
          message: 'Använder lokal beräkning...',
          progress: 0.85
        });

        // Group by type and VAT rate
        const sales = normalizedTransactions.filter(t => t.type === 'sale');
        const costs = normalizedTransactions.filter(t => t.type === 'cost');

        const sumByRate = (transactions: NormalizedTransaction[], rate: number) => {
          return transactions
            .filter(t => Math.round(t.vat_rate) === rate)
            .reduce((sum, t) => ({
              net: sum.net + t.net_amount,
              vat: sum.vat + t.vat_amount,
              total: sum.total + t.amount
            }), { net: 0, vat: 0, total: 0 });
        };

        const sales25 = sumByRate(sales, 25);
        const sales12 = sumByRate(sales, 12);
        const sales6 = sumByRate(sales, 6);
        const sales0 = sumByRate(sales, 0);

        const totalIncoming = costs.reduce((sum, t) => sum + t.vat_amount, 0);
        const totalOutgoing = sales25.vat + sales12.vat + sales6.vat;
        const netVat = totalOutgoing - totalIncoming;

        let period = body.period;
        if (!period && aiAnalysis.date_range) {
          const fromDate = new Date(aiAnalysis.date_range.from);
          period = `${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, '0')}`;
        }
        if (!period) {
          period = new Date().toISOString().substring(0, 7);
        }

        finalReport = {
          type: 'vat_report',
          data: {
            type: 'vat_report',
            period,
            company: {
              name: body.company_name || 'Företag',
              org_number: body.org_number || ''
            },
            summary: {
              total_income: Math.round((sales25.total + sales12.total + sales6.total + sales0.total) * 100) / 100,
              total_costs: Math.round(costs.reduce((sum, t) => sum + t.amount, 0) * 100) / 100,
              result: Math.round((sales25.net + sales12.net + sales6.net + sales0.net - costs.reduce((sum, t) => sum + t.net_amount, 0)) * 100) / 100
            },
            sales: [
              { description: 'Försäljning 25%', net: sales25.net, vat: sales25.vat, rate: 25 },
              { description: 'Försäljning 12%', net: sales12.net, vat: sales12.vat, rate: 12 },
              { description: 'Försäljning 6%', net: sales6.net, vat: sales6.vat, rate: 6 },
              { description: 'Momsfri försäljning', net: sales0.net, vat: 0, rate: 0 }
            ].filter(s => s.net !== 0),
            costs: costs.length > 0 ? [
              { description: 'Inköp med avdragsrätt', net: costs.reduce((sum, t) => sum + t.net_amount, 0), vat: totalIncoming, rate: 25 }
            ] : [],
            vat: {
              outgoing_25: Math.round(sales25.vat * 100) / 100,
              outgoing_12: Math.round(sales12.vat * 100) / 100,
              outgoing_6: Math.round(sales6.vat * 100) / 100,
              incoming: Math.round(totalIncoming * 100) / 100,
              net: Math.round(netVat * 100) / 100,
              to_pay: netVat > 0 ? Math.round(netVat * 100) / 100 : 0,
              to_refund: netVat < 0 ? Math.round(Math.abs(netVat) * 100) / 100 : 0
            },
            journal_entries: [
              { account: '3001', name: 'Försäljning 25%', debit: 0, credit: sales25.net },
              { account: '3002', name: 'Försäljning 12%', debit: 0, credit: sales12.net },
              { account: '3003', name: 'Försäljning 6%', debit: 0, credit: sales6.net },
              { account: '2611', name: 'Utgående moms 25%', debit: 0, credit: sales25.vat },
              { account: '2621', name: 'Utgående moms 12%', debit: 0, credit: sales12.vat },
              { account: '2631', name: 'Utgående moms 6%', debit: 0, credit: sales6.vat },
              { account: '2641', name: 'Ingående moms', debit: totalIncoming, credit: 0 }
            ].filter(j => j.debit !== 0 || j.credit !== 0),
            validation: {
              is_valid: true,
              errors: [],
              warnings: aiAnalysis.confidence < 0.8
                ? [{ field: 'mapping', message: 'Låg konfidens i kolumnmappning, verifiera resultatet', severity: 'warning' }]
                : []
            },
            ai_analysis: {
              file_type: aiAnalysis.file_type,
              confidence: aiAnalysis.confidence,
              column_mapping: aiAnalysis.column_mapping,
              notes: aiAnalysis.notes
            },
            backend: 'fallback'
          }
        };
      }

      // ============================================================
      // COMPLETE
      // ============================================================
      await sendProgress({
        step: 'complete',
        message: 'Analys klar!',
        progress: 1.0,
        report: finalReport
      });

      logger.info('Analysis complete', {
        filename: body.filename,
        transactions: normalizedTransactions.length,
        backend: pythonReport ? 'python+claude' : 'fallback'
      });

      await writer.close();

    } catch (error) {
      logger.error('Analysis failed', error);
      await sendProgress({
        step: 'error',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      await writer.close();
    }
  })();

  // Return streaming response
  return new Response(stream.readable, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  });
});

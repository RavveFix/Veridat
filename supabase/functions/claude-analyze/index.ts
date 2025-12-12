// Supabase Edge Function for Claude Excel Analysis
/// <reference path="../../types/deno.d.ts" />

// @ts-expect-error - Deno npm: specifier
import Anthropic from "npm:@anthropic-ai/sdk@0.32.1";
// @ts-expect-error - Deno npm: specifier
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Swedish accounting system prompt
const SWEDISH_ACCOUNTING_PROMPT = `Du är Britta, en svensk redovisningsassistent specialiserad på momsredovisning för elbilsladdning.

## KRITISKA REGLER - FÖLJ NOGGRANT

### 1. Analysera ALLA rader
- Gå igenom VARJE rad i Excel-filen från första till sista
- Summera ALLA transaktioner, hoppa inte över någon
- Dubbelkolla att total_income = summa av alla positiva belopp
- Dubbelkolla att total_costs = summa av alla negativa belopp (absolutvärde)

### 2. BAS-Konton för Elbilsladdning (CPO/eMSP)

**Intäkter (Debet):**
- **3010**: Laddning till privatkunder (25% moms, ingår ej i OCPI-roaming)
  - Exempel: TEAM#885290 | Tumba → OPERATOR#3636 | CC
- **3011**: Roaming-försäljning momsfri (0% moms, OCPI mellan operatörer)
  - Exempel: OPERATOR#1 | Monta → TEAM#885290 | Tumba

**Kostnader (Kredit):**
- **6590**: Externa tjänster/avgifter (plattformsavgifter från Charge Amps, Monta, etc.)
  - Ingående moms 25% avdragsgill

**Moms:**
- **2611**: Utgående moms 25% (endast på 3010, ej 3011)
- **2641**: Ingående moms 25% (från 6590 kostnader)

### 3. Transaktionskategorisering

**Försäljning (sales):**
- Alla rader där "amount" är POSITIVT
- Om "from" innehåller "TEAM#" och "to" innehåller "OPERATOR#" → Konto 3010, 25% moms
- Om "from" innehåller "OPERATOR#" och "to" innehåller "TEAM#" → Konto 3011, 0% moms

**Kostnader (costs):**
- Alla rader där "amount" är NEGATIVT
- Vanligtvis plattformsavgifter → Konto 6590, 25% moms avdragsgill

### 4. Organisationsnummer
- Format: NNNNNN-NNNN (6 siffror, bindestreck, 4 siffror)
- Ta INTE med kontrollsiffror eller suffix "01"
- Exempel: 556183-9191 (inte 556183-919101)

### 5. Momsberäkningar

**För 25% moms:**
net = amount / 1.25
vat = amount - net

**För 0% moms (roaming):**
net = amount
vat = 0

**Validering (MÅSTE stämma):**
- total_income = sum(alla positiva amount)
- total_costs = abs(sum(alla negativa amount))
- outgoing_25 = sum(vat från försäljning med 25%)
- incoming = sum(vat från kostnader)
- net = outgoing_25 - incoming

### 6. Journal Entries (Bokföring)

**För försäljning med 25% moms:**
- Debet 1510 (Kundfordringar): Brutto belopp
- Kredit 3010 (Försäljning): Netto belopp
- Kredit 2611 (Utgående moms): Moms belopp

**För momsfri försäljning (roaming):**
- Debet 1510 (Kundfordringar): Brutto belopp
- Kredit 3011 (Försäljning momsfri): Netto belopp

**För kostnader med 25% ingående moms:**
- Debet 6590 (Externa tjänster): Netto belopp
- Debet 2641 (Ingående moms): Moms belopp
- Kredit 2440 (Leverantörsskulder): Brutto belopp

## VALIDERING - KOLLA INNAN DU SKICKAR

Innan du returnerar data, KOLLA ATT:
1. ✓ Antal försäljningar + kostnader = totalt antal rader i Excel
2. ✓ sum(sales[].net + sales[].vat) == sum(alla positiva amount)
3. ✓ sum(costs[].net + costs[].vat) == abs(sum(alla negativa amount))
4. ✓ outgoing_25 == sum(sales där rate=25).vat
5. ✓ incoming == sum(costs).vat
6. ✓ net == outgoing_25 - incoming
7. ✓ debet == kredit i journal_entries
8. ✓ org_number format: NNNNNN-NNNN (6-4 siffror)

Om någon validering MISSLYCKAS, lägg fel i validation.errors och försök rätta problemet.`;

// Tool definition for structured VAT report output
const VAT_REPORT_TOOL = {
    name: "create_vat_report",
    description: "Skapar svensk momsredovisning med validering enligt svenska regler",
    input_schema: {
        type: "object",
        properties: {
            type: {
                type: "string",
                description: "Typ av rapport, alltid 'vat_report'"
            },
            period: {
                type: "string",
                description: "Period i format YYYY-MM, t.ex. '2025-11'"
            },
            company: {
                type: "object",
                properties: {
                    name: {
                        type: "string",
                        description: "Företagets namn"
                    },
                    org_number: {
                        type: "string",
                        description: "Organisationsnummer i format NNNNNN-NNNN"
                    }
                }
            },
            summary: {
                type: "object",
                properties: {
                    total_income: {
                        type: "number",
                        description: "Total försäljning exklusive moms"
                    },
                    total_costs: {
                        type: "number",
                        description: "Totala kostnader exklusive moms"
                    },
                    total_kwh: {
                        type: "number",
                        description: "Total kWh för laddning (om relevant)"
                    },
                    result: {
                        type: "number",
                        description: "Resultat (intäkter - kostnader)"
                    }
                },
                required: ["total_income", "total_costs", "result"]
            },
            sales: {
                type: "array",
                description: "Lista över alla försäljningar",
                items: {
                    type: "object",
                    properties: {
                        description: {
                            type: "string",
                            description: "Beskrivning av försäljningen"
                        },
                        net: {
                            type: "number",
                            description: "Belopp exklusive moms"
                        },
                        vat: {
                            type: "number",
                            description: "Momsbelopp"
                        },
                        rate: {
                            type: "number",
                            description: "Momssats i procent (25, 12, 6, eller 0)"
                        }
                    },
                    required: ["description", "net", "vat", "rate"]
                }
            },
            costs: {
                type: "array",
                description: "Lista över alla kostnader",
                items: {
                    type: "object",
                    properties: {
                        description: {
                            type: "string",
                            description: "Beskrivning av kostnaden"
                        },
                        net: {
                            type: "number",
                            description: "Belopp exklusive moms"
                        },
                        vat: {
                            type: "number",
                            description: "Ingående moms"
                        },
                        rate: {
                            type: "number",
                            description: "Momssats i procent"
                        }
                    },
                    required: ["description", "net", "vat", "rate"]
                }
            },
            vat: {
                type: "object",
                description: "Momssammanställning",
                properties: {
                    outgoing_25: {
                        type: "number",
                        description: "Utgående moms 25%"
                    },
                    outgoing_12: {
                        type: "number",
                        description: "Utgående moms 12%"
                    },
                    outgoing_6: {
                        type: "number",
                        description: "Utgående moms 6%"
                    },
                    incoming: {
                        type: "number",
                        description: "Ingående moms totalt"
                    },
                    net: {
                        type: "number",
                        description: "Nettomoms (utgående - ingående)"
                    },
                    to_pay: {
                        type: "number",
                        description: "Moms att betala (positivt värde)"
                    },
                    to_refund: {
                        type: "number",
                        description: "Moms att återfå (positivt värde)"
                    }
                },
                required: ["outgoing_25", "incoming", "net"]
            },
            journal_entries: {
                type: "array",
                description: "Bokföringsförslag enligt BAS-kontoplanen",
                items: {
                    type: "object",
                    properties: {
                        account: {
                            type: "string",
                            description: "4-siffrigt BAS-kontonummer"
                        },
                        name: {
                            type: "string",
                            description: "Kontonamn"
                        },
                        debit: {
                            type: "number",
                            description: "Debetbelopp (0 om inget)"
                        },
                        credit: {
                            type: "number",
                            description: "Kreditbelopp (0 om inget)"
                        }
                    },
                    required: ["account", "name", "debit", "credit"]
                }
            },
            validation: {
                type: "object",
                description: "Valideringsresultat",
                properties: {
                    is_valid: {
                        type: "boolean",
                        description: "Om rapporten är giltig"
                    },
                    errors: {
                        type: "array",
                        items: { type: "string" },
                        description: "Lista med fel som upptäckts"
                    },
                    warnings: {
                        type: "array",
                        items: { type: "string" },
                        description: "Lista med varningar"
                    }
                },
                required: ["is_valid", "errors", "warnings"]
            },
            charging_sessions: {
                type: "array",
                description: "Detaljerad lista över laddningssessioner (om relevant)",
                items: {
                    type: "object",
                    properties: {
                        date: {
                            type: "string",
                            description: "Datum för laddning (YYYY-MM-DD)"
                        },
                        user: {
                            type: "string",
                            description: "Användarnamn eller ID"
                        },
                        kwh: {
                            type: "number",
                            description: "Antal kWh levererade"
                        },
                        amount: {
                            type: "number",
                            description: "Belopp inklusive moms"
                        }
                    }
                }
            }
        },
        required: ["type", "period", "summary", "sales", "costs", "vat", "journal_entries", "validation"]
    }
};

Deno.serve(async (req: Request) => {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        // Validate User Token
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) {
            return new Response(
                JSON.stringify({ error: "Missing Authorization header" }),
                { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
        const supabase = createClient(supabaseUrl, supabaseAnonKey, {
            global: { headers: { Authorization: authHeader } },
        });

        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError || !user) {
            return new Response(
                JSON.stringify({ error: "Unauthorized" }),
                { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const { filename, sheets } = await req.json();

        if (!filename || !sheets) {
            return new Response(
                JSON.stringify({ error: "filename and sheets are required" }),
                {
                    status: 400,
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                }
            );
        }

        // Initialize Claude client
        const apiKey = Deno.env.get('CLAUDE_API_KEY');
        if (!apiKey) {
            return new Response(
                JSON.stringify({ error: "Claude API key not configured" }),
                {
                    status: 500,
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                }
            );
        }

        const client = new Anthropic({ apiKey });

        console.log(`Analyzing Excel file: ${filename} with ${Object.keys(sheets).length} sheets`);

        // Convert sheets to formatted text for Claude
        let excelText = `Excel-fil: ${filename}\n\n`;

        for (const [sheetName, rows] of Object.entries(sheets)) {
            excelText += `=== Flik: ${sheetName} ===\n\n`;

            // Format as table
            const rowsArray = rows as any[][];
            if (rowsArray.length > 0) {
                // Add rows
                rowsArray.forEach((row, idx) => {
                    if (idx === 0) {
                        // Header row
                        excelText += row.join(' | ') + '\n';
                        excelText += '-'.repeat(80) + '\n';
                    } else {
                        excelText += row.join(' | ') + '\n';
                    }
                });
            }
            excelText += '\n';
        }

        console.log('Formatted Excel text length:', excelText.length);

        // Call Claude with text instead of document
        // Model can be overridden via Supabase secrets/env
        // Example: supabase secrets set CLAUDE_MODEL=claude-sonnet-4-20250514
        const modelName = Deno.env.get('CLAUDE_MODEL') || Deno.env.get('ANTHROPIC_MODEL') || "claude-sonnet-4-20250514";

        const response = await client.messages.create({
            model: modelName,
            max_tokens: 8000,
            system: SWEDISH_ACCOUNTING_PROMPT,
            tools: [VAT_REPORT_TOOL],
            messages: [{
                role: "user",
                content: `Analysera denna Excel-fil för elbilsladdning och skapa en komplett svensk momsredovisning.

${excelText}

## INSTRUKTIONER

1. **Räkna rader**: Hur många rader finns totalt? (exklusive header)
2. **Identifiera period**: Extrahera YYYY-MM från första raden eller filnamn
3. **Identifiera företag**: Hitta företagsnamn och org.nr (format NNNNNN-NNNN)

4. **Kategorisera VARJE rad**:
   - Positiv amount → Försäljning (sales)
     - TEAM#→OPERATOR# = Konto 3010, 25% moms
     - OPERATOR#→TEAM# = Konto 3011, 0% moms (roaming)
   - Negativ amount → Kostnad (costs)
     - Konto 6590, 25% ingående moms

5. **Beräkna moms för VARJE rad**:
   - 25% moms: net = amount/1.25, vat = amount - net
   - 0% moms: net = amount, vat = 0

6. **Summera**:
   - total_income = sum(alla positiva amount)
   - total_costs = abs(sum(alla negativa amount))
   - outgoing_25 = sum(vat från försäljning 25%)
   - incoming = sum(vat från kostnader)
   - net = outgoing_25 - incoming

7. **Skapa journal_entries** enligt BAS-kontoplanen

8. **VALIDERA** innan du skickar:
   - Antal sales + costs == antal rader i Excel
   - Summor stämmer (se system prompt)
   - Debet == Kredit

Använd create_vat_report tool för att returnera strukturerad data.`
            }]
        });

        console.log("Claude response received");

        // Extract tool use result
        const toolUse = response.content.find((c: any) => c.type === 'tool_use');

        if (!toolUse) {
            // If no tool use, try to extract text response
            const textContent = response.content.find((c: any) => c.type === 'text');
            return new Response(
                JSON.stringify({
                    error: "No structured output from Claude",
                    rawResponse: textContent?.text || "No response"
                }),
                {
                    status: 500,
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                }
            );
        }

        // Validate the report structure
        const report = toolUse.input;

        // Basic validation
        if (!report.type || !report.period || !report.summary || !report.vat || !report.validation) {
            return new Response(
                JSON.stringify({ error: "Invalid report structure from Claude - missing required fields" }),
                {
                    status: 500,
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                }
            );
        }

        // Enhanced validation
        const totalSalesAmount = report.sales.reduce((sum: number, s: any) => sum + s.net + s.vat, 0);
        const totalCostsAmount = report.costs.reduce((sum: number, c: any) => sum + c.net + c.vat, 0);

        console.log('Validation check:');
        console.log(`- Sales count: ${report.sales.length}`);
        console.log(`- Costs count: ${report.costs.length}`);
        console.log(`- Total sales amount: ${totalSalesAmount.toFixed(2)} SEK`);
        console.log(`- Total costs amount: ${totalCostsAmount.toFixed(2)} SEK`);
        console.log(`- Reported total_income: ${report.summary.total_income.toFixed(2)} SEK`);
        console.log(`- Reported total_costs: ${report.summary.total_costs.toFixed(2)} SEK`);

        // Check if sums match (with 1 SEK tolerance for rounding)
        if (Math.abs(totalSalesAmount - report.summary.total_income) > 1) {
            console.warn(`WARNING: Sales sum mismatch: ${totalSalesAmount} vs ${report.summary.total_income}`);
            if (!report.validation.warnings) report.validation.warnings = [];
            report.validation.warnings.push(`Försäljningssumma stämmer inte: ${totalSalesAmount.toFixed(2)} SEK vs rapporterad ${report.summary.total_income.toFixed(2)} SEK`);
        }

        if (Math.abs(totalCostsAmount - report.summary.total_costs) > 1) {
            console.warn(`WARNING: Costs sum mismatch: ${totalCostsAmount} vs ${report.summary.total_costs}`);
            if (!report.validation.warnings) report.validation.warnings = [];
            report.validation.warnings.push(`Kostnadssumma stämmer inte: ${totalCostsAmount.toFixed(2)} SEK vs rapporterad ${report.summary.total_costs.toFixed(2)} SEK`);
        }

        console.log(`Analysis complete for period: ${report.period}`);

        return new Response(
            JSON.stringify({
                type: 'vat_report',
                data: report
            }),
            {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
        );

    } catch (error) {
        console.error("Claude analysis error:", error);
        return new Response(
            JSON.stringify({
                error: error instanceof Error ? error.message : "Internal server error",
                details: error instanceof Error ? error.stack : undefined
            }),
            {
                status: 500,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
        );
    }
});

// Deno-compatible Gemini Service for Supabase Edge Functions
// Using @google/generative-ai package compatible with Deno
/// <reference path="../types/deno.d.ts" />

// @ts-expect-error - Deno npm: specifier not recognized by VSCode but works in Deno runtime
import { GoogleGenerativeAI } from "npm:@google/generative-ai@0.21.0";

export const SYSTEM_INSTRUCTION = `Du är Britta, en autonom AI-agent och expert på svensk bokföring.
Du hjälper användaren att hantera bokföring och fakturering i Fortnox via API.
Du kan läsa och analysera uppladdade dokument (PDF, bilder) som fakturor, kvitton och skattekonton.

## Din roll:
1. **Analysera**: Förstå vad användaren vill göra (t.ex. skapa faktura, kolla kunder, analysera skattekonto).
2. **Agera**: Använd tillgängliga verktyg (tools) för att hämta data eller utföra åtgärder i Fortnox.
3. **Svara**: Ge ett tydligt och trevligt svar på svenska baserat på resultatet.

## Verktyg (Tools):
- **create_invoice**: Skapar ett fakturautkast i Fortnox. Kräver kundnummer och artiklar.
- **get_customers**: Hämtar en lista på kunder från Fortnox. Returnerar namn och kundnummer.
- **get_articles**: Hämtar en lista på artiklar från Fortnox. Returnerar beskrivning, artikelnummer och pris.

## Arbetsflöde för Fakturering:
1. Om användaren vill skapa en faktura men inte anger kundnummer eller artikelnummer:
   - Använd **get_customers** och **get_articles** för att hitta rätt information.
   - Fråga användaren om det är otydligt vilken kund eller artikel som avses.
2. När du har all information (Kundnr, Artikelnr, Antal):
   - Anropa **create_invoice** med korrekt data.
3. Bekräfta för användaren att fakturautkastet är skapat.

## Datahantering:
- När du får data från **get_customers**, notera särskilt "CustomerNumber" och "Name".
- När du får data från **get_articles**, notera "ArticleNumber", "Description" och "SalesPrice".
- Använd dessa exakta värden när du anropar **create_invoice**.

## 📄 Skattekonto-analys (PDF):
När användaren laddar upp ett dokument från Skatteverket (skattekonto som PDF eller ger information om sitt skattekonto):

### Extrahera och analysera:
1. **Nyckeldata att identifiera:**
   - Organisationsnummer
   - Aktuellt saldo (positivt = tillgodo, negativt = skuld)
   - Kommande förfallodatum för betalningar
   - Senaste transaktioner (inbetalningar och debiteringar)
   - Typ av skatter (moms, arbetsgivaravgifter, F-skatt, etc.)
   - Eventuella restföranden eller påminnelseavgifter

2. **Ge proaktiva råd:**
   - Påminn om nästa förfallodag och hur många dagar som återstår
   - Varna om restföranden eller påminnelseavgifter
   - Föreslå att sätta upp betalning om förfallodagen är nära
   - Förklara vad olika skatteposter innebär om användaren undrar

3. **Bokföringsförslag för skattebetalningar:**
   När användaren ska betala skatt eller redan betalat:
   
   **Vid inbetalning av moms:**
   - Debet: 2650 (Redovisningskonto för moms)
   - Kredit: 1930 (Företagskonto/checkräkningskonto)
   
   **Vid inbetalning av arbetsgivaravgifter:**
   - Debet: 2710 (Personalskatt)
   - Kredit: 1930 (Företagskonto)
   
   **Vid inbetalning av F-skatt/preliminärskatt:**
   - Debet: 2510 (Skatteskuld)
   - Kredit: 1930 (Företagskonto)
   
   **Om företaget har skattefordran (tillgodo):**
   - Debet: 1630 (Skattefordran)
   - Kredit: 2650/2710 (beroende på typ)

4. **Presentationsformat:**
   Ge alltid ett strukturerat svar med:
   - 📊 Tydlig sammanfattning av läget
   - ⚠️ Varningar om viktiga datum
   - 💡 Konkreta bokföringsförslag med verifikationsmall
   - ✅ Nästa steg för användaren

## 📄 Leverantörsfaktura-analys (PDF/Bild):
När användaren laddar upp en leverantörsfaktura (faktura från en leverantör som företaget ska betala):

### Du KAN och SKA läsa och analysera den uppladdade filen:
1. **Extrahera all nyckeldata från fakturan:**
   - Leverantörens namn och organisationsnummer
   - Fakturanummer och fakturadatum
   - Förfallodatum (viktigt för betalning)
   - Totalt belopp att betala (inklusive moms)
   - Nettobelopp (exklusive moms)
   - Momsbelopp och momssats (vanligtvis 25%, 12%, 6% eller 0%)
   - Betalningsuppgifter (bankgiro, plusgiro, IBAN)
   - Fakturarader med artiklar/tjänster, antal, à-pris
   - Eventuell betalningsreferens/OCR-nummer

2. **Analysera och kategorisera inköpet:**
   Identifiera typ av kostnad och föreslå rätt BAS-konto:

   **Vanliga kostnadskategorier:**
   - **Varor för återförsäljning**: 4010 (Inköp varor)
   - **Kontorsmaterial**: 6110 (Kontorsmaterial)
   - **Hyra**: 5010 (Lokalhyra)
   - **El, vatten, värme**: 5460 (Förbrukningsmaterial)
   - **IT-tjänster/programvara**: 6540 (IT-tjänster)
   - **Marknadsföring**: 6110 (Reklam och PR)
   - **Konsulttjänster**: 6580 (Konsultarvoden)
   - **Frakt**: 6420 (Frakter och transporter)
   - **Representation**: 6970 (Representation, avdragsgill)
   - **Bankkostnader**: 6570 (Bankkostnader)
   - **Övriga tjänster**: 6590 (Övriga externa tjänster)

3. **Ge komplett bokföringsförslag:**

   **Exempel på bokföring med 25% moms:**

   Debet: [Kostnadskonto] (t.ex. 6540 IT-tjänster)     1 000,00 SEK
   Debet: 2641 (Ingående moms, 25%)                      250,00 SEK
       Kredit: 2440 (Leverantörsskulder)                           1 250,00 SEK

   **Vid momsfri faktura (0% moms):**

   Debet: [Kostnadskonto]                              X,XX SEK
       Kredit: 2440 (Leverantörsskulder)                     X,XX SEK

   **Vid omvänd skattskyldighet (EU-handel):**
   - Notera att särskilda regler kan gälla
   - Föreslå konsultering av revisor för komplexa fall

4. **Presentera strukturerat svar:**
   - 📋 **Fakturasammanfattning**: Leverantör, belopp, förfallodatum
   - 💰 **Belopp**: Netto, moms, totalt
   - 📊 **Bokföringsförslag**: Exakt kontering med BAS-konton
   - 💡 **Förklaring**: Varför dessa konton valdes
   - ⚠️ **Viktigt**: Påminnelser om förfallodatum eller speciella noteringar
   - ✅ **Nästa steg**: "Godkänn och betala före [datum]", "Kontakta leverantör vid fel", etc.

5. **Proaktiva råd:**
   - Varna om fakturan snart förfaller
   - Föreslå att kontrollera att varor/tjänster mottagits innan betalning
   - Påminn om att spara verifikationer digitalt
   - Om beloppet är stort, nämn att betala i tid för att undvika dröjsmålsränta

## Bokföringsregler:
1. Svara alltid på svenska.
2. Följ god redovisningssed och BAS-kontoplanen.
3. Om något går fel, förklara problemet enkelt för användaren.
4. Var proaktiv - ge råd innan användaren frågar.
`;

const tools = [
    {
        functionDeclarations: [
            {
                name: "create_invoice",
                description: "Skapar ett fakturautkast i Fortnox. Använd detta när användaren vill fakturera.",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        CustomerNumber: {
                            type: "STRING",
                            description: "Kundnumret i Fortnox (t.ex. '1001')"
                        },
                        InvoiceRows: {
                            type: "ARRAY",
                            description: "Lista på fakturarader",
                            items: {
                                type: "OBJECT",
                                properties: {
                                    ArticleNumber: {
                                        type: "STRING",
                                        description: "Artikelnumret (t.ex. 'ART1')"
                                    },
                                    DeliveredQuantity: {
                                        type: "STRING",
                                        description: "Antal levererade enheter (t.ex. '10')"
                                    }
                                },
                                required: ["ArticleNumber", "DeliveredQuantity"]
                            }
                        }
                    },
                    required: ["CustomerNumber", "InvoiceRows"]
                }
            },
            {
                name: "get_customers",
                description: "Hämtar lista på kunder från Fortnox. Används för att slå upp kundnummer.",
                parameters: {
                    type: "OBJECT",
                    properties: {}, // No parameters needed
                }
            },
            {
                name: "get_articles",
                description: "Hämtar lista på artiklar från Fortnox. Används för att slå upp artikelnummer och priser.",
                parameters: {
                    type: "OBJECT",
                    properties: {}, // No parameters needed
                }
            }
        ]
    }
];


export interface FileData {
    mimeType: string;
    data: string; // base64 encoded
}

// Tool argument types for different Fortnox operations
export interface CreateInvoiceArgs {
    customer_number: string;
    article_number: string;
    quantity: number;
}

export interface ToolCall {
    tool: 'create_invoice' | 'get_customers' | 'get_articles';
    args: CreateInvoiceArgs | Record<string, never>; // CreateInvoiceArgs for create_invoice, empty object for get_* tools
}

export interface GeminiResponse {
    text?: string;
    toolCall?: ToolCall;
}

export const sendMessageToGemini = async (
    message: string,
    fileData?: FileData,
    history?: Array<{ role: string, content: string }>,
    apiKey?: string
): Promise<GeminiResponse> => {
    try {
        const key = apiKey || Deno.env.get("GEMINI_API_KEY");

        if (!key) {
            throw new Error("GEMINI_API_KEY not found in environment");
        }

        const genAI = new GoogleGenerativeAI(key);

        // Default model can be overridden via Supabase secrets/env
        // Example: supabase secrets set GEMINI_MODEL=gemini-2.5-pro
        const modelName = Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash";

        const model = genAI.getGenerativeModel({
            model: modelName,
            systemInstruction: SYSTEM_INSTRUCTION,
            tools: tools,
        });

        // Build conversation contents from history
        const contents = [];

        // Add previous messages from history
        if (history && history.length > 0) {
            for (const msg of history) {
                contents.push({
                    role: msg.role === 'user' ? 'user' : 'model',
                    parts: [{ text: msg.content }]
                });
            }
        }

        // Add current message with optional file
        type ContentPart = { text: string } | { inlineData: { mimeType: string; data: string } };
        const currentParts: ContentPart[] = [];

        // Add file if present
        if (fileData) {
            currentParts.push({
                inlineData: {
                    mimeType: fileData.mimeType,
                    data: fileData.data,
                },
            });
        }

        // Add text message
        currentParts.push({ text: message });

        contents.push({ role: "user", parts: currentParts });

        const result = await model.generateContent({
            contents: contents,
            generationConfig: {
                temperature: 0.4,
                maxOutputTokens: 2048,
            },
        });

        const response = await result.response;

        // Check for function calls
        const functionCall = response.functionCalls()?.[0];
        if (functionCall) {
            return {
                toolCall: {
                    tool: functionCall.name,
                    args: functionCall.args
                }
            };
        }

        const text = response.text();
        return { text: text || "Jag kunde inte generera ett svar just nu." };
    } catch (error) {
        console.error("Gemini API Error:", error);
        throw error;
    }
};

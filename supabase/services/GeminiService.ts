// Deno-compatible Gemini Service for Supabase Edge Functions
// Using @google/generative-ai package compatible with Deno
/// <reference path="../types/deno.d.ts" />

import { createLogger } from "./LoggerService.ts";

import { GoogleGenerativeAI, SchemaType, type Tool } from "npm:@google/generative-ai@0.21.0";

const logger = createLogger("gemini");

export const SYSTEM_INSTRUCTION = `Du är Britta, en autonom AI-agent och expert på svensk bokföring.
Du hjälper användaren att hantera bokföring och fakturering i Fortnox via API.
Du kan läsa och analysera uppladdade dokument (PDF, bilder) som fakturor, kvitton och skattekonton.

## Din roll:
1. **Analysera**: Förstå vad användaren vill göra (t.ex. skapa faktura, kolla kunder, analysera skattekonto).
2. **Agera**: Använd tillgängliga verktyg (tools) för att hämta data eller utföra åtgärder i Fortnox.
3. **Svara**: Ge ett tydligt och trevligt svar på svenska baserat på resultatet.

## Minne och kontext:
Du har tillgång till användarens tidigare konversationer. Använd proaktivt:
- **conversation_search**: När användaren refererar till något ni pratat om förut, eller när tidigare kontext kan vara relevant
- **recent_chats**: När du behöver överblick av senaste konversationer

Var proaktiv - sök i historiken om du misstänker att relevant information finns där.
Nämn aldrig att du "söker" eller "letar" - presentera informationen naturligt.

## Verktyg (Tools):
- **conversation_search**: Söker i användarens tidigare konversationer. Använd när något verkar referera till tidigare diskussioner.
- **recent_chats**: Hämtar de senaste konversationerna för att få överblick.
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

const tools: Tool[] = [
    {
        functionDeclarations: [
            {
                name: "conversation_search",
                description: "Söker i användarens tidigare konversationer för att hitta relevant kontext. Använd proaktivt när användaren refererar till tidigare diskussioner, eller när historisk information kan vara användbar.",
                parameters: {
                    type: SchemaType.OBJECT,
                    properties: {
                        query: {
                            type: SchemaType.STRING,
                            description: "Sökfråga - vad du letar efter i tidigare konversationer (t.ex. 'moms Q3', 'faktura till Acme')"
                        }
                    },
                    required: ["query"]
                }
            },
            {
                name: "recent_chats",
                description: "Hämtar de senaste konversationerna för att få överblick över vad användaren pratat om nyligen. Använd när du behöver kontext eller överblick.",
                parameters: {
                    type: SchemaType.OBJECT,
                    properties: {
                        limit: {
                            type: SchemaType.NUMBER,
                            description: "Antal konversationer att hämta (max 10, standard 5)"
                        }
                    }
                }
            },
            {
                name: "create_invoice",
                description: "Skapar ett fakturautkast i Fortnox. Använd detta när användaren vill fakturera.",
                parameters: {
                    type: SchemaType.OBJECT,
                    properties: {
                        CustomerNumber: {
                            type: SchemaType.STRING,
                            description: "Kundnumret i Fortnox (t.ex. '1001')"
                        },
                        InvoiceRows: {
                            type: SchemaType.ARRAY,
                            description: "Lista på fakturarader",
                            items: {
                                type: SchemaType.OBJECT,
                                properties: {
                                    ArticleNumber: {
                                        type: SchemaType.STRING,
                                        description: "Artikelnumret (t.ex. 'ART1')"
                                    },
                                    DeliveredQuantity: {
                                        type: SchemaType.STRING,
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
                    type: SchemaType.OBJECT,
                    properties: {}, // No parameters needed
                }
            },
            {
                name: "get_articles",
                description: "Hämtar lista på artiklar från Fortnox. Används för att slå upp artikelnummer och priser.",
                parameters: {
                    type: SchemaType.OBJECT,
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
export type InvoiceRowArgs = {
    ArticleNumber: string;
    DeliveredQuantity: string;
    [key: string]: unknown;
};

export type CreateInvoiceArgs = {
    CustomerNumber: string;
    InvoiceRows: InvoiceRowArgs[];
    [key: string]: unknown;
};

export type ConversationSearchArgs = {
    query: string;
    [key: string]: unknown;
};

export type RecentChatsArgs = {
    limit?: number;
    [key: string]: unknown;
};

export type ToolCall =
    | { tool: 'conversation_search'; args: ConversationSearchArgs }
    | { tool: 'recent_chats'; args: RecentChatsArgs }
    | { tool: 'create_invoice'; args: CreateInvoiceArgs }
    | { tool: 'get_customers'; args: Record<string, never> }
    | { tool: 'get_articles'; args: Record<string, never> };

export interface GeminiResponse {
    text?: string;
    toolCall?: ToolCall;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeCreateInvoiceArgs(value: unknown): CreateInvoiceArgs | null {
    if (!isRecord(value)) return null;

    const rawCustomerNumber = value.CustomerNumber;
    const rawRows = value.InvoiceRows;

    const customerNumber = (typeof rawCustomerNumber === 'string' || typeof rawCustomerNumber === 'number')
        ? String(rawCustomerNumber).trim()
        : '';
    if (!customerNumber) return null;

    if (!Array.isArray(rawRows) || rawRows.length === 0) return null;

    const rows: InvoiceRowArgs[] = [];
    for (const row of rawRows) {
        if (!isRecord(row)) continue;
        const rawArticleNumber = row.ArticleNumber;
        const rawDeliveredQuantity = row.DeliveredQuantity;

        const articleNumber = (typeof rawArticleNumber === 'string' || typeof rawArticleNumber === 'number')
            ? String(rawArticleNumber).trim()
            : '';
        const deliveredQuantity = (typeof rawDeliveredQuantity === 'string' || typeof rawDeliveredQuantity === 'number')
            ? String(rawDeliveredQuantity).trim()
            : '';

        if (!articleNumber || !deliveredQuantity) continue;
        rows.push({ ...row, ArticleNumber: articleNumber, DeliveredQuantity: deliveredQuantity });
    }

    if (rows.length === 0) return null;

    return {
        ...value,
        CustomerNumber: customerNumber,
        InvoiceRows: rows
    } as CreateInvoiceArgs;
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
        // Example: supabase secrets set GEMINI_MODEL=gemini-1.5-pro
        const modelName = Deno.env.get("GEMINI_MODEL") || "gemini-1.5-flash";

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
            // Memory tools
            if (functionCall.name === 'conversation_search') {
                const query = (functionCall.args as Record<string, unknown>)?.query;
                if (typeof query === 'string' && query.trim()) {
                    return {
                        toolCall: {
                            tool: 'conversation_search',
                            args: { query: query.trim() }
                        }
                    };
                }
            }

            if (functionCall.name === 'recent_chats') {
                const rawLimit = (functionCall.args as Record<string, unknown>)?.limit;
                const limit = typeof rawLimit === 'number' ? Math.min(Math.max(rawLimit, 1), 10) : 5;
                return {
                    toolCall: {
                        tool: 'recent_chats',
                        args: { limit }
                    }
                };
            }

            // Fortnox tools
            if (functionCall.name === 'get_customers' || functionCall.name === 'get_articles') {
                return {
                    toolCall: {
                        tool: functionCall.name,
                        args: {}
                    }
                };
            }

            if (functionCall.name === 'create_invoice') {
                const normalized = normalizeCreateInvoiceArgs(functionCall.args);
                if (normalized) {
                    return {
                        toolCall: {
                            tool: 'create_invoice',
                            args: normalized
                        }
                    };
                }

                return {
                    text: "Jag kan hjälpa dig skapa en faktura, men jag saknar kundnummer och/eller fakturarader. Vilken kund (kundnummer) och vilka artiklar/antal ska faktureras?"
                };
            }
        }

        const text = response.text();
        return { text: text || "Jag kunde inte generera ett svar just nu." };
    } catch (error) {
        logger.error("Gemini API Error", error);
        throw error;
    }
};

/**
 * Send a message to Gemini and get a stream of responses
 */
export const sendMessageStreamToGemini = async (
    message: string,
    fileData?: FileData,
    history?: Array<{ role: string, content: string }>,
    apiKey?: string
) => {
    try {
        const key = apiKey || Deno.env.get("GEMINI_API_KEY");
        if (!key) throw new Error("GEMINI_API_KEY not found");

        const genAI = new GoogleGenerativeAI(key);
        // Use same model as non-streaming (gemini-1.5-flash has better rate limits)
        const modelName = Deno.env.get("GEMINI_MODEL") || "gemini-1.5-flash";
        const model = genAI.getGenerativeModel({
            model: modelName,
            systemInstruction: SYSTEM_INSTRUCTION,
            tools: tools,
        });

        const contents = [];
        if (history && history.length > 0) {
            for (const msg of history) {
                contents.push({
                    role: msg.role === 'user' ? 'user' : 'model',
                    parts: [{ text: msg.content }]
                });
            }
        }

        const currentParts = [];
        if (fileData) {
            currentParts.push({
                inlineData: {
                    mimeType: fileData.mimeType,
                    data: fileData.data,
                },
            });
        }
        currentParts.push({ text: message });
        contents.push({ role: "user", parts: currentParts });

        // Start streaming
        const result = await model.generateContentStream({
            contents: contents,
            generationConfig: {
                temperature: 0.4,
                maxOutputTokens: 2048,
            },
        });

        return result.stream;
    } catch (error) {
        logger.error("Gemini Streaming API Error", error);
        throw error;
    }
};

/**
 * Generate a short, descriptive title for a conversation (max 5 words)
 * Uses Gemini Flash for speed and low cost
 */
export const generateConversationTitle = async (
    userMessage: string,
    aiResponse: string,
    apiKey?: string
): Promise<string> => {
    try {
        const key = apiKey || Deno.env.get("GEMINI_API_KEY");
        if (!key) {
            logger.warn("No API key for title generation, using fallback");
            return userMessage.substring(0, 50) + (userMessage.length > 50 ? '...' : '');
        }

        const genAI = new GoogleGenerativeAI(key);
        // Use flash model for speed and low cost
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

        const prompt = `Generera en kort svensk titel (max 5 ord) som sammanfattar denna konversation. Svara ENDAST med titeln, inget annat.

Användare: ${userMessage.substring(0, 300)}
AI: ${aiResponse.substring(0, 300)}

Titel:`;

        const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.3,
                maxOutputTokens: 30,
            },
        });

        const title = result.response.text()?.trim();

        // Validate and clean the title
        if (!title || title.length < 2 || title.length > 60) {
            return userMessage.substring(0, 50) + (userMessage.length > 50 ? '...' : '');
        }

        // Remove quotes if AI added them
        return title.replace(/^["']|["']$/g, '').trim();
    } catch (error) {
        logger.warn("Title generation failed, using fallback", { error });
        return userMessage.substring(0, 50) + (userMessage.length > 50 ? '...' : '');
    }
};

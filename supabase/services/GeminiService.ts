// Deno-compatible Gemini Service for Supabase Edge Functions
// Using @google/generative-ai package compatible with Deno
/// <reference path="../types/deno.d.ts" />

// @ts-expect-error - Deno npm: specifier not recognized by VSCode but works in Deno runtime
import { GoogleGenerativeAI } from "npm:@google/generative-ai@0.21.0";

const SYSTEM_INSTRUCTION = `Du är Britta, en autonom AI-agent och expert på svensk bokföring.
Du hjälper användaren att hantera bokföring och fakturering i Fortnox via API.

## Din roll:
1. **Analysera**: Förstå vad användaren vill göra (t.ex. skapa faktura, kolla kunder).
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

## Bokföringsregler:
1. Svara alltid på svenska.
2. Följ god redovisningssed.
3. Om något går fel, förklara problemet enkelt för användaren.
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

export interface ToolCall {
    tool: string;
    args: any;
}

export interface GeminiResponse {
    text?: string;
    toolCall?: ToolCall;
}

export const sendMessageToGemini = async (
    message: string,
    fileData?: FileData,
    apiKey?: string
): Promise<GeminiResponse> => {
    try {
        const key = apiKey || Deno.env.get("GEMINI_API_KEY");

        if (!key) {
            throw new Error("GEMINI_API_KEY not found in environment");
        }

        const genAI = new GoogleGenerativeAI(key);

        // Using gemini-2.5-flash
        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash",
            systemInstruction: SYSTEM_INSTRUCTION,
            tools: tools,
        });

        const parts: any[] = [];

        // Add file if present
        if (fileData) {
            parts.push({
                inlineData: {
                    mimeType: fileData.mimeType,
                    data: fileData.data,
                },
            });
        }

        // Add text message
        parts.push({ text: message });

        const result = await model.generateContent({
            contents: [{ role: "user", parts }],
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

        if (error instanceof Error) {
            return { text: `Tyvärr uppstod ett fel: ${error.message} ` };
        }

        return { text: "Tyvärr uppstod ett fel vid kontakten med mina hjärnceller (Gemini). Försök igen senare." };
    }
};

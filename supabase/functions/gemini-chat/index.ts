// Supabase Edge Function for Gemini Chat
/// <reference path="../../types/deno.d.ts" />

import { sendMessageToGemini, type FileData } from "../../services/GeminiService.ts";
import { RateLimiterService } from "../../services/RateLimiterService.ts";
import { ConversationService } from "../../services/ConversationService.ts";
import { getCorsHeaders, createOptionsResponse } from "../../services/CorsService.ts";
import { createLogger } from "../../services/LoggerService.ts";

// @ts-expect-error - Deno npm: specifier
import { createClient } from "npm:@supabase/supabase-js@2";
import { FortnoxService } from "../../services/FortnoxService.ts";

const logger = createLogger('gemini-chat');

interface RequestBody {
    message: string;
    fileData?: FileData;
    history?: Array<{ role: string, content: string }>;
    conversationId?: string;
    companyId?: string | null;
    fileUrl?: string | null;
    fileName?: string | null;
    vatReportContext?: VATReportContext | null;
}

// Proper type for VAT report context instead of 'any'
interface VATReportContext {
    type: string;
    period: string;
    company?: { name: string; org_number: string };
    summary?: { total_income: number; total_costs: number; result: number };
    vat?: { outgoing_25: number; incoming: number; net: number };
    validation?: { is_valid: boolean; errors: string[]; warnings: string[] };
}


Deno.serve(async (req: Request) => {
    const corsHeaders = getCorsHeaders();

    // Handle CORS preflight
    if (req.method === "OPTIONS") {
        return createOptionsResponse();
    }

    try {
        let { message, fileData, history, conversationId, companyId, fileUrl, fileName, vatReportContext }: RequestBody = await req.json();

        if (!message) {
            return new Response(
                JSON.stringify({ error: "Message is required" }),
                {
                    status: 400,
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                }
            );
        }

        // Require auth for AI calls to prevent anonymous abuse/costs
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

        // Initialize Supabase client with service role for rate limiting
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

        // Resolve actual user id from the access token (don’t trust client-provided IDs)
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

        // Check rate limit
        const rateLimiter = new RateLimiterService(supabaseAdmin);
        const rateLimit = await rateLimiter.checkAndIncrement(userId, 'gemini-chat');

        if (!rateLimit.allowed) {
            logger.warn('Rate limit exceeded', { userId });
            return new Response(
                JSON.stringify({
                    error: 'rate_limit_exceeded',
                    message: rateLimit.message,
                    remaining: rateLimit.remaining,
                    resetAt: rateLimit.resetAt.toISOString()
                }),
                {
                    status: 429,
                    headers: {
                        ...corsHeaders,
                        'Content-Type': 'application/json',
                        'X-RateLimit-Remaining': String(rateLimit.remaining),
                        'X-RateLimit-Reset': rateLimit.resetAt.toISOString()
                    }
                }
            );
        }

        logger.info('Rate limit check passed', { userId, remaining: rateLimit.remaining });

        // Save messages to database if conversationId is provided
        // We save the user message FIRST, before calling Gemini, to ensure it's recorded
        // even if the AI call fails. This creates an audit trail of user requests.
        let userMessageSaved = false;
        let conversationService: ConversationService | null = null;

        if (conversationId) {
            try {
                // Get auth token from request
                // Create authenticated Supabase client
                const supabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
                    global: { headers: { Authorization: authHeader } }
                });

                conversationService = new ConversationService(supabaseClient);

                // Save user message
                await conversationService.addMessage(
                    conversationId,
                    'user',
                    message,
                    fileUrl || null,
                    fileName || null
                );
                userMessageSaved = true;
                logger.info('User message saved to database', { conversationId });
            } catch (saveError) {
                logger.error('Failed to save user message', { error: saveError });
                // Continue anyway - user experience takes priority over persistence
                // The message will still be processed by Gemini
            }
        }

        // Inject VAT Report Context if available OR fetch from DB
        let finalMessage = message;

        if (!vatReportContext && conversationId) {
            // Try to fetch latest report from database
            try {
                const { data: reports, error } = await supabaseAdmin
                    .from('vat_reports')
                    .select('report_data, period, company_name')
                    .eq('conversation_id', conversationId)
                    .order('created_at', { ascending: false })
                    .limit(1);

                if (!error && reports && reports.length > 0) {
                    const report = reports[0];
                    const data = report.report_data;

                    // Map DB data to context structure
                    vatReportContext = {
                        type: 'vat_report',
                        period: report.period,
                        company: {
                            name: report.company_name || data.company_name || 'Okänt',
                            org_number: data.org_number || 'Saknas'
                        },
                        summary: data.summary,
                        vat: data.vat,
                        validation: data.claude_validation ? {
                            is_valid: data.claude_validation.validation_passed,
                            errors: [],
                            warnings: data.claude_validation.warnings || []
                        } : undefined
                    };
                    logger.info('Fetched VAT report context from DB', { conversationId });
                }
            } catch (fetchError) {
                logger.warn('Failed to fetch VAT report from DB', fetchError);
            }
        }

        if (vatReportContext) {
            logger.info('Injecting VAT report context');
            const netVat = vatReportContext.vat?.net ?? 0;
            const contextMessage = `
SYSTEM CONTEXT: Användaren tittar just nu på följande momsredovisning (genererad av ${vatReportContext.type === 'vat_report' ? 'systemet' : 'analysverktyget'}):

Period: ${vatReportContext.period}
Företag: ${vatReportContext.company?.name ?? 'Okänt'} (${vatReportContext.company?.org_number ?? 'Saknas'})

SAMMANFATTNING:
- Försäljning: ${vatReportContext.summary?.total_income ?? 0} SEK
- Kostnader: ${vatReportContext.summary?.total_costs ?? 0} SEK
- Resultat: ${vatReportContext.summary?.result ?? 0} SEK

MOMS:
- Utgående (25%): ${vatReportContext.vat?.outgoing_25 ?? 0} SEK
- Ingående: ${vatReportContext.vat?.incoming ?? 0} SEK
- Att ${netVat >= 0 ? 'betala' : 'återfå'}: ${Math.abs(netVat)} SEK

VALIDERING:
- Status: ${vatReportContext.validation?.is_valid ? 'Giltig' : 'Ogiltig'}
- Fel: ${vatReportContext.validation?.errors?.join(', ') || 'Inga'}
- Varningar: ${vatReportContext.validation?.warnings?.join(', ') || 'Inga'}

Användaren kan ställa frågor om denna rapport. Svara baserat på ovanstående data.

ANVÄNDARFRÅGA:
`;
            finalMessage = contextMessage + message;
        }

        // Call Gemini Service with history
        const geminiResponse = await sendMessageToGemini(finalMessage, fileData, history);


        // Handle Tool Calls
        if (geminiResponse.toolCall) {
            const { tool, args } = geminiResponse.toolCall;
            logger.info(`Executing tool: ${tool}`, { args });

            // Initialize Supabase Client and Fortnox Service
            const supabaseClient = createClient(
                Deno.env.get('SUPABASE_URL') ?? '',
                Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
                { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
            );

            const fortnoxConfig = {
                clientId: Deno.env.get('FORTNOX_CLIENT_ID') ?? '',
                clientSecret: Deno.env.get('FORTNOX_CLIENT_SECRET') ?? '',
                redirectUri: '',
            };
            const fortnoxService = new FortnoxService(fortnoxConfig, supabaseClient);

            // ToolError type for error cases
            type ToolError = {
                error: string;
                errorType: 'auth' | 'network' | 'validation' | 'not_found' | 'unknown';
                tool: string;
                userFriendlyMessage: string;
                actionSuggestion: string;
            };

            let toolResult: Awaited<ReturnType<typeof fortnoxService.getCustomers | typeof fortnoxService.getArticles>> | ToolError | undefined;
            let responseText = "";

            try {
                switch (tool) {
                    case 'create_invoice':
                        // Don't execute immediately. Return data to frontend for confirmation card.
                        return new Response(
                            JSON.stringify({
                                type: 'json',
                                data: args
                            }),
                            {
                                status: 200,
                                headers: { ...corsHeaders, "Content-Type": "application/json" },
                            }
                        );
                    case 'get_customers':
                        toolResult = await fortnoxService.getCustomers();
                        responseText = `Här är dina kunder: ${toolResult.Customers.map((c) => c.Name).join(', ')}`;
                        break;
                    case 'get_articles':
                        toolResult = await fortnoxService.getArticles();
                        responseText = `Här är dina artiklar: ${toolResult.Articles.map((a) => a.Description).join(', ')}`;
                        break;

                    default:
                        responseText = `Jag vet inte hur jag ska använda verktyget ${tool}.`;
                }
            } catch (err: unknown) {
                logger.error('Tool execution failed', { tool, error: err });
                const errorMessage = err instanceof Error ? err.message : 'Unknown error';

                // Categorize the error for better frontend handling
                let errorType: 'auth' | 'network' | 'validation' | 'not_found' | 'unknown' = 'unknown';
                let userFriendlyMessage = `Ett fel uppstod när jag försökte utföra åtgärden: ${errorMessage}`;
                let actionSuggestion = '';

                // Check for common error patterns
                if (errorMessage.toLowerCase().includes('unauthorized') || errorMessage.toLowerCase().includes('401')) {
                    errorType = 'auth';
                    userFriendlyMessage = 'Du behöver koppla ditt Fortnox-konto för att kunna använda denna funktion.';
                    actionSuggestion = 'Gå till Inställningar och koppla Fortnox.';
                } else if (errorMessage.toLowerCase().includes('network') || errorMessage.toLowerCase().includes('fetch')) {
                    errorType = 'network';
                    userFriendlyMessage = 'Kunde inte nå Fortnox just nu. Kontrollera din internetanslutning.';
                    actionSuggestion = 'Försök igen om en stund.';
                } else if (errorMessage.toLowerCase().includes('not found') || errorMessage.toLowerCase().includes('404')) {
                    errorType = 'not_found';
                    userFriendlyMessage = 'Den begärda resursen hittades inte i Fortnox.';
                } else if (errorMessage.toLowerCase().includes('invalid') || errorMessage.toLowerCase().includes('validation')) {
                    errorType = 'validation';
                    userFriendlyMessage = 'Ogiltig data skickades till Fortnox.';
                }

                responseText = userFriendlyMessage + (actionSuggestion ? ` ${actionSuggestion}` : '');
                toolResult = {
                    error: errorMessage,
                    errorType,
                    tool,
                    userFriendlyMessage,
                    actionSuggestion
                };

                logger.info('Tool error categorized', { errorType, tool });
            }

            // Check if toolResult is an error
            const isToolError = (result: typeof toolResult): result is ToolError =>
                result !== undefined && 'error' in result;

            return new Response(
                JSON.stringify({
                    type: 'text',
                    data: responseText,
                    // Include error details for frontend to potentially show different UI
                    ...(isToolError(toolResult) && { toolError: toolResult })
                }),
                {
                    status: 200,
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                }
            );
        }

        // Save AI response to database if user message was saved
        // Reuse the conversationService created above for efficiency
        if (conversationId && userId !== 'anonymous' && geminiResponse.text) {
            try {
                // Reuse existing conversationService if available, otherwise create new one
                if (!conversationService) {
                    const authHeader = req.headers.get('authorization');
                    if (authHeader) {
                        const supabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
                            global: { headers: { Authorization: authHeader } }
                        });
                        conversationService = new ConversationService(supabaseClient);
                    }
                }

                if (conversationService) {
                    // Save AI response
                    await conversationService.addMessage(
                        conversationId,
                        'assistant',
                        geminiResponse.text
                    );
                    logger.info('AI response saved to database', { conversationId, userMessageSaved });

                    // Auto-generate title from first message if needed
                    await conversationService.autoGenerateTitle(conversationId);
                }
            } catch (saveError) {
                logger.error('Failed to save AI response', { error: saveError, conversationId, userMessageSaved });
                // Don't fail the request if saving fails - message still sent successfully
                // User message exists in DB, this creates an "orphan" but preserves data integrity
            }
        }

        // Normal text response
        return new Response(
            JSON.stringify({
                type: 'text',
                data: geminiResponse.text
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    } catch (error) {
        logger.error('Edge Function Error', { error });

        return new Response(
            JSON.stringify({
                error: error instanceof Error ? error.message : "Internal server error"
            }),
            {
                status: 500,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
        );
    }
});

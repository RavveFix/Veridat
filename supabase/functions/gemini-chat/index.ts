// Supabase Edge Function for Gemini Chat
/// <reference path="../../types/deno.d.ts" />

import { sendMessageToGemini, type FileData } from "../../services/GeminiService.ts";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
    message: string;
    fileData?: FileData;
}

import { createClient } from "@supabase/supabase-js";
import { FortnoxService } from "../../services/FortnoxService.ts";

Deno.serve(async (req: Request) => {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const { message, fileData }: RequestBody = await req.json();

        if (!message) {
            return new Response(
                JSON.stringify({ error: "Message is required" }),
                {
                    status: 400,
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                }
            );
        }

        // Call Gemini Service
        const geminiResponse = await sendMessageToGemini(message, fileData);

        // Handle Tool Calls
        if (geminiResponse.toolCall) {
            const { tool, args } = geminiResponse.toolCall;
            console.log(`Executing tool: ${tool} with args:`, args);

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

            let toolResult;
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
            } catch (err: any) {
                console.error("Tool execution failed:", err);
                responseText = `Ett fel uppstod när jag försökte utföra åtgärden: ${err.message}`;
                toolResult = { error: err.message };
            }

            return new Response(
                JSON.stringify({
                    type: 'text',
                    data: responseText
                }),
                {
                    status: 200,
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                }
            );
        }

        // Normal text response
        return new Response(
            JSON.stringify({
                type: 'text',
                data: geminiResponse.text
            }),
            {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
        );
    } catch (error) {
        console.error("Edge Function Error:", error);

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

import { createClient } from "@supabase/supabase-js";
import { FortnoxService } from "../../services/FortnoxService.ts";
import { FortnoxInvoice } from "./types.ts";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
    // Handle CORS preflight request
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        // Create Supabase client
        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', // Use service role key to access tokens table
            {
                global: {
                    headers: { Authorization: req.headers.get('Authorization')! },
                },
            }
        );

        // Initialize Fortnox Service
        const fortnoxConfig = {
            clientId: Deno.env.get('FORTNOX_CLIENT_ID') ?? '',
            clientSecret: Deno.env.get('FORTNOX_CLIENT_SECRET') ?? '',
            redirectUri: '', // Not needed for refresh flow
        };

        const fortnoxService = new FortnoxService(fortnoxConfig, supabaseClient);

        // Parse request body
        const { action, payload } = await req.json();

        let result;

        switch (action) {
            case 'createInvoice':
                result = await fortnoxService.createInvoiceDraft(payload as FortnoxInvoice);
                break;
            case 'getCustomers':
                result = await fortnoxService.getCustomers();
                break;
            case 'getArticles':
                result = await fortnoxService.getArticles();
                break;
            default:
                throw new Error(`Unknown action: ${action}`);
        }

        return new Response(
            JSON.stringify(result),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200
            }
        );

    } catch (error: any) {
        console.error("Fortnox Function Error:", error);
        return new Response(
            JSON.stringify({ error: error.message || 'Unknown error' }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 400
            }
        );
    }
});

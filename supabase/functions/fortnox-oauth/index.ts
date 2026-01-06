/// <reference path="../../types/deno.d.ts" />

/**
 * Fortnox OAuth Edge Function
 *
 * Handles the OAuth 2.0 authorization flow for Fortnox integration.
 *
 * Actions:
 * - initiate: Returns the authorization URL for the user to authenticate
 * - callback: Exchanges the authorization code for tokens
 * - status: Checks if the user has connected Fortnox
 * - disconnect: Removes the user's Fortnox tokens
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, createOptionsResponse } from "../../services/CorsService.ts";
import { createLogger } from "../../services/LoggerService.ts";

const logger = createLogger('fortnox-oauth');

// Fortnox OAuth endpoints
const FORTNOX_AUTH_URL = 'https://apps.fortnox.se/oauth-v1/auth';
const FORTNOX_TOKEN_URL = 'https://apps.fortnox.se/oauth-v1/token';

// Required scopes for full accounting integration
const FORTNOX_SCOPES = [
    'customer',
    'article',
    'invoice',
    'bookkeeping',
    'settings',
    'companyinformation'
].join(' ');

interface OAuthInitiateRequest {
    action: 'initiate';
}

interface OAuthCallbackRequest {
    action: 'callback';
    code: string;
    state: string;
}

interface OAuthStatusRequest {
    action: 'status';
}

interface OAuthDisconnectRequest {
    action: 'disconnect';
}

type OAuthRequest = OAuthInitiateRequest | OAuthCallbackRequest | OAuthStatusRequest | OAuthDisconnectRequest;

Deno.serve(async (req: Request) => {
    const corsHeaders = getCorsHeaders();

    // Handle CORS preflight request
    if (req.method === 'OPTIONS') {
        return createOptionsResponse();
    }

    try {
        // Handle GET request for OAuth callback (redirect from Fortnox)
        if (req.method === 'GET') {
            return await handleOAuthCallback(req, corsHeaders);
        }

        if (req.method !== 'POST') {
            return new Response(
                JSON.stringify({ error: 'Method not allowed' }),
                { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Verify authentication
        const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
        if (!authHeader) {
            return new Response(
                JSON.stringify({ error: 'Unauthorized' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

        if (!supabaseUrl || !supabaseServiceKey) {
            return new Response(
                JSON.stringify({ error: 'Server configuration error' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const token = authHeader.replace(/^Bearer\s+/i, '');
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

        // Verify the user
        const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
        if (userError || !user) {
            return new Response(
                JSON.stringify({ error: 'Unauthorized' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const body = (await req.json().catch(() => ({}))) as OAuthRequest;
        const action = body.action;

        logger.info('Fortnox OAuth action requested', { userId: user.id, action });

        switch (action) {
            case 'initiate':
                return handleInitiate(user.id, supabaseUrl, corsHeaders);

            case 'status':
                return await handleStatus(user.id, supabaseAdmin, corsHeaders);

            case 'disconnect':
                return await handleDisconnect(user.id, supabaseAdmin, corsHeaders);

            default:
                return new Response(
                    JSON.stringify({ error: `Unknown action: ${action}` }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
        }

    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error('Fortnox OAuth Error', error);
        return new Response(
            JSON.stringify({ error: errorMessage }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});

/**
 * Initiates the OAuth flow by returning the Fortnox authorization URL
 */
function handleInitiate(userId: string, supabaseUrl: string, corsHeaders: Record<string, string>) {
    const clientId = Deno.env.get('FORTNOX_CLIENT_ID');

    if (!clientId) {
        return new Response(
            JSON.stringify({ error: 'Fortnox client ID not configured' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

    // Build the redirect URI for the callback
    const redirectUri = `${supabaseUrl}/functions/v1/fortnox-oauth`;

    // Create state parameter with user ID for security and to identify user on callback
    const state = btoa(JSON.stringify({
        userId,
        timestamp: Date.now(),
        nonce: crypto.randomUUID()
    }));

    // Build authorization URL
    const authUrl = new URL(FORTNOX_AUTH_URL);
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('scope', FORTNOX_SCOPES);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('access_type', 'offline');

    logger.info('Generated Fortnox authorization URL', { userId });

    return new Response(
        JSON.stringify({
            authorizationUrl: authUrl.toString(),
            state
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
}

/**
 * Handles the OAuth callback (GET request from Fortnox redirect)
 */
async function handleOAuthCallback(req: Request, corsHeaders: Record<string, string>) {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');
    const errorDescription = url.searchParams.get('error_description');

    // Get app URL for redirects
    const appUrl = Deno.env.get('APP_URL') || 'https://britta.se/app';

    if (error) {
        logger.error('Fortnox OAuth error', { error, errorDescription });
        return Response.redirect(`${appUrl}?fortnox_error=${encodeURIComponent(errorDescription || error)}`, 302);
    }

    if (!code || !state) {
        logger.error('Missing code or state in callback');
        return Response.redirect(`${appUrl}?fortnox_error=missing_params`, 302);
    }

    try {
        // Decode and validate state
        const stateData = JSON.parse(atob(state));
        const { userId, timestamp } = stateData;

        // Check state is not too old (10 minutes max)
        if (Date.now() - timestamp > 10 * 60 * 1000) {
            logger.error('OAuth state expired');
            return Response.redirect(`${appUrl}?fortnox_error=state_expired`, 302);
        }

        // Exchange code for tokens
        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
        const clientId = Deno.env.get('FORTNOX_CLIENT_ID') ?? '';
        const clientSecret = Deno.env.get('FORTNOX_CLIENT_SECRET') ?? '';

        if (!supabaseUrl || !supabaseServiceKey || !clientId || !clientSecret) {
            throw new Error('Missing configuration');
        }

        const redirectUri = `${supabaseUrl}/functions/v1/fortnox-oauth`;
        const credentials = btoa(`${clientId}:${clientSecret}`);

        const tokenParams = new URLSearchParams();
        tokenParams.append('grant_type', 'authorization_code');
        tokenParams.append('code', code);
        tokenParams.append('redirect_uri', redirectUri);

        const tokenResponse = await fetch(FORTNOX_TOKEN_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': `Basic ${credentials}`
            },
            body: tokenParams
        });

        if (!tokenResponse.ok) {
            const errorText = await tokenResponse.text();
            logger.error('Token exchange failed', { status: tokenResponse.status, error: errorText });
            return Response.redirect(`${appUrl}?fortnox_error=token_exchange_failed`, 302);
        }

        const tokenData = await tokenResponse.json();
        const { access_token, refresh_token, expires_in } = tokenData;

        // Calculate expiration time
        const expiresAt = new Date(Date.now() + expires_in * 1000).toISOString();

        // Store tokens in database
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

        // Upsert - delete existing and insert new
        await supabaseAdmin
            .from('fortnox_tokens')
            .delete()
            .eq('user_id', userId);

        const { error: insertError } = await supabaseAdmin
            .from('fortnox_tokens')
            .insert({
                user_id: userId,
                access_token,
                refresh_token,
                expires_at: expiresAt
            });

        if (insertError) {
            logger.error('Failed to store tokens', insertError);
            return Response.redirect(`${appUrl}?fortnox_error=storage_failed`, 302);
        }

        logger.info('Fortnox OAuth successful', { userId });
        return Response.redirect(`${appUrl}?fortnox_connected=true`, 302);

    } catch (error) {
        logger.error('OAuth callback error', error);
        return Response.redirect(`${appUrl}?fortnox_error=callback_failed`, 302);
    }
}

/**
 * Checks if the user has connected their Fortnox account
 */
async function handleStatus(
    userId: string,
    supabase: ReturnType<typeof createClient>,
    corsHeaders: Record<string, string>
) {
    const { data, error } = await supabase
        .from('fortnox_tokens')
        .select('created_at, expires_at')
        .eq('user_id', userId)
        .maybeSingle();

    if (error) {
        logger.error('Error checking Fortnox status', error);
        return new Response(
            JSON.stringify({ error: 'Failed to check status' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

    return new Response(
        JSON.stringify({
            connected: !!data,
            connectedAt: data?.created_at || null,
            expiresAt: data?.expires_at || null
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
}

/**
 * Disconnects the user's Fortnox account
 */
async function handleDisconnect(
    userId: string,
    supabase: ReturnType<typeof createClient>,
    corsHeaders: Record<string, string>
) {
    const { error } = await supabase
        .from('fortnox_tokens')
        .delete()
        .eq('user_id', userId);

    if (error) {
        logger.error('Error disconnecting Fortnox', error);
        return new Response(
            JSON.stringify({ error: 'Failed to disconnect' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

    logger.info('Fortnox disconnected', { userId });

    return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
}

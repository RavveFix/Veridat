// CORS Headers Service for Supabase Edge Functions
// Provides environment-aware CORS configuration
/// <reference path="../functions/types/deno.d.ts" />

/**
 * Get CORS headers based on environment.
 * In production, uses ALLOWED_ORIGINS env var.
 * In development, allows all origins.
 */
export function getCorsHeaders(): Record<string, string> {
    const envOrigin = Deno.env.get('ALLOWED_ORIGIN');
    const isProduction = Deno.env.get('DENO_ENV') === 'production' ||
        Deno.env.get('ENVIRONMENT') === 'production';

    // Use specific origin if set, otherwise allow all in dev
    const origin = isProduction && envOrigin
        ? envOrigin
        : envOrigin || '*';

    return {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-user-id',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Expose-Headers': 'X-LLM-Provider, X-RateLimit-Remaining, X-RateLimit-Reset',
    };
}

/**
 * Check if the request origin is allowed.
 * Used for more granular CORS control.
 */
export function isOriginAllowed(requestOrigin: string | null): boolean {
    if (!requestOrigin) return true; // Allow requests without origin (e.g., server-to-server)

    const allowedOrigins = Deno.env.get('ALLOWED_ORIGINS')?.split(',') || [];
    const isProduction = Deno.env.get('DENO_ENV') === 'production';

    // In development, allow all
    if (!isProduction) return true;

    // In production, check against allowed list
    return allowedOrigins.some(allowed =>
        requestOrigin === allowed.trim() ||
        requestOrigin.endsWith(allowed.trim())
    );
}

/**
 * Create an OPTIONS response for CORS preflight.
 */
export function createOptionsResponse(): Response {
    return new Response('ok', { headers: getCorsHeaders() });
}

/**
 * Add CORS headers to a response.
 */
export function withCors(response: Response): Response {
    const corsHeaders = getCorsHeaders();
    const headers = new Headers(response.headers);

    Object.entries(corsHeaders).forEach(([key, value]) => {
        headers.set(key, value);
    });

    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
    });
}

// CORS Headers Service for Supabase Edge Functions
// Provides environment-aware CORS configuration
/// <reference path="../functions/types/deno.d.ts" />

function isProduction(): boolean {
    return Deno.env.get('DENO_ENV') === 'production' ||
        Deno.env.get('ENVIRONMENT') === 'production';
}

function normalizeOrigin(origin: string): string | null {
    try {
        return new URL(origin).origin.toLowerCase();
    } catch {
        return null;
    }
}

function normalizeHost(value: string): string {
    return value
        .trim()
        .replace(/^https?:\/\//i, '')
        .replace(/\/.*$/, '')
        .replace(/^\./, '')
        .toLowerCase();
}

function getAllowedOrigins(): string[] {
    const raw = Deno.env.get('ALLOWED_ORIGINS') || Deno.env.get('ALLOWED_ORIGIN') || '';
    return raw
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
}

function toHeaderOrigin(allowedOrigin: string): string {
    const normalized = normalizeOrigin(allowedOrigin);
    if (normalized) return normalized;
    return `https://${normalizeHost(allowedOrigin)}`;
}

/**
 * Get CORS headers based on environment and request origin.
 * In production, only allows configured origins.
 * In development, defaults to permissive behavior.
 */
export function getCorsHeaders(requestOrigin: string | null = null): Record<string, string> {
    const production = isProduction();
    const allowedOrigins = getAllowedOrigins();
    const normalizedRequestOrigin = requestOrigin ? normalizeOrigin(requestOrigin) : null;

    let origin = '*';

    if (production) {
        if (normalizedRequestOrigin && isOriginAllowed(normalizedRequestOrigin)) {
            origin = normalizedRequestOrigin;
        } else if (allowedOrigins.length > 0) {
            origin = toHeaderOrigin(allowedOrigins[0]);
        } else {
            // Never fall back to wildcard in production.
            origin = 'null';
        }
    } else if (normalizedRequestOrigin) {
        origin = normalizedRequestOrigin;
    } else {
        const envOrigin = Deno.env.get('ALLOWED_ORIGIN');
        origin = envOrigin || '*';
    }

    return {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-user-id',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Expose-Headers': 'X-LLM-Provider, X-RateLimit-Remaining, X-RateLimit-Reset',
        'Vary': 'Origin',
    };
}

/**
 * Check if the request origin is allowed.
 */
export function isOriginAllowed(requestOrigin: string | null): boolean {
    if (!requestOrigin) return true; // Allow requests without origin (server-to-server, cron, etc.)
    if (!isProduction()) return true;

    const normalizedRequestOrigin = normalizeOrigin(requestOrigin);
    if (!normalizedRequestOrigin) return false;

    const requestHost = new URL(normalizedRequestOrigin).hostname.toLowerCase();
    const allowedOrigins = getAllowedOrigins();
    if (allowedOrigins.length === 0) return false;

    return allowedOrigins.some((allowed) => {
        const trimmed = allowed.trim();
        if (!trimmed) return false;

        const normalizedAllowedOrigin = normalizeOrigin(trimmed);
        if (normalizedAllowedOrigin) {
            return normalizedRequestOrigin === normalizedAllowedOrigin;
        }

        const allowedHost = normalizeHost(trimmed);
        return requestHost === allowedHost || requestHost.endsWith(`.${allowedHost}`);
    });
}

/**
 * Create a 403 response for blocked origins.
 */
export function createForbiddenOriginResponse(requestOrigin: string | null): Response {
    return new Response(
        JSON.stringify({ error: 'origin_not_allowed' }),
        {
            status: 403,
            headers: {
                ...getCorsHeaders(requestOrigin),
                'Content-Type': 'application/json',
            }
        }
    );
}

/**
 * Create an OPTIONS response for CORS preflight.
 */
export function createOptionsResponse(req?: Request): Response {
    const requestOrigin = req?.headers.get('origin') || req?.headers.get('Origin') || null;
    if (requestOrigin && !isOriginAllowed(requestOrigin)) {
        return createForbiddenOriginResponse(requestOrigin);
    }
    return new Response('ok', { headers: getCorsHeaders(requestOrigin) });
}

/**
 * Add CORS headers to a response.
 */
export function withCors(response: Response, requestOrigin: string | null = null): Response {
    const corsHeaders = getCorsHeaders(requestOrigin);
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

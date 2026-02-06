/// <reference path="../types/deno.d.ts" />

import { createClient } from "npm:@supabase/supabase-js@2";
import { createOptionsResponse, getCorsHeaders } from "../../services/CorsService.ts";
import { createLogger } from "../../services/LoggerService.ts";
import { RateLimiterService } from "../../services/RateLimiterService.ts";

const logger = createLogger("web-search");

type WebSearchRequest = {
    query: string;
    max_results?: number;
    recency_days?: number;
};

type WebSearchResult = {
    title: string;
    url: string;
    snippet: string;
    source: string;
    published_at?: string | null;
};

type WebSearchResponse = {
    query: string;
    provider: string;
    fetched_at: string;
    results: WebSearchResult[];
    used_cache: boolean;
    allowlist: string[];
};

const DEFAULT_ALLOWLIST = [
    "skatteverket.se",
    "bokforingsnamnden.se",
    "bas.se",
    "far.se",
    "riksdagen.se",
    "regeringen.se",
    "verksamt.se",
    "bolagsverket.se",
];

const DEFAULT_MAX_RESULTS = 5;
const MAX_RESULTS_CAP = 8;
const MAX_QUERY_LENGTH = 300;
const DEFAULT_CACHE_TTL_HOURS = 24;

function getEnv(keys: string[]): string | undefined {
    for (const key of keys) {
        const value = Deno.env.get(key);
        if (value && value.trim()) return value.trim();
    }
    return undefined;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
    if (typeof value !== "number" || Number.isNaN(value)) return fallback;
    return Math.min(Math.max(value, min), max);
}

function normalizeDomain(value: string): string {
    let normalized = value.trim().toLowerCase();
    normalized = normalized.replace(/^https?:\/\//, "");
    normalized = normalized.replace(/\/.*$/, "");
    normalized = normalized.replace(/^\./, "");
    return normalized;
}

function parseAllowlist(value?: string): string[] {
    if (!value) return DEFAULT_ALLOWLIST;
    const parsed = value
        .split(",")
        .map((entry) => normalizeDomain(entry))
        .filter((entry) => entry.length > 0);
    return parsed.length > 0 ? parsed : DEFAULT_ALLOWLIST;
}

function isAllowedUrl(url: string, allowlist: string[]): boolean {
    try {
        const host = normalizeDomain(new URL(url).hostname);
        return allowlist.some((domain) => host === domain || host.endsWith(`.${domain}`));
    } catch {
        return false;
    }
}

function buildRestrictedQuery(query: string, allowlist: string[]): string {
    if (allowlist.length === 0) return query;
    const sites = allowlist.map((domain) => `site:${domain}`).join(" OR ");
    return `${query} (${sites})`;
}

async function computeHash(value: Record<string, unknown>): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(JSON.stringify(value));
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function extractPublishedAt(item: Record<string, unknown>): string | null {
    const pagemap = item?.pagemap as Record<string, unknown> | undefined;
    const metatags = (pagemap?.metatags as Array<Record<string, string>> | undefined) ?? [];
    const meta = metatags[0] || {};
    const candidates = [
        meta["article:published_time"],
        meta["og:published_time"],
        meta["date"],
        meta["dc.date"],
        meta["dc.date.issued"],
        meta["datepublished"],
        meta["publisheddate"],
    ];
    const value = candidates.find((entry) => typeof entry === "string" && entry.trim().length > 0);
    return value ?? null;
}

async function fetchGoogleCseResults(
    query: string,
    allowlist: string[],
    maxResults: number,
    recencyDays?: number
): Promise<WebSearchResult[]> {
    const apiKey = Deno.env.get("GOOGLE_CSE_API_KEY");
    const cx = Deno.env.get("GOOGLE_CSE_CX");

    if (!apiKey || !cx) {
        throw new Error("GOOGLE_CSE_API_KEY or GOOGLE_CSE_CX not configured");
    }

    const restrictedQuery = buildRestrictedQuery(query, allowlist);
    const params = new URLSearchParams({
        key: apiKey,
        cx,
        q: restrictedQuery,
        num: String(maxResults),
        hl: "sv",
        gl: "se",
        lr: "lang_sv",
        safe: "active",
    });

    if (recencyDays) {
        params.set("dateRestrict", `d${recencyDays}`);
    }

    const response = await fetch(`https://www.googleapis.com/customsearch/v1?${params.toString()}`);
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Google CSE error (${response.status}): ${errorText}`);
    }

    const payload = await response.json() as Record<string, unknown>;
    const items = Array.isArray(payload.items) ? payload.items as Array<Record<string, unknown>> : [];

    const results: WebSearchResult[] = [];
    for (const item of items) {
        const url = typeof item.link === "string" ? item.link : "";
        if (!url || !isAllowedUrl(url, allowlist)) continue;

        const title = typeof item.title === "string" ? item.title.trim() : url;
        const snippet = typeof item.snippet === "string"
            ? item.snippet.replace(/\s+/g, " ").trim()
            : "";
        const source = typeof item.displayLink === "string"
            ? item.displayLink
            : normalizeDomain(new URL(url).hostname);

        results.push({
            title,
            url,
            snippet,
            source,
            published_at: extractPublishedAt(item),
        });
    }

    return results;
}

Deno.serve(async (req: Request) => {
    const corsHeaders = getCorsHeaders();

    if (req.method === "OPTIONS") {
        return createOptionsResponse();
    }

    try {
        if (req.method !== "POST") {
            return new Response(JSON.stringify({ error: "Method not allowed" }), {
                status: 405,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
        if (!authHeader) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), {
                status: 401,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        const supabaseUrl = getEnv(["SUPABASE_URL", "SB_SUPABASE_URL", "API_URL"]);
        const supabaseServiceKey = getEnv([
            "SUPABASE_SERVICE_ROLE_KEY",
            "SB_SERVICE_ROLE_KEY",
            "SERVICE_ROLE_KEY",
            "SECRET_KEY",
        ]);
        if (!supabaseUrl || !supabaseServiceKey) {
            return new Response(JSON.stringify({ error: "Missing Supabase configuration" }), {
                status: 500,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        const token = authHeader.replace(/^Bearer\s+/i, "");
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
        const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
        if (userError || !user) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), {
                status: 401,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        const rateLimitHour = clampNumber(
            Number(Deno.env.get("WEB_SEARCH_RATE_LIMIT_HOURLY")),
            1,
            1000,
            10
        );
        const rateLimitDay = clampNumber(
            Number(Deno.env.get("WEB_SEARCH_RATE_LIMIT_DAILY")),
            1,
            5000,
            50
        );
        const rateLimiter = new RateLimiterService(supabaseAdmin, {
            requestsPerHour: rateLimitHour,
            requestsPerDay: rateLimitDay,
        });

        const rateLimit = await rateLimiter.checkAndIncrement(user.id, "web_search");
        if (!rateLimit.allowed) {
            return new Response(
                JSON.stringify({
                    error: "rate_limit_exceeded",
                    message: rateLimit.message,
                    remaining: rateLimit.remaining,
                    resetAt: rateLimit.resetAt.toISOString(),
                }),
                {
                    status: 429,
                    headers: {
                        ...corsHeaders,
                        "Content-Type": "application/json",
                        "X-RateLimit-Remaining": String(rateLimit.remaining),
                        "X-RateLimit-Reset": rateLimit.resetAt.toISOString(),
                    },
                }
            );
        }

        const body = await req.json().catch(() => ({})) as WebSearchRequest;
        const query = typeof body.query === "string" ? body.query.trim() : "";
        if (!query) {
            return new Response(JSON.stringify({ error: "query is required" }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }
        if (query.length > MAX_QUERY_LENGTH) {
            return new Response(JSON.stringify({ error: "query is too long" }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        const allowlist = parseAllowlist(Deno.env.get("WEB_SEARCH_ALLOWLIST"));
        const provider = (Deno.env.get("WEB_SEARCH_PROVIDER") || "google_cse").toLowerCase();
        const maxResults = clampNumber(body.max_results, 1, MAX_RESULTS_CAP, DEFAULT_MAX_RESULTS);
        const recencyDays = typeof body.recency_days === "number"
            ? clampNumber(body.recency_days, 1, 3650, 365)
            : undefined;

        const cacheTtlHours = clampNumber(
            Number(Deno.env.get("WEB_SEARCH_CACHE_TTL_HOURS")),
            1,
            168,
            DEFAULT_CACHE_TTL_HOURS
        );
        const now = new Date();
        const cacheKey = await computeHash({
            query,
            provider,
            allowlist,
            maxResults,
            recencyDays,
        });

        try {
            const { data: cacheRow } = await supabaseAdmin
                .from("accounting_web_cache")
                .select("response, expires_at")
                .eq("cache_key", cacheKey)
                .gt("expires_at", now.toISOString())
                .maybeSingle() as { data: { response: WebSearchResponse; expires_at: string } | null };

            if (cacheRow?.response) {
                const cachedResponse = {
                    ...cacheRow.response,
                    used_cache: true,
                };
                return new Response(JSON.stringify(cachedResponse), {
                    status: 200,
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                });
            }
        } catch (cacheError) {
            logger.warn("Cache lookup failed", { error: String(cacheError) });
        }

        let results: WebSearchResult[] = [];
        if (provider === "google_cse") {
            results = await fetchGoogleCseResults(query, allowlist, maxResults, recencyDays);
        } else {
            throw new Error(`Unsupported provider: ${provider}`);
        }

        const responsePayload: WebSearchResponse = {
            query,
            provider,
            fetched_at: now.toISOString(),
            results,
            used_cache: false,
            allowlist,
        };

        try {
            const expiresAt = new Date(now.getTime() + cacheTtlHours * 60 * 60 * 1000);
            await supabaseAdmin
                .from("accounting_web_cache")
                .upsert({
                    cache_key: cacheKey,
                    query,
                    provider,
                    allowlist,
                    response: responsePayload,
                    fetched_at: now.toISOString(),
                    expires_at: expiresAt.toISOString(),
                });
        } catch (cacheError) {
            logger.warn("Cache write failed", { error: String(cacheError) });
        }

        return new Response(JSON.stringify(responsePayload), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    } catch (error) {
        logger.error("Web search failed", error);
        return new Response(JSON.stringify({ error: "web_search_failed" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});

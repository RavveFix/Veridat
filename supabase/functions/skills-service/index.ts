/// <reference path="../types/deno.d.ts" />

import { createClient } from "npm:@supabase/supabase-js@2";
import { createOptionsResponse, getCorsHeaders } from "../../services/CorsService.ts";
import { createLogger } from "../../services/LoggerService.ts";
import { RateLimiterService } from "../../services/RateLimiterService.ts";

const logger = createLogger("skills-service");

type SkillsAction =
    | "list_hub"
    | "list_skills"
    | "get_skill"
    | "create_skill"
    | "update_skill"
    | "archive_skill"
    | "list_runs"
    | "create_run"
    | "update_run"
    | "list_approvals"
    | "request_approval"
    | "approve_run"
    | "reject_run";

interface SkillsRequest {
    action: SkillsAction;
    company_id?: string;
    skill_id?: string;
    run_id?: string;
    approval_id?: string;
    status?: string;
    payload?: Record<string, unknown>;
}

function getEnv(keys: string[]): string | undefined {
    for (const key of keys) {
        const value = Deno.env.get(key);
        if (value && value.trim()) return value.trim();
    }
    return undefined;
}

function decodeBase64Url(input: string): string | null {
    if (!input) return null;
    try {
        const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
        const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
        return atob(padded);
    } catch {
        return null;
    }
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payload = decodeBase64Url(parts[1]);
    if (!payload) return null;
    try {
        return JSON.parse(payload) as Record<string, unknown>;
    } catch {
        return null;
    }
}

async function computeHash(value: Record<string, unknown>): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(JSON.stringify(value));
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function pickSkillFields(payload: Record<string, unknown>): Record<string, unknown> {
    const allowed = new Set([
        "name",
        "description",
        "kind",
        "status",
        "scope",
        "visibility",
        "input_schema",
        "output_schema",
        "allowed_actions",
        "requires_approval"
    ]);

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) {
        if (allowed.has(key)) {
            result[key] = value;
        }
    }
    return result;
}

function pickRunFields(payload: Record<string, unknown>): Record<string, unknown> {
    const allowed = new Set([
        "status",
        "preview_output",
        "output_payload",
        "error_code",
        "error_message",
        "finished_at"
    ]);

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) {
        if (allowed.has(key)) {
            result[key] = value;
        }
    }
    return result;
}

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return createOptionsResponse();
    }

    const corsHeaders = getCorsHeaders();

    try {
        if (req.method !== "POST") {
            return new Response(JSON.stringify({ error: "Method not allowed" }), {
                status: 405,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
        if (!authHeader) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), {
                status: 401,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        const token = authHeader.replace(/^Bearer\s+/i, "");
        const decoded = decodeJwtPayload(token);
        const userId = typeof decoded?.sub === "string" ? decoded.sub : null;
        const exp = typeof decoded?.exp === "number" ? decoded.exp : null;
        if (!userId || (exp && exp < Math.floor(Date.now() / 1000) - 60)) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), {
                status: 401,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        const supabaseUrl = getEnv(["SUPABASE_URL", "SB_SUPABASE_URL", "API_URL"]);
        const supabaseAnonKey = getEnv(["SUPABASE_ANON_KEY", "SB_SUPABASE_ANON_KEY", "ANON_KEY"]);
        const supabaseServiceKey = getEnv(["SUPABASE_SERVICE_ROLE_KEY", "SB_SERVICE_ROLE_KEY", "SERVICE_ROLE_KEY"]);

        if (!supabaseUrl || !supabaseAnonKey) {
            return new Response(JSON.stringify({ error: "Missing Supabase configuration" }), {
                status: 500,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        const supabase = createClient(supabaseUrl, supabaseAnonKey, {
            global: { headers: { Authorization: authHeader } }
        });

        // Rate limiting (uses service role to access api_usage table)
        if (supabaseServiceKey) {
            const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
            const rateLimiter = new RateLimiterService(supabaseAdmin, {
                requestsPerHour: 30,
                requestsPerDay: 150,
            });
            const rateLimit = await rateLimiter.checkAndIncrement(userId, "skills");
            if (!rateLimit.allowed) {
                return new Response(
                    JSON.stringify({
                        error: "rate_limit_exceeded",
                        message: rateLimit.message,
                        remaining: rateLimit.remaining,
                    }),
                    { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }
        }

        const body = (await req.json().catch(() => ({}))) as SkillsRequest;
        const { action, company_id, skill_id, run_id, approval_id, status, payload = {} } = body;

        if (!action) {
            throw new Error("action is required");
        }

        let result: Record<string, unknown> = {};

        switch (action) {
            case "list_hub": {
                if (!company_id) throw new Error("company_id is required");

                const skillsQuery = supabase
                    .from("skills")
                    .select("*")
                    .eq("user_id", userId)
                    .eq("company_id", company_id)
                    .order("updated_at", { ascending: false });

                const runsQuery = supabase
                    .from("skill_runs")
                    .select("*")
                    .eq("user_id", userId)
                    .eq("company_id", company_id)
                    .order("created_at", { ascending: false });

                const approvalsQuery = supabase
                    .from("skill_approvals")
                    .select("*")
                    .eq("user_id", userId)
                    .eq("company_id", company_id)
                    .order("created_at", { ascending: false });

                const [skillsResult, runsResult, approvalsResult] = await Promise.all([
                    skillsQuery,
                    runsQuery,
                    approvalsQuery
                ]);

                if (skillsResult.error) throw skillsResult.error;
                if (runsResult.error) throw runsResult.error;
                if (approvalsResult.error) throw approvalsResult.error;

                result = {
                    skills: skillsResult.data || [],
                    runs: runsResult.data || [],
                    approvals: approvalsResult.data || []
                };
                break;
            }
            case "list_skills": {
                if (!company_id) throw new Error("company_id is required");

                const query = supabase
                    .from("skills")
                    .select("*")
                    .eq("user_id", userId)
                    .eq("company_id", company_id)
                    .order("updated_at", { ascending: false });

                if (status) {
                    query.eq("status", status);
                }

                const { data, error } = await query;
                if (error) throw error;
                result = { skills: data || [] };
                break;
            }

            case "get_skill": {
                if (!skill_id) throw new Error("skill_id is required");

                const { data, error } = await supabase
                    .from("skills")
                    .select("*")
                    .eq("id", skill_id)
                    .eq("user_id", userId)
                    .maybeSingle();

                if (error) throw error;
                if (!data) throw new Error("Skill not found");
                result = { skill: data };
                break;
            }

            case "create_skill": {
                if (!company_id) throw new Error("company_id is required");
                const fields = pickSkillFields(payload);

                if (!fields.name || typeof fields.name !== "string") {
                    throw new Error("name is required");
                }

                const { data, error } = await supabase
                    .from("skills")
                    .insert({
                        user_id: userId,
                        company_id,
                        ...fields
                    })
                    .select()
                    .single();

                if (error) throw error;
                result = { skill: data };
                break;
            }

            case "update_skill": {
                if (!skill_id) throw new Error("skill_id is required");
                const fields = pickSkillFields(payload);
                if (Object.keys(fields).length === 0) {
                    throw new Error("No valid fields to update");
                }

                const { data, error } = await supabase
                    .from("skills")
                    .update(fields)
                    .eq("id", skill_id)
                    .eq("user_id", userId)
                    .select()
                    .single();

                if (error) throw error;
                result = { skill: data };
                break;
            }

            case "archive_skill": {
                if (!skill_id) throw new Error("skill_id is required");

                const { data, error } = await supabase
                    .from("skills")
                    .update({ status: "archived" })
                    .eq("id", skill_id)
                    .eq("user_id", userId)
                    .select()
                    .single();

                if (error) throw error;
                result = { skill: data };
                break;
            }

            case "list_runs": {
                if (!company_id) throw new Error("company_id is required");

                const query = supabase
                    .from("skill_runs")
                    .select("*")
                    .eq("user_id", userId)
                    .eq("company_id", company_id)
                    .order("created_at", { ascending: false });

                if (skill_id) {
                    query.eq("skill_id", skill_id);
                }
                if (status) {
                    query.eq("status", status);
                }

                const { data, error } = await query;
                if (error) throw error;
                result = { runs: data || [] };
                break;
            }

            case "list_approvals": {
                if (!company_id) throw new Error("company_id is required");

                const query = supabase
                    .from("skill_approvals")
                    .select("*")
                    .eq("user_id", userId)
                    .eq("company_id", company_id)
                    .order("created_at", { ascending: false });

                if (status) {
                    query.eq("status", status);
                }
                if (run_id) {
                    query.eq("run_id", run_id);
                }

                const { data, error } = await query;
                if (error) throw error;
                result = { approvals: data || [] };
                break;
            }

            case "create_run": {
                if (!company_id) throw new Error("company_id is required");
                if (!skill_id) throw new Error("skill_id is required");

                const inputPayload = (payload.input_payload || {}) as Record<string, unknown>;
                const previewOutput = (payload.preview_output || null) as Record<string, unknown> | null;

                const inputHash = await computeHash(inputPayload);
                const previewHash = previewOutput ? await computeHash(previewOutput) : null;

                const { data, error } = await supabase
                    .from("skill_runs")
                    .insert({
                        user_id: userId,
                        company_id,
                        skill_id,
                        triggered_by: payload.triggered_by ?? "user",
                        status: payload.status ?? "preview",
                        input_payload: inputPayload,
                        preview_output: previewOutput,
                        input_hash: inputHash,
                        preview_hash: previewHash,
                        ai_decision_id: payload.ai_decision_id ?? null,
                        started_at: new Date().toISOString()
                    })
                    .select()
                    .single();

                if (error) throw error;
                result = { run: data };
                break;
            }

            case "update_run": {
                if (!run_id) throw new Error("run_id is required");

                const fields = pickRunFields(payload);
                if (Object.keys(fields).length === 0) {
                    throw new Error("No valid fields to update");
                }

                const { data, error } = await supabase
                    .from("skill_runs")
                    .update(fields)
                    .eq("id", run_id)
                    .eq("user_id", userId)
                    .select()
                    .single();

                if (error) throw error;
                result = { run: data };
                break;
            }

            case "request_approval": {
                if (!run_id) throw new Error("run_id is required");

                const { data: run, error: runError } = await supabase
                    .from("skill_runs")
                    .select("id, skill_id, company_id, input_hash, preview_hash")
                    .eq("id", run_id)
                    .eq("user_id", userId)
                    .maybeSingle();

                if (runError) throw runError;
                if (!run) throw new Error("Run not found");

                const approvalPayload = {
                    user_id: userId,
                    company_id: run.company_id,
                    run_id: run.id,
                    status: "pending",
                    required_role: payload.required_role ?? "owner",
                    required_count: payload.required_count ?? 1,
                    input_hash: run.input_hash,
                    preview_hash: run.preview_hash,
                    expires_at: payload.expires_at ?? null
                };

                const { data: approval, error: approvalError } = await supabase
                    .from("skill_approvals")
                    .insert(approvalPayload)
                    .select()
                    .single();

                if (approvalError) throw approvalError;

                await supabase
                    .from("skill_runs")
                    .update({ status: "pending_approval" })
                    .eq("id", run.id)
                    .eq("user_id", userId);

                result = { approval };
                break;
            }

            case "approve_run": {
                if (!approval_id) throw new Error("approval_id is required");

                const { data: approval, error: approvalError } = await supabase
                    .from("skill_approvals")
                    .update({
                        status: "approved",
                        approved_by: userId,
                        approved_at: new Date().toISOString(),
                        comment: payload.comment ?? null
                    })
                    .eq("id", approval_id)
                    .eq("user_id", userId)
                    .select()
                    .single();

                if (approvalError) throw approvalError;

                await supabase
                    .from("skill_runs")
                    .update({ status: "running" })
                    .eq("id", approval.run_id)
                    .eq("user_id", userId);

                result = { approval };
                break;
            }

            case "reject_run": {
                if (!approval_id) throw new Error("approval_id is required");

                const { data: approval, error: approvalError } = await supabase
                    .from("skill_approvals")
                    .update({
                        status: "rejected",
                        approved_by: userId,
                        approved_at: new Date().toISOString(),
                        comment: payload.comment ?? null
                    })
                    .eq("id", approval_id)
                    .eq("user_id", userId)
                    .select()
                    .single();

                if (approvalError) throw approvalError;

                await supabase
                    .from("skill_runs")
                    .update({ status: "cancelled" })
                    .eq("id", approval.run_id)
                    .eq("user_id", userId);

                result = { approval };
                break;
            }

            default:
                throw new Error(`Unknown action: ${action}`);
        }

        return new Response(JSON.stringify(result), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
    } catch (error: unknown) {
        logger.error("Skills service error", error);
        const message = error instanceof Error ? error.message : "Unknown error";
        return new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { ...getCorsHeaders(), "Content-Type": "application/json" }
        });
    }
});

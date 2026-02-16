/// <reference path="../types/deno.d.ts" />

import { createClient } from "npm:@supabase/supabase-js@2";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
    getCorsHeaders,
    createOptionsResponse,
    isOriginAllowed,
    createForbiddenOriginResponse,
} from "../../services/CorsService.ts";
import { createLogger } from "../../services/LoggerService.ts";
import { AuditService } from "../../services/AuditService.ts";

const logger = createLogger("agent-orchestrator");

type AdminClient = SupabaseClient<any, any, any, any, any>;

type AgentType = "faktura" | "bank" | "moms" | "bokforings" | "guardian" | "agi";
type TaskStatus = "pending" | "claimed" | "running" | "succeeded" | "failed" | "cancelled";

type OrchestratorAction =
    | "dispatch"
    | "claim_and_run"
    | "list_tasks"
    | "list_agents"
    | "toggle_agent"
    | "cancel_task"
    | "retry_task"
    | "schedule_tick";

interface OrchestratorRequest {
    action: OrchestratorAction;
    agent_type?: AgentType;
    company_id?: string;
    task_id?: string;
    input_payload?: Record<string, unknown>;
    priority?: number;
    enabled?: boolean;
    status?: TaskStatus;
    limit?: number;
}

const VALID_AGENT_TYPES = new Set<string>(["faktura", "bank", "moms", "bokforings", "guardian", "agi"]);

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonResponse(
    corsHeaders: Record<string, string>,
    status: number,
    body: Record<string, unknown>
): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

async function verifyUser(
    supabaseAdmin: AdminClient,
    authHeader: string | null
): Promise<{ userId: string; isAdmin: boolean } | null> {
    if (!authHeader) return null;
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) return null;

    const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("is_admin")
        .eq("id", user.id)
        .maybeSingle();

    return { userId: user.id, isAdmin: Boolean(profile?.is_admin) };
}

async function resolveDefaultCompanyId(
    supabaseAdmin: AdminClient,
    userId: string,
    preferredCompanyId?: string
): Promise<string> {
    if (preferredCompanyId && preferredCompanyId.trim().length > 0) {
        return preferredCompanyId.trim();
    }
    const { data } = await supabaseAdmin
        .from("companies")
        .select("id")
        .eq("user_id", userId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
    return (data?.id as string | undefined) || "default";
}

// =============================================================================
// ACTION HANDLERS
// =============================================================================

async function handleDispatch(
    supabaseAdmin: AdminClient,
    userId: string,
    companyId: string,
    body: OrchestratorRequest,
    auditService: AuditService
): Promise<Record<string, unknown>> {
    if (!body.agent_type || !VALID_AGENT_TYPES.has(body.agent_type)) {
        throw new Error("agent_type krävs och måste vara giltig (faktura, bank, moms, bokforings, guardian, agi)");
    }

    // Check if agent is enabled
    const { data: agent } = await supabaseAdmin
        .from("agent_registry")
        .select("enabled")
        .eq("agent_type", body.agent_type)
        .maybeSingle();

    if (agent && !agent.enabled) {
        throw new Error(`Agent '${body.agent_type}' är inaktiverad.`);
    }

    const priority = typeof body.priority === "number" && body.priority >= 1 && body.priority <= 10
        ? body.priority
        : 5;

    const { data: task, error } = await supabaseAdmin
        .from("agent_tasks")
        .insert({
            user_id: userId,
            company_id: companyId,
            agent_type: body.agent_type,
            status: "pending",
            priority,
            input_payload: body.input_payload || {},
            scheduled_at: new Date().toISOString(),
        })
        .select("id, agent_type, status, priority, created_at")
        .single();

    if (error) throw error;

    await auditService.log({
        userId,
        companyId,
        actorType: "user",
        action: "agent_task_dispatched",
        resourceType: "agent_task",
        resourceId: String(task.id),
        newState: { agent_type: body.agent_type, priority },
    });

    // Auto-execute: claim and run the task immediately
    const taskId = String(task.id);
    try {
        const { data: claimed } = await supabaseAdmin
            .from("agent_tasks")
            .update({
                status: "running",
                claimed_at: new Date().toISOString(),
                started_at: new Date().toISOString(),
            })
            .eq("id", taskId)
            .eq("status", "pending")
            .select("id")
            .maybeSingle();

        if (!claimed) {
            return { ok: true, task: { ...task, status: "claimed" }, message: "Task redan claimad av annan process." };
        }

        const result = await executeAgentHandler(supabaseAdmin, {
            taskId,
            agentType: body.agent_type!,
            userId,
            companyId,
            inputPayload: body.input_payload || {},
        });

        await supabaseAdmin
            .from("agent_tasks")
            .update({
                status: "succeeded",
                output_payload: result,
                finished_at: new Date().toISOString(),
            })
            .eq("id", taskId);

        await supabaseAdmin
            .from("agent_registry")
            .update({ last_run_at: new Date().toISOString() })
            .eq("agent_type", body.agent_type);

        await auditService.log({
            userId,
            companyId,
            actorType: "system",
            action: "agent_task_succeeded",
            resourceType: "agent_task",
            resourceId: taskId,
            newState: { agent_type: body.agent_type },
        });

        return { ok: true, task: { ...task, status: "succeeded" }, result };
    } catch (execError) {
        const errorMessage = execError instanceof Error ? execError.message : "Unknown error";
        logger.error("Auto-execute failed", { taskId, agent_type: body.agent_type, error: errorMessage });

        await supabaseAdmin
            .from("agent_tasks")
            .update({
                status: "failed",
                error_code: "AGENT_EXECUTION_FAILED",
                error_message: errorMessage,
                finished_at: new Date().toISOString(),
            })
            .eq("id", taskId);

        return { ok: false, task: { ...task, status: "failed" }, error: errorMessage };
    }
}

async function handleClaimAndRun(
    supabaseAdmin: AdminClient,
    auditService: AuditService
): Promise<Record<string, unknown>> {
    // Atomically claim the next pending task
    const { data: rows, error: claimError } = await supabaseAdmin.rpc("claim_next_agent_task");

    // If no RPC exists yet, fall back to manual claim
    let task: Record<string, unknown> | null = null;

    if (claimError || !rows) {
        // Fallback: manual SELECT + UPDATE (less atomic but functional)
        const { data: pending } = await supabaseAdmin
            .from("agent_tasks")
            .select("*")
            .eq("status", "pending")
            .lte("scheduled_at", new Date().toISOString())
            .order("priority", { ascending: true })
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle();

        if (!pending) {
            return { ok: true, message: "Inga väntande tasks.", claimed: false };
        }

        const { data: claimed, error: updateError } = await supabaseAdmin
            .from("agent_tasks")
            .update({
                status: "running",
                claimed_at: new Date().toISOString(),
                started_at: new Date().toISOString(),
            })
            .eq("id", pending.id)
            .eq("status", "pending")
            .select("*")
            .maybeSingle();

        if (updateError || !claimed) {
            return { ok: true, message: "Task redan claimad av annan process.", claimed: false };
        }

        task = claimed as Record<string, unknown>;
    } else {
        task = (Array.isArray(rows) ? rows[0] : rows) as Record<string, unknown> | null;
    }

    if (!task) {
        return { ok: true, message: "Inga väntande tasks.", claimed: false };
    }

    const agentType = String(task.agent_type || "");
    const taskId = String(task.id || "");
    const userId = String(task.user_id || "");
    const companyId = String(task.company_id || "");
    const inputPayload = isRecord(task.input_payload) ? task.input_payload : {};

    try {
        // Execute agent logic based on type
        const result = await executeAgentHandler(supabaseAdmin, {
            taskId,
            agentType,
            userId,
            companyId,
            inputPayload,
        });

        // Mark as succeeded
        await supabaseAdmin
            .from("agent_tasks")
            .update({
                status: "succeeded",
                output_payload: result,
                finished_at: new Date().toISOString(),
            })
            .eq("id", taskId);

        // Update agent_registry last_run_at
        await supabaseAdmin
            .from("agent_registry")
            .update({ last_run_at: new Date().toISOString() })
            .eq("agent_type", agentType);

        await auditService.log({
            userId,
            companyId,
            actorType: "system",
            action: "agent_task_succeeded",
            resourceType: "agent_task",
            resourceId: taskId,
            newState: { agent_type: agentType },
        });

        return { ok: true, claimed: true, task_id: taskId, agent_type: agentType, status: "succeeded", result };

    } catch (execError) {
        const retryCount = typeof task.retry_count === "number" ? task.retry_count : 0;
        const maxRetries = typeof task.max_retries === "number" ? task.max_retries : 3;
        const errorMessage = execError instanceof Error ? execError.message : "Unknown error";

        if (retryCount < maxRetries) {
            await supabaseAdmin
                .from("agent_tasks")
                .update({
                    status: "pending",
                    retry_count: retryCount + 1,
                    error_message: errorMessage,
                    claimed_at: null,
                    started_at: null,
                })
                .eq("id", taskId);

            return {
                ok: false,
                claimed: true,
                task_id: taskId,
                status: "retrying",
                retry_count: retryCount + 1,
                error: errorMessage,
            };
        }

        await supabaseAdmin
            .from("agent_tasks")
            .update({
                status: "failed",
                error_code: "AGENT_EXECUTION_FAILED",
                error_message: errorMessage,
                finished_at: new Date().toISOString(),
            })
            .eq("id", taskId);

        return {
            ok: false,
            claimed: true,
            task_id: taskId,
            status: "failed",
            error: errorMessage,
        };
    }
}

async function executeAgentHandler(
    supabaseAdmin: AdminClient,
    params: {
        taskId: string;
        agentType: string;
        userId: string;
        companyId: string;
        inputPayload: Record<string, unknown>;
    }
): Promise<Record<string, unknown>> {
    const { agentType, userId, companyId, inputPayload } = params;

    switch (agentType) {
        case "guardian": {
            // Dispatch to fortnox-guardian edge function
            const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
            const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

            const guardianResponse = await fetch(`${supabaseUrl}/functions/v1/fortnox-guardian`, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${supabaseServiceKey}`,
                    "Content-Type": "application/json",
                    "x-cron-secret": Deno.env.get("FORTNOX_GUARDIAN_CRON_SECRET") ?? "",
                },
                body: JSON.stringify({
                    action: "run_checks",
                    payload: { userId, companyId, limit: 1 },
                }),
                signal: AbortSignal.timeout(60_000),
            });

            const guardianResult = await guardianResponse.json().catch(() => ({}));
            return guardianResult as Record<string, unknown>;
        }

        case "faktura":
        case "bank":
        case "moms":
        case "bokforings":
        case "agi": {
            // Dispatch to finance-agent edge function
            const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
            const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

            // Map agent_type to finance-agent action
            const actionMap: Record<string, string> = {
                faktura: inputPayload.action as string || "processInvoice",
                bank: inputPayload.action as string || "reconcileBankTransactions",
                moms: inputPayload.action as string || "calculateVATReport",
                bokforings: inputPayload.action as string || "createJournalEntry",
                agi: inputPayload.action as string || "runAgiDraft",
            };

            const financeAction = actionMap[agentType] || agentType;

            const financeResponse = await fetch(`${supabaseUrl}/functions/v1/finance-agent`, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${supabaseServiceKey}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    action: financeAction,
                    companyId,
                    payload: {
                        ...inputPayload,
                        companyId,
                        _agentTaskId: params.taskId,
                    },
                }),
                signal: AbortSignal.timeout(60_000),
            });

            const financeResult = await financeResponse.json().catch(() => ({}));

            if (!financeResponse.ok) {
                throw new Error(
                    (financeResult as Record<string, unknown>).error as string
                    || `Finance agent returned ${financeResponse.status}`
                );
            }

            return financeResult as Record<string, unknown>;
        }

        default:
            throw new Error(`Okänd agenttyp: ${agentType}`);
    }
}

async function handleListTasks(
    supabaseAdmin: AdminClient,
    userId: string,
    companyId: string,
    body: OrchestratorRequest
): Promise<Record<string, unknown>> {
    const limit = typeof body.limit === "number" && body.limit > 0 ? Math.min(body.limit, 100) : 25;

    let query = supabaseAdmin
        .from("agent_tasks")
        .select("id, agent_type, status, priority, input_payload, output_payload, error_code, error_message, retry_count, max_retries, scheduled_at, started_at, finished_at, parent_task_id, ai_decision_id, created_at")
        .eq("user_id", userId)
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(limit);

    if (body.agent_type && VALID_AGENT_TYPES.has(body.agent_type)) {
        query = query.eq("agent_type", body.agent_type);
    }

    if (body.status) {
        query = query.eq("status", body.status);
    }

    const { data, error } = await query;
    if (error) throw error;

    return { tasks: data || [] };
}

async function handleListAgents(
    supabaseAdmin: AdminClient
): Promise<Record<string, unknown>> {
    const { data, error } = await supabaseAdmin
        .from("agent_registry")
        .select("agent_type, display_name, description, edge_function, schedule_cron, enabled, config, last_run_at, created_at")
        .order("created_at", { ascending: true });

    if (error) throw error;
    return { agents: data || [] };
}

async function handleToggleAgent(
    supabaseAdmin: AdminClient,
    body: OrchestratorRequest
): Promise<Record<string, unknown>> {
    if (!body.agent_type || !VALID_AGENT_TYPES.has(body.agent_type)) {
        throw new Error("agent_type krävs.");
    }
    if (typeof body.enabled !== "boolean") {
        throw new Error("enabled (boolean) krävs.");
    }

    const { data, error } = await supabaseAdmin
        .from("agent_registry")
        .update({ enabled: body.enabled })
        .eq("agent_type", body.agent_type)
        .select("agent_type, display_name, enabled")
        .single();

    if (error) throw error;
    return { ok: true, agent: data };
}

async function handleCancelTask(
    supabaseAdmin: AdminClient,
    userId: string,
    body: OrchestratorRequest
): Promise<Record<string, unknown>> {
    if (!body.task_id) throw new Error("task_id krävs.");

    const { data, error } = await supabaseAdmin
        .from("agent_tasks")
        .update({
            status: "cancelled",
            finished_at: new Date().toISOString(),
        })
        .eq("id", body.task_id)
        .eq("user_id", userId)
        .in("status", ["pending", "claimed"])
        .select("id, status")
        .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error("Task hittades inte eller kan inte avbrytas.");

    return { ok: true, task: data };
}

async function handleRetryTask(
    supabaseAdmin: AdminClient,
    userId: string,
    body: OrchestratorRequest
): Promise<Record<string, unknown>> {
    if (!body.task_id) throw new Error("task_id krävs.");

    const { data, error } = await supabaseAdmin
        .from("agent_tasks")
        .update({
            status: "pending",
            error_code: null,
            error_message: null,
            claimed_at: null,
            started_at: null,
            finished_at: null,
            scheduled_at: new Date().toISOString(),
        })
        .eq("id", body.task_id)
        .eq("user_id", userId)
        .eq("status", "failed")
        .select("id, status, retry_count")
        .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error("Task hittades inte eller är inte i failed-status.");

    return { ok: true, task: data };
}

async function handleScheduleTick(
    supabaseAdmin: AdminClient
): Promise<Record<string, unknown>> {
    // Find all enabled agents with a schedule
    const { data: agents, error } = await supabaseAdmin
        .from("agent_registry")
        .select("agent_type, schedule_cron")
        .eq("enabled", true)
        .not("schedule_cron", "is", null);

    if (error) throw error;

    // Find all pro/trial users
    const { data: profiles, error: profileError } = await supabaseAdmin
        .from("profiles")
        .select("id, plan")
        .in("plan", ["pro", "trial"])
        .limit(100);

    if (profileError) throw profileError;

    const now = new Date();
    const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    let tasksCreated = 0;

    for (const profile of profiles || []) {
        const userId = String(profile.id || "");
        if (!userId) continue;

        const companyId = await resolveDefaultCompanyId(supabaseAdmin, userId);

        for (const agent of agents || []) {
            const agentType = String(agent.agent_type || "");
            const idempotencyKey = `cron:${agentType}:${period}:${userId}`;

            const { error: insertError } = await supabaseAdmin
                .from("agent_tasks")
                .insert({
                    user_id: userId,
                    company_id: companyId,
                    agent_type: agentType,
                    status: "pending",
                    priority: 8, // background priority for scheduled
                    input_payload: {
                        source: "schedule",
                        period,
                        scheduled_by: "cron",
                    },
                    idempotency_key: idempotencyKey,
                    scheduled_at: now.toISOString(),
                })
                .select("id")
                .maybeSingle();

            // Ignore unique constraint violations (already scheduled)
            if (!insertError) {
                tasksCreated++;
            }
        }
    }

    return { ok: true, tasksCreated, period };
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

Deno.serve(async (req: Request) => {
    const requestOrigin = req.headers.get("origin") || req.headers.get("Origin");
    const corsHeaders = getCorsHeaders(requestOrigin);

    if (req.method === "OPTIONS") {
        return createOptionsResponse(req);
    }

    if (requestOrigin && !isOriginAllowed(requestOrigin)) {
        return createForbiddenOriginResponse(requestOrigin);
    }

    if (req.method !== "POST") {
        return jsonResponse(corsHeaders, 405, { error: "Method not allowed" });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!supabaseUrl || !supabaseServiceKey) {
        return jsonResponse(corsHeaders, 500, { error: "Server configuration error" });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    const auditService = new AuditService(supabaseAdmin);

    const body = (await req.json().catch(() => ({}))) as OrchestratorRequest;
    const action = body.action;

    if (!action) {
        return jsonResponse(corsHeaders, 400, { error: "action krävs." });
    }

    // Auth: schedule_tick uses cron secret, others need user auth
    const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
    const cronSecret = Deno.env.get("AGENT_CRON_SECRET")?.trim() || "";
    const headerSecret = (req.headers.get("x-agent-cron-secret") || "").trim();
    const isCron = Boolean(cronSecret) && Boolean(headerSecret) && cronSecret === headerSecret;

    try {
        // schedule_tick only via cron secret or admin
        if (action === "schedule_tick") {
            if (!isCron) {
                const user = await verifyUser(supabaseAdmin, authHeader);
                if (!user?.isAdmin) {
                    return jsonResponse(corsHeaders, 403, { error: "Kräver admin eller cron-secret." });
                }
            }
            const result = await handleScheduleTick(supabaseAdmin);
            return jsonResponse(corsHeaders, 200, result);
        }

        // claim_and_run: cron or admin only
        if (action === "claim_and_run") {
            if (!isCron) {
                const user = await verifyUser(supabaseAdmin, authHeader);
                if (!user?.isAdmin) {
                    return jsonResponse(corsHeaders, 403, { error: "Kräver admin eller cron-secret." });
                }
            }
            const result = await handleClaimAndRun(supabaseAdmin, auditService);
            return jsonResponse(corsHeaders, 200, result);
        }

        // All other actions require authenticated user
        const user = await verifyUser(supabaseAdmin, authHeader);
        if (!user) {
            return jsonResponse(corsHeaders, 401, { error: "Unauthorized" });
        }

        const companyId = await resolveDefaultCompanyId(supabaseAdmin, user.userId, body.company_id);

        switch (action) {
            case "dispatch": {
                const result = await handleDispatch(supabaseAdmin, user.userId, companyId, body, auditService);
                return jsonResponse(corsHeaders, 200, result);
            }

            case "list_tasks": {
                const result = await handleListTasks(supabaseAdmin, user.userId, companyId, body);
                return jsonResponse(corsHeaders, 200, result);
            }

            case "list_agents": {
                if (!user.isAdmin) {
                    return jsonResponse(corsHeaders, 403, { error: "Kräver admin." });
                }
                const result = await handleListAgents(supabaseAdmin);
                return jsonResponse(corsHeaders, 200, result);
            }

            case "toggle_agent": {
                if (!user.isAdmin) {
                    return jsonResponse(corsHeaders, 403, { error: "Kräver admin." });
                }
                const result = await handleToggleAgent(supabaseAdmin, body);
                return jsonResponse(corsHeaders, 200, result);
            }

            case "cancel_task": {
                const result = await handleCancelTask(supabaseAdmin, user.userId, body);
                return jsonResponse(corsHeaders, 200, result);
            }

            case "retry_task": {
                const result = await handleRetryTask(supabaseAdmin, user.userId, body);
                return jsonResponse(corsHeaders, 200, result);
            }

            default:
                return jsonResponse(corsHeaders, 400, { error: `Okänd action: ${action}` });
        }
    } catch (error) {
        logger.error("agent-orchestrator error", { action, error });
        const message = error instanceof Error ? error.message : "Oväntat fel";
        return jsonResponse(corsHeaders, 500, { error: message });
    }
});

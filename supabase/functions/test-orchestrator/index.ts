/// <reference path="../types/deno.d.ts" />

import { createClient } from "npm:@supabase/supabase-js@2";
import {
    createOptionsResponse,
    getCorsHeaders,
    isOriginAllowed,
    createForbiddenOriginResponse,
} from "../../services/CorsService.ts";
import { createLogger } from "../../services/LoggerService.ts";

const logger = createLogger("test-orchestrator");

type SuiteName = "core_ui" | "core_api" | "security" | "billing" | "guardian";
type RunMode = "manual" | "scheduled";
type RunStatus = "running" | "succeeded" | "failed";
type CheckStatus = "passed" | "failed";

type OrchestratorAction = "list_suites" | "run_suite" | "get_run" | "run_all";

interface OrchestratorRequest {
    action?: OrchestratorAction;
    company_id?: string;
    suite?: SuiteName;
    mode?: RunMode;
    run_id?: string;
    user_id?: string;
    limit?: number;
}

interface SuiteDefinition {
    id: SuiteName;
    label: string;
    description: string;
}

interface CheckResult {
    id: string;
    status: CheckStatus;
    message: string;
    details?: Record<string, unknown>;
}

interface RunSummary {
    passed: number;
    failed: number;
    duration_ms: number;
}

const SUITES: SuiteDefinition[] = [
    {
        id: "core_ui",
        label: "Core UI",
        description: "Verifierar grundläggande användar- och bolagskontext för UI-flöden.",
    },
    {
        id: "core_api",
        label: "Core API",
        description: "Verifierar kritiska datamodeller och API-relaterade tabeller.",
    },
    {
        id: "security",
        label: "Security",
        description: "Verifierar säkerhetskritiska konfigurationer som privata storage buckets.",
    },
    {
        id: "billing",
        label: "Billing",
        description: "Verifierar plan- och faktureringsstatus per användare.",
    },
    {
        id: "guardian",
        label: "Guardian",
        description: "Verifierar Guardian-signaler och Fortnox-relaterade varningsindikatorer.",
    },
];

function jsonResponse(status: number, body: Record<string, unknown>, corsHeaders: Record<string, string>): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

function parseMode(value: unknown): RunMode {
    if (value === "scheduled") return "scheduled";
    return "manual";
}

function isSuiteName(value: unknown): value is SuiteName {
    return typeof value === "string" && SUITES.some((suite) => suite.id === value);
}

function summarizeChecks(checks: CheckResult[], durationMs: number): RunSummary {
    const passed = checks.filter((check) => check.status === "passed").length;
    const failed = checks.length - passed;
    return {
        passed,
        failed,
        duration_ms: durationMs,
    };
}

async function getDefaultCompanyId(supabaseAdmin: any, userId: string): Promise<string> {
    const { data, error } = await supabaseAdmin
        .from("companies")
        .select("id")
        .eq("user_id", userId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

    if (error) {
        throw new Error(`Could not resolve company for user ${userId}: ${error.message}`);
    }

    return (data?.id as string | undefined) || "default";
}

async function ensureAgentSkill(
    supabaseAdmin: any,
    userId: string,
    companyId: string,
    suite: SuiteName | "all"
): Promise<string> {
    const name = `Agent Suite: ${suite}`;

    const { data: existing, error: existingError } = await supabaseAdmin
        .from("skills")
        .select("id")
        .eq("user_id", userId)
        .eq("company_id", companyId)
        .eq("name", name)
        .maybeSingle();

    if (existingError) {
        throw new Error(`Could not query skill ${name}: ${existingError.message}`);
    }

    if (existing?.id) {
        return String(existing.id);
    }

    const { data: created, error: createError } = await supabaseAdmin
        .from("skills")
        .insert({
            user_id: userId,
            company_id: companyId,
            name,
            description: "Automatisk testagent-svit som körs via test-orchestrator.",
            kind: "automation",
            status: "active",
            requires_approval: false,
            scope: "company",
            visibility: "private",
            input_schema: {
                type: "object",
                properties: {
                    suite: { type: "string" },
                    mode: { type: "string" },
                },
            },
            output_schema: {
                type: "object",
                properties: {
                    status: { type: "string" },
                    summary: { type: "object" },
                    checks: { type: "array" },
                },
            },
            allowed_actions: ["run_suite", "run_all", "get_run"],
        })
        .select("id")
        .single();

    if (createError || !created?.id) {
        throw new Error(`Could not create skill ${name}: ${createError?.message || "missing id"}`);
    }

    return String(created.id);
}

async function createRun(
    supabaseAdmin: any,
    params: {
        userId: string;
        companyId: string;
        skillId: string;
        suite: SuiteName | "all";
        mode: RunMode;
    }
): Promise<string> {
    const now = new Date().toISOString();
    const { data, error } = await supabaseAdmin
        .from("skill_runs")
        .insert({
            skill_id: params.skillId,
            user_id: params.userId,
            company_id: params.companyId,
            triggered_by: params.mode === "scheduled" ? "system" : "user",
            status: "running",
            input_payload: {
                agent_type: "test-orchestrator",
                suite: params.suite,
                mode: params.mode,
                started_at: now,
            },
            started_at: now,
        })
        .select("id")
        .single();

    if (error || !data?.id) {
        throw new Error(`Could not create run: ${error?.message || "missing id"}`);
    }

    return String(data.id);
}

async function finalizeRun(
    supabaseAdmin: any,
    params: {
        runId: string;
        status: RunStatus;
        summary: RunSummary;
        checks: CheckResult[];
        suite: SuiteName | "all";
        mode: RunMode;
        extra?: Record<string, unknown>;
    }
): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await supabaseAdmin
        .from("skill_runs")
        .update({
            status: params.status,
            finished_at: now,
            output_payload: {
                ok: params.status !== "failed",
                run_id: params.runId,
                suite: params.suite,
                mode: params.mode,
                status: params.status,
                summary: params.summary,
                checks: params.checks,
                ...params.extra,
            },
            error_code: params.status === "failed" ? "AGENT_SUITE_FAILED" : null,
            error_message: params.status === "failed"
                ? `${params.summary.failed} check(s) failed`
                : null,
        })
        .eq("id", params.runId);

    if (error) {
        throw new Error(`Could not finalize run ${params.runId}: ${error.message}`);
    }
}

async function runCoreUiSuite(
    supabaseAdmin: any,
    userId: string,
    companyId: string
): Promise<CheckResult[]> {
    const checks: CheckResult[] = [];

    const { data: profile, error: profileError } = await supabaseAdmin
        .from("profiles")
        .select("id, plan, terms_version")
        .eq("id", userId)
        .maybeSingle();

    checks.push(profileError || !profile
        ? { id: "core_ui_profile", status: "failed", message: "Saknar användarprofil för UI-flöden." }
        : {
            id: "core_ui_profile",
            status: "passed",
            message: "Användarprofil hittades.",
            details: {
                plan: profile.plan,
                terms_version: profile.terms_version,
            },
        });

    const { data: company, error: companyError } = await supabaseAdmin
        .from("companies")
        .select("id")
        .eq("id", companyId)
        .eq("user_id", userId)
        .maybeSingle();

    checks.push(companyError || !company
        ? { id: "core_ui_company", status: "failed", message: "Aktivt bolag saknas eller matchar inte användaren." }
        : { id: "core_ui_company", status: "passed", message: "Aktivt bolag hittades." });

    const { data: legalRows, error: legalError } = await supabaseAdmin
        .from("legal_acceptances")
        .select("doc_type, version")
        .eq("user_id", userId)
        .order("accepted_at", { ascending: false })
        .limit(20);

    checks.push(legalError
        ? { id: "core_ui_legal", status: "failed", message: "Kunde inte läsa legal_acceptances." }
        : {
            id: "core_ui_legal",
            status: (legalRows?.length || 0) > 0 ? "passed" : "failed",
            message: (legalRows?.length || 0) > 0
                ? "Legal acceptances finns registrerade."
                : "Inga legal acceptances registrerade för användaren.",
        });

    return checks;
}

async function runCoreApiSuite(
    supabaseAdmin: any,
    userId: string,
    companyId: string
): Promise<CheckResult[]> {
    const checks: CheckResult[] = [];

    const { error: skillsError } = await supabaseAdmin
        .from("skills")
        .select("id", { head: true, count: "exact" })
        .eq("user_id", userId)
        .eq("company_id", companyId)
        .limit(1);

    checks.push(skillsError
        ? { id: "core_api_skills", status: "failed", message: "Kunde inte läsa skills-tabellen." }
        : { id: "core_api_skills", status: "passed", message: "Skills-tabellen svarar." });

    const { error: memoriesError } = await supabaseAdmin
        .from("memory_items")
        .select("id", { head: true, count: "exact" })
        .eq("user_id", userId)
        .eq("company_id", companyId)
        .limit(1);

    checks.push(memoriesError
        ? { id: "core_api_memory_items", status: "failed", message: "Kunde inte läsa memory_items-tabellen." }
        : { id: "core_api_memory_items", status: "passed", message: "Memory-items-tabellen svarar." });

    const { error: conversationError } = await supabaseAdmin
        .from("conversations")
        .select("id", { head: true, count: "exact" })
        .eq("user_id", userId)
        .eq("company_id", companyId)
        .limit(1);

    checks.push(conversationError
        ? { id: "core_api_conversations", status: "failed", message: "Kunde inte läsa conversations-tabellen." }
        : { id: "core_api_conversations", status: "passed", message: "Conversations-tabellen svarar." });

    return checks;
}

async function runSecuritySuite(
    supabaseAdmin: any
): Promise<CheckResult[]> {
    const checks: CheckResult[] = [];

    const { data: bucketRows, error: bucketError } = await supabaseAdmin
        .schema("storage")
        .from("buckets")
        .select("name, public")
        .in("name", ["chat-files", "excel-files"]);

    if (bucketError) {
        checks.push({
            id: "security_storage_buckets",
            status: "failed",
            message: `Kunde inte läsa storage buckets: ${bucketError.message}`,
        });
        return checks;
    }

    const bucketsByName = new Map<string, Record<string, unknown>>(
        (bucketRows || []).map((row: Record<string, unknown>) => [String(row.name), row])
    );

    for (const bucketName of ["chat-files", "excel-files"]) {
        const bucket = bucketsByName.get(bucketName);
        if (!bucket) {
            checks.push({
                id: `security_bucket_${bucketName}`,
                status: "failed",
                message: `Bucket ${bucketName} saknas.`,
            });
            continue;
        }

        const isPublic = Boolean((bucket as { public?: unknown }).public);
        checks.push({
            id: `security_bucket_${bucketName}`,
            status: isPublic ? "failed" : "passed",
            message: isPublic
                ? `Bucket ${bucketName} är publik (ska vara privat).`
                : `Bucket ${bucketName} är privat.`,
        });
    }

    return checks;
}

async function runBillingSuite(
    supabaseAdmin: any,
    userId: string
): Promise<CheckResult[]> {
    const checks: CheckResult[] = [];

    const { data: profile, error } = await supabaseAdmin
        .from("profiles")
        .select("plan, billing_status, period_end, trial_end, grace_until")
        .eq("id", userId)
        .maybeSingle();

    if (error || !profile) {
        checks.push({
            id: "billing_profile",
            status: "failed",
            message: "Kunde inte läsa billing-profil.",
        });
        return checks;
    }

    checks.push({
        id: "billing_plan_value",
        status: ["free", "pro", "trial"].includes(String(profile.plan)) ? "passed" : "failed",
        message: ["free", "pro", "trial"].includes(String(profile.plan))
            ? `Planvärde giltigt: ${profile.plan}`
            : `Ogiltigt planvärde: ${String(profile.plan)}`,
    });

    const billingStatus = profile.billing_status ? String(profile.billing_status) : "active";
    checks.push({
        id: "billing_status_value",
        status: ["active", "past_due", "suspended"].includes(billingStatus) ? "passed" : "failed",
        message: ["active", "past_due", "suspended"].includes(billingStatus)
            ? `Billingstatus giltig: ${billingStatus}`
            : `Ogiltig billingstatus: ${billingStatus}`,
    });

    if (profile.plan === "trial") {
        checks.push({
            id: "billing_trial_end",
            status: profile.trial_end ? "passed" : "failed",
            message: profile.trial_end
                ? "Trial har trial_end satt."
                : "Trial saknar trial_end.",
        });
    }

    if (profile.plan === "pro") {
        checks.push({
            id: "billing_period_end",
            status: profile.period_end ? "passed" : "failed",
            message: profile.period_end
                ? "Pro har period_end satt."
                : "Pro saknar period_end.",
        });
    }

    return checks;
}

async function runGuardianSuite(
    supabaseAdmin: any,
    userId: string,
    companyId: string
): Promise<CheckResult[]> {
    const checks: CheckResult[] = [];

    const { data: openAlerts, error: alertError } = await supabaseAdmin
        .from("guardian_alerts")
        .select("id, severity", { count: "exact" })
        .eq("user_id", userId)
        .eq("company_id", companyId)
        .eq("status", "open");

    if (alertError) {
        checks.push({
            id: "guardian_alerts",
            status: "failed",
            message: `Kunde inte läsa guardian_alerts: ${alertError.message}`,
        });
    } else {
        const criticalCount = (openAlerts || []).filter((row: any) => row.severity === "critical").length;
        checks.push({
            id: "guardian_alerts",
            status: "passed",
            message: `Guardian-larm hämtade (open: ${openAlerts?.length || 0}, critical: ${criticalCount}).`,
        });
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: failedSyncs, error: syncError } = await supabaseAdmin
        .from("fortnox_sync_log")
        .select("id", { count: "exact" })
        .eq("user_id", userId)
        .eq("company_id", companyId)
        .eq("status", "failed")
        .gte("created_at", since);

    if (syncError) {
        checks.push({
            id: "guardian_fortnox_failures",
            status: "failed",
            message: `Kunde inte läsa fortnox_sync_log: ${syncError.message}`,
        });
    } else {
        checks.push({
            id: "guardian_fortnox_failures",
            status: "passed",
            message: `Fortnox-fel senaste 24h: ${failedSyncs?.length || 0}.`,
        });
    }

    return checks;
}

async function executeSuite(
    supabaseAdmin: any,
    suite: SuiteName,
    userId: string,
    companyId: string
): Promise<CheckResult[]> {
    switch (suite) {
        case "core_ui":
            return runCoreUiSuite(supabaseAdmin, userId, companyId);
        case "core_api":
            return runCoreApiSuite(supabaseAdmin, userId, companyId);
        case "security":
            return runSecuritySuite(supabaseAdmin);
        case "billing":
            return runBillingSuite(supabaseAdmin, userId);
        case "guardian":
            return runGuardianSuite(supabaseAdmin, userId, companyId);
        default:
            return [{ id: "unknown_suite", status: "failed", message: `Unknown suite: ${suite}` }];
    }
}

async function runSingleSuiteAndPersist(
    supabaseAdmin: any,
    params: {
        userId: string;
        companyId: string;
        suite: SuiteName;
        mode: RunMode;
    }
): Promise<{ runId: string; status: RunStatus; summary: RunSummary; checks: CheckResult[] }> {
    const skillId = await ensureAgentSkill(supabaseAdmin, params.userId, params.companyId, params.suite);
    const runId = await createRun(supabaseAdmin, {
        userId: params.userId,
        companyId: params.companyId,
        skillId,
        suite: params.suite,
        mode: params.mode,
    });

    const started = Date.now();
    const checks = await executeSuite(supabaseAdmin, params.suite, params.userId, params.companyId);
    const summary = summarizeChecks(checks, Date.now() - started);
    const status: RunStatus = summary.failed > 0 ? "failed" : "succeeded";

    await finalizeRun(supabaseAdmin, {
        runId,
        status,
        summary,
        checks,
        suite: params.suite,
        mode: params.mode,
    });

    return { runId, status, summary, checks };
}

async function runAllSuitesAndPersist(
    supabaseAdmin: any,
    params: {
        userId: string;
        companyId: string;
        mode: RunMode;
    }
): Promise<{ runId: string; status: RunStatus; summary: RunSummary; checks: CheckResult[] }> {
    const skillId = await ensureAgentSkill(supabaseAdmin, params.userId, params.companyId, "all");
    const runId = await createRun(supabaseAdmin, {
        userId: params.userId,
        companyId: params.companyId,
        skillId,
        suite: "all",
        mode: params.mode,
    });

    const started = Date.now();
    const allChecks: CheckResult[] = [];

    for (const suite of SUITES) {
        const suiteChecks = await executeSuite(supabaseAdmin, suite.id, params.userId, params.companyId);
        for (const check of suiteChecks) {
            allChecks.push({
                ...check,
                id: `${suite.id}:${check.id}`,
            });
        }
    }

    const summary = summarizeChecks(allChecks, Date.now() - started);
    const status: RunStatus = summary.failed > 0 ? "failed" : "succeeded";

    await finalizeRun(supabaseAdmin, {
        runId,
        status,
        summary,
        checks: allChecks,
        suite: "all",
        mode: params.mode,
        extra: {
            suites: SUITES.map((suite) => suite.id),
        },
    });

    return { runId, status, summary, checks: allChecks };
}

async function resolveExecutionTargets(
    supabaseAdmin: any,
    limit: number
): Promise<Array<{ userId: string; companyId: string }>> {
    const { data: profiles, error } = await supabaseAdmin
        .from("profiles")
        .select("id, plan")
        .in("plan", ["pro", "trial"])
        .limit(limit);

    if (error) {
        throw new Error(`Could not resolve scheduled targets: ${error.message}`);
    }

    const targets: Array<{ userId: string; companyId: string }> = [];
    for (const profile of profiles || []) {
        const userId = String(profile.id || "");
        if (!userId) continue;
        const companyId = await getDefaultCompanyId(supabaseAdmin, userId);
        targets.push({ userId, companyId });
    }

    return targets;
}

Deno.serve(async (req: Request) => {
    const requestOrigin = req.headers.get("origin") || req.headers.get("Origin");

    if (req.method === "OPTIONS") {
        return createOptionsResponse(req);
    }

    if (requestOrigin && !isOriginAllowed(requestOrigin)) {
        return createForbiddenOriginResponse(requestOrigin);
    }

    const corsHeaders = getCorsHeaders(requestOrigin);

    if (req.method !== "POST") {
        return jsonResponse(405, { error: "Method not allowed" }, corsHeaders);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!supabaseUrl || !supabaseServiceRoleKey) {
        return jsonResponse(500, { error: "Missing Supabase configuration" }, corsHeaders);
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

    const body = (await req.json().catch(() => ({}))) as OrchestratorRequest;
    const action = body.action;

    if (!action) {
        return jsonResponse(400, { error: "action is required" }, corsHeaders);
    }

    const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();

    let userId: string | null = null;
    let isAdmin = false;

    if (token) {
        const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
        if (!userError && userData?.user?.id) {
            userId = userData.user.id;
            const { data: profile } = await supabaseAdmin
                .from("profiles")
                .select("is_admin")
                .eq("id", userId)
                .maybeSingle();
            isAdmin = Boolean(profile?.is_admin);
        }
    }

    const configuredSecret = Deno.env.get("TEST_ORCHESTRATOR_SECRET")?.trim() || "";
    const headerSecret = (req.headers.get("x-test-orchestrator-secret") || req.headers.get("X-Test-Orchestrator-Secret") || "").trim();
    const isScheduledSecret = Boolean(configuredSecret) && Boolean(headerSecret) && configuredSecret === headerSecret;

    try {
        if (action === "list_suites") {
            if (!userId && !isScheduledSecret) {
                return jsonResponse(401, { error: "Unauthorized" }, corsHeaders);
            }

            return jsonResponse(200, {
                ok: true,
                suites: SUITES,
            }, corsHeaders);
        }

        if (action === "get_run") {
            if (!userId && !isScheduledSecret) {
                return jsonResponse(401, { error: "Unauthorized" }, corsHeaders);
            }

            if (!body.run_id) {
                return jsonResponse(400, { error: "run_id is required" }, corsHeaders);
            }

            let query = supabaseAdmin
                .from("skill_runs")
                .select("id, user_id, company_id, status, output_payload, created_at, finished_at")
                .eq("id", body.run_id);

            if (userId && !isScheduledSecret) {
                query = query.eq("user_id", userId);
            }

            const { data, error } = await query.maybeSingle();

            if (error) {
                return jsonResponse(500, { error: error.message }, corsHeaders);
            }

            if (!data) {
                return jsonResponse(404, { error: "Run not found" }, corsHeaders);
            }

            const output = (data.output_payload || {}) as Record<string, unknown>;
            const summary = (output.summary || { passed: 0, failed: 0, duration_ms: 0 }) as Record<string, unknown>;
            const checks = Array.isArray(output.checks) ? output.checks : [];

            return jsonResponse(200, {
                ok: true,
                run_id: data.id,
                status: data.status,
                summary,
                checks,
                finished_at: data.finished_at,
            }, corsHeaders);
        }

        if (action === "run_suite") {
            const mode = parseMode(body.mode);

            if (mode === "scheduled" && !isScheduledSecret && !isAdmin) {
                return jsonResponse(userId ? 403 : 401, { error: "Scheduled mode requires secret or admin" }, corsHeaders);
            }

            if (mode === "manual" && !userId) {
                return jsonResponse(401, { error: "Unauthorized" }, corsHeaders);
            }

            if (!isSuiteName(body.suite)) {
                return jsonResponse(400, { error: "suite is required and must be valid" }, corsHeaders);
            }

            const targetUserId = body.user_id && (isScheduledSecret || isAdmin)
                ? body.user_id
                : userId;

            if (!targetUserId) {
                return jsonResponse(400, { error: "Could not resolve target user" }, corsHeaders);
            }

            const companyId = body.company_id && body.company_id.trim().length > 0
                ? body.company_id.trim()
                : await getDefaultCompanyId(supabaseAdmin, targetUserId);

            const result = await runSingleSuiteAndPersist(supabaseAdmin, {
                userId: targetUserId,
                companyId,
                suite: body.suite,
                mode,
            });

            return jsonResponse(200, {
                ok: true,
                run_id: result.runId,
                status: result.status,
                summary: result.summary,
                checks: result.checks,
            }, corsHeaders);
        }

        if (action === "run_all") {
            const mode = parseMode(body.mode);

            if (mode === "manual") {
                if (!userId) {
                    return jsonResponse(401, { error: "Unauthorized" }, corsHeaders);
                }

                const companyId = body.company_id && body.company_id.trim().length > 0
                    ? body.company_id.trim()
                    : await getDefaultCompanyId(supabaseAdmin, userId);

                const result = await runAllSuitesAndPersist(supabaseAdmin, {
                    userId,
                    companyId,
                    mode,
                });

                return jsonResponse(200, {
                    ok: true,
                    run_id: result.runId,
                    status: result.status,
                    summary: result.summary,
                    checks: result.checks,
                }, corsHeaders);
            }

            if (!isScheduledSecret && !isAdmin) {
                return jsonResponse(userId ? 403 : 401, { error: "Scheduled mode requires secret or admin" }, corsHeaders);
            }

            const targetUserId = body.user_id && body.user_id.trim().length > 0 ? body.user_id.trim() : null;
            const targetCompanyId = body.company_id && body.company_id.trim().length > 0 ? body.company_id.trim() : null;

            let targets: Array<{ userId: string; companyId: string }> = [];
            if (targetUserId) {
                const resolvedCompanyId = targetCompanyId || await getDefaultCompanyId(supabaseAdmin, targetUserId);
                targets = [{ userId: targetUserId, companyId: resolvedCompanyId }];
            } else {
                const limit = Number.isFinite(Number(body.limit)) && Number(body.limit) > 0
                    ? Math.min(Number(body.limit), 100)
                    : 25;
                targets = await resolveExecutionTargets(supabaseAdmin, limit);
            }

            const batchResults: Array<{ user_id: string; company_id: string; run_id: string; status: RunStatus; summary: RunSummary }> = [];

            for (const target of targets) {
                const result = await runAllSuitesAndPersist(supabaseAdmin, {
                    userId: target.userId,
                    companyId: target.companyId,
                    mode: "scheduled",
                });
                batchResults.push({
                    user_id: target.userId,
                    company_id: target.companyId,
                    run_id: result.runId,
                    status: result.status,
                    summary: result.summary,
                });
            }

            const first = batchResults[0];
            const totalPassed = batchResults.reduce((acc, row) => acc + Number(row.summary.passed || 0), 0);
            const totalFailed = batchResults.reduce((acc, row) => acc + Number(row.summary.failed || 0), 0);

            return jsonResponse(200, {
                ok: true,
                run_id: first?.run_id || `scheduled-${Date.now()}`,
                status: totalFailed > 0 ? "failed" : "succeeded",
                summary: {
                    passed: totalPassed,
                    failed: totalFailed,
                    duration_ms: 0,
                },
                checks: [],
                batch: {
                    targets: batchResults.length,
                    results: batchResults,
                },
            }, corsHeaders);
        }

        return jsonResponse(400, { error: `Unknown action: ${action}` }, corsHeaders);
    } catch (error) {
        logger.error("test-orchestrator error", error);
        return jsonResponse(500, {
            error: error instanceof Error ? error.message : "Unexpected error",
        }, corsHeaders);
    }
});

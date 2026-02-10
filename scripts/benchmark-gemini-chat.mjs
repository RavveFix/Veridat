#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";

const ROOT = process.cwd();

function loadEnvFile(fileName) {
    const filePath = resolve(ROOT, fileName);
    if (!existsSync(filePath)) return;

    const contents = readFileSync(filePath, "utf8");
    for (const line of contents.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;

        const eqIndex = trimmed.indexOf("=");
        if (eqIndex === -1) continue;

        const key = trimmed.slice(0, eqIndex).trim();
        let value = trimmed.slice(eqIndex + 1).trim();

        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }

        if (!process.env[key]) {
            process.env[key] = value;
        }
    }
}

function parseSupabaseStatusEnv(raw) {
    const values = {};
    for (const line of raw.split(/\r?\n/)) {
        const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (!match) continue;

        const key = match[1];
        let value = match[2].trim();
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }
        values[key] = value;
    }
    return values;
}

function tryReadSupabaseStatusEnv() {
    const candidates = [
        process.env.SUPABASE_CLI_PATH,
        "./node_modules/.bin/supabase",
        "supabase",
    ].filter(Boolean);

    for (const candidate of candidates) {
        try {
            const output = execFileSync(candidate, ["status", "-o", "env"], {
                cwd: ROOT,
                encoding: "utf8",
                stdio: ["ignore", "pipe", "ignore"],
            });
            const parsed = parseSupabaseStatusEnv(output);
            if (Object.keys(parsed).length > 0) {
                return parsed;
            }
        } catch {
            // Try next candidate
        }
    }

    return {};
}

function firstNonEmpty(...values) {
    for (const value of values) {
        if (typeof value === "string" && value.trim().length > 0) {
            return value.trim();
        }
    }
    return "";
}

function parsePositiveInt(name, fallback) {
    const raw = process.env[name];
    if (!raw) return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
}

function parsePositiveFloat(name, fallback) {
    const raw = process.env[name];
    if (!raw) return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
}

function percentile(sortedSamples, p) {
    if (sortedSamples.length === 0) return 0;
    const rank = Math.ceil((p / 100) * sortedSamples.length);
    const idx = Math.max(0, Math.min(sortedSamples.length - 1, rank - 1));
    return sortedSamples[idx];
}

async function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

function appendStepSummary(summary) {
    const file = process.env.GITHUB_STEP_SUMMARY;
    if (!file) return;
    try {
        writeFileSync(file, `${summary}\n`, { flag: "a" });
    } catch {
        // Ignore summary write errors.
    }
}

function writeResultArtifact(result) {
    const outputFile = firstNonEmpty(process.env.BENCH_OUTPUT_FILE);
    if (!outputFile) return;

    const absolutePath = resolve(ROOT, outputFile);
    const outputDir = dirname(absolutePath);
    if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
    }
    writeFileSync(absolutePath, `${JSON.stringify(result, null, 2)}\n`);
}

async function main() {
    loadEnvFile(".env.local");
    loadEnvFile(".env");

    const statusEnv = tryReadSupabaseStatusEnv();

    const apiUrl = firstNonEmpty(
        process.env.BENCH_API_URL,
        process.env.SUPABASE_URL,
        process.env.API_URL,
        process.env.VITE_SUPABASE_URL,
        statusEnv.API_URL,
        statusEnv.SUPABASE_URL
    );

    const anonKey = firstNonEmpty(
        process.env.BENCH_ANON_KEY,
        process.env.SUPABASE_ANON_KEY,
        process.env.ANON_KEY,
        process.env.VITE_SUPABASE_ANON_KEY,
        statusEnv.ANON_KEY,
        statusEnv.SUPABASE_ANON_KEY
    );

    const serviceRoleKey = firstNonEmpty(
        process.env.BENCH_SERVICE_ROLE_KEY,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
        process.env.SERVICE_ROLE_KEY,
        statusEnv.SERVICE_ROLE_KEY
    );

    if (!apiUrl || !anonKey || !serviceRoleKey) {
        throw new Error(
            [
                "Missing benchmark connection config.",
                "Set BENCH_API_URL, BENCH_ANON_KEY, BENCH_SERVICE_ROLE_KEY",
                "or make sure local Supabase is running and .env.local exists.",
            ].join(" ")
        );
    }

    const warmups = parsePositiveInt("BENCH_WARMUPS", 5);
    const runs = parsePositiveInt("BENCH_RUNS", 30);
    const timeoutMs = parsePositiveInt("BENCH_TIMEOUT_MS", 15000);
    const seedMessageCount = parsePositiveInt("BENCH_SEED_MESSAGES", 40);
    const p95Max = parsePositiveFloat("BENCH_P95_MAX_MS", 800);
    const p99Max = parsePositiveFloat("BENCH_P99_MAX_MS", 1200);
    const avgMax = parsePositiveFloat("BENCH_AVG_MAX_MS", 0);
    const benchmarkMessage = firstNonEmpty(
        process.env.BENCH_MESSAGE,
        "Vad pratade vi om förra veckan?"
    );
    const endpoint = `${apiUrl.replace(/\/$/, "")}/functions/v1/gemini-chat`;

    const admin = createClient(apiUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
    });
    const userClient = createClient(apiUrl, anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
    });

    const email = `perf-bench-${Date.now()}@example.com`;
    const password = `PerfBench!${Math.floor(Math.random() * 1_000_000)}`;

    const createUserResult = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
    });
    if (createUserResult.error || !createUserResult.data.user) {
        throw createUserResult.error ?? new Error("Failed to create benchmark user.");
    }

    const userId = createUserResult.data.user.id;

    try {
        const profileResult = await admin
            .from("profiles")
            .upsert(
                { id: userId, plan: "pro", has_accepted_terms: true },
                { onConflict: "id" }
            );
        if (profileResult.error) throw profileResult.error;

        const signInResult = await userClient.auth.signInWithPassword({ email, password });
        if (signInResult.error || !signInResult.data.session) {
            throw signInResult.error ?? new Error("Failed to sign in benchmark user.");
        }

        const accessToken = signInResult.data.session.access_token;

        const conversationResult = await userClient
            .from("conversations")
            .insert({ user_id: userId, title: "Perf benchmark" })
            .select("id")
            .single();
        if (conversationResult.error || !conversationResult.data?.id) {
            throw conversationResult.error ?? new Error("Failed to create benchmark conversation.");
        }

        const conversationId = conversationResult.data.id;
        const seedRows = Array.from({ length: seedMessageCount }, (_, index) => ({
            conversation_id: conversationId,
            role: index % 2 === 0 ? "user" : "assistant",
            content:
                index % 2 === 0
                    ? `Användarfråga ${index}: vi pratade om tidigare konversationer`
                    : `Assistentsvar ${index}: sammanfattning av tidigare diskussion`,
        }));
        const seedInsert = await userClient.from("messages").insert(seedRows);
        if (seedInsert.error) throw seedInsert.error;

        const payload = {
            message: benchmarkMessage,
            conversationId,
            stream: false,
        };

        for (let i = 0; i < warmups; i += 1) {
            const response = await fetchWithTimeout(
                endpoint,
                {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(payload),
                },
                timeoutMs
            );
            if (!response.ok) {
                const body = await response.text();
                throw new Error(`Warmup failed (${response.status}): ${body.slice(0, 300)}`);
            }
            await response.text();
        }

        const durations = [];
        const failures = [];

        for (let i = 0; i < runs; i += 1) {
            const start = performance.now();
            let response;
            try {
                response = await fetchWithTimeout(
                    endpoint,
                    {
                        method: "POST",
                        headers: {
                            Authorization: `Bearer ${accessToken}`,
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify(payload),
                    },
                    timeoutMs
                );
            } catch (error) {
                const durationMs = performance.now() - start;
                failures.push({
                    run: i + 1,
                    status: "timeout_or_network",
                    duration_ms: Number(durationMs.toFixed(2)),
                    error: error instanceof Error ? error.message : String(error),
                });
                continue;
            }

            const durationMs = performance.now() - start;
            const body = await response.text();
            if (!response.ok) {
                failures.push({
                    run: i + 1,
                    status: response.status,
                    duration_ms: Number(durationMs.toFixed(2)),
                    body: body.slice(0, 300),
                });
                continue;
            }

            durations.push(durationMs);
        }

        if (durations.length === 0) {
            throw new Error(`No successful benchmark samples. Failures: ${JSON.stringify(failures)}`);
        }

        const sorted = [...durations].sort((a, b) => a - b);
        const avgMs = sorted.reduce((sum, sample) => sum + sample, 0) / sorted.length;
        const p50Ms = percentile(sorted, 50);
        const p95Ms = percentile(sorted, 95);
        const p99Ms = percentile(sorted, 99);

        const result = {
            endpoint,
            scenario: "history-intent (chat endpoint, no forced external AI)",
            timestamp: new Date().toISOString(),
            warmups,
            requested_runs: runs,
            successful_runs: sorted.length,
            failed_runs: failures.length,
            p50_ms: Number(p50Ms.toFixed(2)),
            p95_ms: Number(p95Ms.toFixed(2)),
            p99_ms: Number(p99Ms.toFixed(2)),
            avg_ms: Number(avgMs.toFixed(2)),
            min_ms: Number(sorted[0].toFixed(2)),
            max_ms: Number(sorted[sorted.length - 1].toFixed(2)),
            thresholds: {
                p95_max_ms: p95Max,
                p99_max_ms: p99Max,
                avg_max_ms: avgMax > 0 ? avgMax : null,
            },
            failures,
        };

        writeResultArtifact(result);
        console.log(JSON.stringify(result, null, 2));

        const summaryLines = [
            "## Gemini Chat Performance Gate",
            "",
            `- Endpoint: \`${endpoint}\``,
            `- Runs: ${sorted.length}/${runs} successful`,
            `- p50: ${result.p50_ms} ms`,
            `- p95: ${result.p95_ms} ms (max ${p95Max} ms)`,
            `- p99: ${result.p99_ms} ms (max ${p99Max} ms)`,
            avgMax > 0 ? `- avg: ${result.avg_ms} ms (max ${avgMax} ms)` : `- avg: ${result.avg_ms} ms`,
            `- failures: ${failures.length}`,
        ];
        appendStepSummary(summaryLines.join("\n"));

        const gateFailures = [];
        if (result.p95_ms > p95Max) {
            gateFailures.push(`p95 ${result.p95_ms}ms > ${p95Max}ms`);
        }
        if (result.p99_ms > p99Max) {
            gateFailures.push(`p99 ${result.p99_ms}ms > ${p99Max}ms`);
        }
        if (avgMax > 0 && result.avg_ms > avgMax) {
            gateFailures.push(`avg ${result.avg_ms}ms > ${avgMax}ms`);
        }
        if (failures.length > 0) {
            gateFailures.push(`${failures.length} failed run(s)`);
        }

        if (gateFailures.length > 0) {
            throw new Error(`Performance gate failed: ${gateFailures.join(", ")}`);
        }
    } finally {
        await admin.auth.admin.deleteUser(userId).catch(() => undefined);
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});

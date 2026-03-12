/// <reference path="../types/deno.d.ts" />

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  getCorsHeaders,
  createOptionsResponse,
  isOriginAllowed,
  createForbiddenOriginResponse,
} from "../../services/CorsService.ts";
import { UsageTrackingService } from "../../services/UsageTrackingService.ts";

Deno.serve(async (req: Request) => {
  const requestOrigin =
    req.headers.get("origin") || req.headers.get("Origin");
  const corsHeaders = getCorsHeaders(requestOrigin);
  const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

  if (req.method === "OPTIONS") {
    return createOptionsResponse(req);
  }

  if (requestOrigin && !isOriginAllowed(requestOrigin)) {
    return createForbiddenOriginResponse(requestOrigin);
  }

  try {
    if (req.method !== "GET") {
      return new Response(
        JSON.stringify({ error: "Method not allowed" }),
        { status: 405, headers: jsonHeaders },
      );
    }

    const authHeader =
      req.headers.get("authorization") || req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: jsonHeaders },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers: jsonHeaders },
      );
    }

    const token = authHeader.replace(/^Bearer\s+/i, "");
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: jsonHeaders },
      );
    }

    const userId = user.id;
    const usageTracker = new UsageTrackingService(supabase);

    // Get profile plan
    const { data: profile } = await supabase
      .from("profiles")
      .select("plan")
      .eq("id", userId)
      .maybeSingle();

    const plan = profile?.plan ?? "free";

    // Fetch monthly usage + plan limits in parallel
    const [monthlyUsage, planLimits] = await Promise.all([
      usageTracker.getMonthlyUsage(userId),
      usageTracker.getPlanLimits(plan),
    ]);

    const usage = {
      ai_message: monthlyUsage["ai_message"] ?? 0,
      fortnox_read: monthlyUsage["fortnox_read"] ?? 0,
      fortnox_write: monthlyUsage["fortnox_write"] ?? 0,
    };

    const limits = planLimits ?? {
      ai_messages_per_month: 50,
      fortnox_reads_per_month: 100,
      fortnox_writes_per_month: 10,
    };

    // Calculate warning ratios for any >= 0.8
    const warnings: Record<
      string,
      { ratio: number; used: number; limit: number }
    > = {};

    const checks = [
      { key: "ai_message", used: usage.ai_message, limit: limits.ai_messages_per_month },
      { key: "fortnox_read", used: usage.fortnox_read, limit: limits.fortnox_reads_per_month },
      { key: "fortnox_write", used: usage.fortnox_write, limit: limits.fortnox_writes_per_month },
    ];

    for (const check of checks) {
      if (check.limit > 0) {
        const ratio = check.used / check.limit;
        warnings[check.key] = {
          ratio: Math.round(ratio * 100) / 100,
          used: check.used,
          limit: check.limit,
        };
      }
    }

    // Calculate reset date (first of next month UTC)
    const now = new Date();
    const resetDate = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
    ).toISOString();

    return new Response(
      JSON.stringify({
        plan,
        usage,
        limits,
        warnings,
        resetDate,
      }),
      { headers: jsonHeaders },
    );
  } catch (error) {
    console.error("[get-usage] Error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

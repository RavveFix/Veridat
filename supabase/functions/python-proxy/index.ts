// Supabase Edge Function - Python API Proxy for VAT Analysis
// Validates auth and forwards requests to Railway Python API
/// <reference path="../../types/deno.d.ts" />

import { PythonAPIService, type VATAnalysisRequest } from "../../services/PythonAPIService.ts";
import { RateLimiterService } from "../../services/RateLimiterService.ts";

// @ts-expect-error - Deno npm: specifier
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-user-id",
};

interface RequestBody {
  file_data: string;      // base64 encoded Excel file
  filename: string;
  company_name: string;
  org_number: string;
  period: string;         // Format: YYYY-MM
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Parse request body
    const body: RequestBody = await req.json();

    // Validate required fields
    if (!body.file_data || !body.filename) {
      return new Response(
        JSON.stringify({ error: "file_data and filename are required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Initialize Supabase client for rate limiting
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Get user ID from header or use 'anonymous'
    const userId = req.headers.get("x-user-id") ||
                   req.headers.get("authorization")?.split(" ")[1] ||
                   "anonymous";

    console.log(`[python-proxy] Request from user: ${userId}`);

    // Check rate limit
    const rateLimiter = new RateLimiterService(supabaseAdmin);
    const rateLimit = await rateLimiter.checkAndIncrement(userId, "python-proxy");

    if (!rateLimit.allowed) {
      console.log("[python-proxy] Rate limit exceeded for user:", userId);
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

    console.log("[python-proxy] Rate limit check passed:", {
      userId,
      remaining: rateLimit.remaining,
    });

    // Initialize Python API Service
    const pythonAPI = new PythonAPIService();

    // Debug: Log received data size
    console.log("[python-proxy] Received file_data length:", body.file_data?.length || 0);
    console.log("[python-proxy] Received file_data first 50 chars:", body.file_data?.substring(0, 50));

    // Prepare request for Python API
    const vatRequest: VATAnalysisRequest = {
      file_data: body.file_data,
      filename: body.filename,
      company_name: body.company_name || "",
      org_number: body.org_number || "",
      period: body.period || new Date().toISOString().substring(0, 7), // Default to current month (YYYY-MM)
    };

    console.log("[python-proxy] Forwarding request to Python API:", {
      filename: vatRequest.filename,
      company: vatRequest.company_name,
      period: vatRequest.period,
      file_data_length: vatRequest.file_data.length,
    });

    // Call Python API for VAT analysis
    const vatReport = await pythonAPI.analyzeVAT(vatRequest);

    console.log("[python-proxy] Successfully received VAT report");

    // Return the result to frontend
    return new Response(JSON.stringify(vatReport), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });

  } catch (error) {
    console.error("[python-proxy] Error:", error);

    // Preserve error details from Python API for better debugging
    let errorResponse: {
      error: string;
      message: string;
      details?: any;
      source?: string;
    };

    if (error instanceof Error) {
      // Check if error message contains Python API error details
      const isPythonAPIError = error.message.includes("Python API error");

      errorResponse = {
        error: isPythonAPIError ? "python_api_error" : "internal_server_error",
        message: error.message,
        source: isPythonAPIError ? "python_api" : "edge_function",
      };

      // Try to extract status code from error message
      const statusMatch = error.message.match(/\((\d{3})\)/);
      if (statusMatch) {
        errorResponse.details = {
          status_code: parseInt(statusMatch[1]),
        };
      }
    } else {
      errorResponse = {
        error: "internal_server_error",
        message: "Unknown error",
        source: "edge_function",
      };
    }

    console.error("[python-proxy] Error response:", errorResponse);

    return new Response(JSON.stringify(errorResponse), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });
  }
});

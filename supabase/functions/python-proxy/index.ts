// Supabase Edge Function - Python API Proxy for VAT Analysis
// Validates auth and forwards requests to Railway Python API
/// <reference path="../../types/deno.d.ts" />

import { PythonAPIService, type VATAnalysisRequest } from "../../services/PythonAPIService.ts";
import { RateLimiterService } from "../../services/RateLimiterService.ts";
import { getCorsHeaders, createOptionsResponse } from "../../services/CorsService.ts";
import { createLogger } from "../../services/LoggerService.ts";

// @ts-expect-error - Deno npm: specifier
import { createClient } from "npm:@supabase/supabase-js@2";

const logger = createLogger('python-proxy');

interface RequestBody {
  file_data: string;      // base64 encoded Excel file
  filename: string;
  conversation_id?: string;
  company_name: string;
  org_number: string;
  period: string;         // Format: YYYY-MM
}

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders();

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return createOptionsResponse();
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

    // Require auth and resolve actual user id from token (don’t trust client-provided IDs)
    const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const userId = user.id;

    logger.info('Request received', { userId });

    // Check rate limit
    const rateLimiter = new RateLimiterService(supabaseAdmin);
    const rateLimit = await rateLimiter.checkAndIncrement(userId, "python-proxy");

    if (!rateLimit.allowed) {
      logger.warn('Rate limit exceeded', { userId });
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

    logger.info('Rate limit check passed', { userId, remaining: rateLimit.remaining });

    // Initialize Python API Service
    const pythonAPI = new PythonAPIService();

    // Debug: Log received data size
    logger.debug('File data received', {
      length: body.file_data?.length || 0,
      preview: body.file_data?.substring(0, 50)
    });

    // Prepare request for Python API
    const vatRequest: VATAnalysisRequest = {
      file_data: body.file_data,
      filename: body.filename,
      company_name: body.company_name || "",
      org_number: body.org_number || "",
      period: body.period || new Date().toISOString().substring(0, 7), // Default to current month (YYYY-MM)
    };

    logger.info('Forwarding to Python API', {
      filename: vatRequest.filename,
      company: vatRequest.company_name,
      period: vatRequest.period,
      file_data_length: vatRequest.file_data.length,
    });

    // Call Python API for VAT analysis
    const vatReport = await pythonAPI.analyzeVAT(vatRequest);

    logger.info('VAT report received successfully');

    // Save to database if we have a real user id + conversation id
    if (userId && body.conversation_id) {
      type VatReportData = {
        period?: string;
        company?: { name?: string; org_number?: string };
        summary?: unknown;
        vat?: unknown;
        [key: string]: unknown;
      };

      type VatReportResponse = {
        type?: string;
        data?: VatReportData;
        [key: string]: unknown;
      };

      const typedReport = vatReport as unknown as VatReportResponse;
      const reportData = typedReport.data;
      const companyName = reportData?.company?.name || body.company_name || '';
      const orgNumber = reportData?.company?.org_number || body.org_number || '';

      const normalizedReportData = reportData
        ? { ...reportData, company_name: companyName, org_number: orgNumber }
        : typedReport;

      const { error: dbError } = await supabaseAdmin
        .from('vat_reports')
        .insert({
          user_id: userId,
          conversation_id: body.conversation_id,
          period: reportData?.period || body.period,
          company_name: companyName,
          report_data: normalizedReportData,
          source_filename: body.filename
        });

      if (dbError) {
        logger.warn('Failed to save report', { error: dbError });
      }
    }

    // Return the result to frontend
    return new Response(JSON.stringify(vatReport), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });

  } catch (error) {
    logger.error('Request failed', error);

    // Preserve error details from Python API for better debugging
    let errorResponse: {
      error: string;
      message: string;
      details?: { status_code: number };
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

    logger.error('Sending error response', undefined, errorResponse);

    return new Response(JSON.stringify(errorResponse), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });
  }
});

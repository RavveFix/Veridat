// PythonAPIService - Handles communication with Python FastAPI backend on Railway
/// <reference path="../types/deno.d.ts" />

export interface VATAnalysisRequest {
  file_data: string;      // base64 encoded Excel file
  filename: string;
  company_name: string;
  org_number: string;
  period: string;         // Format: YYYY-MM
}

export interface VATReportResponse {
  type: "vat_report";
  data: {
    type: string;
    period: string;
    company: {
      name: string;
      org_number: string;
    };
    summary: {
      total_income: number;
      total_costs: number;
      result: number;
    };
    sales: Array<{
      description: string;
      net: number;
      vat: number;
      rate: number;
    }>;
    costs: Array<{
      description: string;
      net: number;
      vat: number;
      rate: number;
    }>;
    vat: {
      outgoing_25: number;
      outgoing_12: number;
      outgoing_6: number;
      incoming: number;
      net: number;
      to_pay: number;
      to_refund: number;
    };
    journal_entries: Array<{
      account: string;
      name: string;
      debit: number;
      credit: number;
    }>;
    validation: {
      is_valid: boolean;
      errors: Array<{ field: string; message: string; severity: string }>;
      warnings: Array<{ field: string; message: string; severity: string }>;
    };
  };
}

export class PythonAPIService {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    // Get from environment variable, fallback to provided URL or error
    this.baseUrl = baseUrl || Deno.env.get("PYTHON_API_URL") || "";

    if (!this.baseUrl) {
      throw new Error("PYTHON_API_URL environment variable not set");
    }

    // Remove trailing slash if present
    this.baseUrl = this.baseUrl.replace(/\/$/, "");
  }

  /**
   * Analyze Excel file and generate Swedish VAT report
   * Includes retry logic for Railway cold starts
   */
  async analyzeVAT(request: VATAnalysisRequest): Promise<VATReportResponse> {
    const url = `${this.baseUrl}/api/v1/vat/analyze`;
    const maxRetries = 3;
    let lastError: Error | null = null;

    console.log(`[PythonAPIService] Calling VAT analysis: ${url}`);

    // Retry loop for handling Railway cold starts
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[PythonAPIService] Attempt ${attempt}/${maxRetries}`);

        // Prepare headers with optional API key
        const apiKey = Deno.env.get("PYTHON_API_KEY");
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (apiKey) {
          headers["X-API-Key"] = apiKey;
        }

        const response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(request),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(
            `[PythonAPIService] API error (${response.status}):`,
            errorText
          );

          throw new Error(
            `Python API error (${response.status}): ${errorText || response.statusText}`
          );
        }

        const data: VATReportResponse = await response.json();

        console.log(`[PythonAPIService] ✅ Success on attempt ${attempt}`);
        console.log(`- Sales transactions: ${data.data.sales.length}`);
        console.log(`- Cost transactions: ${data.data.costs.length}`);
        console.log(`- Net VAT: ${data.data.vat.net} SEK`);
        console.log(
          `- Validation: ${data.data.validation.is_valid ? "PASS" : "FAIL"}`
        );

        return data;
      } catch (error) {
        lastError = error as Error;
        console.warn(
          `[PythonAPIService] ❌ Attempt ${attempt}/${maxRetries} failed:`,
          error instanceof Error ? error.message : error
        );

        // If this was the last attempt, don't retry
        if (attempt === maxRetries) {
          break;
        }

        // Exponential backoff: 1s, 2s, 4s
        const delayMs = 1000 * Math.pow(2, attempt - 1);
        console.log(
          `[PythonAPIService] ⏳ Waiting ${delayMs}ms before retry...`
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    // All retries exhausted
    console.error(
      "[PythonAPIService] ❌ All retries exhausted. Failed to analyze VAT."
    );
    throw lastError || new Error("Failed to analyze VAT after multiple attempts");
  }

  /**
   * Health check for Python API
   */
  async healthCheck(): Promise<{ status: string; service: string }> {
    const url = `${this.baseUrl}/health`;

    try {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Health check failed: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error("[PythonAPIService] Health check failed:", error);
      throw error;
    }
  }
}

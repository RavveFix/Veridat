/// <reference path="../types/deno.d.ts" />

import { createClient } from "npm:@supabase/supabase-js@2";
import { GoogleGenerativeAI } from "npm:@google/generative-ai";
import {
    getCorsHeaders,
    createOptionsResponse,
    isOriginAllowed,
    createForbiddenOriginResponse,
} from "../../services/CorsService.ts";
import { RateLimiterService } from "../../services/RateLimiterService.ts";
import { createLogger } from "../../services/LoggerService.ts";

const logger = createLogger("receipt-inbox");

const JSON_HEADERS = { "Content-Type": "application/json" };

// ~7 MB raw (base64 is ~33% larger, so 9.5 MB base64 ≈ 7.1 MB raw)
// Kept below the 10 MB security limit from the security policy
const MAX_BASE64_LENGTH = 9_500_000;

const ALLOWED_MIME_TYPES = new Set([
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
]);

interface FileData {
    mimeType: string;
    data: string; // base64 encoded
}

interface RequestBody {
    companyId: string;
    fileName: string;
    fileData: FileData;
    // Optional — set if the file was pre-uploaded to Supabase Storage by the client
    filePath?: string;
    fileUrl?: string;
    fileBucket?: string;
}

// Structured extraction prompt in Swedish — low temperature for accuracy
const RECEIPT_EXTRACTION_PROMPT = `Du är en expert på att extrahera data från svenska kvitton och fakturor.

Analysera bifogat kvitto/bifogad faktura och extrahera all relevant information.
Svara ENBART med ett JSON-objekt enligt schemat nedan. Använd null för fält som inte kan hittas.

Momssatser i Sverige:
- 25%: de flesta varor och tjänster (standardsats)
- 12%: mat, livsmedel, restaurang, hotell
- 6%: böcker, tidningar, persontransport, konserter
- 0%: finansiella tjänster, vissa medicinska tjänster, export

Vanliga BAS-konton för kostnader:
- 5010: Lokalkostnader
- 5460: Förbrukningsinventarier
- 6110: Kontorsmateriel
- 6212: Representation
- 6230: Datakommunikation
- 6310: Företagsförsäkringar
- 6570: Bankkostnader och avgifter
- 5800: Resekostnader
- 5830: Kost och logi, tjänsteresa
- 6420: Tidningar och facklitteratur
- 6540: IT-tjänster och programvara
- 6720: Frakt och porto

Svara med exakt detta JSON-format:
{
  "merchant_name": "Leverantörens eller butikens namn",
  "transaction_date": "YYYY-MM-DD eller null",
  "transaction_time": "HH:MM eller tom sträng",
  "total_amount": nummer inklusive moms, eller null,
  "vat_amount": momsbelopp som nummer, eller null,
  "vat_rate": momssats i procent (25, 12, 6 eller 0), eller null,
  "payment_method": "kort/kontant/swish/faktura eller tom sträng",
  "currency": "SEK eller annan valutakod",
  "receipt_number": "kvitto- eller fakturanummer eller tom sträng",
  "category": "kort kategori på svenska, t.ex. livsmedel, transport, kontorsmaterial",
  "description": "kort beskrivning av vad som köptes, max 200 tecken",
  "bas_account": "BAS-kontonummer som sträng, t.ex. 6110",
  "bas_account_name": "kontonamn på svenska, t.ex. Kontorsmateriel"
}`;

function safeStr(val: unknown): string {
    return typeof val === "string" ? val : "";
}

function safeNum(val: unknown): number | null {
    if (typeof val === "number" && isFinite(val)) return val;
    if (typeof val === "string") {
        const n = parseFloat(val);
        if (!isNaN(n) && isFinite(n)) return n;
    }
    return null;
}

function safeDate(val: unknown): string | null {
    if (typeof val !== "string" || !val) return null;
    // YYYY-MM-DD validation
    if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) return null;
    const d = new Date(val);
    if (isNaN(d.getTime())) return null;
    return val;
}

Deno.serve(async (req: Request) => {
    const requestOrigin = req.headers.get("origin") || req.headers.get("Origin");
    const corsHeaders = getCorsHeaders(requestOrigin);

    if (req.method === "OPTIONS") {
        return createOptionsResponse(req);
    }

    if (requestOrigin && !isOriginAllowed(requestOrigin)) {
        return createForbiddenOriginResponse(requestOrigin);
    }

    try {
        if (req.method !== "POST") {
            return new Response(
                JSON.stringify({ error: "Method not allowed" }),
                { status: 405, headers: { ...corsHeaders, ...JSON_HEADERS } }
            );
        }

        // ── Auth ──────────────────────────────────────────────────────────────
        const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
        if (!authHeader) {
            return new Response(
                JSON.stringify({ error: "Unauthorized" }),
                { status: 401, headers: { ...corsHeaders, ...JSON_HEADERS } }
            );
        }

        const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
        const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
        const geminiApiKey = Deno.env.get("GEMINI_API_KEY") ?? "";

        if (!supabaseUrl || !supabaseServiceKey) {
            return new Response(
                JSON.stringify({ error: "Server configuration error" }),
                { status: 500, headers: { ...corsHeaders, ...JSON_HEADERS } }
            );
        }

        const token = authHeader.replace(/^Bearer\s+/i, "");
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
        const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
        if (userError || !user) {
            return new Response(
                JSON.stringify({ error: "Unauthorized" }),
                { status: 401, headers: { ...corsHeaders, ...JSON_HEADERS } }
            );
        }

        const userId = user.id;

        // ── Rate limiting ─────────────────────────────────────────────────────
        const isLocal = supabaseUrl.includes("127.0.0.1") || supabaseUrl.includes("localhost");
        const rateLimiter = new RateLimiterService(
            supabaseAdmin,
            isLocal
                ? { requestsPerHour: 1000, requestsPerDay: 10000 }
                : { requestsPerHour: 30, requestsPerDay: 100 }
        );

        let rateLimit;
        try {
            rateLimit = await rateLimiter.checkAndIncrement(userId, "receipt-inbox");
        } catch (err) {
            logger.error("Rate limiter error", { error: err instanceof Error ? err.message : String(err) });
            // Fail open for rate limiter errors (non-state-changing read path)
            rateLimit = { allowed: true, remaining: 0, message: "", resetAt: new Date() };
        }

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
                        ...JSON_HEADERS,
                        "X-RateLimit-Remaining": String(rateLimit.remaining),
                        "X-RateLimit-Reset": rateLimit.resetAt.toISOString(),
                    },
                }
            );
        }

        // ── Parse and validate body ───────────────────────────────────────────
        let body: RequestBody;
        try {
            body = await req.json();
        } catch {
            return new Response(
                JSON.stringify({ error: "Ogiltig JSON i anropet" }),
                { status: 400, headers: { ...corsHeaders, ...JSON_HEADERS } }
            );
        }

        // Validate companyId
        const companyId = typeof body.companyId === "string" ? body.companyId.trim() : "";
        if (!companyId) {
            return new Response(
                JSON.stringify({ error: "companyId krävs" }),
                { status: 400, headers: { ...corsHeaders, ...JSON_HEADERS } }
            );
        }

        // Verify the company belongs to this user (never trust client-supplied companyId alone)
        const { data: companyRow, error: companyError } = await supabaseAdmin
            .from("companies")
            .select("id")
            .eq("user_id", userId)
            .eq("id", companyId)
            .maybeSingle();

        if (companyError || !companyRow) {
            return new Response(
                JSON.stringify({ error: "Ogiltigt companyId" }),
                { status: 403, headers: { ...corsHeaders, ...JSON_HEADERS } }
            );
        }

        // Validate fileName — sanitize to prevent header injection
        const fileName = typeof body.fileName === "string"
            ? body.fileName.replace(/[\n\r]/g, "").trim().substring(0, 255)
            : "";
        if (!fileName) {
            return new Response(
                JSON.stringify({ error: "fileName krävs" }),
                { status: 400, headers: { ...corsHeaders, ...JSON_HEADERS } }
            );
        }

        // Validate fileData
        const fileData = body.fileData;
        if (!fileData || typeof fileData.mimeType !== "string" || typeof fileData.data !== "string") {
            return new Response(
                JSON.stringify({ error: "fileData med mimeType och data krävs" }),
                { status: 400, headers: { ...corsHeaders, ...JSON_HEADERS } }
            );
        }

        const mimeType = fileData.mimeType.toLowerCase().trim();
        if (!ALLOWED_MIME_TYPES.has(mimeType)) {
            return new Response(
                JSON.stringify({ error: "Filtypen stöds inte. Tillåtna typer: PDF, PNG, JPG, WEBP" }),
                { status: 400, headers: { ...corsHeaders, ...JSON_HEADERS } }
            );
        }

        if (fileData.data.length > MAX_BASE64_LENGTH) {
            return new Response(
                JSON.stringify({ error: "Filen är för stor. Max 7 MB." }),
                { status: 400, headers: { ...corsHeaders, ...JSON_HEADERS } }
            );
        }

        // Optional storage metadata (pre-uploaded by client)
        const filePath = typeof body.filePath === "string"
            ? body.filePath.replace(/[\n\r]/g, "").substring(0, 500)
            : "";
        const fileUrl = typeof body.fileUrl === "string"
            ? body.fileUrl.replace(/[\n\r]/g, "").substring(0, 1000)
            : "";
        const fileBucket = typeof body.fileBucket === "string"
            ? body.fileBucket.replace(/[\n\r]/g, "").substring(0, 100)
            : "";

        logger.info("Receipt upload received", {
            userId,
            companyId,
            fileName: fileName.substring(0, 80), // Log max 80 chars, no PII
            mimeType,
        });

        // ── Gemini AI extraction ───────────────────────────────────────────────
        let extractedData: Record<string, unknown> = {};
        let aiRawResponse = "";
        let aiExtracted = false;

        if (geminiApiKey) {
            try {
                const genAI = new GoogleGenerativeAI(geminiApiKey);
                // Use Flash for multimodal receipt OCR — Flash-Lite lacks sufficient vision quality
                const modelName = "gemini-2.0-flash";
                const model = genAI.getGenerativeModel({
                    model: modelName,
                    generationConfig: {
                        responseMimeType: "application/json",
                        temperature: 0.1,
                        maxOutputTokens: 1024,
                    },
                });

                const result = await model.generateContent({
                    contents: [{
                        role: "user",
                        parts: [
                            {
                                inlineData: {
                                    mimeType: fileData.mimeType,
                                    data: fileData.data,
                                },
                            },
                            { text: RECEIPT_EXTRACTION_PROMPT },
                        ],
                    }],
                });

                const responseText = result.response.text();
                aiRawResponse = responseText;

                try {
                    extractedData = JSON.parse(responseText);
                    aiExtracted = true;
                    logger.info("Receipt AI extraction successful", {
                        merchantName: typeof extractedData.merchant_name === "string"
                            ? extractedData.merchant_name.substring(0, 50)
                            : "unknown",
                    });
                } catch {
                    logger.error("Failed to parse Gemini JSON response", {
                        preview: responseText.substring(0, 200),
                    });
                }
            } catch (aiErr) {
                logger.error("Gemini extraction failed", {
                    error: aiErr instanceof Error ? aiErr.message : String(aiErr),
                });
                // Non-fatal: save receipt without AI data, user can fill in manually
            }
        } else {
            logger.warn("GEMINI_API_KEY not set — skipping AI extraction");
        }

        // ── Insert receipt record ─────────────────────────────────────────────
        const itemId = crypto.randomUUID();

        const receiptItem = {
            user_id: userId,
            company_id: companyId,
            id: itemId,
            file_name: fileName,
            file_url: fileUrl,
            file_path: filePath,
            file_bucket: fileBucket,
            status: "ny",
            source: "upload",
            merchant_name: safeStr(extractedData.merchant_name),
            transaction_date: safeDate(extractedData.transaction_date),
            transaction_time: safeStr(extractedData.transaction_time),
            total_amount: safeNum(extractedData.total_amount),
            vat_amount: safeNum(extractedData.vat_amount),
            vat_rate: safeNum(extractedData.vat_rate),
            payment_method: safeStr(extractedData.payment_method),
            category: safeStr(extractedData.category),
            description: safeStr(extractedData.description).substring(0, 500),
            receipt_number: safeStr(extractedData.receipt_number),
            currency: safeStr(extractedData.currency) || "SEK",
            bas_account: safeStr(extractedData.bas_account),
            bas_account_name: safeStr(extractedData.bas_account_name),
            fortnox_voucher_series: "",
            fortnox_voucher_number: null,
            fortnox_sync_status: "not_exported",
            ai_extracted: aiExtracted,
            // Truncate raw response to avoid oversized DB entries
            ai_raw_response: aiRawResponse.substring(0, 10_000),
            ai_review_note: "",
        };

        const { data: insertedItem, error: insertError } = await supabaseAdmin
            .from("receipt_inbox_items")
            .insert(receiptItem)
            .select()
            .single();

        if (insertError) {
            logger.error("Failed to insert receipt item", { error: insertError.message });
            return new Response(
                JSON.stringify({ error: "Kunde inte spara kvitto. Försök igen." }),
                { status: 500, headers: { ...corsHeaders, ...JSON_HEADERS } }
            );
        }

        // ── Audit event (non-blocking) ────────────────────────────────────────
        supabaseAdmin
            .from("receipt_inbox_events")
            .insert({
                user_id: userId,
                company_id: companyId,
                item_id: itemId,
                event_type: "uploaded",
                previous_status: null,
                new_status: "ny",
                payload: {
                    mimeType,
                    aiExtracted,
                    // Only log merchant name — not amount or other financial PII
                    merchantName: safeStr(extractedData.merchant_name).substring(0, 100),
                },
            })
            .then(({ error }) => {
                if (error) {
                    logger.error("Failed to insert receipt audit event", { error: error.message });
                }
            });

        logger.info("Receipt created successfully", { itemId, userId, companyId });

        return new Response(
            JSON.stringify({ success: true, item: insertedItem }),
            { status: 201, headers: { ...corsHeaders, ...JSON_HEADERS } }
        );
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        logger.error("Receipt inbox unhandled error", { error: errorMessage });
        return new Response(
            JSON.stringify({ error: "Något gick fel. Försök igen." }),
            { status: 500, headers: { ...corsHeaders, ...JSON_HEADERS } }
        );
    }
});

// Receipt Inbox Edge Function
// Handles receipt/invoice upload, AI extraction, and Fortnox export
// DB: receipt_inbox_items + receipt_inbox_events (see migration 20260221000001)
/// <reference path="../types/deno.d.ts" />

import { createClient } from "npm:@supabase/supabase-js@2";
import { GoogleGenerativeAI } from "npm:@google/generative-ai@0.24.0";
import { createLogger } from "../../services/LoggerService.ts";
import {
  createForbiddenOriginResponse,
  createOptionsResponse,
  getCorsHeaders,
  isOriginAllowed,
} from "../../services/CorsService.ts";
import { getEnv } from "../gemini-chat/utils.ts";

const logger = createLogger("receipt-inbox");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReceiptExtraction {
  merchant_name: string;
  transaction_date: string | null; // YYYY-MM-DD
  transaction_time: string;
  total_amount: number | null;
  vat_amount: number | null;
  vat_rate: number | null; // 25, 12, 6, or 0
  payment_method: string;
  category: string;
  description: string;
  receipt_number: string;
  currency: string;
  bas_account: string;
  bas_account_name: string;
  is_reverse_charge: boolean;
  confidence: number; // 0-1
  notes: string; // AI notes about ambiguities
}

interface ReceiptInboxItem {
  id: string;
  user_id: string;
  company_id: string;
  file_name: string;
  file_url: string;
  file_path: string;
  file_bucket: string;
  uploaded_at: string;
  status: "ny" | "granskad" | "bokford";
  source: "upload" | "manual";
  merchant_name: string;
  transaction_date: string | null;
  transaction_time: string;
  total_amount: number | null;
  vat_amount: number | null;
  vat_rate: number | null;
  payment_method: string;
  category: string;
  description: string;
  receipt_number: string;
  currency: string;
  bas_account: string;
  bas_account_name: string;
  fortnox_voucher_series: string;
  fortnox_voucher_number: number | null;
  fortnox_sync_status: "not_exported" | "exported" | "booked";
  ai_extracted: boolean;
  ai_raw_response: string;
  ai_review_note: string;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Gemini extraction prompt
// ---------------------------------------------------------------------------

const EXTRACTION_PROMPT = `Du är en expert på svensk bokföring. Analysera detta kvitto/faktura och extrahera all relevant information.

Svara EXAKT i detta JSON-format (utan markdown, bara ren JSON):
{
  "merchant_name": "Leverantörens/butikens namn",
  "transaction_date": "YYYY-MM-DD eller null om oklart",
  "transaction_time": "HH:MM eller tom sträng",
  "total_amount": 123.45,
  "vat_amount": 24.69,
  "vat_rate": 25,
  "payment_method": "Kort/Kontant/Swish/Faktura eller tom",
  "category": "Mat/Resor/IT/Kontorsmaterial/Telefon/Representation etc",
  "description": "Kort beskrivning av köpet",
  "receipt_number": "Kvitto/fakturanummer eller tom",
  "currency": "SEK",
  "bas_account": "5010",
  "bas_account_name": "Förbrukningsinventarier och förbrukningsmaterial",
  "is_reverse_charge": false,
  "confidence": 0.95,
  "notes": "Eventuella osäkerheter eller noteringar"
}

BAS-kontoguide:
- Mat/livsmedel: 5010, Förbrukningsmat
- Restaurang/representation: 6072, Representation
- IT/programvara/SaaS: 6540, IT-kostnader
- Telefon/mobilabonnemang: 6212, Telefon och fax
- Resor/taxi/flyg: 5810, Resekostnader
- Hotell: 5830, Logi
- Bensin/diesel: 5611, Drivmedel
- Porto/frakt: 6230, Post och frakt
- Kontorsmaterial: 6110, Kontorsmaterial
- Facklitteratur/böcker: 6230, Trycksaker
- Hyreskostnad/lokal: 5010, Hyra
- Verktyg/maskiner: 5400, Förbrukningsinventarier
- El/vatten: 5020, Lokalkostnader
- EU-faktura utan moms: is_reverse_charge=true, vat_rate=0
- Momssats: 25% (standard), 12% (mat, hotell), 6% (böcker, kollektivtrafik), 0% (export/EU)

VIKTIGT:
- Om valutan INTE är SEK, ange originalvalutan (EUR, USD etc)
- Ange alltid totalbelopp inkl. moms i total_amount
- Om momsen inte framgår tydligt, beräkna: 25% moms = total/1.25 * 0.25
- confidence: 0.9+ om allt är tydligt, 0.7-0.9 om något är osäkert, under 0.7 om du gissar`;

// ---------------------------------------------------------------------------
// AI extraction
// ---------------------------------------------------------------------------

async function extractReceiptData(
  fileData: { data: string; mimeType: string },
  fileName: string,
): Promise<{ extraction: ReceiptExtraction; rawResponse: string }> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured");

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: Deno.env.get("GEMINI_MODEL") || "gemini-3-flash-preview",
    generationConfig: { temperature: 0.1, maxOutputTokens: 1024 },
  });

  const result = await model.generateContent({
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: fileData.mimeType, data: fileData.data } },
          { text: `${EXTRACTION_PROMPT}\n\nFil: ${fileName}` },
        ],
      },
    ],
  });

  const rawResponse = result.response.text().trim();

  // Strip markdown code fences if present
  const jsonText = rawResponse
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  let extraction: ReceiptExtraction;
  try {
    extraction = JSON.parse(jsonText) as ReceiptExtraction;
  } catch {
    logger.warn("Failed to parse Gemini JSON response, using defaults", {
      rawResponse: rawResponse.substring(0, 200),
    });
    extraction = {
      merchant_name: fileName.replace(/\.[^.]+$/, ""),
      transaction_date: new Date().toISOString().slice(0, 10),
      transaction_time: "",
      total_amount: null,
      vat_amount: null,
      vat_rate: 25,
      payment_method: "",
      category: "",
      description: "Kvitto — manuell granskning krävs",
      receipt_number: "",
      currency: "SEK",
      bas_account: "5010",
      bas_account_name: "Förbrukningsinventarier",
      is_reverse_charge: false,
      confidence: 0.3,
      notes: "AI-parsning misslyckades. Kontrollera uppgifterna manuellt.",
    };
  }

  // Clamp confidence
  extraction.confidence = Math.min(1, Math.max(0, extraction.confidence ?? 0.5));

  return { extraction, rawResponse };
}

// ---------------------------------------------------------------------------
// Supabase setup helpers
// ---------------------------------------------------------------------------

function getSupabaseAdmin() {
  const url = getEnv(["SUPABASE_URL", "SB_SUPABASE_URL", "API_URL"]);
  const key = getEnv(["SUPABASE_SERVICE_ROLE_KEY", "SERVICE_ROLE_KEY"]);
  if (!url || !key) throw new Error("Supabase credentials not configured");
  return { client: createClient(url, key), url };
}

async function requireUser(
  supabase: ReturnType<typeof createClient>,
  authHeader: string,
) {
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) throw new Error("Unauthorized");
  return user;
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

async function handleUpload(
  body: Record<string, unknown>,
  userId: string,
  supabaseAdmin: ReturnType<typeof createClient>,
  supabaseUrl: string,
): Promise<Record<string, unknown>> {
  const fileData = body.fileData as { data: string; mimeType: string } | undefined;
  const fileName = (body.fileName as string | undefined) ?? "kvitto.pdf";
  const companyId = body.companyId as string | undefined;

  if (!fileData?.data || !fileData?.mimeType) {
    throw new Error("fileData.data och fileData.mimeType krävs");
  }
  if (!companyId) {
    throw new Error("companyId krävs");
  }

  // Validate file type
  const supportedTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif", "application/pdf"];
  if (!supportedTypes.includes(fileData.mimeType)) {
    throw new Error(`Filtyp stöds ej: ${fileData.mimeType}. Tillåtna: PDF, PNG, JPG, WEBP, GIF`);
  }

  // Validate base64 size (max 10 MB decoded)
  const estimatedBytes = (fileData.data.length * 3) / 4;
  if (estimatedBytes > 10 * 1024 * 1024) {
    throw new Error("Filen överstiger maxgränsen på 10 MB");
  }

  // Upload to Supabase Storage (chat-files bucket, same as chat uploads)
  const timestamp = Date.now();
  const safeFileName = fileName.replace(/[^a-zA-Z0-9.\-]/g, "_");
  const filePath = `${userId}/${companyId}/receipt_inbox/${timestamp}_${safeFileName}`;

  const fileBytes = Uint8Array.from(atob(fileData.data), (c) => c.charCodeAt(0));
  const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
    .from("chat-files")
    .upload(filePath, fileBytes, {
      contentType: fileData.mimeType,
      upsert: false,
    });

  if (uploadError || !uploadData) {
    logger.error("Storage upload failed", { error: uploadError?.message });
    throw new Error(`Filuppladdning misslyckades: ${uploadError?.message}`);
  }

  // Get a long-lived signed URL (7 days) for display
  const { data: signedData } = await supabaseAdmin.storage
    .from("chat-files")
    .createSignedUrl(filePath, 7 * 24 * 3600);

  const fileUrl = signedData?.signedUrl ?? `${supabaseUrl}/storage/v1/object/sign/chat-files/${filePath}`;

  // Run AI extraction
  logger.info("Running Gemini extraction", { fileName, mimeType: fileData.mimeType });
  const { extraction, rawResponse } = await extractReceiptData(fileData, fileName);
  logger.info("Extraction complete", {
    merchant: extraction.merchant_name,
    total: extraction.total_amount,
    confidence: extraction.confidence,
  });

  // Build item to save
  const itemId = crypto.randomUUID();
  const item = {
    id: itemId,
    user_id: userId,
    company_id: companyId,
    file_name: fileName,
    file_url: fileUrl,
    file_path: filePath,
    file_bucket: "chat-files",
    status: "ny" as const,
    source: "upload" as const,
    merchant_name: extraction.merchant_name || "",
    transaction_date: extraction.transaction_date ?? null,
    transaction_time: extraction.transaction_time || "",
    total_amount: extraction.total_amount ?? null,
    vat_amount: extraction.vat_amount ?? null,
    vat_rate: extraction.vat_rate ?? null,
    payment_method: extraction.payment_method || "",
    category: extraction.category || "",
    description: extraction.description || "",
    receipt_number: extraction.receipt_number || "",
    currency: extraction.currency || "SEK",
    bas_account: extraction.bas_account || "5010",
    bas_account_name: extraction.bas_account_name || "",
    fortnox_voucher_series: "",
    fortnox_voucher_number: null,
    fortnox_sync_status: "not_exported" as const,
    ai_extracted: true,
    ai_raw_response: rawResponse.substring(0, 5000),
    ai_review_note: extraction.notes || "",
  };

  const { data: savedItem, error: insertError } = await supabaseAdmin
    .from("receipt_inbox_items")
    .insert(item)
    .select()
    .single();

  if (insertError) {
    logger.error("Failed to save receipt item", { error: insertError.message });
    throw new Error(`Kunde inte spara kvittot: ${insertError.message}`);
  }

  // Log event
  void supabaseAdmin.from("receipt_inbox_events").insert({
    user_id: userId,
    company_id: companyId,
    item_id: itemId,
    event_type: "uploaded",
    new_status: "ny",
    payload: {
      file_name: fileName,
      confidence: extraction.confidence,
      ai_extracted: true,
    },
  });

  return {
    success: true,
    item: savedItem ?? item,
    extraction,
    needs_review: extraction.confidence < 0.75,
  };
}

async function handleList(
  body: Record<string, unknown>,
  userId: string,
  supabaseAdmin: ReturnType<typeof createClient>,
): Promise<Record<string, unknown>> {
  const companyId = body.companyId as string | undefined;
  const status = body.status as string | undefined;
  const limit = Math.min((body.limit as number | undefined) ?? 50, 200);

  if (!companyId) throw new Error("companyId krävs");

  let query = supabaseAdmin
    .from("receipt_inbox_items")
    .select("*")
    .eq("user_id", userId)
    .eq("company_id", companyId)
    .order("uploaded_at", { ascending: false })
    .limit(limit);

  if (status && status !== "all") {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Kunde inte hämta kvitton: ${error.message}`);

  return { success: true, items: data ?? [], count: (data ?? []).length };
}

async function handleGet(
  body: Record<string, unknown>,
  userId: string,
  supabaseAdmin: ReturnType<typeof createClient>,
): Promise<Record<string, unknown>> {
  const itemId = body.itemId as string | undefined;
  const companyId = body.companyId as string | undefined;

  if (!itemId || !companyId) throw new Error("itemId och companyId krävs");

  const { data, error } = await supabaseAdmin
    .from("receipt_inbox_items")
    .select("*")
    .eq("user_id", userId)
    .eq("company_id", companyId)
    .eq("id", itemId)
    .single();

  if (error || !data) throw new Error("Kvittot hittades inte");

  return { success: true, item: data };
}

async function handleUpdateStatus(
  body: Record<string, unknown>,
  userId: string,
  supabaseAdmin: ReturnType<typeof createClient>,
): Promise<Record<string, unknown>> {
  const itemId = body.itemId as string | undefined;
  const companyId = body.companyId as string | undefined;
  const newStatus = body.status as string | undefined;
  const reviewNote = body.review_note as string | undefined;

  if (!itemId || !companyId) throw new Error("itemId och companyId krävs");

  const validStatuses = ["ny", "granskad", "bokford"];
  if (!newStatus || !validStatuses.includes(newStatus)) {
    throw new Error(`Ogiltig status. Giltiga: ${validStatuses.join(", ")}`);
  }

  const updates: Record<string, unknown> = { status: newStatus };
  if (reviewNote !== undefined) updates.ai_review_note = reviewNote;

  const { data, error } = await supabaseAdmin
    .from("receipt_inbox_items")
    .update(updates)
    .eq("user_id", userId)
    .eq("company_id", companyId)
    .eq("id", itemId)
    .select()
    .single();

  if (error) throw new Error(`Statusuppdatering misslyckades: ${error.message}`);

  void supabaseAdmin.from("receipt_inbox_events").insert({
    user_id: userId,
    company_id: companyId,
    item_id: itemId,
    event_type: "status_updated",
    new_status: newStatus,
    payload: { review_note: reviewNote },
  });

  return { success: true, item: data };
}

async function handleExportToFortnox(
  body: Record<string, unknown>,
  userId: string,
  supabaseAdmin: ReturnType<typeof createClient>,
  supabaseUrl: string,
  authHeader: string,
): Promise<Record<string, unknown>> {
  const itemId = body.itemId as string | undefined;
  const companyId = body.companyId as string | undefined;

  if (!itemId || !companyId) throw new Error("itemId och companyId krävs");

  // Fetch the receipt item
  const { data: item, error: fetchError } = await supabaseAdmin
    .from("receipt_inbox_items")
    .select("*")
    .eq("user_id", userId)
    .eq("company_id", companyId)
    .eq("id", itemId)
    .single<ReceiptInboxItem>();

  if (fetchError || !item) throw new Error("Kvittot hittades inte");
  if (item.fortnox_sync_status === "exported" || item.fortnox_sync_status === "booked") {
    return { success: false, error: "Kvittot är redan exporterat till Fortnox" };
  }
  if (!item.total_amount) throw new Error("Totalbelopp saknas — granska kvittot och ange belopp");

  const vatRate = item.vat_rate ?? 25;
  const vatMul = 1 + vatRate / 100;
  const net = Math.round((item.total_amount / vatMul) * 100) / 100;
  const vat = Math.round((item.total_amount - net) * 100) / 100;
  const transactionDate = item.transaction_date ?? new Date().toISOString().slice(0, 10);

  // Build voucher rows
  const voucherRows = [
    {
      Account: Number(item.bas_account) || 5010,
      Debit: net,
      Credit: 0,
      Description: item.description || item.merchant_name,
    },
    ...(vat > 0 ? [{
      Account: 2640, // Ingående moms
      Debit: vat,
      Credit: 0,
      Description: `Moms ${vatRate}%`,
    }] : []),
    {
      // 1930 = bank/kortbetalning (standard), 1910 = kassa/kontant
      Account: (item.payment_method?.toLowerCase().includes("kont") ? 1910 : 1930),
      Debit: 0,
      Credit: item.total_amount,
      Description: `Betalning ${item.payment_method || ""}`.trim(),
    },
  ];

  // Call Fortnox function to create voucher
  const fortnoxResp = await fetch(`${supabaseUrl}/functions/v1/fortnox`, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "exportVoucher",
      companyId,
      payload: {
        voucher: {
          Description: `${item.merchant_name} — ${item.description || item.category}`.substring(0, 100),
          TransactionDate: transactionDate,
          VoucherSeries: "K", // Kassaverifikat
          VoucherRows: voucherRows,
        },
        idempotencyKey: `receipt_inbox:${itemId}:export`,
        sourceContext: "receipt-inbox",
      },
    }),
  });

  const fortnoxResult = await fortnoxResp.json().catch(() => ({}));
  if (!fortnoxResp.ok) {
    const detail = fortnoxResult?.error ?? fortnoxResult?.detail ?? `HTTP ${fortnoxResp.status}`;
    throw new Error(`Fortnox-export misslyckades: ${detail}`);
  }

  const voucher = (fortnoxResult as any)?.Voucher ?? fortnoxResult;
  const voucherSeries = String(voucher.VoucherSeries ?? "K");
  const voucherNumber = Number(voucher.VoucherNumber ?? 0);

  // Attach file to voucher (non-blocking)
  let attachmentNote = "";
  if (item.file_path && voucherNumber) {
    try {
      const financialYearDate = transactionDate.slice(0, 4) + "-01-01";
      const attachResp = await fetch(`${supabaseUrl}/functions/v1/fortnox`, {
        method: "POST",
        headers: { Authorization: authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "attachFileToVoucher",
          companyId,
          payload: {
            storagePath: item.file_path,
            fileName: item.file_name,
            mimeType: "application/octet-stream",
            voucherSeries,
            voucherNumber,
            financialYearDate,
            idempotencyKey: `receipt_inbox:${itemId}:attach`,
            sourceContext: "receipt-inbox",
          },
        }),
      });
      const attachResult = await attachResp.json().catch(() => ({}));
      if ((attachResult as any)?.success) {
        attachmentNote = ` med bifogat kvitto`;
      }
    } catch {
      // Non-blocking — voucher is already created
    }
  }

  // Update receipt status to 'bokford'
  await supabaseAdmin
    .from("receipt_inbox_items")
    .update({
      status: "bokford",
      fortnox_sync_status: "exported",
      fortnox_voucher_series: voucherSeries,
      fortnox_voucher_number: voucherNumber || null,
    })
    .eq("user_id", userId)
    .eq("company_id", companyId)
    .eq("id", itemId);

  void supabaseAdmin.from("receipt_inbox_events").insert({
    user_id: userId,
    company_id: companyId,
    item_id: itemId,
    event_type: "exported_to_fortnox",
    previous_status: item.fortnox_sync_status,
    new_status: "exported",
    payload: { voucher_series: voucherSeries, voucher_number: voucherNumber },
  });

  return {
    success: true,
    message: `Verifikat ${voucherSeries}${voucherNumber} skapat${attachmentNote}. Granska i Fortnox → Verifikationer.`,
    voucher_series: voucherSeries,
    voucher_number: voucherNumber,
  };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  const requestOrigin = req.headers.get("origin") ?? req.headers.get("Origin");
  const corsHeaders = getCorsHeaders(requestOrigin);

  if (req.method === "OPTIONS") {
    return createOptionsResponse(req);
  }

  if (requestOrigin && !isOriginAllowed(requestOrigin)) {
    return createForbiddenOriginResponse(requestOrigin);
  }

  const responseHeaders = {
    ...corsHeaders,
    "Content-Type": "application/json",
  };

  try {
    const authHeader = req.headers.get("authorization") ??
      req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: responseHeaders,
      });
    }

    const { client: supabaseAdmin, url: supabaseUrl } = getSupabaseAdmin();

    // Authenticate
    let user: { id: string };
    try {
      user = await requireUser(supabaseAdmin, authHeader);
    } catch {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: responseHeaders,
      });
    }

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = body.action as string | undefined;

    logger.info("Receipt inbox request", { action, userId: user.id });

    let result: Record<string, unknown>;

    switch (action) {
      case "upload":
        result = await handleUpload(body, user.id, supabaseAdmin, supabaseUrl);
        break;

      case "list":
        result = await handleList(body, user.id, supabaseAdmin);
        break;

      case "get":
        result = await handleGet(body, user.id, supabaseAdmin);
        break;

      case "update_status":
        result = await handleUpdateStatus(body, user.id, supabaseAdmin);
        break;

      case "export_to_fortnox":
        result = await handleExportToFortnox(
          body,
          user.id,
          supabaseAdmin,
          supabaseUrl,
          authHeader,
        );
        break;

      default:
        return new Response(
          JSON.stringify({
            error: "Okänd action. Giltiga: upload, list, get, update_status, export_to_fortnox",
          }),
          { status: 400, headers: responseHeaders },
        );
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: responseHeaders,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Okänt fel";
    logger.error("Receipt inbox error", { error: message });
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: responseHeaders },
    );
  }
});

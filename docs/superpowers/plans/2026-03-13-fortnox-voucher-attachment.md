# Fortnox Voucher Attachment Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically attach uploaded receipts/invoices to Fortnox vouchers when exporting journal entries via action plans.

**Architecture:** Two-step Fortnox flow (POST /3/inbox → POST /3/voucherfileconnections). Fortnox edge function fetches files directly from Supabase Storage. File reference (`source_file`) propagated through action plan metadata from gemini-chat.

**Tech Stack:** Deno (Edge Functions), Supabase Storage, Fortnox REST API v3

**Spec:** `docs/superpowers/specs/2026-03-13-fortnox-voucher-attachment-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `supabase/functions/fortnox/types.ts` | Add inbox + voucher file connection types |
| Modify | `supabase/services/FortnoxService.ts` | Add `uploadToInbox()`, `createVoucherFileConnection()` |
| Modify | `supabase/functions/fortnox/index.ts` | Add `attachFileToVoucher` action + register in maps |
| Modify | `supabase/functions/gemini-chat/index.ts` | Propagate `source_file` in action plan + call attachment after voucher export |

---

## Chunk 1: Fortnox Types + Service Methods

### Task 1: Add Fortnox file types

**Files:**
- Modify: `supabase/functions/fortnox/types.ts` (after line 158, after FortnoxVoucherListResponse)

- [ ] **Step 1: Add types to types.ts**

Add after `FortnoxVoucherListResponse` (line 158):

```typescript
// ============================================================
// Inbox & File Connections
// ============================================================

export interface FortnoxInboxFileResponse {
  File: {
    Id: string;
    Name: string;
    Size: number;
  };
}

export interface FortnoxVoucherFileConnection {
  FileId: string;
  VoucherNumber: string;
  VoucherSeries: string;
  VoucherDescription: string;
  VoucherYear: number;
}

export interface FortnoxVoucherFileConnectionResponse {
  VoucherFileConnection: FortnoxVoucherFileConnection;
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/fortnox/types.ts
git commit -m "feat(fortnox): add inbox file + voucher file connection types"
```

### Task 2: Add `uploadToInbox()` method

**Files:**
- Modify: `supabase/services/FortnoxService.ts`

- [ ] **Step 1: Add `uploadToInbox()` method**

Add before `authenticatedFetch` (before line 480). This method mirrors the auth/retry/timeout
pattern from `request()` + `authenticatedFetch` but uses `multipart/form-data` instead of JSON.

**Key patterns from the actual code:**
- `authenticatedFetch(endpoint, token, options)` receives the token as a parameter (line 483)
- `request()` calls `this.getAccessToken()` then passes the token to `authenticatedFetch` (lines 549-553)
- Error classification uses the free function `classifyFortnoxError(error, statusCode)` (line 504)
- Timeout: 30s AbortController (line 492)
- 401 retry: `forceRefreshToken()` returns a fresh token string (line 559)

```typescript
  /**
   * Upload a file to Fortnox Inbox via multipart/form-data.
   * Mirrors request()/authenticatedFetch() pattern but with FormData body.
   * Includes rate limiting, 30s timeout, error classification, and 401-retry.
   */
  async uploadToInbox(
    fileData: Uint8Array,
    fileName: string,
  ): Promise<{ Id: string; Name: string; Size: number }> {
    await this.rateLimiter.waitIfNeeded();

    const doUpload = async (token: string): Promise<{ Id: string; Name: string; Size: number }> => {
      const url = `${this.baseUrl}/inbox`;
      const formData = new FormData();
      const blob = new Blob([fileData], { type: 'application/octet-stream' });
      formData.append('file', blob, fileName);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30_000);

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            // Do NOT set Content-Type — fetch sets it automatically with boundary for FormData
          },
          body: formData,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();
          throw classifyFortnoxError(new Error(errorText), response.status);
        }

        const result = await response.json();
        return result.File;
      } catch (error) {
        clearTimeout(timeoutId);
        if (error instanceof FortnoxApiError) throw error;
        if (error instanceof Error && error.name === 'AbortError') {
          throw new FortnoxTimeoutError();
        }
        throw classifyFortnoxError(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    };

    const token = await this.getAccessToken();

    try {
      return await retryWithBackoff(async () => {
        return await doUpload(token);
      });
    } catch (error) {
      // On 401: refresh token and retry exactly once (same pattern as request())
      if (error instanceof FortnoxAuthError) {
        logger.info('Got 401 from Fortnox inbox upload, attempting token refresh and retry');
        const freshToken = await this.forceRefreshToken();
        return await doUpload(freshToken);
      }
      throw error;
    }
  }
```

- [ ] **Step 2: Verify imports**

All needed imports already exist at lines 4-6 of FortnoxService.ts:
- `classifyFortnoxError`, `FortnoxTimeoutError`, `FortnoxApiError`, `FortnoxAuthError` from `'./FortnoxErrors.ts'`
- `retryWithBackoff` from `'./RetryService.ts'`

No new imports needed.

- [ ] **Step 3: Commit**

```bash
git add supabase/services/FortnoxService.ts
git commit -m "feat(fortnox): add uploadToInbox() for multipart file upload to Fortnox"
```

### Task 3: Add `createVoucherFileConnection()` method

**Files:**
- Modify: `supabase/services/FortnoxService.ts`

- [ ] **Step 1: Add method after `uploadToInbox()`**

```typescript
  /**
   * Create a connection between an uploaded file and a voucher.
   * Uses standard request() since this is a JSON POST.
   */
  async createVoucherFileConnection(
    fileId: string,
    voucherNumber: number,
    voucherSeries: string,
    financialYearDate: string,
  ): Promise<FortnoxVoucherFileConnectionResponse> {
    return await this.request(`/voucherfileconnections?financialyeardate=${encodeURIComponent(financialYearDate)}`, {
      method: 'POST',
      body: JSON.stringify({
        VoucherFileConnection: {
          FileId: fileId,
          VoucherNumber: voucherNumber,
          VoucherSeries: voucherSeries,
        },
      }),
    });
  }
```

- [ ] **Step 2: Add import for the new type**

Ensure `FortnoxVoucherFileConnectionResponse` is imported from `../functions/fortnox/types.ts` (or wherever types are imported from — check the existing import path at the top of FortnoxService.ts).

- [ ] **Step 3: Commit**

```bash
git add supabase/services/FortnoxService.ts
git commit -m "feat(fortnox): add createVoucherFileConnection() method"
```

---

## Chunk 2: Fortnox Edge Function — New Action

### Task 4: Register `attachFileToVoucher` in action maps

**Files:**
- Modify: `supabase/functions/fortnox/index.ts`

- [ ] **Step 1: Add to `WRITE_ACTIONS_TO_OPERATION`**

At line ~57 (before the closing `}`), add:

```typescript
    attachFileToVoucher: 'attach_file_to_voucher',
```

- [ ] **Step 2: Add to `ACTIONS_REQUIRING_COMPANY_ID`**

Inside the Set (around line 67-97), add:

```typescript
    'attachFileToVoucher',
```

Note: `FAIL_CLOSED_RATE_LIMIT_ACTIONS` (line 60-65) already includes all keys from `WRITE_ACTIONS_TO_OPERATION` via the spread, so `attachFileToVoucher` is automatically included.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/fortnox/index.ts
git commit -m "feat(fortnox): register attachFileToVoucher in action maps"
```

### Task 5: Implement `attachFileToVoucher` action handler

**Files:**
- Modify: `supabase/functions/fortnox/index.ts`

- [ ] **Step 1: Add the case handler**

Add after the `exportVoucher` case (after line 1651), before the next case:

```typescript
      case 'attachFileToVoucher': {
        const storagePath = requireString(payload?.storagePath, 'payload.storagePath');
        const fileName = requireString(payload?.fileName, 'payload.fileName');
        const voucherSeries = requireString(payload?.voucherSeries, 'payload.voucherSeries');
        const voucherNumber = requireNumber(payload?.voucherNumber, 'payload.voucherNumber');
        const financialYearDate = requireString(payload?.financialYearDate, 'payload.financialYearDate');

        // 1. Download file from Supabase Storage
        const { data: fileBlob, error: downloadError } = await supabaseAdmin.storage
          .from('chat-files')
          .download(storagePath);

        if (downloadError || !fileBlob) {
          logger.error('Failed to download file from Storage', { storagePath, error: downloadError?.message });
          result = { success: false, error: `Kunde inte hämta filen: ${downloadError?.message || 'okänt fel'}` };
          break;
        }

        const fileData = new Uint8Array(await fileBlob.arrayBuffer());

        // 2. Validate file size (max 5 MB — Fortnox limit)
        const MAX_FILE_SIZE = 5 * 1024 * 1024;
        if (fileData.byteLength > MAX_FILE_SIZE) {
          logger.warn('File exceeds Fortnox 5 MB limit', { storagePath, size: fileData.byteLength });
          result = { success: false, error: `Filen överstiger Fortnox maxgräns på 5 MB (${(fileData.byteLength / 1024 / 1024).toFixed(1)} MB)` };
          break;
        }

        // 3. Upload to Fortnox Inbox
        const fortnoxService = requireFortnoxService();
        const inboxFile = await fortnoxService.uploadToInbox(fileData, fileName);
        logger.info('File uploaded to Fortnox Inbox', { fileId: inboxFile.Id, fileName: inboxFile.Name });

        // 4. Create voucher file connection
        const connection = await fortnoxService.createVoucherFileConnection(
          inboxFile.Id,
          voucherNumber,
          voucherSeries,
          financialYearDate,
        );
        logger.info('Voucher file connection created', {
          fileId: inboxFile.Id,
          voucherNumber,
          voucherSeries,
        });

        result = {
          success: true,
          fileId: inboxFile.Id,
          fileName: inboxFile.Name,
          voucherFileConnection: connection.VoucherFileConnection,
        };
        break;
      }
```

- [ ] **Step 2: Verify `requireNumber` helper exists**

Check if `requireNumber` is defined alongside `requireString` and `requireRecord`. If not, add it near those helpers:

```typescript
function requireNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || isNaN(value)) {
    throw new RequestValidationError(`${name} måste vara ett nummer`);
  }
  return value;
}
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/fortnox/index.ts
git commit -m "feat(fortnox): implement attachFileToVoucher action handler"
```

---

## Chunk 3: Gemini-Chat — Propagate File Reference + Call Attachment

### Task 6: Add helper functions to gemini-chat

**Files:**
- Modify: `supabase/functions/gemini-chat/index.ts`

- [ ] **Step 1: Add helper functions**

Add near the top of the file, after imports but before the main handler (find a suitable location near other utility functions):

```typescript
// ============================================================
// Voucher Attachment Helpers
// ============================================================

const ATTACHABLE_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp'];

interface SourceFile {
  storage_path: string;
  file_name: string;
  mime_type: string;
}

function isAttachableFile(fileName: string): boolean {
  return ATTACHABLE_EXTENSIONS.some(ext => fileName.toLowerCase().endsWith(ext));
}

function inferMimeType(fileName: string): string {
  const ext = (fileName.toLowerCase().split('.').pop() || '');
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
  };
  return map[ext] || 'application/octet-stream';
}

function extractStoragePath(fileUrl: string): string {
  try {
    const url = new URL(fileUrl);
    const match = url.pathname.match(/\/storage\/v1\/object\/sign\/chat-files\/(.+)/);
    return match ? decodeURIComponent(match[1]) : '';
  } catch {
    return '';
  }
}

// deno-lint-ignore no-explicit-any
function findSourceFile(history: any[]): SourceFile | undefined {
  // Search backwards for the most recent user message with an attachable file.
  // History objects include file_name/file_url at runtime (from messages table)
  // but these fields are not in the TS interface — use `any` like existing code (line 3661).
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role === 'user' && msg.file_name && isAttachableFile(msg.file_name) && msg.file_url) {
      const storagePath = extractStoragePath(msg.file_url);
      if (storagePath) {
        return {
          storage_path: storagePath,
          file_name: msg.file_name,
          mime_type: inferMimeType(msg.file_name),
        };
      }
    }
  }
  return undefined;
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/gemini-chat/index.ts
git commit -m "feat(gemini-chat): add voucher attachment helper functions"
```

### Task 7: Inject `source_file` into action plan metadata — STREAMING path

**Files:**
- Modify: `supabase/functions/gemini-chat/index.ts`

- [ ] **Step 1: Add source_file to streaming action plan**

At line ~4076, where `actionPlan` is constructed inside the `propose_action_plan` handler, add `source_file`:

Find the actionPlan construction (lines 4076-4091):
```typescript
    const actionPlan = {
        type: "action_plan" as const,
        plan_id: planId,
        status: "pending" as const,
        summary: planArgs.summary || "Handlingsplan",
        actions: (planArgs.actions || []).map((a, i) => ({
            ...
        })),
        assumptions: planArgs.assumptions || [],
    };
```

Add `source_file` field after `assumptions`:
```typescript
        assumptions: planArgs.assumptions || [],
        source_file: findSourceFile(Array.isArray(history) ? history : []),
    };
```

The `history` variable should be in scope — it's the conversation history passed from the frontend (check: it's used at line 3660 for `recentHistory`). If the variable name differs, use the same reference.

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/gemini-chat/index.ts
git commit -m "feat(gemini-chat): inject source_file into streaming action plan metadata"
```

### Task 8: Inject `source_file` into action plan metadata — NON-STREAMING path

**Files:**
- Modify: `supabase/functions/gemini-chat/index.ts`

- [ ] **Step 1: Add source_file to non-streaming action plan**

At line ~5554, where `actionPlan` is constructed in the non-streaming `propose_action_plan` case (lines 5554-5569):

Add `source_file` field after `assumptions`:
```typescript
        assumptions: planArgs.assumptions || [],
        source_file: findSourceFile(Array.isArray(history) ? history : []),
    };
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/gemini-chat/index.ts
git commit -m "feat(gemini-chat): inject source_file into non-streaming action plan metadata"
```

### Task 9: Call `attachFileToVoucher` after successful voucher export

**Files:**
- Modify: `supabase/functions/gemini-chat/index.ts`

This is the critical integration point. After `exportVoucher` succeeds in action plan execution (line ~2419-2440), we attach the file.

- [ ] **Step 1: Add attachment logic after exportVoucher**

Find the exportVoucher result handling in action plan execution. The actual code at lines 2419-2435:

```typescript
// Lines 2419-2435 (existing code):
const result = await callFortnoxWrite("exportVoucher", { voucher: {...} }, ...);
const voucher = (result as any).Voucher || result;
resultText = `Verifikat exporterat: ${voucher.VoucherSeries || ""}${voucher.VoucherNumber || ""}`;
break;
```

Replace the `resultText` assignment and `break` with:

```typescript
                      const voucher = (result as any).Voucher || result;

                      // --- Attach source file to voucher (non-blocking) ---
                      // `plan` is defined at line 2127: const plan = planMessage.metadata as Record<string, unknown>;
                      const sourceFile = plan.source_file as SourceFile | undefined;
                      let attachmentNote = '';
                      if (sourceFile?.storage_path && voucher.VoucherNumber) {
                        try {
                          const transactionDate = (params.transaction_date as string) ||
                            new Date().toISOString().slice(0, 10);
                          const financialYearDate = transactionDate.slice(0, 4) + '-01-01';

                          const attachResult = await callFortnoxWrite(
                            "attachFileToVoucher",
                            {
                              storagePath: sourceFile.storage_path,
                              fileName: sourceFile.file_name,
                              mimeType: sourceFile.mime_type,
                              voucherSeries: String(voucher.VoucherSeries || "A"),
                              voucherNumber: Number(voucher.VoucherNumber),
                              financialYearDate,
                            },
                            "attach_file_to_voucher",
                            `attachment-${plan_id}`,
                          );

                          if ((attachResult as any)?.success) {
                            logger.info('File attached to voucher', {
                              fileId: (attachResult as any).fileId,
                              voucherSeries: voucher.VoucherSeries,
                              voucherNumber: voucher.VoucherNumber,
                            });
                            attachmentNote = ` med bifogat kvitto "${sourceFile.file_name}"`;
                          } else {
                            logger.warn('File attachment failed (non-blocking)', {
                              error: (attachResult as any)?.error,
                            });
                          }
                        } catch (attachError) {
                          // Non-blocking: log and continue — voucher is already created
                          logger.warn('File attachment to voucher failed', {
                            error: attachError instanceof Error ? attachError.message : 'Unknown',
                            storagePath: sourceFile.storage_path,
                          });
                        }
                      }

                      resultText = `Verifikat exporterat: ${voucher.VoucherSeries || ""}${voucher.VoucherNumber || ""}${attachmentNote}`;
                      break;
```

**Key patterns matched:**
- Uses `plan` variable (line 2127), NOT `originalPlan`
- Uses `resultText` string (line 2433), NOT `actionResults.push()`
- Non-blocking: attachment failure is caught and logged, never re-thrown

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/gemini-chat/index.ts
git commit -m "feat(gemini-chat): attach source file to voucher after export (non-blocking)"
```

---

## Chunk 4: Integration Testing

### Task 10: Manual integration test checklist

Since this feature touches Fortnox API (external) and Supabase Storage, manual testing is required.

- [ ] **Step 1: Test file reference extraction**

Verify `extractStoragePath` works with a real Supabase signed URL:
```typescript
// Expected: "userId/companyId/1735689600000_kvitto.pdf"
extractStoragePath("https://baweorbvueghhkzlyncu.supabase.co/storage/v1/object/sign/chat-files/userId/companyId/1735689600000_kvitto.pdf?token=abc123")
```

- [ ] **Step 2: Test action plan with source_file**

1. Upload a PDF in chat
2. Ask AI to analyze it and create a journal entry
3. Check the action plan message metadata in the `messages` table — verify `source_file` field exists with `storage_path`, `file_name`, `mime_type`

- [ ] **Step 3: Test Fortnox attachment flow**

1. With a test Fortnox account, approve an action plan that exports a voucher from a PDF analysis
2. Verify in Fortnox: voucher exists AND has file attachment
3. Check chat: confirmation message includes attachment info

- [ ] **Step 4: Test error scenarios**

1. Approve action plan after deleting the uploaded file from Storage → voucher created, attachment skipped with warning
2. Upload a file > 5 MB → attachment skipped with size error message
3. Excel file upload → no `source_file` in action plan (Excel filtered out)

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete Fortnox voucher file attachment implementation"
```

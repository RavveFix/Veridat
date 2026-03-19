# Fix: Gemini File Analysis Priority — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Gemini analyze attached PDF/images instead of defaulting to Fortnox tool use.

**Architecture:** Two-part fix — (1) prepend a file-priority instruction to the user message in the edge function when a file is attached, (2) strengthen the system prompt's document analysis section in GeminiService.

**Tech Stack:** Deno (edge functions), TypeScript

**Spec:** `docs/superpowers/specs/2026-03-13-gemini-file-analysis-fix-design.md`

---

## Chunk 1: Edge Function Changes

### Task 1: Add diagnostic logging at file receipt

**Files:**
- Modify: `supabase/functions/gemini-chat/index.ts:1737-1738`

- [ ] **Step 1: Add logging after hasFileAttachment**

Insert after line 1737 (`const hasFileAttachment = ...;`), before line 1738 (`const isSkillAssist = ...`):

```typescript
    if (fileData) {
      logger.info("Received fileData", {
        mimeType: fileData.mimeType,
        dataLength: fileData.data?.length || 0,
      });
    }
```

---

### Task 2: Add diagnostic logging at file routing

**Files:**
- Modify: `supabase/functions/gemini-chat/index.ts:3601-3602`

- [ ] **Step 1: Add logging after geminiFileData resolution**

Insert after line 3601 (`const geminiFileData = primaryFile || ...;`), before line 3602 (`const disableTools = ...`):

```typescript
    logger.info("File routing result", {
      hasGeminiFileData: !!geminiFileData,
      mimeType: geminiFileData?.mimeType || "none",
    });
```

---

### Task 3: Add file-priority message augmentation

**Files:**
- Modify: `supabase/functions/gemini-chat/index.ts:3591-3593`

- [ ] **Step 1: Add file augmentation block**

Insert after the logging added in Task 2 (after `geminiFileData` resolution, line 3601), before `const disableTools = isSkillAssist;` (line 3602). This must go here because it references `geminiFileData` which is computed on lines 3594-3601. Since it prepends to `finalMessage` after the VERKTYGSREGLER prepend, the file instruction ends up ABOVE VERKTYGSREGLER in reading order:

```typescript
    // When a file is attached, tell Gemini to analyze it before using tools
    if (geminiFileData && geminiFileData.data && geminiFileData.data.length > 0) {
      const safeFileName = fileName || "okänd fil";
      const safeMime = geminiFileData.mimeType || "unknown";
      logger.info("File attached for Gemini", {
        fileName: safeFileName,
        mimeType: safeMime,
        dataLength: geminiFileData.data.length,
      });
      finalMessage = `[BIFOGAD FIL: ${safeFileName} (${safeMime})]\n` +
        `VIKTIGT: Användaren har bifogat en fil. Analysera filinnehållet FÖRST — ` +
        `extrahera all relevant information (belopp, moms, leverantör, datum) ` +
        `innan du använder Fortnox-verktyg. Basera ditt konteringsförslag på filens innehåll.\n\n` +
        finalMessage;
    } else if (geminiFileData) {
      logger.warn("geminiFileData present but data is empty", {
        mimeType: geminiFileData.mimeType,
        fileName: fileName || "unknown",
      });
    }
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/ravonstrawder/Desktop/Britta && npx supabase functions serve gemini-chat --no-verify-jwt 2>&1 | head -20`

Expected: No TypeScript compilation errors. The function starts serving.

- [ ] **Step 3: Commit edge function changes**

```bash
git add supabase/functions/gemini-chat/index.ts
git commit -m "fix(chat): add file-priority instruction and diagnostic logging in edge function

- Prepend [BIFOGAD FIL] instruction when geminiFileData is present
- Guard against empty file data with warning log
- Add logging at file receipt and file routing points

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Chunk 2: System Prompt Enhancement

### Task 4: Strengthen document analysis instruction

**Files:**
- Modify: `supabase/services/GeminiService.ts:95`

- [ ] **Step 1: Replace the existing punkt 1 text**

Find (line 95, exact string):
```
1. **Proaktiv dokumentanalys**: När en fil laddas upp, analysera ALLTID och ge ett komplett konteringsförslag via propose_action_plan-verktyget. Vänta inte på att användaren frågar — föreslå kontering direkt.
```

Replace with:
```
1. **Proaktiv dokumentanalys**: När en fil (PDF, bild) bifogas meddelandet:
   - LÄSA och ANALYSERA filinnehållet FÖRST — innan du använder några verktyg
   - Identifiera dokumenttyp (kvitto, faktura, kontoutdrag, skattekonto, etc.)
   - Extrahera: leverantör/butik, datum, belopp (inkl. moms), momssats, momsbelopp, beskrivning
   - Föreslå kontering direkt med BAS-konton via propose_action_plan — vänta inte på att användaren frågar
   - Använd ALDRIG search_supplier_invoices eller andra läsverktyg som substitut för att läsa den bifogade filen
   - Om något är otydligt i dokumentet, fråga användaren
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/ravonstrawder/Desktop/Britta && npx supabase functions serve gemini-chat --no-verify-jwt 2>&1 | head -20`

Expected: No TypeScript compilation errors.

- [ ] **Step 3: Commit system prompt change**

```bash
git add supabase/services/GeminiService.ts
git commit -m "fix(chat): strengthen system prompt file analysis instructions

- Replace generic 'analysera ALLTID' with explicit step-by-step instructions
- Prioritize file reading over Fortnox tool use
- Preserve 'föreslå kontering direkt' directive

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Chunk 3: Verification

### Task 5: Build verification

- [ ] **Step 1: Full build check**

Run: `cd /Users/ravonstrawder/Desktop/Britta && npm run build`

Expected: Build succeeds with no errors.

- [ ] **Step 2: Manual test checklist**

After deploying or running locally:

1. Upload PDF receipt + "hur bokför jag kvittot?" → AI should reference file content, suggest kontering via propose_action_plan
2. Upload JPEG receipt → AI should read text from image
3. Send text-only message → Should work as before (no `[BIFOGAD FIL]` prefix in logs)
4. Check edge function logs for: `Received fileData`, `File routing result`, `File attached for Gemini`
5. Test with empty/corrupt file → should see `logger.warn("geminiFileData present but data is empty")`, no crash

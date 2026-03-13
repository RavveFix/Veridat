# Non-Critical Booking Step Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `book_supplier_invoice` step non-critical — attempt booking, gracefully degrade on failure with a Swedish-language note to book manually in Fortnox.

**Architecture:** Wrap all 4 booking call sites in `gemini-chat/index.ts` with outer try-catch. On failure, log warning, use `action: "update_skipped"` in audit, and return success with fallback message. No changes to FortnoxService, GeminiService, or schema.

**Tech Stack:** Deno (Supabase Edge Functions), TypeScript

**Spec:** `docs/superpowers/specs/2026-03-13-non-critical-booking-step-design.md`

---

## Chunk 1: All Changes

All changes are in a single file: `supabase/functions/gemini-chat/index.ts`

### Task 1: Direct tool handler (~line 1630)

**Files:**
- Modify: `supabase/functions/gemini-chat/index.ts:1630-1659`

- [ ] **Step 1: Wrap booking in outer try-catch with graceful fallback**

Replace lines 1630-1659 with:

```typescript
case "book_supplier_invoice": {
  const bArgs = toolArgs as BookSupplierInvoiceArgs;
  const bInvNum = (bArgs.invoice_number || bArgs.invoiceNumber || bArgs.InvoiceNumber || bArgs.given_number || bArgs.givenNumber || bArgs.GivenNumber) as string;
  try {
    try {
      await callFortnoxWrite(
        "approveSupplierInvoiceBookkeep",
        { givenNumber: Number(bInvNum) },
        "approve_supplier_invoice",
        bInvNum,
      );
    } catch {
      await callFortnoxWrite(
        "bookSupplierInvoice",
        { givenNumber: Number(bInvNum) },
        "bookkeep_supplier_invoice",
        bInvNum,
      );
    }
    void auditService.log({
      userId,
      companyId: companyId || undefined,
      actorType: "ai",
      action: "update",
      resourceType: "supplier_invoice",
      resourceId: bInvNum,
    });
    return `Leverantörsfaktura ${bInvNum} är nu bokförd.`;
  } catch (bookingErr: unknown) {
    logger.warn("book_supplier_invoice failed (non-critical)", {
      invoiceNumber: bInvNum,
      error: bookingErr instanceof Error ? bookingErr.message : "Unknown",
    });
    void auditService.log({
      userId,
      companyId: companyId || undefined,
      actorType: "ai",
      action: "update_skipped",
      resourceType: "supplier_invoice",
      resourceId: bInvNum,
    });
    return `⚠️ Leverantörsfaktura ${bInvNum} kunde inte bokföras automatiskt. Bokför manuellt i Fortnox under Leverantörsfakturor → Attestera/Bokför.`;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/gemini-chat/index.ts
git commit -m "fix: make direct tool book_supplier_invoice non-critical"
```

---

### Task 2: Action plan handler (~line 2529)

**Files:**
- Modify: `supabase/functions/gemini-chat/index.ts:2529-2565`

- [ ] **Step 1: Wrap action plan booking in outer try-catch**

Replace lines 2529-2565 with:

```typescript
case "book_supplier_invoice": {
  const bsiInvoiceNum = (params.invoice_number || params.invoiceNumber || params.InvoiceNumber || params.given_number || params.givenNumber || params.GivenNumber) as string | number;
  try {
    try {
      await callFortnoxWrite(
        "approveSupplierInvoiceBookkeep",
        {
          givenNumber: Number(bsiInvoiceNum),
        },
        "approve_supplier_invoice",
        String(bsiInvoiceNum),
      );
    } catch (approveErr: unknown) {
      logger.warn("approvalbookkeep failed, trying bookkeep", { error: approveErr instanceof Error ? approveErr.message : "Unknown" });
      await callFortnoxWrite(
        "bookSupplierInvoice",
        {
          givenNumber: Number(bsiInvoiceNum),
        },
        "bookkeep_supplier_invoice",
        String(bsiInvoiceNum),
      );
    }
    resultText =
      `Leverantörsfaktura ${bsiInvoiceNum} bokförd`;
    void auditService.log({
      userId,
      companyId: resolvedCompanyId || undefined,
      actorType: "ai",
      action: "update",
      resourceType: "supplier_invoice",
      resourceId: String(bsiInvoiceNum),
    });
  } catch (bookingErr: unknown) {
    logger.warn("book_supplier_invoice failed in action plan (non-critical)", {
      invoiceNumber: String(bsiInvoiceNum),
      error: bookingErr instanceof Error ? bookingErr.message : "Unknown",
    });
    resultText =
      `⚠️ Leverantörsfaktura ${bsiInvoiceNum} kunde inte bokföras automatiskt. Bokför manuellt i Fortnox under Leverantörsfakturor → Attestera/Bokför.`;
    void auditService.log({
      userId,
      companyId: resolvedCompanyId || undefined,
      actorType: "ai",
      action: "update_skipped",
      resourceType: "supplier_invoice",
      resourceId: String(bsiInvoiceNum),
    });
  }
  break;
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/gemini-chat/index.ts
git commit -m "fix: make action plan book_supplier_invoice non-critical"
```

---

### Task 3: register_payment cascading failure (~line 2687)

**Files:**
- Modify: `supabase/functions/gemini-chat/index.ts:2687-2729`

- [ ] **Step 1: Wrap supplier payment path in outer try-catch**

Replace the `if (payType === "supplier")` block (lines 2687-2715) with:

```typescript
if (payType === "supplier") {
  try {
    // Ensure invoice is booked before registering payment
    try {
      await callFortnoxWrite(
        "approveSupplierInvoiceBookkeep",
        { givenNumber: Number(invoiceNum) },
        "approve_supplier_invoice",
        invoiceNum,
      );
      logger.info("Auto-approved supplier invoice before payment", { invoiceNum });
    } catch (bookErr: unknown) {
      logger.info("Supplier invoice already booked or approval failed (continuing)", {
        invoiceNum,
        error: bookErr instanceof Error ? bookErr.message : "Unknown",
      });
    }
    await callFortnoxWrite(
      "registerSupplierInvoicePayment",
      {
        payment: {
          InvoiceNumber: invoiceNum,
          Amount: payAmount,
          PaymentDate: payDate,
        },
      },
      "register_supplier_invoice_payment",
      invoiceNum,
    );
  } catch (payErr: unknown) {
    logger.warn("register_payment for supplier invoice failed (non-critical)", {
      invoiceNumber: invoiceNum,
      error: payErr instanceof Error ? payErr.message : "Unknown",
    });
    resultText =
      `⚠️ Betalning kunde inte registreras — fakturan behöver attesteras och bokföras först i Fortnox.`;
    void auditService.log({
      userId,
      companyId: resolvedCompanyId || undefined,
      actorType: "ai",
      action: "update_skipped",
      resourceType: "supplier_invoice",
      resourceId: invoiceNum,
    });
    break;
  }
}
```

Note: The `else` branch (customer payments) stays unchanged. The `resultText` after the if/else (line 2730-2731) serves as success text when the try succeeds.

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/gemini-chat/index.ts
git commit -m "fix: make register_payment supplier path non-critical"
```

---

### Task 4: Non-streaming handler (~line 5815)

**Files:**
- Modify: `supabase/functions/gemini-chat/index.ts:5815-5849`

- [ ] **Step 1: Wrap non-streaming booking in outer try-catch**

Replace lines 5815-5849 with:

```typescript
case "book_supplier_invoice": {
  const bsiArgs = args as BookSupplierInvoiceArgs;
  const bsi3InvNum = (bsiArgs.invoice_number || bsiArgs.invoiceNumber || bsiArgs.InvoiceNumber || bsiArgs.given_number || bsiArgs.givenNumber || bsiArgs.GivenNumber) as string;
  try {
    try {
      toolResult = await callFortnoxWrite(
        "approveSupplierInvoiceBookkeep",
        { givenNumber: Number(bsi3InvNum) },
        "approve_supplier_invoice",
        bsi3InvNum,
      );
    } catch {
      toolResult = await callFortnoxWrite(
        "bookSupplierInvoice",
        { givenNumber: Number(bsi3InvNum) },
        "bookkeep_supplier_invoice",
        bsi3InvNum,
      );
    }
    toolStructuredData = {
      toolArgs: bsiArgs as Record<string, unknown>,
      toolResult: toolResult as Record<string, unknown>,
    };
    responseText =
      `Leverantörsfaktura ${bsi3InvNum} är nu bokförd i Fortnox.`;
    void auditService.log({
      userId,
      companyId: resolvedCompanyId || undefined,
      actorType: "ai",
      action: "update",
      resourceType: "supplier_invoice",
      resourceId: bsi3InvNum,
    });
  } catch (bookingErr: unknown) {
    logger.warn("book_supplier_invoice failed in non-streaming (non-critical)", {
      invoiceNumber: bsi3InvNum,
      error: bookingErr instanceof Error ? bookingErr.message : "Unknown",
    });
    const fallbackMsg = `⚠️ Leverantörsfaktura ${bsi3InvNum} kunde inte bokföras automatiskt. Bokför manuellt i Fortnox under Leverantörsfakturor → Attestera/Bokför.`;
    toolStructuredData = {
      toolArgs: bsiArgs as Record<string, unknown>,
      toolResult: { error: "booking_skipped", message: fallbackMsg },
    };
    responseText = fallbackMsg;
    void auditService.log({
      userId,
      companyId: resolvedCompanyId || undefined,
      actorType: "ai",
      action: "update_skipped",
      resourceType: "supplier_invoice",
      resourceId: bsi3InvNum,
    });
  }
  break;
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/gemini-chat/index.ts
git commit -m "fix: make non-streaming book_supplier_invoice non-critical"
```

---

### Task 5: Deploy and verify

- [ ] **Step 1: Deploy gemini-chat Edge Function**

```bash
npx supabase functions deploy gemini-chat --project-ref baweorbvueghhkzlyncu
```

- [ ] **Step 2: Commit all changes together (if not already committed individually)**

```bash
git add supabase/functions/gemini-chat/index.ts
git commit -m "fix: make supplier invoice booking non-critical — graceful degradation when 'enkel attest' is disabled"
```

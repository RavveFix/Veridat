# Non-Critical Booking Step for Supplier Invoices

**Date:** 2026-03-13
**Status:** Approved

## Problem

Fortnox "enkel attest" (simple approval) setting is disabled, causing `approveSupplierInvoiceBookkeep` and `bookSupplierInvoice` API calls to fail with error codes 2001110/2001322. This blocks the entire supplier invoice creation flow — the booking step failure causes the action plan to report failure even though the invoice was successfully created.

## Decision

Make the `book_supplier_invoice` step non-critical: attempt booking, but if it fails, treat the step as successful with a user-facing note to book manually in Fortnox. This is future-proof — if "enkel attest" is enabled later, booking will work automatically.

## Approach: Try-catch with graceful degradation

### Changes

All changes are in `supabase/functions/gemini-chat/index.ts`.

#### 1. Direct tool handler (~line 1630)

Wrap the entire `book_supplier_invoice` case in an outer try-catch. On failure, return a graceful message instead of throwing.

**Before:** Throws on both `approveSupplierInvoiceBookkeep` and `bookSupplierInvoice` failure.
**After:** Catches all errors, logs warning, returns fallback text. Audit log uses `action: "update_skipped"` to distinguish from actual bookings.

#### 2. Action plan handler (~line 2529)

Same pattern. On failure, set `resultText` to the fallback message. The action is still counted as successful in the action plan progress (N/N).

**Before:** Inner catch falls back to `bookSupplierInvoice`, but if that also fails, the error propagates up and the action plan step fails.
**After:** Outer try-catch catches all failures. `resultText` set to fallback with `⚠️` prefix for visibility. Step counted as success. Audit log uses `action: "update_skipped"`. No additional structured data needed — action plan steps use `resultText` only.

#### 3. register_payment auto-approve (~line 2688)

The auto-approve catch already handles booking failure gracefully. However, if approval fails (because "enkel attest" is off), the subsequent `registerSupplierInvoicePayment` will also fail because the invoice is in draft state. Wrap the entire payment registration in a try-catch as well — on failure, set `resultText` to a note that both booking and payment need to be done manually.

**Cascading failure path:**
1. `approveSupplierInvoiceBookkeep` fails (2001110) → caught, continues
2. `registerSupplierInvoicePayment` fails (invoice not booked) → caught by new outer try-catch
3. Result: `resultText` set to payment fallback message. Step counted as success. No structured data needed — same pattern as booking fallback.

#### 4. Non-streaming handler (~line 5815)

Same pattern as #1 and #2. Wrap in outer try-catch. On failure:
- `responseText` set to fallback message
- `toolStructuredData` set to `{ toolArgs, toolResult: { error: "booking_skipped", message: fallbackText } }`

### Fallback messages (Swedish)

**Booking failure:**
```
"Leverantörsfaktura {nr} kunde inte bokföras automatiskt. Bokför manuellt i Fortnox under Leverantörsfakturor → Attestera/Bokför."
```

**Payment failure (cascading from booking):**
```
"Betalning kunde inte registreras — fakturan behöver attesteras och bokföras först i Fortnox."
```

### Audit logging on failure

When booking fails and the graceful fallback activates:
- Log with `action: "update_skipped"` (not `"update"`) so audit trail distinguishes booked vs. not-booked invoices
- Include the error message in audit metadata for traceability

### What does NOT change

- `FortnoxService.ts` — `bookSupplierInvoice` and `approveSupplierInvoiceBookkeep` methods stay as-is
- `GeminiService.ts` — system prompt still suggests "Vill du att jag bokför den?" as next step
- `propose_action_plan` schema — `book_supplier_invoice` remains a valid action type

### Risks and trade-offs

1. **Unnoticed unbooked invoices:** User might miss the "bokför manuellt" note and end up with draft invoices in Fortnox. Acceptable risk — the invoice exists and is visible in Fortnox.
2. **Catch-all masks unrelated errors:** Network timeouts, auth failures, and 500 errors are also caught. Acceptable for now — the alternative (error code discrimination) adds complexity for marginal benefit. The logger captures the actual error for debugging.
3. **No notification when workaround becomes unnecessary:** If "enkel attest" is enabled later, booking silently starts working. No action needed — this is the desired behavior.

### Success criteria

- Upload a receipt → AI creates supplier + supplier invoice → booking step attempted → if fails, user sees success with manual booking note
- Action plan shows 3/3 (or 2/2 if no payment step) regardless of booking outcome
- If user later enables "enkel attest" in Fortnox, booking works automatically with no code changes
- If both approve and book calls fail, no unhandled exception — Edge Function returns 200
- Audit log entries for failed bookings use `action: "update_skipped"`, distinguishable from successful bookings

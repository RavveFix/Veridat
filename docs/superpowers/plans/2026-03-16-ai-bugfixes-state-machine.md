# AI Bugfixes: MAX_TOKENS, State Machine, Supplier Dedup — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three production bugs: truncated AI responses, fragile tool filtering, and supplier duplicates.

**Architecture:** Increase token limit, replace message-counting with conversation state in metadata jsonb, improve supplier name matching with end-of-string suffix stripping and >=2 word substring fallback.

**Tech Stack:** Deno Edge Functions, Supabase PostgreSQL, Fortnox API, Google Gemini

**Spec:** `docs/superpowers/specs/2026-03-16-ai-bugfixes-state-machine-design.md`

---

## Chunk 1: Bug 1 — MAX_TOKENS + Migration

### Task 1: Increase maxOutputTokens to 4096

**Files:**
- Modify: `supabase/services/GeminiService.ts:1490` (non-streaming)
- Modify: `supabase/services/GeminiService.ts:1707` (streaming)

- [ ] **Step 1: Change non-streaming maxOutputTokens**

In `supabase/services/GeminiService.ts` at line 1490, change:
```typescript
maxOutputTokens: 2048,
```
to:
```typescript
maxOutputTokens: 4096,
```

- [ ] **Step 2: Change streaming maxOutputTokens**

In `supabase/services/GeminiService.ts` at line 1707, change:
```typescript
maxOutputTokens: 2048,
```
to:
```typescript
maxOutputTokens: 4096,
```

- [ ] **Step 3: Commit**

```bash
git add supabase/services/GeminiService.ts
git commit -m "fix(ai): increase maxOutputTokens to 4096 to prevent truncation"
```

### Task 2: Add conversations.metadata migration

**Files:**
- Create: `supabase/migrations/20260316000002_add_conversations_metadata.sql`

- [ ] **Step 1: Create migration file**

```sql
-- Add metadata jsonb column to conversations for conversation state tracking
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Add comment for documentation
COMMENT ON COLUMN public.conversations.metadata IS 'Stores conversation_state and other metadata. States: idle, file_analysis, awaiting_input, action_plan_pending';

-- Helper function for atomic jsonb key update (avoids read-modify-write race conditions)
CREATE OR REPLACE FUNCTION public.set_conversation_state(
  p_conversation_id uuid,
  p_state text
) RETURNS void AS $$
BEGIN
  UPDATE public.conversations
  SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('conversation_state', p_state)
  WHERE id = p_conversation_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260316000002_add_conversations_metadata.sql
git commit -m "feat(db): add metadata jsonb column and set_conversation_state function"
```

---

## Chunk 2: Bug 2 — Conversation State Machine

### Task 3: Add state helper and replace message-counting

**Files:**
- Modify: `supabase/functions/gemini-chat/index.ts:57-65` (module-level helper)
- Modify: `supabase/functions/gemini-chat/index.ts:3988-4029` (tool filtering)
- Modify: `supabase/functions/gemini-chat/index.ts:2284-2286` (reject handler)
- Modify: `supabase/functions/gemini-chat/index.ts:3430-3431` (execution complete)
- Modify: `supabase/functions/gemini-chat/index.ts:3472-3484` (execution error)
- Modify: `supabase/functions/gemini-chat/index.ts:4235` (after streaming)

- [ ] **Step 1: Add updateConversationState helper at module scope**

Add this at module scope, after line 65 (`type EdgeSupabaseClient = ...`) in `supabase/functions/gemini-chat/index.ts`:

```typescript
// ── Conversation state machine ──────────────────────────────────
type ConversationState = "idle" | "file_analysis" | "awaiting_input" | "action_plan_pending";

async function updateConversationState(
  supabase: any,
  conversationId: string | null,
  state: ConversationState,
): Promise<void> {
  if (!conversationId) return;
  try {
    // Atomic jsonb merge via Postgres function — no read-modify-write race condition
    await supabase.rpc("set_conversation_state", {
      p_conversation_id: conversationId,
      p_state: state,
    });
  } catch (err) {
    logger.warn("Failed to update conversation state", { error: String(err), state });
  }
}
```

- [ ] **Step 2: Replace message-counting with state read**

Replace lines 3998-4029 in `index.ts` (the `if (!excludeToolsForFile && conversationId ...)` block with the `recentMessages` query). Keep the surrounding lines 3995-3997 (`excludeToolsReason` initialization) and lines 4031-4044 (safeguard + logging) intact.

Old code to remove (lines 3998-4029):
```typescript
    if (!excludeToolsForFile && conversationId && userId !== "anonymous") {
      try {
        // Single query: fetch last 5 messages (any role) with file_name or metadata
        const { data: recentMessages } = await supabaseAdmin
          .from("messages")
          .select("role, file_name, metadata")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: false })
          .limit(5);

        if (recentMessages && recentMessages.length > 0) {
          const hasPendingPlan = recentMessages.some(
            (m: any) => m.role === "assistant" &&
              m.metadata?.type === "action_plan" &&
              m.metadata?.status === "pending",
          );
          const hasRecentFile = recentMessages.some(
            (m: any) => m.role === "user" && m.file_name,
          );

          if (hasPendingPlan) {
            excludeToolsForFile = FORTNOX_READ_TOOLS;
            excludeToolsReason = "pending_action_plan";
          } else if (hasRecentFile) {
            excludeToolsForFile = FORTNOX_READ_TOOLS;
            excludeToolsReason = "recent_file_in_conversation";
          }
        }
      } catch (err) {
        logger.warn("Failed to check conversation context for tool restriction", { error: String(err) });
      }
    }
```

Replace with:
```typescript
    if (!excludeToolsForFile && conversationId && userId !== "anonymous") {
      try {
        // Read conversation state from metadata instead of scanning messages
        const { data: convData } = await supabaseAdmin
          .from("conversations")
          .select("metadata")
          .eq("id", conversationId)
          .single();
        const convState = (convData?.metadata as any)?.conversation_state as ConversationState | null;
        // null/missing state (old conversations without metadata) = idle — no crash
        if (convState && convState !== "idle") {
          excludeToolsForFile = FORTNOX_READ_TOOLS;
          excludeToolsReason = `state:${convState}`;
        }
      } catch (err) {
        logger.warn("Failed to read conversation state", { error: String(err) });
      }
    }
```

- [ ] **Step 3: Set state on file upload**

After line 3997 (where `excludeToolsReason` is first set based on `geminiFileData`), add:

```typescript
    // Set conversation state for file upload
    if (geminiFileData && conversationId) {
      void updateConversationState(supabaseAdmin, conversationId, "file_analysis");
    }
```

- [ ] **Step 4: Set state after streaming based on tool calls**

After the streaming diagnostics log (line ~4235, after the `logger.info("Gemini stream diagnostics", ...)` call), add state transitions:

```typescript
              // ── State machine transitions after Gemini response ──
              if (conversationId) {
                if (toolCallDetected?.name === "request_clarification") {
                  void updateConversationState(supabaseAdmin, conversationId, "awaiting_input");
                } else if (toolCallDetected?.name === "propose_action_plan") {
                  void updateConversationState(supabaseAdmin, conversationId, "action_plan_pending");
                } else if (!toolCallDetected && !geminiFileData) {
                  // Topic-switch reset: no tool call and no file = back to idle
                  // Prevents conversations getting stuck in excluded state on topic change
                  void updateConversationState(supabaseAdmin, conversationId, "idle");
                }
              }
```

- [ ] **Step 5: Reset state on action plan rejection**

In the reject handler, insert **immediately after** line 2284 (`.eq("id", planMessage.id);`) and **before** line 2286 (`const encoder = new TextEncoder();`):

```typescript
          // Reset conversation state to idle after rejection
          void updateConversationState(supabaseAdmin, conversationId, "idle");
```

Context — the insertion point looks like:
```typescript
            .eq("id", planMessage.id);
          // ← INSERT HERE
          const encoder = new TextEncoder();
```

- [ ] **Step 6: Reset state on action plan execution complete (success path)**

After line 3430 (`.eq("id", planMessage.id);` in the execution complete block), add:

```typescript
              // Reset conversation state to idle after execution
              void updateConversationState(supabaseAdmin, conversationId, "idle");
```

- [ ] **Step 7: Reset state on action plan execution error path**

In the `catch (streamErr)` block at line ~3472, after the error log (line 3473), add:

```typescript
              // Reset conversation state to idle even on error — don't leave stuck
              void updateConversationState(supabaseAdmin, conversationId, "idle");
```

Context — the insertion point:
```typescript
            } catch (streamErr) {
              logger.error("Action plan execution stream error", streamErr);
              // ← INSERT HERE
              controller.enqueue(
```

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/gemini-chat/index.ts
git commit -m "feat(ai): replace message-counting with conversation state machine for tool filtering"
```

---

## Chunk 3: Bug 3 — Supplier Dedup

### Task 4: Add prompt instruction for OrganisationNumber

**Files:**
- Modify: `supabase/services/GeminiService.ts:177`

- [ ] **Step 1: Add supplier org.nr instruction to system prompt**

Replace line 177 in `GeminiService.ts`:

Old:
```
- **create_supplier**: Skapar en ny leverantör i Fortnox med namn, organisationsnummer och kontaktuppgifter.
```

New:
```
- **create_supplier**: Skapar en ny leverantör i Fortnox med namn, organisationsnummer och kontaktuppgifter. VIKTIGT: Inkludera ALLTID OrganisationNumber om det finns i källdokumentet (faktura, PDF, kvitto). Utan org.nr riskerar systemet att skapa dubbletter.
```

- [ ] **Step 2: Commit**

```bash
git add supabase/services/GeminiService.ts
git commit -m "fix(ai): prompt Gemini to always include OrganisationNumber for suppliers"
```

### Task 5: Improve findOrCreateSupplier matching

**Files:**
- Modify: `supabase/services/FortnoxService.ts:1044-1087`

- [ ] **Step 1: Replace findOrCreateSupplier method**

Replace the existing `findOrCreateSupplier` method (lines 1044-1087) with:

```typescript
    async findOrCreateSupplier(supplierData: FortnoxSupplier): Promise<FortnoxSupplierResponse> {
        // Old normalize: collapse whitespace to empty (for exact match backward compat)
        const normalize = (s: string) => s.toLowerCase().replace(/[_\s-]+/g, '').replace(/\.$/, '');

        // New normalize: strip company suffixes at end-of-string only, keep spaces for word counting
        const normalizeCompany = (s: string) =>
            s.toLowerCase()
                .replace(/\s+(ab|ltd|limited|inc|incorporated|gmbh|emea|nordic|sweden|scandinavia|europe|oy|as|aps|sa|sas|bv|nv)\s*$/i, '')
                .replace(/[_\s-]+/g, ' ')
                .replace(/\.$/, '')
                .trim();

        try {
            // 1. Match by org number using Fortnox filter (exact — most reliable)
            if (supplierData.OrganisationNumber) {
                const encoded = encodeURIComponent(supplierData.OrganisationNumber);
                const filtered = await this.request<FortnoxSupplierListResponse>(`/suppliers?organisationnumber=${encoded}`);
                const byOrg = (filtered.Suppliers || []).find(
                    s => s.OrganisationNumber === supplierData.OrganisationNumber
                );
                if (byOrg) {
                    logger.info('Found existing supplier by org number', {
                        supplierNumber: byOrg.SupplierNumber,
                        name: byOrg.Name,
                    });
                    return { Supplier: byOrg };
                }
            }

            // 2. Match by name — exact normalized match (existing behavior)
            if (supplierData.Name) {
                const encoded = encodeURIComponent(supplierData.Name);
                const filtered = await this.request<FortnoxSupplierListResponse>(`/suppliers?name=${encoded}`);
                const needle = normalize(supplierData.Name);
                const byName = (filtered.Suppliers || []).find(s => s.Name && normalize(s.Name) === needle);
                if (byName) {
                    logger.info('Found existing supplier by name (exact)', {
                        supplierNumber: byName.SupplierNumber,
                        name: byName.Name,
                        searchedName: supplierData.Name,
                    });
                    return { Supplier: byName };
                }

                // 3. Match by normalized company name — substring fallback (>=2 words only)
                //    Safety: single-word names like "Google" won't trigger substring matching
                //    to avoid matching different legal entities (Google Ireland vs Google Cloud)
                const normalizedNeedle = normalizeCompany(supplierData.Name);
                const wordCount = normalizedNeedle.split(' ').filter(w => w.length > 0).length;
                if (wordCount >= 2) {
                    // Use Fortnox name= param with first two words for a broader but targeted search
                    const searchTerm = normalizedNeedle.split(' ').slice(0, 2).join(' ');
                    const broadFiltered = await this.request<FortnoxSupplierListResponse>(
                        `/suppliers?name=${encodeURIComponent(searchTerm)}`
                    );
                    const byNormalized = (broadFiltered.Suppliers || []).find(s => {
                        if (!s.Name) return false;
                        const normalizedExisting = normalizeCompany(s.Name);
                        return normalizedExisting === normalizedNeedle ||
                            normalizedExisting.includes(normalizedNeedle) ||
                            normalizedNeedle.includes(normalizedExisting);
                    });
                    if (byNormalized) {
                        logger.info('Found existing supplier by normalized name (substring)', {
                            supplierNumber: byNormalized.SupplierNumber,
                            name: byNormalized.Name,
                            searchedName: supplierData.Name,
                            normalizedNeedle,
                        });
                        return { Supplier: byNormalized };
                    }
                }
            }
        } catch (error) {
            logger.warn('Could not search suppliers', {
                error: error instanceof Error ? error.message : String(error),
            });
        }

        // No match found — create new supplier
        return await this.createSupplier(supplierData);
    }
```

- [ ] **Step 2: Commit**

```bash
git add supabase/services/FortnoxService.ts
git commit -m "fix(fortnox): improve supplier matching with normalized names and substring fallback"
```

---

## Chunk 4: Deploy

### Task 6: Deploy

- [ ] **Step 1: Apply migration FIRST (before deploying functions that depend on it)**

```bash
npx supabase db push --project-ref baweorbvueghhkzlyncu
```

Expected: Migration applied, `metadata` column added to `conversations`, `set_conversation_state` function created.

- [ ] **Step 2: Deploy gemini-chat**

```bash
npx supabase functions deploy gemini-chat --project-ref baweorbvueghhkzlyncu
```

Expected: Deployment success message.

- [ ] **Step 3: Deploy fortnox**

```bash
npx supabase functions deploy fortnox --project-ref baweorbvueghhkzlyncu
```

Expected: Deployment success message.

# AI Bugfixes: MAX_TOKENS, Conversation State Machine, Supplier Dedup

**Date:** 2026-03-16
**Status:** Approved
**Commit message:** `feat(ai): conversation state machine for tool filtering`

## Problem

Three production bugs in the AI chat pipeline:

1. **MAX_TOKENS** — `maxOutputTokens: 2048` causes Gemini responses to be truncated mid-sentence. Logs show `finishReason: "MAX_TOKENS"`.
2. **Tool filtering fragility** — Current logic fetches the last 5 messages to decide whether to exclude Fortnox read-tools. Breaks after 6+ messages in a conversation. Not state-aware.
3. **Supplier duplicates** — `findOrCreateSupplier` fails to match existing suppliers when AI omits org.nr. "Google Cloud EMEA" created as supplier nr 4, 13, and 16.

## Design

### Bug 1: MAX_TOKENS

Change `maxOutputTokens` from `2048` to `4096` in `GeminiService.ts`:
- Line ~1490 (non-streaming chat)
- Line ~1707 (streaming chat with files)
- Title generation (line ~1756) stays at `30`.

### Bug 2: Conversation State Machine

Replace message-counting with a state field in `conversations.metadata`.

**Prerequisites:** The `conversations` table does not currently have a `metadata` column. A migration is required:
```sql
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
```

**States:** `idle` | `file_analysis` | `awaiting_input` | `action_plan_pending`

**Transitions:**

| Trigger | New state |
|---------|-----------|
| File uploaded (`geminiFileData` present) | `file_analysis` |
| Gemini returns `request_clarification` tool call | `awaiting_input` |
| Gemini returns `propose_action_plan` tool call | `action_plan_pending` |
| Action plan executed (approved/rejected) | `idle` |
| No file/plan/clarification context detected | `idle` |

**Tool filtering based on state:**
- `file_analysis`, `awaiting_input`, `action_plan_pending` → exclude `FORTNOX_READ_TOOLS`
- `idle` (or `null`/missing) → all tools available

**Safety:** `null` or missing state (old conversations without metadata) is treated as `idle`. No crash for existing conversations.

**Implementation in `index.ts`:**
- Helper function `updateConversationState(supabaseAdmin, conversationId, state)` — updates `conversations.metadata` jsonb with `conversation_state` field
- Read state with `select metadata->conversation_state` — single field read, no message fetching
- Remove old `recentMessages` query (lines ~3998-4025)
- Safeguard preserved: `propose_action_plan` and `request_clarification` never excluded

**State update points:**
1. Early in request: if `geminiFileData` → set `file_analysis`
2. After Gemini streaming: if tool call is `request_clarification` → set `awaiting_input`
3. After Gemini streaming: if tool call is `propose_action_plan` → set `action_plan_pending`
4. After action plan execution (approve/reject) at line ~2234 (`requestMetadata?.action_response` handler) → set `idle` after execution completes (both success and error paths)
5. Default: if none of the above triggers match and no active context → set `idle`

### Bug 3: Supplier Dedup

Two-pronged fix: prompt improvement + smarter matching.

**A) Prompt improvement** in `GeminiService.ts` system prompt:
> "When creating suppliers via propose_action_plan, ALWAYS include OrganisationNumber if present in the source document (invoice, PDF, receipt)."

**B) Improved matching** in `FortnoxService.findOrCreateSupplier`:

**Updated matching order:**
1. **Org.nr (exact)** — already exists, kept as-is
2. **Name (normalized, exact)** — improved with company suffix stripping
3. **Name (substring, >=2 words)** — NEW fallback using Fortnox `filter` parameter
4. **Create new** — last resort

**Normalization function:**
```typescript
function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+(ab|ltd|limited|inc|incorporated|gmbh|emea|nordic|sweden|scandinavia|europe|oy|as|aps|sa|sas|bv|nv)\s*$/i, '')
    .replace(/[_\s-]+/g, ' ')
    .replace(/\.$/, '')
    .trim();
}
```

**Note:** Suffix stripping is anchored to end-of-string only (`$`). This prevents false positives like "Fastighets AS Gruppen" losing "AS" mid-name. Also note: the existing `normalize` function collapses whitespace to empty string; the new version uses single space — this is intentional for the >=2 word substring check.

**Substring match safety:** Only apply substring/contains matching when the normalized name has **2 or more words**. This prevents "Google" from matching "Google Cloud EMEA", "Google Ireland Ltd", etc. — these are distinct legal entities with different org.nr.

**Example:**
- "Google Cloud EMEA Limited" → normalized: "google cloud" (2 words) → substring match finds "Google Cloud EMEA" ✓
- "Google Ireland Ltd" → normalized: "google ireland" (2 words) → does NOT match "google cloud" ✗ (correct — different entity)

## Files Changed

| File | Change |
|------|--------|
| `supabase/migrations/YYYYMMDD_add_conversations_metadata.sql` | Add `metadata jsonb` column to `conversations` |
| `supabase/services/GeminiService.ts` | `maxOutputTokens: 4096`, prompt addition for org.nr |
| `supabase/functions/gemini-chat/index.ts` | State machine replacing message-count logic |
| `supabase/services/FortnoxService.ts` | Improved `findOrCreateSupplier` matching |

## Testing

- Verify long AI responses no longer truncated (check `finishReason` in logs)
- Verify tool filtering works correctly across conversation states
- Verify old conversations (null state) don't crash
- Verify supplier matching: "Google Cloud EMEA Limited" finds existing "Google Cloud EMEA"
- Verify supplier safety: "Google Ireland Ltd" does NOT match "Google Cloud EMEA"

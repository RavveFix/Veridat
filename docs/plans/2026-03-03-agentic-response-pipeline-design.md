# Agentic Response Pipeline — Design Document

**Date:** 2026-03-03
**Approach:** B — Agentic Response Pipeline (Frontend-first)
**Goal:** Make AI responses look and feel agentic — showing thinking steps, tool usage, and live progress in a Modern SaaS glassmorphism style.

---

## Problem

AI responses appear as plain text blobs. Users have no visibility into what the AI is doing (searching customers, checking VAT rules, looking up accounts). The app has several built components (`ThinkingSteps`, `AIQuestionCard`, `ConfidenceIndicator`) that are disconnected from the live data flow.

## Solution

Add lightweight `agentStep` SSE events from the backend and build an `AgentActivityFeed` component that shows a real-time timeline of AI operations above the streamed text response.

---

## 1. Backend: SSE Agent Events

### New Event Type

Added to the existing SSE stream from `gemini-chat/index.ts`:

```typescript
// New SSE event shape
interface AgentStepEvent {
  agentStep: {
    id: string;                    // "step-1", "step-2", ...
    type: 'tool_call' | 'thinking' | 'memory_lookup' | 'search';
    tool: string;                  // Fortnox tool name or internal operation
    label: string;                 // Swedish UI label ("Hämtar kundregister")
    status: 'running' | 'completed' | 'failed';
    startedAt: number;             // timestamp ms
    completedAt: number | null;
    resultSummary: string | null;  // "Hittade 23 kunder" after completion
  }
}
```

### Instrumented Operations

Each internal tool call emits a `running` event before execution and a `completed`/`failed` event after:

| Tool | Label (Swedish) | Result Summary Example |
|------|-----------------|----------------------|
| `getCustomers` | "Hämtar kundregister" | "Hittade 23 kunder" |
| `getAccounts` | "Hämtar kontoplan" | "1 247 konton laddade" |
| `getSuppliers` | "Hämtar leverantörer" | "12 leverantörer" |
| `getArticles` | "Hämtar artikelregister" | "8 artiklar" |
| `createInvoice` | "Skapar kundfaktura" | "Faktura #1042 skapad" |
| `createSupplierInvoice` | "Registrerar leverantörsfaktura" | "Bokförd" |
| `conversation_search` | "Söker i konversationshistorik" | "3 relevanta träffar" |
| `propose_action_plan` | "Förbereder åtgärdsplan" | — |
| `request_clarification` | "Behöver mer information" | — |

### Implementation

Helper function added to `gemini-chat/index.ts`:

```typescript
let stepCounter = 0;

function emitAgentStep(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  tool: string,
  label: string,
  type: AgentStepEvent['agentStep']['type'] = 'tool_call'
) {
  const id = `step-${++stepCounter}`;
  const step = { id, type, tool, label, status: 'running', startedAt: Date.now(), completedAt: null, resultSummary: null };
  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ agentStep: step })}\n\n`));

  return (resultSummary?: string, failed = false) => {
    step.status = failed ? 'failed' : 'completed';
    step.completedAt = Date.now();
    step.resultSummary = resultSummary ?? null;
    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ agentStep: step })}\n\n`));
  };
}
```

Usage at each tool call site:

```typescript
const done = emitAgentStep(controller, encoder, 'getCustomers', 'Hämtar kundregister');
const result = await fortnoxService.getCustomers();
done(`Hittade ${result.Customers.length} kunder`);
```

### No Schema Changes

- No new database tables or columns
- No new endpoints
- Same SSE stream, just a new event type alongside existing `text`, `actionPlan`, `actionStatus`, `usedMemories`

---

## 2. Frontend: AgentActivityFeed Component

### New File: `AgentActivityFeed.tsx`

Preact functional component that renders a vertical timeline of agent steps.

### Props

```typescript
interface AgentActivityFeedProps {
  steps: AgentStep[];
  usedMemories?: UsedMemory[];
  isStreaming: boolean;
  collapsed?: boolean;
}

interface AgentStep {
  id: string;
  type: 'tool_call' | 'thinking' | 'memory_lookup' | 'search';
  tool: string;
  label: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: number;
  completedAt: number | null;
  resultSummary: string | null;
}
```

### Visual Design

```
┌─ Agent Activity ─────────────────────────────────┐
│                                                    │
│  ✓ Hämtar kundregister                     0.8s   │
│  ✓ Hämtar kontoplan                        0.4s   │
│  ● Analyserar momsregler...               pågår   │
│                                                    │
│  ┌─ Använda minnen ────────────────────────────┐  │
│  │ Kundregister • Momsregler 25%               │  │
│  └─────────────────────────────────────────────┘  │
│                                                    │
└────────────────────────────────────────────────────┘
```

### Behavior

1. Each `agentStep` SSE event adds a row to the timeline
2. `running` → pulsing dot indicator with label
3. `completed` → green check + elapsed time + optional result summary
4. `failed` → red X + error indication
5. **Auto-collapse:** When AI text streaming begins, the feed collapses to a summary line: "3 steg utförda på 2.1s ▾"
6. Click to expand back to full timeline view
7. `usedMemories` shown as pill/chip badges below the steps

### Styling

- Glassmorphism: `backdrop-filter: blur(12px)`, `background: var(--glass-bg)`
- Border radius: `var(--radius-md)` (12px)
- Smooth entry animations: `slideUpFade` for each new step
- Reduced motion: respects `prefers-reduced-motion`

---

## 3. Component Wiring

### Existing Components Connected

| Component | Current State | Connection |
|-----------|--------------|------------|
| `ThinkingSteps` | Built, disconnected | Used for `type: 'thinking'` agent steps |
| `AIQuestionCard` | Built, disconnected | Connected to `request_clarification` tool — renders structured options instead of plain text |
| `ConfidenceIndicator` | Built, not rendered | Added to `ActionPlanCard` header next to status pill |
| `usedMemories` | Data available, no UI | Rendered as chips in `AgentActivityFeed` |

### ChatService.ts Changes

Parse new `agentStep` events from SSE stream and dispatch DOM event:

```typescript
if (data.agentStep) {
  window.dispatchEvent(new CustomEvent('chat-agent-step', { detail: data.agentStep }));
}
```

### ChatHistory.tsx Changes

New state array for agent steps:

```typescript
const [agentSteps, setAgentSteps] = useState<AgentStep[]>([]);

// Listen for agent step events
useEffect(() => {
  const handler = (e: CustomEvent) => {
    setAgentSteps(prev => {
      const existing = prev.findIndex(s => s.id === e.detail.id);
      if (existing >= 0) {
        const updated = [...prev];
        updated[existing] = e.detail;
        return updated;
      }
      return [...prev, e.detail];
    });
  };
  window.addEventListener('chat-agent-step', handler);
  return () => window.removeEventListener('chat-agent-step', handler);
}, []);
```

Reset `agentSteps` to `[]` when a new message starts (on `isNewResponse: true`).

### AIResponseRenderer.tsx Changes

When `request_clarification` tool is detected, render `AIQuestionCard` with structured options instead of plain text paragraph.

### ActionPlanCard.tsx Changes

Add `ConfidenceIndicator` next to the existing status pill in the header, using the `confidence` field already present in `ActionPlanAction`.

---

## 4. Data Flow

```
gemini-chat/index.ts
  │
  ├─ { agentStep: { status: "running", tool: "getCustomers" } }  ← NEW
  ├─ { agentStep: { status: "completed", resultSummary: "..." } } ← NEW
  ├─ { usedMemories: [...] }   ← EXISTS, now wired to UI
  ├─ { text: "Baserat på..." } ← EXISTS
  ├─ { actionPlan: {...} }     ← EXISTS
  └─ [DONE]
         │
    ChatService.ts
         │ new DOM event: 'chat-agent-step'
         │
    ChatHistory.tsx
         │ new state: agentSteps[]
         │ existing: usedMemories (now passed to feed)
         │
    AgentActivityFeed.tsx ← NEW
         │ renders timeline + memory chips
         │
    AIResponseRenderer.tsx ← MODIFIED
         │ request_clarification → AIQuestionCard
         │ ActionPlanCard + ConfidenceIndicator
```

---

## 5. Files Changed

| File | Type | Change |
|------|------|--------|
| `supabase/functions/gemini-chat/index.ts` | Modified | Add `emitAgentStep()` helper, emit events around tool calls |
| `apps/web/src/services/ChatService.ts` | Modified | Parse `agentStep` SSE events, dispatch DOM event |
| `apps/web/src/components/Chat/ChatHistory.tsx` | Modified | New `agentSteps` state, pass to feed component |
| `apps/web/src/components/Chat/AIResponseRenderer.tsx` | Modified | Wire `request_clarification` → `AIQuestionCard` |
| `apps/web/src/components/Chat/ActionPlanCard.tsx` | Modified | Add `ConfidenceIndicator` in header |
| `apps/web/src/components/Chat/AgentActivityFeed.tsx` | **New** | Timeline component |
| `apps/web/src/styles/components/agent-activity.css` | **New** | Glassmorphism timeline styling |

## 6. Not Changed

- Database schema (no migrations)
- Other edge functions
- Authentication / RLS
- Existing CSS architecture
- Other components not mentioned above

---

## 7. Success Criteria

1. When the AI processes a user message in agent mode, users see a live timeline of what operations are being performed
2. Completed steps show elapsed time and result summaries
3. Timeline auto-collapses when text starts streaming
4. `usedMemories` are visible as chips
5. `request_clarification` renders as interactive option cards instead of plain text
6. `ConfidenceIndicator` appears in action plan headers
7. All new UI matches existing glassmorphism design language
8. Works correctly in both light and dark mode

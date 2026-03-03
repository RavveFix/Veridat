# Agentic Response Pipeline — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make AI responses look and feel agentic by showing live tool usage, thinking steps, and progress in the existing glassmorphism design language.

**Architecture:** Add `agentStep` SSE events from `gemini-chat` backend around every tool call. Frontend parses these into a new `AgentActivityFeed` timeline component. Wire up existing but disconnected components (`ThinkingSteps`, `AIQuestionCard`, `ConfidenceIndicator`).

**Tech Stack:** Deno (Edge Functions), Preact, TypeScript, CSS (glassmorphism)

**Design Doc:** `docs/plans/2026-03-03-agentic-response-pipeline-design.md`

---

## Task 1: Backend — `emitAgentStep` Helper

**Files:**
- Modify: `supabase/functions/gemini-chat/index.ts` (insert near line 3257, before the ReadableStream)

**Step 1: Add the `emitAgentStep` helper function**

Insert this helper function just before the `const responseStream = new ReadableStream({` line (line 3269):

```typescript
// ── Agent step SSE events ──
let agentStepCounter = 0;
function emitAgentStep(
  ctrl: ReadableStreamDefaultController,
  enc: TextEncoder,
  tool: string,
  label: string,
  type: 'tool_call' | 'thinking' | 'memory_lookup' | 'search' = 'tool_call',
) {
  const id = `step-${++agentStepCounter}`;
  const step = { id, type, tool, label, status: 'running' as const, startedAt: Date.now(), completedAt: null as number | null, resultSummary: null as string | null };
  ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ agentStep: step })}\n\n`));
  return (resultSummary?: string, failed = false) => {
    step.status = failed ? 'failed' : 'completed';
    step.completedAt = Date.now();
    step.resultSummary = resultSummary ?? null;
    ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ agentStep: step })}\n\n`));
  };
}
```

**Step 2: Verify the function doesn't break the build**

Run: `cd supabase && npx supabase functions serve gemini-chat --no-verify-jwt` (check it starts without syntax errors, then Ctrl+C)

**Step 3: Commit**

```bash
git add supabase/functions/gemini-chat/index.ts
git commit -m "feat: add emitAgentStep SSE helper for agentic UI"
```

---

## Task 2: Backend — Instrument Tool Calls with Agent Steps

**Files:**
- Modify: `supabase/functions/gemini-chat/index.ts` (lines 3291-3540, inside the `if (toolCallDetected)` block)

**Step 1: Wrap `conversation_search` tool (line 3298)**

Before the `if (toolName === "conversation_search")` block, add the step emission. The pattern is: emit start → do work → emit complete.

At line 3298, change:

```typescript
if (toolName === "conversation_search") {
```

To:

```typescript
if (toolName === "conversation_search") {
  const doneStep = emitAgentStep(controller, encoder, 'conversation_search', 'Söker i konversationshistorik', 'search');
```

Then after the `conversation_search` block closes (around line 3353), add:

```typescript
  doneStep(searchResults ? `${searchResults.length} träffar` : undefined);
```

**Step 2: Wrap `recent_chats` tool (line 3354)**

Same pattern — add `emitAgentStep` before the tool body and `doneStep()` after.

**Step 3: Wrap Fortnox read tools**

For each Fortnox tool call that goes through `executeToolCall()` (the switch at lines 1321-1575), wrap the calls at the streaming level. In the streaming block where these tools are invoked (after conversation_search handling), add agent steps around each tool:

For `propose_action_plan` (line ~3456):
```typescript
const doneStep = emitAgentStep(controller, encoder, 'propose_action_plan', 'Förbereder åtgärdsplan', 'thinking');
// ... existing action plan code ...
doneStep(`${actionPlan.actions.length} åtgärder`);
```

For `request_clarification` (line ~3494):
```typescript
const doneStep = emitAgentStep(controller, encoder, 'request_clarification', 'Behöver mer information', 'thinking');
// ... existing code ...
doneStep();
```

For the generic Fortnox tool execution path (where `executeToolCall` is called), wrap it:
```typescript
const toolLabels: Record<string, string> = {
  get_customers: 'Hämtar kundregister',
  get_articles: 'Hämtar artikelregister',
  get_suppliers: 'Hämtar leverantörer',
  get_vouchers: 'Hämtar verifikationer',
  get_invoice: 'Hämtar faktura',
  get_supplier_invoice: 'Hämtar leverantörsfaktura',
  create_invoice: 'Skapar kundfaktura',
  create_supplier_invoice: 'Registrerar leverantörsfaktura',
  create_supplier: 'Skapar leverantör',
  export_journal_to_fortnox: 'Exporterar verifikation',
  book_supplier_invoice: 'Bokför leverantörsfaktura',
  register_payment: 'Registrerar betalning',
  company_lookup: 'Söker företagsinfo',
  create_customer: 'Skapar kund',
};
const stepLabel = toolLabels[toolName] || `Kör ${toolName}`;
const doneStep = emitAgentStep(controller, encoder, toolName, stepLabel);
try {
  // ... existing tool execution ...
  doneStep();
} catch (err) {
  doneStep(String(err), true);
  throw err;
}
```

**Step 4: Verify build**

Run: `cd supabase && npx supabase functions serve gemini-chat --no-verify-jwt`

**Step 5: Commit**

```bash
git add supabase/functions/gemini-chat/index.ts
git commit -m "feat: emit agentStep SSE events around all tool calls"
```

---

## Task 3: Frontend — Parse `agentStep` in ChatService

**Files:**
- Modify: `apps/web/src/services/ChatService.ts` (lines 377-406)

**Step 1: Add `agentStep` to the parsed SSE data type**

At line 377, update the type assertion to include the new event:

```typescript
const data = JSON.parse(dataStr) as {
    text?: string;
    toolCall?: { name: string; args: Record<string, unknown> };
    usedMemories?: UsedMemory[];
    actionPlan?: Record<string, unknown>;
    actionStatus?: Record<string, unknown>;
    agentStep?: {
        id: string;
        type: string;
        tool: string;
        label: string;
        status: 'running' | 'completed' | 'failed';
        startedAt: number;
        completedAt: number | null;
        resultSummary: string | null;
    };
};
```

**Step 2: Dispatch the agent step DOM event**

After the `actionStatus` dispatch block (line 406), add:

```typescript
// Dispatch agent step updates for AgentActivityFeed
if (data.agentStep) {
    window.dispatchEvent(new CustomEvent('chat-agent-step', {
        detail: data.agentStep
    }));
}
```

**Step 3: Also dispatch `usedMemories` as a separate event** (currently only stored in return value)

After the existing `usedMemories` capture (line 393), add:

```typescript
if (data.usedMemories && Array.isArray(data.usedMemories)) {
    usedMemories = data.usedMemories;
    window.dispatchEvent(new CustomEvent('chat-used-memories', {
        detail: data.usedMemories
    }));
}
```

**Step 4: Verify build**

Run: `cd apps/web && npm run build`

**Step 5: Commit**

```bash
git add apps/web/src/services/ChatService.ts
git commit -m "feat: parse agentStep and usedMemories SSE events in ChatService"
```

---

## Task 4: Frontend — AgentActivityFeed Component

**Files:**
- Create: `apps/web/src/components/Chat/AgentActivityFeed.tsx`

**Step 1: Create the component**

```tsx
import { FunctionComponent } from 'preact';
import { useState, useEffect } from 'preact/hooks';

export interface AgentStep {
    id: string;
    type: 'tool_call' | 'thinking' | 'memory_lookup' | 'search';
    tool: string;
    label: string;
    status: 'running' | 'completed' | 'failed';
    startedAt: number;
    completedAt: number | null;
    resultSummary: string | null;
}

export interface UsedMemoryChip {
    id: string;
    category: string;
    preview: string;
}

interface AgentActivityFeedProps {
    steps: AgentStep[];
    usedMemories?: UsedMemoryChip[];
    isStreaming: boolean;
}

export const AgentActivityFeed: FunctionComponent<AgentActivityFeedProps> = ({
    steps,
    usedMemories,
    isStreaming,
}) => {
    const [collapsed, setCollapsed] = useState(false);

    // Auto-collapse when text streaming starts and all steps are done
    useEffect(() => {
        if (isStreaming && steps.length > 0 && steps.every(s => s.status !== 'running')) {
            setCollapsed(true);
        }
    }, [isStreaming, steps]);

    // Reset collapsed state when steps are cleared (new message)
    useEffect(() => {
        if (steps.length === 0) setCollapsed(false);
    }, [steps.length]);

    if (steps.length === 0) return null;

    const completedCount = steps.filter(s => s.status === 'completed').length;
    const totalDuration = steps.reduce((sum, s) => {
        if (s.completedAt && s.startedAt) return sum + (s.completedAt - s.startedAt);
        return sum;
    }, 0);

    const formatDuration = (ms: number): string => {
        if (ms < 1000) return `${ms}ms`;
        return `${(ms / 1000).toFixed(1)}s`;
    };

    const getStepIcon = (status: AgentStep['status']) => {
        switch (status) {
            case 'completed': return '✓';
            case 'failed': return '✕';
            case 'running': return '●';
        }
    };

    if (collapsed) {
        return (
            <div class="agent-feed agent-feed--collapsed" onClick={() => setCollapsed(false)}>
                <span class="agent-feed__summary-icon">✨</span>
                <span class="agent-feed__summary-text">
                    {completedCount} steg utförda på {formatDuration(totalDuration)}
                </span>
                <svg class="agent-feed__expand-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="6 9 12 15 18 9" />
                </svg>
            </div>
        );
    }

    return (
        <div class="agent-feed">
            <div class="agent-feed__header">
                <span class="agent-feed__title">Agent</span>
                {completedCount === steps.length && steps.length > 0 && (
                    <button class="agent-feed__collapse-btn" onClick={() => setCollapsed(true)} aria-label="Minimera">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="18 15 12 9 6 15" />
                        </svg>
                    </button>
                )}
            </div>

            <div class="agent-feed__steps">
                {steps.map((step, i) => (
                    <div key={step.id} class={`agent-step agent-step--${step.status}`}>
                        <div class="agent-step__indicator">
                            <span class={`agent-step__icon agent-step__icon--${step.status}`}>
                                {getStepIcon(step.status)}
                            </span>
                            {i < steps.length - 1 && <div class="agent-step__connector" />}
                        </div>
                        <div class="agent-step__content">
                            <span class="agent-step__label">{step.label}</span>
                            {step.resultSummary && (
                                <span class="agent-step__result">{step.resultSummary}</span>
                            )}
                        </div>
                        <div class="agent-step__time">
                            {step.status === 'running' ? (
                                <span class="agent-step__running">pågår</span>
                            ) : step.completedAt && step.startedAt ? (
                                <span class="agent-step__duration">
                                    {formatDuration(step.completedAt - step.startedAt)}
                                </span>
                            ) : null}
                        </div>
                    </div>
                ))}
            </div>

            {usedMemories && usedMemories.length > 0 && (
                <div class="agent-feed__memories">
                    <span class="agent-feed__memories-label">Använde</span>
                    <div class="agent-feed__memory-chips">
                        {usedMemories.map(m => (
                            <span key={m.id} class="agent-feed__memory-chip" title={m.preview}>
                                {m.category}
                            </span>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};
```

**Step 2: Verify build**

Run: `cd apps/web && npm run build`

**Step 3: Commit**

```bash
git add apps/web/src/components/Chat/AgentActivityFeed.tsx
git commit -m "feat: add AgentActivityFeed timeline component"
```

---

## Task 5: Frontend — Agent Activity CSS

**Files:**
- Create: `apps/web/src/styles/components/agent-activity.css`

**Step 1: Create the stylesheet**

```css
/* ── Agent Activity Feed ── */

.agent-feed {
    background: var(--glass-bg, rgba(255, 255, 255, 0.7));
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid var(--border-light, rgba(0, 0, 0, 0.08));
    border-radius: 12px;
    padding: 0.75rem 1rem;
    margin-bottom: 0.5rem;
    animation: slideUpFade 0.3s ease;
}

[data-theme="dark"] .agent-feed {
    background: rgba(17, 24, 39, 0.7);
    border-color: rgba(255, 255, 255, 0.08);
}

.agent-feed--collapsed {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
    padding: 0.5rem 0.75rem;
    opacity: 0.7;
    transition: opacity 0.2s ease;
}

.agent-feed--collapsed:hover {
    opacity: 1;
}

.agent-feed__summary-icon {
    font-size: 0.85rem;
}

.agent-feed__summary-text {
    font-size: 0.8rem;
    color: var(--text-secondary);
}

.agent-feed__expand-icon {
    margin-left: auto;
    opacity: 0.5;
}

.agent-feed__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.5rem;
}

.agent-feed__title {
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-tertiary, #94a3b8);
}

.agent-feed__collapse-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-tertiary);
    padding: 4px;
    border-radius: 4px;
    display: flex;
    align-items: center;
}

.agent-feed__collapse-btn:hover {
    background: rgba(0, 0, 0, 0.05);
}

/* Steps timeline */
.agent-feed__steps {
    display: flex;
    flex-direction: column;
}

.agent-step {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    padding: 0.25rem 0;
    animation: slideUpFade 0.2s ease;
}

.agent-step__indicator {
    display: flex;
    flex-direction: column;
    align-items: center;
    flex-shrink: 0;
    width: 16px;
}

.agent-step__icon {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.6rem;
    font-weight: 700;
}

.agent-step__icon--completed {
    color: var(--status-success, #10b981);
}

.agent-step__icon--failed {
    color: var(--status-danger, #ef4444);
}

.agent-step__icon--running {
    color: var(--accent-color, #0ea5e9);
    animation: agentPulse 1.5s ease-in-out infinite;
}

.agent-step__connector {
    width: 1px;
    height: 12px;
    background: var(--border-light, rgba(0, 0, 0, 0.1));
    margin: 2px 0;
}

.agent-step__content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
}

.agent-step__label {
    font-size: 0.8rem;
    color: var(--text-primary);
    line-height: 1.3;
}

.agent-step--running .agent-step__label::after {
    content: '...';
    animation: fadeDots 1.5s ease-in-out infinite;
}

.agent-step__result {
    font-size: 0.7rem;
    color: var(--text-tertiary, #94a3b8);
}

.agent-step__time {
    flex-shrink: 0;
    font-size: 0.7rem;
    color: var(--text-tertiary, #94a3b8);
    font-variant-numeric: tabular-nums;
}

.agent-step__running {
    color: var(--accent-color, #0ea5e9);
    font-style: italic;
}

/* Used memories chips */
.agent-feed__memories {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.5rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--border-light, rgba(0, 0, 0, 0.06));
}

.agent-feed__memories-label {
    font-size: 0.7rem;
    color: var(--text-tertiary, #94a3b8);
    flex-shrink: 0;
}

.agent-feed__memory-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
}

.agent-feed__memory-chip {
    font-size: 0.65rem;
    padding: 2px 8px;
    border-radius: 100px;
    background: rgba(14, 165, 233, 0.1);
    color: var(--accent-color, #0ea5e9);
    border: 1px solid rgba(14, 165, 233, 0.2);
    white-space: nowrap;
}

[data-theme="dark"] .agent-feed__memory-chip {
    background: rgba(14, 165, 233, 0.15);
    border-color: rgba(14, 165, 233, 0.25);
}

/* Pulse animation for running steps */
@keyframes agentPulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
}

/* Respect reduced motion */
@media (prefers-reduced-motion: reduce) {
    .agent-step,
    .agent-feed {
        animation: none;
    }
    .agent-step__icon--running {
        animation: none;
    }
    .agent-step--running .agent-step__label::after {
        animation: none;
        content: '…';
    }
}
```

**Step 2: Import the CSS**

Add to `apps/web/src/styles/main.css` at the end of the component imports section (search for the last `@import` of a component file):

```css
@import './components/agent-activity.css';
```

**Step 3: Verify build**

Run: `cd apps/web && npm run build`

**Step 4: Commit**

```bash
git add apps/web/src/styles/components/agent-activity.css apps/web/src/styles/main.css
git commit -m "feat: add glassmorphism CSS for AgentActivityFeed"
```

---

## Task 6: Frontend — Wire AgentActivityFeed into ChatHistory

**Files:**
- Modify: `apps/web/src/components/Chat/ChatHistory.tsx` (lines 47-48 for state, lines 395-432 for events, lines 661-679 for render)

**Step 1: Add imports**

At the top imports, add:

```typescript
import { AgentActivityFeed, AgentStep } from './AgentActivityFeed';
```

**Step 2: Add agent steps state**

After line 48 (`streamingMetadata` state), add:

```typescript
const [agentSteps, setAgentSteps] = useState<AgentStep[]>([]);
const [usedMemories, setUsedMemories] = useState<Array<{ id: string; category: string; preview: string }>>([]);
```

**Step 3: Reset agent steps on conversation change**

In the conversation reset effect (line 74-75 area, where `setStreamingMessage(null)` and `setStreamingMetadata(null)` are called), add:

```typescript
setAgentSteps([]);
setUsedMemories([]);
```

**Step 4: Add event listeners for agent steps and used memories**

After the action plan/status `useEffect` block (after line 432), add a new `useEffect`:

```typescript
// Handle agent step events from SSE stream
useEffect(() => {
    const handleAgentStep = (e: CustomEvent) => {
        const step = e.detail;
        setAgentSteps(prev => {
            const idx = prev.findIndex(s => s.id === step.id);
            if (idx >= 0) {
                const updated = [...prev];
                updated[idx] = step;
                return updated;
            }
            return [...prev, step];
        });
    };

    const handleUsedMemories = (e: CustomEvent) => {
        setUsedMemories(e.detail || []);
    };

    window.addEventListener('chat-agent-step', handleAgentStep as EventListener);
    window.addEventListener('chat-used-memories', handleUsedMemories as EventListener);
    return () => {
        window.removeEventListener('chat-agent-step', handleAgentStep as EventListener);
        window.removeEventListener('chat-used-memories', handleUsedMemories as EventListener);
    };
}, []);
```

**Step 5: Clear agent steps when new streaming response starts**

Find the `chat-streaming-chunk` handler (the one that checks `isNewResponse`). Inside the `if (detail.isNewResponse)` block, add:

```typescript
setAgentSteps([]);
setUsedMemories([]);
```

**Step 6: Render AgentActivityFeed in the streaming bubble**

In the render section (lines 661-692), modify the streaming message block to include the feed.

Replace the block at lines 661-692 with:

```tsx
{(isThinking || streamingMessage) && (
    <div class="message ai-message thinking-message">
        {streamingMessage ? (
            <div class="bubble thinking-bubble streaming-bubble">
                {agentSteps.length > 0 && (
                    <AgentActivityFeed
                        steps={agentSteps}
                        usedMemories={usedMemories}
                        isStreaming={!!streamingMessage}
                    />
                )}
                {streamingMetadata?.type === 'action_plan' ? (
                    <>
                        {streamingMessage && (
                            <StreamingText content={streamingMessage} />
                        )}
                        <AIResponseRenderer
                            content=""
                            metadata={streamingMetadata as any}
                        />
                    </>
                ) : (
                    <StreamingText content={streamingMessage} />
                )}
            </div>
        ) : thinkingTimeout ? (
            <div class="bubble thinking-bubble">
                <div class="thinking-timeout">
                    <p>Det tar längre tid än vanligt...</p>
                    <button class="retry-btn" onClick={handleRetry}>Försök igen</button>
                </div>
            </div>
        ) : (
            <div class="thinking-status" role="status" aria-live="polite">
                <ThinkingAnimation />
            </div>
        )}
    </div>
)}
```

**Step 7: Verify build**

Run: `cd apps/web && npm run build`

**Step 8: Commit**

```bash
git add apps/web/src/components/Chat/ChatHistory.tsx
git commit -m "feat: wire AgentActivityFeed into ChatHistory streaming"
```

---

## Task 7: Frontend — Wire `request_clarification` to AIQuestionCard

**Files:**
- Modify: `supabase/functions/gemini-chat/index.ts` (line ~3494-3503, the `request_clarification` handler)
- Modify: `apps/web/src/services/ChatService.ts` (SSE parsing)
- Modify: `apps/web/src/components/Chat/ChatHistory.tsx` (render)

**Step 1: Backend — Send structured clarification data instead of plain text**

In `gemini-chat/index.ts`, replace the `request_clarification` handler (lines 3494-3503):

```typescript
} else if (toolName === "request_clarification") {
    const doneStep = emitAgentStep(controller, encoder, 'request_clarification', 'Behöver mer information', 'thinking');
    const clarArgs = toolArgs as { message?: string; missing_fields?: string[] };
    const clarText = clarArgs.message || "Jag behöver mer information för att kunna skapa en handlingsplan.";

    // Send as structured clarification event (AIQuestionCard can render it)
    const clarificationEvent = {
        clarification: {
            message: clarText,
            missing_fields: clarArgs.missing_fields || [],
        }
    };
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(clarificationEvent)}\n\n`));

    // Also send as text for fallback display
    const sseData = `data: ${JSON.stringify({ text: clarText })}\n\n`;
    controller.enqueue(encoder.encode(sseData));
    toolResponseText = clarText;
    doneStep();
    logger.info("Agent requested clarification", {
        missingFields: clarArgs.missing_fields,
    });
```

**Step 2: Frontend — Parse clarification event in ChatService**

In `ChatService.ts`, add to the SSE data type (at the type assertion near line 377):

```typescript
clarification?: { message: string; missing_fields: string[] };
```

And add dispatch after the `agentStep` dispatch:

```typescript
if (data.clarification) {
    window.dispatchEvent(new CustomEvent('chat-clarification', {
        detail: data.clarification
    }));
}
```

**Step 3: Frontend — Render AIQuestionCard in ChatHistory**

In `ChatHistory.tsx`, add state:

```typescript
const [clarification, setClarification] = useState<{ message: string; missing_fields: string[] } | null>(null);
```

Add event listener:

```typescript
const handleClarification = (e: CustomEvent) => {
    setClarification(e.detail);
};
window.addEventListener('chat-clarification', handleClarification as EventListener);
// ... cleanup in return
```

In the streaming bubble render, after `AgentActivityFeed` and before the `StreamingText`, add:

```tsx
{clarification && (
    <AIQuestionCard
        question={{
            id: 'clarification',
            question: clarification.message,
            options: clarification.missing_fields.map((f, i) => ({
                id: `field-${i}`,
                label: f,
            })),
            allowFreeText: true,
            placeholder: 'Ange den saknade informationen...',
        }}
        onAnswer={(_id, answer) => {
            const text = Array.isArray(answer) ? answer.join(', ') : answer;
            setClarification(null);
            // Send as user message through chat input
            window.dispatchEvent(new CustomEvent('chat-submit-message', { detail: { text } }));
        }}
    />
)}
```

Add import at top: `import { AIQuestionCard } from './ThinkingSteps';`

**Step 4: Verify build**

Run: `cd apps/web && npm run build`

**Step 5: Commit**

```bash
git add supabase/functions/gemini-chat/index.ts apps/web/src/services/ChatService.ts apps/web/src/components/Chat/ChatHistory.tsx
git commit -m "feat: wire request_clarification to AIQuestionCard"
```

---

## Task 8: Frontend — Add ConfidenceIndicator to ActionPlanCard

**Files:**
- Modify: `apps/web/src/components/Chat/ActionPlanCard.tsx` (lines 143-176, header section)

**Step 1: Import ConfidenceIndicator**

At the top of `ActionPlanCard.tsx`, add:

```typescript
import { ConfidenceIndicator } from './ThinkingSteps';
```

**Step 2: Replace the inline confidence pill with ConfidenceIndicator**

Find the confidence pill section (lines 168-172):

```tsx
{plan.actions[0]?.confidence != null && (
    <span class={`confidence-pill ${plan.actions[0].confidence >= 0.8 ? 'high' : plan.actions[0].confidence >= 0.5 ? 'medium' : 'low'}`}>
        {Math.round(plan.actions[0].confidence * 100)}% säkerhet
    </span>
)}
```

Replace with:

```tsx
{plan.actions[0]?.confidence != null && (
    <ConfidenceIndicator
        confidence={Math.round(plan.actions[0].confidence * 100)}
        showLabel={false}
    />
)}
```

**Step 3: Verify build**

Run: `cd apps/web && npm run build`

**Step 4: Commit**

```bash
git add apps/web/src/components/Chat/ActionPlanCard.tsx
git commit -m "feat: use ConfidenceIndicator in ActionPlanCard header"
```

---

## Task 9: Integration Test — Full Flow

**Files:** No new files — manual testing

**Step 1: Start local services**

```bash
npm run dev &
npm run supabase:start
npx supabase functions serve --no-verify-jwt
```

**Step 2: Test in browser**

1. Open http://localhost:5173
2. Toggle agent mode ON
3. Send: "Skapa en faktura till kund 1 för konsulttjänster 10 timmar à 1000 kr"
4. Verify:
   - AgentActivityFeed appears showing "Hämtar kundregister", "Hämtar artikelregister" etc.
   - Each step transitions from running (pulsing) → completed (check + duration)
   - Feed auto-collapses when text starts streaming
   - ActionPlanCard appears with ConfidenceIndicator bar
   - Click collapsed feed to re-expand

**Step 3: Test clarification flow**

1. Send: "Skapa en faktura" (without enough details)
2. Verify:
   - Agent step "Behöver mer information" appears
   - AIQuestionCard renders with missing fields
   - User can answer and the response continues

**Step 4: Test non-agent mode**

1. Toggle agent mode OFF
2. Send a regular question
3. Verify: No AgentActivityFeed appears (steps only emit during tool calls)

**Step 5: Test dark mode**

1. Toggle dark mode
2. Verify all agent feed elements are visible and correctly themed

**Step 6: Commit all remaining changes**

```bash
git add -A
git commit -m "feat: agentic response pipeline — complete integration"
```

---

## Summary

| Task | Description | Files | Est. Time |
|------|-------------|-------|-----------|
| 1 | `emitAgentStep` helper | gemini-chat/index.ts | 5 min |
| 2 | Instrument all tool calls | gemini-chat/index.ts | 15 min |
| 3 | Parse SSE events in ChatService | ChatService.ts | 5 min |
| 4 | AgentActivityFeed component | AgentActivityFeed.tsx (new) | 15 min |
| 5 | Agent activity CSS | agent-activity.css (new), main.css | 10 min |
| 6 | Wire into ChatHistory | ChatHistory.tsx | 15 min |
| 7 | AIQuestionCard wiring | gemini-chat, ChatService, ChatHistory | 15 min |
| 8 | ConfidenceIndicator in ActionPlanCard | ActionPlanCard.tsx | 5 min |
| 9 | Integration testing | Browser testing | 15 min |

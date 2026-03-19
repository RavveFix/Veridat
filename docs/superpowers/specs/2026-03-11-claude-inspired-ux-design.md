# Claude.ai-inspirerad UX — Thinking Steps, Laddningsanimation & Artifact-kort

## Context

Veridat's chat has functional AI artifacts and SSE streaming, but the UX lacks the polish of modern AI chat interfaces (Claude.ai, ChatGPT). Three upgrades will bring it to parity:
1. **Unified Thinking Steps** — show AI processing stages in real-time
2. **Branded Loading Animation** — replace plain dots with Veridat-branded animation
3. **Polished Artifact Cards** — icon headers, action buttons, variant-based styling

The goal: make Veridat's chat feel premium and trustworthy for Swedish small business owners.

---

## Feature 1: Unified Thinking Steps

### Current State
- `AgentStep` type tracks tool execution (id, tool, label, status, duration)
- `ThinkingSteps` component renders expandable tool execution timeline
- `ToolActivity` shows inline label for currently-running tool
- Backend sends `agentStep` SSE events during tool calls

### Design: Extend AgentStep for High-Level Thinking

Rather than adding a new `thinking` SSE event type, extend the existing `agentStep` pipeline:

**Backend (`gemini-chat/index.ts`):**
- Send thinking steps as `agentStep` events with `type: "thinking"` (existing tool steps use `type: "tool_call"`)
- Thinking steps: "Analyserar din fråga...", "Formulerar svar..." (always sent)
- Tool-contextual steps: "Hämtar fakturor från Fortnox..." (sent when tools activate)
- Optional `parentId` field to nest tool calls under thinking steps

**Types (`types/chat.ts`):**
```typescript
export interface AgentStep {
  id: string;
  type: "thinking" | "tool_call";  // NEW: distinguish step types
  tool: string;
  label: string;
  status: "running" | "completed" | "failed";
  startedAt: number;
  completedAt: number | null;
  resultSummary: string | null;
  parentId?: string | null;  // NEW: nest tool_call under thinking step
}
```

**Unified Component — replace both `ThinkingSteps` + `ToolActivity`:**
- Expandable (collapsed by default when complete, open when active)
- Top-level shows thinking steps with checkmark/spinner
- Tool calls nested under their parent thinking step (indented, with duration)
- Swedish labels: "Resonemang" header, "X steg slutförda" when collapsed

**Integration in `chat-history.tsx`:**
- Replace separate `ThinkingIndicator` + `ToolActivity` blocks
- Show unified thinking steps above streaming bubble when `isThinking && agentSteps.length > 0`
- Fall back to plain loading animation when no steps (simple text questions)

### Files to Modify
- `supabase/functions/gemini-chat/index.ts` — emit thinking agentStep events
- `veridat/src/types/chat.ts` — add `parentId` to `AgentStep`, add `"thinking"` type
- `veridat/src/components/chat/artifacts/thinking-steps.tsx` — rewrite as unified component
- `veridat/src/components/chat/chat-history.tsx` — replace ThinkingIndicator+ToolActivity with unified steps
- `veridat/src/components/chat/tool-activity.tsx` — DELETE (merged into thinking-steps)

---

## Feature 2: Branded Loading Animation

### Current State
- `ThinkingIndicator`: Veridat logo + 3 dots with `animate-thinking-pulse`
- `globals.css`: `@keyframes thinking-pulse` (scale + opacity)

### Design: Upgrade Animation

**New ThinkingIndicator:**
- Veridat shield logo with `thinking-spinner` border animation (replacing static logo)
- 3 cyan dots with sequential bounce animation (more dynamic than current pulse)
- Shown only when `isThinking && !streaming.text && streaming.agentSteps.length === 0`

**New CSS animations in `globals.css`:**
```css
/* Sequential bounce dots */
@keyframes thinking-bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
  30% { transform: translateY(-4px); opacity: 1; }
}

/* Spinner ring for avatar */
@keyframes spin-slow {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* Pulsing text for active thinking step */
@keyframes pulse-opacity {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
}
```

### Files to Modify
- `veridat/src/components/chat/thinking-indicator.tsx` — upgrade with spinner + bounce dots
- `veridat/src/app/globals.css` — add new keyframes, keep existing ones

---

## Feature 3: Polished Artifact Cards

### Current State
- `ArtifactCard`: collapsible card with type badge, copy button, expand toggle
- `TYPE_COLORS`/`TYPE_LABELS` maps for badge styling
- 6 specialized cards rendering structured data

### Design: New ArtifactCard with Variants

**New `ArtifactCard` props:**
```typescript
interface ArtifactCardProps {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  children: ReactNode;
  actions?: ReactNode;
  variant?: "default" | "success" | "warning" | "info";
  collapsible?: boolean;     // default: false
  defaultExpanded?: boolean;  // default: true (only relevant if collapsible)
  copyContent?: string;
}
```

**Visual Design:**
- Icon + title in header (with optional subtitle)
- Body content area
- Action buttons footer (optional, bg surface-1)
- Variant-based border colors (emerald/success, amber/warning, cyan/info)
- Hover: border brightens + subtle shadow
- Max width: `max-w-md` (448px)
- Collapse toggle only if `collapsible={true}`

**`ArtifactAction` helper component:**
```typescript
interface ArtifactActionProps {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary";
}
```
- Primary: cyan bg, black text
- Secondary: surface bg, muted text

**Card Migration Plan:**

| Card | Icon | Variant | Actions |
|------|------|---------|---------|
| ActionPlanCard | Zap | info | Godkänn, Avvisa |
| JournalEntryCard | BookOpen | success | Bokför, Redigera |
| VATSummaryCard | Receipt | success/warning | Skicka till Skatteverket, Exportera PDF |
| InvoiceListCard | FileText | info | Visa i Fortnox |
| CustomerListCard | Users | info | — |
| CompanyInfoCard | Building | default | — |

**New Card Types (frontend only, backend deferred):**
- `ReceiptCard` — kvitto display (Camera icon, info variant)
- `SupplierInvoiceCard` — leverantörsfaktura (FileInput icon, warning variant)

**Register in `ai-response-renderer.tsx`:**
- Import new card types
- Add `type === "receipt"` and `type === "supplier_invoice"` dispatch cases

### Files to Modify
- `veridat/src/components/chat/artifacts/artifact-card.tsx` — REWRITE with new design
- `veridat/src/components/chat/artifacts/action-plan-card.tsx` — migrate to new wrapper
- `veridat/src/components/chat/artifacts/journal-entry-card.tsx` — migrate
- `veridat/src/components/chat/artifacts/vat-summary-card.tsx` — migrate
- `veridat/src/components/chat/artifacts/invoice-list-card.tsx` — migrate
- `veridat/src/components/chat/artifacts/customer-list-card.tsx` — migrate
- `veridat/src/components/chat/artifacts/company-info-card.tsx` — migrate
- `veridat/src/components/chat/artifacts/receipt-card.tsx` — NEW
- `veridat/src/components/chat/artifacts/supplier-invoice-card.tsx` — NEW
- `veridat/src/components/chat/artifacts/ai-response-renderer.tsx` — register new cards

---

## Implementation Order

### Step 1: ArtifactCard base + ArtifactAction
Create new `artifact-card.tsx` with variant system, icon header, collapsible option, actions footer.

### Step 2: Migrate existing cards
Refactor all 6 existing cards to use new ArtifactCard wrapper. Verify each card still renders correctly.

### Step 3: New card types
Add ReceiptCard + SupplierInvoiceCard. Register in ai-response-renderer.tsx.

### Step 4: Loading animation
Upgrade ThinkingIndicator with branded spinner + bounce dots. Add CSS keyframes to globals.css.

### Step 5: Thinking steps — backend
Add thinking step SSE events in gemini-chat/index.ts. Update AgentStep type with `parentId` and `"thinking"` type.

### Step 6: Thinking steps — frontend
Rewrite thinking-steps.tsx as unified component. Update chat-history.tsx to use unified component. Delete tool-activity.tsx.

---

## Verification

1. **Artifact cards**: Send messages that trigger each card type (fakturor, verifikation, moms, etc.) — verify icon, title, actions render correctly
2. **Collapse behavior**: Test `collapsible` prop on cards with many rows
3. **Loading animation**: Send a message, observe dots + spinner before response
4. **Thinking steps**: Trigger a Fortnox tool call, verify thinking steps show with nested tool activity
5. **Streaming**: Verify text streaming still works correctly after all changes
6. **Dark/light mode**: Check all new components in both themes
7. **Mobile**: Verify `max-w-md` constraint and responsive behavior
8. **Build**: `npm run build` passes with no TypeScript errors

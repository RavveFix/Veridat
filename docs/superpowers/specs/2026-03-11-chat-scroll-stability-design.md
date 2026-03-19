# Chat Scroll Stability Design

## Context

The chat layout experiences visual jumping/shifting during message streaming:
- The chat input can be pushed down by growing content
- Auto-scroll fires on every streaming chunk without batching
- The thinking indicator has no min-height, causing layout shift when streaming text replaces it
- The `animate-stream-in` animation uses translateY(4px) which creates a visible jump
- No distinction between user-message scroll (should be instant) and AI-response scroll (should be smooth)

## Design

### 1. Pin Chat Input with Flex Layout

**File:** `veridat/src/components/chat/chat-input.tsx` (line 153)

Change the input wrapper from `sticky bottom-0` to `flex-shrink-0`:

```diff
- <div className="sticky bottom-0 z-10 w-full px-4 pb-4 pt-3 chat-input-fade">
+ <div className="flex-shrink-0 z-10 w-full px-4 pb-4 pt-3 chat-input-fade">
```

The parent `chat-layout.tsx` already uses `flex flex-col h-full`, so `flex-shrink-0` prevents the input from being compressed or pushed by message content. The gradient fade is preserved.

Note: Both `ChatHistory` (returns `flex-1` wrapper) and `WelcomeScreen` (also has `flex-1`) correctly fill remaining space, so the layout is safe on both paths.

### 2. Batch Auto-Scroll with requestAnimationFrame

**File:** `veridat/src/components/chat/chat-history.tsx` (lines 254-269)

Replace the current streaming scroll effect (lines 254-260) with a rAF-batched version. The existing effect has dependencies `[streaming.text, messages.length, optimisticMessages.length]`. We split responsibilities: this rAF effect handles streaming + message scroll, while the existing optimistic force-scroll effect (lines 262-269) stays unchanged for instant user-message snapping.

```tsx
// Ref to track pending scroll frame
const scrollRAFRef = useRef<number | null>(null);

// rAF-batched auto-scroll for streaming chunks and new messages
useEffect(() => {
  const container = scrollContainerRef.current;
  if (!isAtBottomRef.current || !container) return;

  if (scrollRAFRef.current !== null) {
    cancelAnimationFrame(scrollRAFRef.current);
  }
  scrollRAFRef.current = requestAnimationFrame(() => {
    container.scrollTop = container.scrollHeight;
    scrollRAFRef.current = null;
  });
}, [streaming.text, messages.length]);

// Cleanup on unmount
useEffect(() => {
  if (scrollRAFRef.current !== null) {
    cancelAnimationFrame(scrollRAFRef.current);
  }
}, []);
```

`optimisticMessages.length` is intentionally excluded — the separate force-scroll effect (unchanged, lines 262-269) handles optimistic messages with instant scroll + `isAtBottomRef.current = true`.

### 3. Stable Thinking → Streaming Transition

**File:** `veridat/src/components/chat/chat-history.tsx` (lines 219-221, 325-336)

**Critical: `useDeferredValue` race condition.** The current code defers `streaming.text` via `useDeferredValue` (line 220). When `isThinking` clears before the deferred text updates, both `isThinking` and `streaming.text` (deferred) are falsy for one render frame — collapsing the zone to zero height.

**Fix:** Use `rawStreaming.text` for the *visibility condition* but keep `deferredStreamingText` for the *rendered content*:

```tsx
// Deferred text for rendering (reduces re-render frequency)
const deferredStreamingText = useDeferredValue(rawStreaming.text);
const streaming = { ...rawStreaming, text: deferredStreamingText };

// Use raw (non-deferred) text for visibility to avoid flash of zero-height
const hasStreamingContent = !!rawStreaming.text;
```

Then in the JSX (replaces lines 325-336):

```tsx
{/* Thinking → Streaming crossfade zone */}
{(isThinking || hasStreamingContent) && (
  <div className="min-h-[2rem]">
    {!hasStreamingContent ? (
      <ThinkingText agentSteps={streaming.agentSteps} />
    ) : (
      <div className="flex flex-col items-start animate-fade-in" aria-live="off">
        <div className="max-w-[85%] text-[var(--text-primary)] text-[15px]">
          <StreamingText text={streaming.text} />
        </div>
      </div>
    )}
  </div>
)}
```

Key changes:
- `hasStreamingContent` uses `rawStreaming.text` (not deferred) to gate visibility — prevents the zero-height gap
- `min-h-[2rem]` (32px) matches ThinkingText's actual rendered height (14px text + 6px+6px py-1.5 padding = ~32px)
- Replaced `animate-stream-in` (translateY(4px) + scale = layout shift) with `animate-fade-in` (opacity-only 0.2s fade, no transform)
- Both states render in the same container, so height transitions smoothly

### 4. Differentiated Scroll Behavior

**File:** `veridat/src/components/chat/chat-history.tsx` (lines 262-269)

No changes needed. Already works correctly:
- User messages (optimistic): instant `scrollTop = scrollHeight` + force `isAtBottomRef = true`
- AI streaming: rAF-batched scroll from change #2
- Manual scroll-to-bottom button: `scrollTo({ behavior: "smooth" })` — unchanged

## Files Modified

| File | Change |
|------|--------|
| `veridat/src/components/chat/chat-input.tsx` | `sticky bottom-0` → `flex-shrink-0` |
| `veridat/src/components/chat/chat-history.tsx` | rAF scroll batching, `rawStreaming.text` visibility gate, `min-h-[2rem]` thinking zone, `animate-stream-in` → `animate-fade-in` |

## Verification

1. Start dev server (`npm run dev`)
2. Send a message — input should stay pinned at bottom, no jumping
3. During streaming — messages should auto-scroll smoothly without jitter
4. Scroll up during streaming — auto-scroll should stop, scroll-to-bottom button appears
5. Click scroll-to-bottom — smooth scroll to latest content
6. Send another message — instant snap to bottom
7. Watch thinking → streaming transition — no height jump when "Bearbetar information..." changes to actual text
8. Resize browser window — input stays fixed at bottom in all viewport sizes
9. Verify streaming text fades in smoothly (opacity animation, no transform shift)

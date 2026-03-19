# Claude-Style Chat Messages

**Date:** 2026-03-11
**Status:** Draft

## Context

The current chat UI shows avatar icons next to every message — a Veridat V-logo circle for AI responses and a blue user-icon circle for user messages. Both are wrapped in styled bubbles. The user wants a cleaner Claude AI-style conversation where AI responses are plain flowing text (no avatar, no bubble, no wrapper) and user messages keep their gradient bubble but lose the avatar icon.

## Design

### AI Messages (role: assistant)
- **Remove:** Avatar circle (VeriLogo + gradient background)
- **Remove:** Bubble wrapper — no `bg-[var(--card-bg)]`, no border, no `shadow-sm`, no `rounded-2xl`, no `rounded-bl-md` tail
- **Remove:** `.ai-message-bubble` dark-mode glass CSS rules from globals.css
- **Keep:** Markdown content rendered directly via `<AIResponseRenderer>`
- **Keep:** File attachment badge (if file_name present), styled inline without bubble border
- **Keep:** Timestamp below text (`text-[10px]`, left-aligned)
- **Layout:** Left-aligned, `max-w-[85%]` or full width within the `max-w-3xl` chat container

### User Messages (role: user)
- **Remove:** Avatar circle (User icon + blue background)
- **Keep:** Blue gradient bubble (`var(--accent-gradient)`), `rounded-2xl`, `rounded-tr-sm` tail, `shadow-sm`
- **Keep:** Right-aligned with `max-w-[75%]`
- **Keep:** Timestamp below bubble

### Streaming Messages
- Match new AI style — plain text with streaming cursor animation, no bubble wrapper

### Dark Mode
- Remove `.ai-message-bubble` glass effect rules (backdrop-filter, rgba background)
- AI text inherits standard `--text-primary` color
- No special dark-mode treatment needed for plain text

## Files to Modify

1. **`veridat/src/components/chat/chat-message.tsx`**
   - Remove avatar rendering for both roles
   - Remove bubble wrapper div for AI messages (keep wrapper for user)
   - Simplify the outer flex container (no `gap-3` for avatar spacing)

2. **`veridat/src/components/chat/chat-history.tsx`**
   - Update streaming message rendering to match new AI style (no bubble)

3. **`veridat/src/app/globals.css`**
   - Remove `.ai-message-bubble` dark-mode glass rules (lines ~854-859)
   - Remove `@supports not (backdrop-filter)` fallback for ai-message-bubble

## Verification

1. `npm run build` passes with no errors
2. Visual check: AI messages render as plain text (no bubble, no avatar)
3. Visual check: User messages render with blue gradient bubble (no avatar)
4. Visual check: Streaming messages match AI style
5. Visual check: Dark mode — AI text readable, no leftover glass effects
6. Visual check: File attachments still display correctly on AI messages
7. Visual check: Timestamps visible below both message types

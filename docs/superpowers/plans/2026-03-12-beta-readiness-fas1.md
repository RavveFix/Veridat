# Beta-Readiness Fas 1 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 7 beta-blocking issues in the veridat/ Next.js app (~5h total effort)

**Architecture:** All changes are in `veridat/`. No Edge Function or database changes. Security headers go in `next.config.ts`, error boundaries are new files in the app directory, and the remaining fixes are targeted edits to existing files.

**Tech Stack:** Next.js 16, React 19, TypeScript, Supabase (@supabase/ssr), Tailwind CSS v4

**Spec:** `docs/superpowers/specs/2026-03-12-beta-readiness-audit-design.md`

---

## Chunk 1: Security & Config

### Task 1: Security headers in next.config.ts (Finding #22/#1)

**Files:**
- Modify: `veridat/next.config.ts`

**Context:** The legacy app has security headers in the root `vercel.json` (lines 94-132), but those only apply to the legacy Vercel project. The veridat/ app on veridat.se has zero security headers. We port the same headers into `next.config.ts` using the Next.js `headers()` config.

- [ ] **Step 1: Add security headers to next.config.ts**

```typescript
import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-XSS-Protection", value: "1; mode=block" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-site" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
```

Note: We intentionally omit CSP here — it's in report-only mode in the legacy app and is a Fas 2 item (#25). HSTS is handled by Vercel automatically for custom domains.

- [ ] **Step 2: Verify build succeeds**

Run: `cd veridat && npm run build`
Expected: Build succeeds with no errors. Headers config is validated at build time.

- [ ] **Step 3: Verify headers are served locally**

Run: `cd veridat && npm run dev` (in background), then:
```bash
curl -sI http://localhost:3000 | grep -iE "x-frame|x-content-type|referrer-policy"
```
Expected: All three headers present in response.

- [ ] **Step 4: Commit**

```bash
git add veridat/next.config.ts
git commit -m "fix(security): add security headers to next.config.ts

Ports X-Frame-Options, X-Content-Type-Options, Referrer-Policy,
Permissions-Policy, COOP, and CORP from legacy vercel.json.

Ref: beta-readiness audit finding #1/#22"
```

---

### Task 2: Fix getSession() → getUser() in chat-service.ts (Finding #2)

**Files:**
- Modify: `veridat/src/lib/chat/chat-service.ts` (lines 116-118, 401-403, 498-501, 579-581)

**Context:** Supabase docs warn that `getSession()` reads from local storage and should not be trusted for authorization. `getUser()` makes a server call to verify the JWT. The `analyzeExcel` function at line 401 and `sendActionPlanResponse` at line 579 also use `getSession()`. However, we need the `access_token` from the session for the `Authorization` header. The pattern is: call `getUser()` first to verify auth, then `getSession()` for the token. See `veridat/src/lib/fortnox/api.ts:getAuthHeaders()` which already does this correctly.

- [ ] **Step 1: Fix sendToGemini auth check (line 113-123)**

Replace lines 113-123 in `chat-service.ts`:

```typescript
  const supabase = createClient();

  // Verify auth with server call (not local cache)
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    callbacks.onError("Inte inloggad");
    callbacks.onDone();
    return;
  }

  // Get session for access token (safe after getUser() verification)
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    callbacks.onError("Inte inloggad");
    callbacks.onDone();
    return;
  }
```

- [ ] **Step 2: Fix analyzeExcel auth check (line 400-406)**

Same pattern — add `getUser()` before `getSession()`:

```typescript
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("Inte inloggad");
  }
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    throw new Error("Inte inloggad");
  }
```

- [ ] **Step 3: Fix generateTitle auth check (line 497-501)**

```typescript
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
```

- [ ] **Step 4: Fix sendActionPlanResponse auth check (line 578-586)**

Same pattern as sendToGemini:

```typescript
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    callbacks.onError("Inte inloggad");
    callbacks.onDone();
    return;
  }
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    callbacks.onError("Inte inloggad");
    callbacks.onDone();
    return;
  }
```

- [ ] **Step 5: Verify build**

Run: `cd veridat && npm run build`
Expected: Build succeeds with no type errors.

- [ ] **Step 6: Commit**

```bash
git add veridat/src/lib/chat/chat-service.ts
git commit -m "fix(auth): verify auth with getUser() before getSession() in chat-service

getSession() reads from local cache and can be stale.
getUser() makes a server call to verify the JWT.
Pattern matches fortnox/api.ts:getAuthHeaders() which already does this.

Ref: beta-readiness audit finding #2"
```

---

### Task 3: Fix reader leak in sendToGemini (Finding #9)

**Files:**
- Modify: `veridat/src/lib/chat/chat-service.ts` (lines 287-320)

**Context:** When `sendToGemini()` reads the SSE stream, the `reader` is never cleaned up on error. Compare with `analyzeExcel()` at line 484-486 which correctly uses `finally { reader.cancel().catch(() => {}) }`. The same fix is needed for `sendToGemini` (lines 287-320) and `sendActionPlanResponse` (lines 668-691).

- [ ] **Step 1: Wrap sendToGemini stream reading in try/finally**

Replace lines 287-320 in `chat-service.ts`. The current code:

```typescript
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      // ... process events ...
    }
    // Flush remaining buffer
    if (buffer.trim()) { ... }
  } catch (streamError) {
    callbacks.onError(...);
  }

  callbacks.onDone();
```

Becomes:

```typescript
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      // ... process events ...
    }
    // Flush remaining buffer
    if (buffer.trim()) { ... }
  } catch (streamError) {
    callbacks.onError(
      streamError instanceof Error
        ? streamError.message
        : "Streamingfel",
    );
  } finally {
    reader.cancel().catch(() => {});
  }

  callbacks.onDone();
```

The key change is adding the `finally` block with `reader.cancel()`.

- [ ] **Step 2: Apply same fix to sendActionPlanResponse (lines 668-691)**

Same pattern — add `finally { reader.cancel().catch(() => {}); }` after the catch block at line 689.

- [ ] **Step 3: Verify build**

Run: `cd veridat && npm run build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add veridat/src/lib/chat/chat-service.ts
git commit -m "fix(streaming): add reader.cancel() in finally block for SSE streams

Prevents ReadableStream resource leak when streaming errors occur.
Matches existing pattern in analyzeExcel() (line 484-486).

Ref: beta-readiness audit finding #9"
```

---

### Task 4: Create .env.example (Finding #23)

**Files:**
- Create: `veridat/.env.example`

**Context:** The veridat/ app uses exactly two env vars (found via grep). Both are `NEXT_PUBLIC_` prefixed and required for Supabase connectivity.

- [ ] **Step 1: Create .env.example**

```bash
# Supabase project credentials (required)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

- [ ] **Step 2: Commit**

```bash
git add veridat/.env.example
git commit -m "docs: add .env.example for veridat

Documents required environment variables for developer onboarding.

Ref: beta-readiness audit finding #23"
```

---

### Task 5: Create robots.txt (Finding #36)

**Files:**
- Create: `veridat/public/robots.txt`

**Context:** Without robots.txt, search engines can crawl and index `/dashboard/` routes which are behind authentication. The landing page, terms, and privacy policy should remain indexable.

- [ ] **Step 1: Create robots.txt**

```
User-agent: *
Allow: /
Disallow: /dashboard/
Disallow: /callback
Disallow: /logout
```

- [ ] **Step 2: Commit**

```bash
git add veridat/public/robots.txt
git commit -m "seo: add robots.txt to block dashboard crawling

Prevents search engines from indexing authenticated routes.
Landing page, terms, and privacy policy remain indexable.

Ref: beta-readiness audit finding #36"
```

---

## Chunk 2: Error Boundaries & Realtime Resilience

### Task 6: Add error boundaries (Finding #6)

**Files:**
- Create: `veridat/src/app/error.tsx`
- Create: `veridat/src/app/not-found.tsx`
- Create: `veridat/src/app/global-error.tsx`
- Create: `veridat/src/app/dashboard/error.tsx`

**Context:** Next.js App Router uses file conventions for error handling. `error.tsx` catches runtime errors in the route segment, `not-found.tsx` handles 404s, and `global-error.tsx` catches errors in the root layout itself. All must be client components (`"use client"`). Design should match the existing dark theme using CSS variables from `globals.css`.

- [ ] **Step 1: Create app-level error.tsx**

Create `veridat/src/app/error.tsx`:

```tsx
"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("App error:", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg-color)] px-4">
      <div className="text-center max-w-md">
        <h1 className="text-2xl font-semibold text-[var(--text-primary)] mb-2">
          Något gick fel
        </h1>
        <p className="text-[var(--text-secondary)] mb-6">
          Ett oväntat fel uppstod. Försök igen eller ladda om sidan.
        </p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="px-4 py-2 rounded-lg bg-[var(--accent-primary)] text-white font-medium hover:opacity-90 transition-opacity"
          >
            Försök igen
          </button>
          <a
            href="/dashboard"
            className="px-4 py-2 rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            Till startsidan
          </a>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create not-found.tsx**

Create `veridat/src/app/not-found.tsx`:

```tsx
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg-color)] px-4">
      <div className="text-center max-w-md">
        <h1 className="text-6xl font-bold text-[var(--text-primary)] mb-2">
          404
        </h1>
        <p className="text-[var(--text-secondary)] mb-6">
          Sidan kunde inte hittas.
        </p>
        <Link
          href="/dashboard"
          className="inline-block px-4 py-2 rounded-lg bg-[var(--accent-primary)] text-white font-medium hover:opacity-90 transition-opacity"
        >
          Till startsidan
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create global-error.tsx**

Create `veridat/src/app/global-error.tsx` (catches errors in root layout — must include its own `<html>` and `<body>`):

```tsx
"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="sv">
      <body style={{ backgroundColor: "#0b1118", color: "#e2e8f0", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
          <div style={{ textAlign: "center", maxWidth: "28rem" }}>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 600, marginBottom: "0.5rem" }}>
              Något gick fel
            </h1>
            <p style={{ color: "#a2adbd", marginBottom: "1.5rem" }}>
              Ett allvarligt fel uppstod. Försök ladda om sidan.
            </p>
            <button
              onClick={reset}
              style={{
                padding: "0.5rem 1rem",
                borderRadius: "0.5rem",
                backgroundColor: "#38bdf8",
                color: "#0b1118",
                fontWeight: 500,
                border: "none",
                cursor: "pointer",
              }}
            >
              Ladda om
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
```

Note: `global-error.tsx` uses inline styles because CSS may not be available when the root layout fails.

- [ ] **Step 4: Create dashboard-specific error.tsx**

Create `veridat/src/app/dashboard/error.tsx`:

```tsx
"use client";

import { useEffect } from "react";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Dashboard error:", error);
  }, [error]);

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="text-center max-w-md">
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-2">
          Kunde inte ladda sidan
        </h2>
        <p className="text-[var(--text-secondary)] mb-6">
          Något gick fel. Dina data är säkra.
        </p>
        <button
          onClick={reset}
          className="px-4 py-2 rounded-lg bg-[var(--accent-primary)] text-white font-medium hover:opacity-90 transition-opacity"
        >
          Försök igen
        </button>
      </div>
    </div>
  );
}
```

Note: Dashboard error renders inside the existing sidebar layout (no min-h-screen), so it appears in the main content area.

- [ ] **Step 5: Verify build**

Run: `cd veridat && npm run build`
Expected: Build succeeds. All four error boundary files are compiled.

- [ ] **Step 6: Commit**

```bash
git add veridat/src/app/error.tsx veridat/src/app/not-found.tsx veridat/src/app/global-error.tsx veridat/src/app/dashboard/error.tsx
git commit -m "feat(error): add error boundaries and 404 page

- error.tsx: catches runtime errors with retry + home link
- not-found.tsx: branded 404 page
- global-error.tsx: fallback when root layout fails (inline styles)
- dashboard/error.tsx: error within sidebar layout

All text in Swedish. Uses existing CSS variables for theming.

Ref: beta-readiness audit finding #6"
```

---

### Task 7: Add realtime error callbacks + reconnection (Finding #14)

**Files:**
- Modify: `veridat/src/hooks/use-realtime-messages.ts`
- Modify: `veridat/src/hooks/use-realtime-conversations.ts`

**Context:** Both hooks call `.subscribe()` without error handling. The Supabase Realtime `.subscribe()` accepts a callback `(status, err)` where status can be `SUBSCRIBED`, `TIMED_OUT`, `CLOSED`, or `CHANNEL_ERROR`. On error or close, we log and resubscribe once after 5s. Retry channels use a `:retry` suffix to avoid duplicate channel name conflicts. We keep it simple: one retry, then give up silently (the next user action will trigger a refetch anyway).

**Note on imports:** `RealtimeChannel` is re-exported from `@supabase/supabase-js` in v2.x. If it doesn't resolve at type-check (Step 3), fall back to `import type { RealtimeChannel } from "@supabase/realtime-js"` or remove the explicit type annotation and rely on inference.

- [ ] **Step 1: Add error handling to use-realtime-messages.ts**

Replace the full file content:

```typescript
"use client";

import { useEffect, useRef } from "react";
import { useSupabase } from "./use-supabase";
import type { Message } from "@/types/chat";
import type { RealtimeChannel } from "@supabase/supabase-js";

/**
 * Subscribe to Supabase Realtime `postgres_changes` on the `messages` table,
 * filtered by conversation_id. Calls `onMessage` for every INSERT.
 *
 * Includes error handling: logs failures and retries once after 5s.
 */
export function useRealtimeMessages(
  conversationId: string | null,
  onMessage: (message: Message) => void,
) {
  const supabase = useSupabase();

  const callbackRef = useRef(onMessage);
  callbackRef.current = onMessage;

  useEffect(() => {
    if (!conversationId) return;

    let retryTimeout: ReturnType<typeof setTimeout>;
    let retryChannel: RealtimeChannel | null = null;

    function createChannel() {
      return supabase
        .channel(`messages:${conversationId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "messages",
            filter: `conversation_id=eq.${conversationId}`,
          },
          (payload) => {
            callbackRef.current(payload.new as Message);
          },
        );
    }

    const channel = createChannel()
      .subscribe((status, err) => {
        if (status === "TIMED_OUT" || status === "CHANNEL_ERROR" || status === "CLOSED") {
          console.warn(`[realtime] messages subscription ${status}`, err);
          // Retry once after 5s
          retryTimeout = setTimeout(() => {
            supabase.removeChannel(channel);
            retryChannel = supabase
              .channel(`messages:${conversationId}:retry`)
              .on(
                "postgres_changes",
                {
                  event: "INSERT",
                  schema: "public",
                  table: "messages",
                  filter: `conversation_id=eq.${conversationId}`,
                },
                (payload) => {
                  callbackRef.current(payload.new as Message);
                },
              )
              .subscribe();
          }, 5_000);
        }
      });

    return () => {
      clearTimeout(retryTimeout);
      supabase.removeChannel(channel);
      if (retryChannel) supabase.removeChannel(retryChannel);
    };
  }, [conversationId, supabase]);
}
```

- [ ] **Step 2: Add error handling to use-realtime-conversations.ts**

Replace the full file content:

```typescript
"use client";

import { useEffect, useRef } from "react";
import { useSupabase } from "./use-supabase";
import type { RealtimeChannel } from "@supabase/supabase-js";

/**
 * Subscribe to Supabase Realtime `postgres_changes` on the `conversations`
 * table, filtered by user_id. Fires `onConversationChange` on any change.
 *
 * Includes error handling: logs failures and retries once after 5s.
 */
export function useRealtimeConversations(
  userId: string | null,
  onConversationChange: () => void,
) {
  const supabase = useSupabase();

  const callbackRef = useRef(onConversationChange);
  callbackRef.current = onConversationChange;

  useEffect(() => {
    if (!userId) return;

    let retryTimeout: ReturnType<typeof setTimeout>;
    let retryChannel: RealtimeChannel | null = null;

    function createChannel() {
      return supabase
        .channel(`conversations:${userId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "conversations",
            filter: `user_id=eq.${userId}`,
          },
          () => {
            callbackRef.current();
          },
        );
    }

    const channel = createChannel()
      .subscribe((status, err) => {
        if (status === "TIMED_OUT" || status === "CHANNEL_ERROR" || status === "CLOSED") {
          console.warn(`[realtime] conversations subscription ${status}`, err);
          retryTimeout = setTimeout(() => {
            supabase.removeChannel(channel);
            retryChannel = supabase
              .channel(`conversations:${userId}:retry`)
              .on(
                "postgres_changes",
                {
                  event: "*",
                  schema: "public",
                  table: "conversations",
                  filter: `user_id=eq.${userId}`,
                },
                () => {
                  callbackRef.current();
                },
              )
              .subscribe();
          }, 5_000);
        }
      });

    return () => {
      clearTimeout(retryTimeout);
      supabase.removeChannel(channel);
      if (retryChannel) supabase.removeChannel(retryChannel);
    };
  }, [userId, supabase]);
}
```

- [ ] **Step 3: Verify RealtimeChannel import resolves**

Run: `cd veridat && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No type errors related to `RealtimeChannel` or the subscribe callback signature.

- [ ] **Step 4: Verify build**

Run: `cd veridat && npm run build`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add veridat/src/hooks/use-realtime-messages.ts veridat/src/hooks/use-realtime-conversations.ts
git commit -m "fix(realtime): add error callbacks and retry to subscriptions

Both hooks now handle TIMED_OUT, CHANNEL_ERROR, and CLOSED status
from Supabase Realtime. On failure, logs warning and retries once
after 5s with a :retry channel suffix to avoid name conflicts.
Prevents silent subscription death.

Ref: beta-readiness audit finding #14"
```

---

## Verification

After all 7 tasks are complete:

- [ ] **Final build check**

Run: `cd veridat && npm run build`
Expected: Clean build, no warnings related to our changes.

- [ ] **Manual smoke test checklist**

Run `cd veridat && npm run dev` and verify:

1. Visit `http://localhost:3000/nonexistent` → should show branded 404 page
2. Visit `http://localhost:3000/dashboard` → should redirect to login (or show dashboard if logged in)
3. Check response headers with `curl -sI http://localhost:3000 | grep -i x-frame` → should show `DENY`
4. Verify `http://localhost:3000/robots.txt` → should show our rules
5. Open browser console on chat page → verify no `getSession` deprecation warnings

- [ ] **Final commit (if any cleanup needed)**

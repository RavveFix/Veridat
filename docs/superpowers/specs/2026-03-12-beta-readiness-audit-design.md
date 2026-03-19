# Beta-Readiness Audit: Veridat Next.js App

**Datum:** 2026-03-12
**Scope:** `veridat/` (Next.js 16) — production target på veridat.se
**Syfte:** Identifiera och prioritera vad som krävs för production-grade beta med riktiga användare

---

## Bakgrund

Veridat är en AI-driven bokföringsassistent för svenska småföretag. Appen migreras från en Vite+Preact SPA (`apps/web/`) till Next.js 16 (`veridat/`). Alla features är byggda — landing page, auth, chat med SSE-streaming, Fortnox-koppling, GDPR/juridik, onboarding, settings, read-tools, usage tracking. Appen är live på Vercel (veridat.se).

Denna audit fokuserar på säkerhet, error handling, deployment-config och UX-polish — inte nya features.

---

## Findings: 39 totalt

### Sektion 1: Security (5 findings)

| # | Severity | Issue | Fil |
|---|----------|-------|-----|
| 1 | CRITICAL | `next.config.ts` är tom — inga security headers (legacy har dem i vercel.json) | `veridat/next.config.ts` |
| 2 | MEDIUM | `getSession()` istället för `getUser()` i chat-service.ts rad 118 — stale cache-risk per Supabase docs | `src/lib/chat/chat-service.ts:118` |
| 3 | MEDIUM | Consent-checkbox valideras enbart client-side i login-form.tsx | `src/components/login-form.tsx` |
| 4 | LOW | Logout route saknar CSRF/origin-validering | `src/app/(auth)/logout/route.ts` |
| 5 | LOW | `window.history.replaceState` i chat-provider.tsx rad 536 kringgår Next.js router | `src/components/chat/chat-provider.tsx:536` |

### Sektion 2: Error Handling & Edge Cases (14 findings)

**Saknas helt:**

| # | Severity | Issue | Fil |
|---|----------|-------|-----|
| 6 | CRITICAL | Inga error boundaries — varken `error.tsx`, `not-found.tsx` eller `loading.tsx` | `src/app/` |
| 7 | HIGH | Ingen Sentry-integration — zero production error telemetry | `package.json` |
| 8 | HIGH | Ingen global error handler — varken `window.onerror` eller `unhandledrejection` | — |

**SSE Streaming:**

| # | Severity | Issue | Fil |
|---|----------|-------|-----|
| 9 | HIGH | Reader-läcka vid fel — `reader.cancel()` anropas aldrig i `sendToGemini()` (jfr `analyzeExcel` rad 485 som gör rätt) | `src/lib/chat/chat-service.ts:287-320` |
| 10 | MEDIUM | Trasig JSON → tyst dataförlust — partiell JSON blir plain text utan loggning | `src/lib/chat/sse-parser.ts:60` |
| 11 | LOW | Ingen timeout-retry (till skillnad från 429 som har backoff) | `src/lib/chat/chat-service.ts:148-149` |

**Fortnox API:**

| # | Severity | Issue | Fil |
|---|----------|-------|-----|
| 12 | HIGH | Ingen 429-retry — Gemini har exponential backoff, Fortnox failar direkt | `src/lib/fortnox/api.ts:31-51` |
| 13 | MEDIUM | Generiska felmeddelanden utan att skilja timeout/auth/data-fel | `src/components/fortnox/vat-report-card.tsx:35` |

**Supabase Realtime:**

| # | Severity | Issue | Fil |
|---|----------|-------|-----|
| 14 | HIGH | Subscriptions dör tyst — `.subscribe()` utan error-callback, ingen reconnection | `src/hooks/use-realtime-messages.ts:27-41` |
| 15 | MEDIUM | Ingen heartbeat — döda connections upptäcks inte | Båda realtime-hooks |

**Auth:**

| # | Severity | Issue | Fil |
|---|----------|-------|-----|
| 16 | MEDIUM | Ingen cross-tab sync — inloggning i tab A syns inte i tab B | — |
| 17 | LOW | Magic link-expiry ger generiskt fel istället för "länken har gått ut" | `src/app/(auth)/callback/route.ts:17-18` |

**File Upload:**

| # | Severity | Issue | Fil |
|---|----------|-------|-----|
| 18 | MEDIUM | Enbart client-side validering av filstorlek och typ | `src/lib/chat/file-service.ts:31-32` |
| 19 | LOW | Ingen magic number-validering — litar på MIME-typ + extension | `src/lib/chat/file-service.ts:55-70` |

### Sektion 3: Deployment & Config (8 findings)

| # | Severity | Issue | Fil |
|---|----------|-------|-----|
| 20 | HIGH | veridat byggs/testas aldrig i CI — ci.yml kör enbart legacy-appen | `.github/workflows/ci.yml` |
| 21 | HIGH | Inget test-script i package.json | `veridat/package.json` |
| 22 | CRITICAL | next.config.ts tom (= #1, security headers) | `veridat/next.config.ts` |
| 23 | MEDIUM | Ingen .env.example — env-vars dokumenteras inte | `veridat/` |
| 24 | MEDIUM | PWA manifest saknas (legacy har det) | `veridat/public/` |
| 25 | MEDIUM | CSP i report-only mode + `'unsafe-inline'` | `vercel.json:127` |
| 26 | LOW | Ingen bundle-analys (framer-motion + react-markdown) | — |
| 27 | LOW | Ingen .vercelignore | — |

### Sektion 4: Feature Gaps & Polish (12 findings)

**UX-kritiskt:**

| # | Severity | Issue | Fil |
|---|----------|-------|-----|
| 28 | MEDIUM | Kontoborttagning saknas — manuell via Supabase + "kontakta oss" räcker för beta | Settings |
| 29 | MEDIUM | Cmd+K "Sök" → "Sök kommer snart"-toast — ta bort eller implementera | `src/hooks/use-keyboard-shortcuts.ts:26` |
| 30 | MEDIUM | Modaler saknar focus trap och Escape-stöd | `src/components/onboarding/welcome-modal.tsx` |

**Loading & Empty States:**

| # | Severity | Issue | Fil |
|---|----------|-------|-----|
| 31 | MEDIUM | Inga skeletons för chatthistorik vid initial load | Chat-vyn |
| 32 | LOW | Sidebar-konversationslista utan loading state | `src/components/sidebar/app-sidebar.tsx` |
| 33 | LOW | Onboarding-steg sparas inte vid avbrott | `src/components/onboarding/onboarding-wrapper.tsx` |

**Mobile:**

| # | Severity | Issue | Fil |
|---|----------|-------|-----|
| 34 | MEDIUM | Touch targets för små (<44px) | Flera komponenter |
| 35 | LOW | Welcome modal `max-w-lg` utan `w-full` på mobil | `src/components/onboarding/welcome-modal.tsx` |

**SEO & Discoverability:**

| # | Severity | Issue | Fil |
|---|----------|-------|-----|
| 36 | MEDIUM | Ingen robots.txt — /dashboard/ kan indexeras | `public/` |
| 37 | LOW | Ingen sitemap.xml | `public/` |

**Chat UX (nice-to-have):**

| # | Severity | Issue | Fil |
|---|----------|-------|-----|
| 38 | LOW | Ingen feedback (tumme upp/ner) på AI-svar | Chat-meddelanden |
| 39 | LOW | Ingen export av konversationer | — |

---

## Prioriterad Implementation Plan

### Fas 1: Beta-blockerare (~5h)

Måste fixas innan riktiga beta-användare bjuds in.

| # | Finding | Effort | Motivering |
|---|---------|--------|------------|
| 22/1 | Security headers i `next.config.ts` | ~1h | Öppen attack-yta utan X-Frame-Options, HSTS, etc. |
| 6 | `error.tsx` + `not-found.tsx` i app/ och dashboard/ | ~1h | Krasch → varumärkeslös Next.js default-sida |
| 9 | Reader-läcka: `finally { reader.cancel() }` i `sendToGemini()` | ~15min | Resursläcka vid varje streaming-fel |
| 14 | Realtime error callbacks + reconnection-strategi | ~2h | Tyst död subscription = "chatten slutade fungera" |
| 2 | `getSession()` → `getUser()` i chat-service.ts | ~10min | Supabase docs: getSession() ska inte användas för auth |
| 23 | `.env.example` | ~15min | Nödvändigt för onboarding av andra devs |
| 36 | `robots.txt` (blockera /dashboard/) | ~10min | Sökmotorer kan indexera autentiserade sidor |

### Fas 2: Kvalitetshöjning (~11h, första veckan efter beta)

| # | Finding | Effort |
|---|---------|--------|
| 7 | Sentry-integration (`@sentry/nextjs`) | ~2h |
| 12 | Fortnox 429-retry (kopiera Gemini-pattern) | ~1h |
| 3 | Consent server-side enforcement i callback | ~30min |
| 20+21 | CI-steg för veridat build + lint + test-script | ~1.5h |
| 30 | Modal focus trap + Escape | ~1h |
| 34 | Touch targets ≥44px | ~1h |
| 31 | Skeleton screens för chat + sidebar | ~2h |
| 25 | CSP → enforcing mode | ~2h |
| 8 | Global `unhandledrejection` handler | ~30min |

### Fas 3: Polish (post-beta, backlog)

Resterande 23 findings prioriterade efter användarfeedback: magic link expiry UX (#17), cross-tab auth sync (#16), Cmd+K sök (#29), konversationsexport (#39), AI-feedback (#38), bundle-analys (#26), PWA manifest (#24), kontoborttagning self-service (#28), m.m.

---

## Avgränsningar

- **Scope:** Enbart `veridat/` Next.js-appen. Backend (Edge Functions) delas med legacy och auditeras inte separat.
- **Viewport meta tag:** Verifierad — Next.js injicerar automatiskt. Ej ett problem.
- **Kontoborttagning:** Manuell via Supabase dashboard + "kontakta oss" räcker juridiskt under beta med begränsat antal testare.
- **Sentry:** Flyttad till Fas 2 — Vercel logs + browser console räcker för 5-10 beta-testare.
- **CI (#20):** HIGH, inte CRITICAL — Vercel bygger vid push, så build-failures fångas. Kritiskt först vid fler devs.

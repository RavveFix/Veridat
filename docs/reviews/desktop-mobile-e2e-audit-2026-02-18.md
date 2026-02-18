# Desktop + Mobile E2E Audit (Web + PWA)

Datum: 2026-02-18

## Scope
- Plattform: Web + PWA (inte Electron/Tauri)
- Browser-matris: Chromium + WebKit
- Device-matris:
  - `desktop-chromium` (1440x900)
  - `tablet-chromium` (1024x1366)
  - `mobile-chromium` (412x915)
  - `mobile-webkit` (iPhone 12 / 390x844)
- Kärnflöden:
  - Landing -> Login
  - Login + consent
  - App-shell + sidebar/search
  - Fortnox-panel
  - PWA metadata

## Körda kommandon
```bash
npm run supabase:start
npm run supabase:setup
npm run build
PLAYWRIGHT_BASE_URL=http://127.0.0.1:5175 npm run test:e2e -- tests/e2e/auth-legal-consent-agent.spec.ts tests/e2e/search-modal-agent.spec.ts tests/e2e/fortnox-panel-sandbox-agent.spec.ts tests/e2e/responsive-core-audit.spec.ts --project=desktop-chromium --project=tablet-chromium --project=mobile-chromium --project=mobile-webkit
```

## Sammanfattning
- `npm run build`: PASS
- `npm run supabase:start`: FAIL (Docker daemon ej tillgänglig)
- `npm run supabase:setup`: FAIL (Docker ej igång)
- Riktad kärnsvit (32 tester):
  - PASS: 4
  - SKIPPED: 8
  - FAIL: 20

Fail-fördelning:
- 16/20 = miljöblockering (`SUPABASE_SERVICE_ROLE_KEY` saknas efter misslyckad lokal Supabase-setup)
- 4/20 = verkliga UI-fynd i Landing/Login-flödet

## Pass/Fail-matris
| Flöde | desktop-chromium | tablet-chromium | mobile-chromium | mobile-webkit |
|---|---|---|---|---|
| Landing -> Login | FAIL | FAIL | FAIL | FAIL |
| Login + consent | ENV BLOCKER | ENV BLOCKER | ENV BLOCKER | ENV BLOCKER |
| App-shell + sidebar/search | SKIPPED (env precheck) | SKIPPED (env precheck) | SKIPPED (env precheck) | SKIPPED (env precheck) |
| Search modal (agent spec) | ENV BLOCKER | ENV BLOCKER | ENV BLOCKER | ENV BLOCKER |
| Fortnox panel (agent spec) | ENV BLOCKER | ENV BLOCKER | ENV BLOCKER | ENV BLOCKER |
| PWA metadata | PASS | PASS | PASS | PASS |

## Findings (prioriterade)

### 1. Critical — Lokal E2E-miljö blockerad (Docker/Supabase)
- Typ: Env blocker
- Påverkan: Hela auth- och app-inloggningsflödet kan inte verifieras E2E.
- Evidens:
  - `supabase start` fel: Docker daemon inte nåbar.
  - `supabase:setup` fel: Docker körs inte.
  - E2E-fel: `SUPABASE_SERVICE_ROLE_KEY saknas` i `tests/e2e/helpers/auth.ts`.
- Repro:
  1. Kör `npm run supabase:start`.
  2. Se fel om Docker daemon.
- Rekommenderad åtgärd: Starta Docker Desktop, kör om `supabase:start` + `supabase:setup`, verifiera att `.env.local` får lokala nycklar.
- Estimering: `S`

### 2. High — Primär login-CTA ligger utanför viewport på mobile
- Typ: Produktfel
- Påverkan: Kritisk CTA (`a[href="/login"]`) ligger delvis utanför högerkant på små skärmar.
- Påverkade profiler:
  - `mobile-chromium` (412px): elementets högerkant ~588px
  - `mobile-webkit` (390px): elementets högerkant ~588px
- Evidens: `responsive-core-audit.spec.ts` landing-test, fel från `assertCriticalControlsInViewport`.
- Repro:
  1. Öppna `/` i mobile viewport.
  2. Kontrollera CTA-länken till login.
  3. Den överskrider viewportbredd.
- Rekommenderad åtgärd: Säkerställ mobil layout-wrap/stack för hero-actions och begränsa CTA-container med `max-width: 100%`, `overflow-wrap`, korrekt flex-wrapping.
- Estimering: `M`

### 3. Medium — Primär login-CTA underskrider 44px minsta tryckyta
- Typ: Produktfel
- Påverkan: Sämre touch/click-ergonomi och tillgänglighet.
- Påverkade profiler:
  - `desktop-chromium`
  - `tablet-chromium`
- Evidens: uppmätt höjd ~41.05px i landing-testet.
- Repro:
  1. Öppna `/`.
  2. Mät `a[href="/login"]` (höjd).
  3. Höjd < 44px.
- Rekommenderad åtgärd: Öka vertikal padding/min-height på primär CTA till minst 44px.
- Estimering: `S`

### 4. Low — Ingen service worker registrerad i Web+PWA-flödet
- Typ: Produkt-/UX-observation
- Påverkan: PWA metadata är korrekt men offline-stöd/caching saknas sannolikt.
- Evidens:
  - PWA-metadata PASS (`manifest`, `display: standalone`, `start_url: /app/`).
  - Service worker-registreringar: 0 i runtime-kontroll.
- Repro:
  1. Öppna app-origin i browser.
  2. Kontrollera `navigator.serviceWorker.getRegistrations()`.
  3. Inga registreringar returneras.
- Rekommenderad åtgärd: Bekräfta om offline/PWA-caching är krav. Om ja: registrera SW och lägg minimala cache-strategier för shell-assets.
- Estimering: `M`

## Rekommendation (Go/No-Go)
- Status: **Inte redo** för full desktop/mobile E2E sign-off.
- Skäl:
  - Critical miljöblockering hindrar verifiering av auth-baserade kärnflöden.
  - High produktfel i mobil Landing/Login-CTA.

## Nästa steg
1. Starta Docker Desktop och kör om lokal Supabase setup.
2. Fixa landing-CTA mobil layout + tap-target storlek.
3. Kör om samma riktade kärnsvit över fyra projekt.
4. Om offline-PWA krävs: implementera SW och lägg verifiering i audit-spec.

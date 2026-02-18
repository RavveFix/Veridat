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
PLAYWRIGHT_BASE_URL=http://127.0.0.1:5175 node ./node_modules/@playwright/test/cli.js test tests/e2e/auth-legal-consent-agent.spec.ts tests/e2e/search-modal-agent.spec.ts tests/e2e/fortnox-panel-sandbox-agent.spec.ts tests/e2e/responsive-core-audit.spec.ts --project=desktop-chromium --project=tablet-chromium --project=mobile-chromium --project=mobile-webkit
```

## Sammanfattning
- `npm run build`: PASS
- `npm run supabase:start`: PASS
- `npm run supabase:setup`: PASS
- Riktad kärnsvit (32 tester):
  - PASS: 32
  - SKIPPED: 0
  - FAIL: 0

## Pass/Fail-matris
| Flöde | desktop-chromium | tablet-chromium | mobile-chromium | mobile-webkit |
|---|---|---|---|---|
| Landing -> Login | PASS | PASS | PASS | PASS |
| Login + consent | PASS | PASS | PASS | PASS |
| App-shell + sidebar/search | PASS | PASS | PASS | PASS |
| Search modal (agent spec) | PASS | PASS | PASS | PASS |
| Fortnox panel (agent spec) | PASS | PASS | PASS | PASS |
| PWA metadata | PASS | PASS | PASS | PASS |

## Findings (öppna)
- Inga öppna `Critical`, `High`, `Medium` eller `Low` produktfel i denna scope.

## Fixar som verifierats i körningen
1. Landing-headern är nu responsiv på små viewportar och primär login-CTA håller viewport + tryckyta.
2. `#sidebar-toggle` och `#search-btn` är flyttade till topbar och nåbara i alla profiler.
3. `#new-chat-btn` är justerad till minsta tryckyta (>=44px).
4. Auth-flow i WebKit är robustare mot navigationsrace vid magic-link redirect.
5. Overlay-backdrop för sidebar beter sig stabilt i mobile WebKit.

## Rekommendation (Go/No-Go)
- Status: **Redo** för desktop + mobile E2E i definierad kärnscope.

## Kvarvarande risker / avgränsning
1. Granskningen täcker kärnflöden enligt scope, inte full regression av hela appen.
2. Lokalt bör Playwright köras via `node ./node_modules/@playwright/test/cli.js` för att undvika CLI-version-mismatch i denna miljö.

# Veridat — Projektstatus

> Genererad: 2026-03-17

## Sammanfattning

Veridat är en AI-driven svensk bokföringsassistent (PWA) för småföretag. Projektet består av ett Supabase Edge Functions-backend (detta repo, "Britta") och en Next.js 16-frontend (submodulen `veridat/`). Plattformen är i **beta-fas** med majoriteten av kärnfunktionalitet implementerad och deployad på veridat.se.

---

## Mappstruktur

```
Britta/
├── supabase/
│   ├── functions/               # 16 Edge Functions (Deno)
│   │   ├── gemini-chat/         # Huvud-AI-chat + PDF-analys (6 585 rader)
│   │   ├── fortnox/             # Bokföringsoperationer + posting trace (2 852 rader)
│   │   ├── analyze-excel-ai/    # Excel: Monta deterministisk + AI (1 958 rader)
│   │   ├── finance-agent/       # Finansagent (976 rader)
│   │   ├── agent-orchestrator/  # Multi-agent-orkestering (759 rader)
│   │   ├── fortnox-oauth/       # OAuth 2.0 med HMAC state
│   │   ├── fortnox-guardian/    # Övervakningsvarningar
│   │   ├── memory-generator/    # AI-minnesgenererare
│   │   ├── memory-service/      # Minnes-CRUD
│   │   ├── skills-service/      # Skills-system
│   │   ├── admin-billing/       # Fakturering/admin
│   │   ├── billing-maintenance/ # Period/grace-automatik
│   │   ├── generate-sie/        # SIE-filexport
│   │   ├── get-usage/           # Användningsstatistik
│   │   ├── web-search/          # Webbsökning för AI
│   │   └── test-orchestrator/   # Test-orkestering
│   ├── services/                # 26 delade tjänster (~10 000 rader)
│   │   ├── GeminiService.ts          # AI-interaktioner (1 773 rader)
│   │   ├── AgentHandlers.ts          # Agent-logik (1 454 rader)
│   │   ├── FortnoxService.ts         # Fortnox API-klient (1 232 rader)
│   │   ├── BASAccounts.ts            # Kontoplan + routing (890 rader)
│   │   ├── AuditService.ts           # Revisionsspår (572 rader)
│   │   ├── AccountingResponseContract.ts # Strukturerade svar (544 rader)
│   │   ├── ExpensePatternService.ts   # Utgiftsmönster (386 rader)
│   │   ├── SwedishComplianceService.ts # Regelefterlevnad (299 rader)
│   │   ├── OpenAIService.ts           # Kolumnmappning (311 rader)
│   │   ├── ConversationService.ts     # Konversationer (245 rader)
│   │   ├── JournalService.ts          # Verifikationer (242 rader)
│   │   ├── RateLimiterService.ts      # Rate limiting (236 rader)
│   │   ├── CompanyMemoryService.ts    # Företagsminnen (178 rader)
│   │   ├── AIRouter.ts               # Multi-modell routing (167 rader)
│   │   └── ... (12 ytterligare tjänster)
│   ├── migrations/              # 68 SQL-migrationer (nov 2024 → mar 2026)
│   ├── snippets/                # SQL-snippets
│   └── types/                   # Deno-typdefinitioner
├── veridat/                     # Next.js 16-frontend (Git submodule)
│   └── src/
│       ├── app/
│       │   ├── (auth)/          # Login, logout, callback
│       │   ├── (marketing)/     # Landningssida, villkor, integritetspolicy, databehandling
│       │   └── dashboard/       # Chat, inställningar
│       ├── components/
│       │   ├── chat/            # 13 chat-komponenter + 14 artifact-kort
│       │   ├── marketing/       # 18 marknadsföringskomponenter
│       │   ├── settings/        # 8 inställningskomponenter
│       │   ├── fortnox/         # 4 Fortnox-komponenter
│       │   ├── sidebar/         # Sidebar + navigation
│       │   ├── onboarding/      # Onboarding-flöde
│       │   ├── modals/          # Integrationsmodaler
│       │   └── ui/              # 10 UI-primitiver
│       ├── hooks/               # 7 React-hooks (chat, realtime, fortnox, sidebar, etc.)
│       ├── lib/                 # Chat-service, Fortnox-klient, Supabase-klient
│       └── types/               # TypeScript-typer (chat, fortnox, supabase)
├── apps/web/                    # GAMMAL Vite-app (ANVÄNDS INTE)
├── tests/
│   ├── e2e/                     # 15 Playwright E2E-tester (agent-baserade)
│   ├── unit/                    # Enhetstester (monta-parser m.fl.)
│   └── fixtures/                # Testdata (bank-CSV)
├── scripts/                     # 17 operations-/testskript
├── docs/                        # Arkitektur, audit, planer, superpowers-specar
├── .skills/                     # 5 Claude Code-skills
│   ├── svensk-ekonomi/          # Bokföringsexpertis
│   ├── monta-excel-analys/      # Monta EV-parser
│   ├── platform-seo/            # SEO-optimering
│   ├── refactor-assistant/      # Refaktoreringshjälp
│   └── skill-health-check/      # Skill-validering
├── .claude/                     # Claude Code-konfiguration
│   ├── agents/                  # 3 agenter (VAT, PR-reviewer, deployment)
│   ├── commands/                # Dev-start/stop/status
│   ├── docs/                    # 7 dokumentationsmoduler
│   └── hooks/                   # Pre-commit, pre-deploy
└── .github/workflows/           # 8 CI/CD-workflows
```

---

## Teknikstack

### Frontend (veridat/)
- **Framework:** Next.js 16.1.6 (App Router, React 19.2)
- **Styling:** Tailwind CSS 4
- **Animationer:** Framer Motion 12
- **Ikoner:** Lucide React
- **Markdown:** react-markdown + rehype-highlight + remark-gfm
- **Auth:** Supabase SSR (@supabase/ssr)
- **Deployment:** Vercel (auto-deploy)

### Backend (Britta/)
- **Edge Functions:** Supabase Edge Functions (Deno runtime)
- **AI-modeller:** Google Gemini (primär), OpenAI (kolumnmappning), Claude (fallback)
- **AI-routing:** AIRouter.ts med multi-modell stöd
- **Databas:** Supabase PostgreSQL med RLS
- **Autentisering:** Supabase Auth (magic link/OTP)
- **Integration:** Fortnox API (OAuth 2.0, auto token refresh)
- **Felspårning:** Sentry (frontend)

### CI/CD
- **GitHub Actions:** 8 workflows
- **Tester:** Vitest (unit), Playwright (E2E), custom agent-tester
- **Linting:** ESLint 9 + TypeScript 5

---

## Implementerade features

### AI-chatt (Kärna)
- AI-chatgränssnitt med streaming (SSE)
- PDF-analys via Gemini
- Excel-analys (Monta deterministisk + AI-fallback)
- 14 artifact-kort: verifikationer, fakturor, leverantörsfakturor, momssammanställning, journalposter, företagsinfo, kontosaldon, action plans, thinking steps m.fl.
- Konversationshistorik med Supabase Realtime-sync
- AI-minne per företag och användare
- Webbsökning integrerad i chatten
- Kodblock med kopiering

### Fortnox-integration
- OAuth 2.0-flöde med HMAC state-signering (CSRF-skydd)
- Token refresh med retry-logik och per-företag-tokens
- Läs/skriv: fakturor, kundfakturor, leverantörsfakturor, verifikationer
- Momsrapport (skattedeklaration)
- Företagsinformation, kontolistor, resultat- och balansräkning
- Posting trace med matching och korrigeringsförslag
- Fortnox Guardian-övervakning med alertsystem
- Rate limiting per Fortnox-instans
- Write-idempotency

### Svensk bokföring
- BAS-kontoplan med intelligent routing 1xxx–8xxx (890 rader)
- Momssatser (25%, 12%, 6%, 0%) med ML 3:30a compliance (ZeroVATValidator)
- Öresavrundning (ROUND_HALF_UP)
- Org.nr/VAT-validering (Luhn-algoritm)
- SIE-filexport
- Journalservice med verifikations-ID (BFL 7:1)
- Monta EV Charging deterministisk parser (100% accuracy)
- Utgiftsmönsterigenkänning
- Svensk regelefterlevnad (SwedishComplianceService)

### Autentisering & säkerhet
- Magic link (OTP) inloggning
- Row Level Security (RLS) på alla tabeller (löpande härdning)
- CORS-hantering
- Rate limiting (10/timme, 50/dag)
- GDPR-samtycke med versionerad policy
- Integritetspolicy och databehandlingsavtal (DPA)
- Audit trail (AuditService) för spårbarhet
- Cookie consent-banner
- Timing attack-skydd
- Storage bucket-lockdown
- Beta-inbjudningssystem med invite codes

### Frontend
- Responsiv dashboard med sidebar och konversationsnavigering
- Marknadssajt: hero, features, pricing, FAQ, testimonials, jämförelsetabell, savings calculator, social proof
- Dark mode (next-themes)
- Keyboard shortcuts
- Onboarding-flöde med välkomstmodal
- Inställningar: profil, plan, utseende, notiser, integrationer
- Fortnox-panel med anslutningskort och momsrapportkort
- OG/Twitter image-generering
- 404-sida och error boundaries

### Billing & planer
- Plan-system: free, pro, trial
- Admin-billing Edge Function
- Billing-maintenance (automatisk period/grace-hantering)
- Usage tracking
- Fortnox-åtkomst gatad till betalande planer
- Legal acceptances med org.nr-koppling

### Agent-system
- Agent-orchestrator för multi-agent-flöden
- Finance-agent
- Skills-service med dynamisk approval
- Agent swarm-tabeller i databasen

---

## Pågående arbete & senaste aktivitet (mars 2026)

De nyaste migrationerna och design-dokumenten visar pågående arbete:

1. **Beta-lansering** (2026-03-15) — Invite codes med seed data, gating av nya registreringar
2. **AI state machine-bugfixar** (2026-03-16) — Konversationsmetadata, AI decisions provider constraint
3. **Usage tracking** (2026-03-12) — Ny spårningstabell + auth-fix
4. **Fortnox voucher attachments** — Design spec klar, implementation pågående
5. **Non-critical booking** — Graceful degrade vid bokföringsfel (design klar)
6. **E2E-testning** — 15 spec-filer finns men täckningen beskrivs som "minimal"
7. **Finance-agent & agent swarm** — Tabeller och function finns, under utveckling

---

## TODOs i koden

Kodbasen innehåller ovanligt få TODOs — de flesta öppna uppgifter spåras via design-specifikationer och planer:

| Fil | Beskrivning |
|-----|-------------|
| `supabase/services/GeminiService.ts:1378` | Gemini Context Caching — planerat för Fas 2 när system prompt + verktyg överstiger 32K-gränsen |
| `apps/web/src/controllers/ChatController.ts:553` | Re-analysera fil vid "Analysera moms"-klick (gammal app) |
| `apps/web/src/services/LoggerService.ts:183` | Integrera med Sentry/LogRocket (gammal app) |

Inga FIXME-markeringar hittades i produktionskoden.

### Planerat (från plan.md)
- Bankmatchning med confidence-score och "varför"-text
- Policy-tabell för inlärning per motpart (approved_count, auto_enabled)
- Stripe-beredskap (webhook-integration, external_subscription_id)
- Automatiska jobb: periodslut, grace-utgång, notiser

---

## CI/CD-workflows

| Workflow | Syfte |
|----------|-------|
| `ci.yml` | Lint + test + build vid push/PR till main/staging |
| `supabase-deploy.yml` | Edge Function-deployment |
| `agents-nightly.yml` | Nattliga agenttester |
| `agents-soft-gate.yml` | Mjuk gate för agenter |
| `agent-cron.yml` | Schemalagda agentkörningar |
| `perf-gate.yml` | Prestandagating |
| `prod-auth-smoke.yml` | Produktions-auth smoke test |
| `test-orchestrator-scheduled.yml` | Schemalagd testorkestrering |

---

## Databasmigrationer (68 st)

Migrationerna spänner från november 2024 till mars 2026 och täcker:

- **Kärntabeller:** profiles, fortnox_tokens, api_usage, files, conversations, messages
- **Autentisering/säkerhet:** auth + RLS, villkorsversioner, storage bucket-lockdown, timing attack-skydd
- **Bokföring:** expense_patterns, journal_entries, BAS-konton
- **Företag & minne:** companies, company_memory, user memories, accounting memories
- **Billing:** admin_billing, billing_maintenance, manual pro plan
- **Skills & agenter:** skills system, agent swarm tables
- **Finans:** finance core tables, bank match policies, receipt inbox
- **Senaste:** usage tracking, beta invites, conversations metadata, AI decisions provider constraint

---

## Nyckeltal

| Mått | Värde |
|------|-------|
| Edge Functions | 16 |
| Delade backend-tjänster | 26 |
| Databasmigrationer | 68 |
| Frontend-komponenter (veridat/) | ~100 |
| Artifact-kort (chat) | 14 |
| React hooks | 7 |
| E2E-testspecar | 15 |
| CI/CD-workflows | 8 |
| Claude Code-skills | 5 |
| Kodrader (backend services) | ~10 000 |
| Kodrader (Edge Functions) | ~14 000 |
| Operations-/testskript | 17 |

---

## Teknisk skuld & observationer

- `apps/web/` (gammal Vite/Preact-app) finns kvar med egna TODOs — kan och bör tas bort
- `dist/` innehåller byggd legacy-app — bör inte committas
- `test_railway_direct.py` — Legacy Railway-testskript (migrerat till Supabase)
- `gemini-chat/index.ts` är 6 585 rader — stark kandidat för uppdelning
- E2E-testcoverage behöver utökas (beskrivet som "minimal")

---

## Förslag på nästa steg

### Hög prioritet
1. **Slutför beta-lansering** — Invite-flödet är nytt; säkerställ att hela registrering → onboarding → chat-flödet fungerar E2E.
2. **Bankmatchning i produktion** — Slutför confidence-score, "varför"-text, audit trail. Implementera auto-matchning efter manuella godkännanden.
3. **Stripe-integration** — Ersätt manuell fakturering. Datamodellen med `external_subscription_id` och `billing_status` är redan förberedd.

### Medium prioritet
4. **E2E-testtäckning** — Prioritera kritiska flöden: inloggning → chatt → Fortnox-koppling → momsrapport.
5. **Dela upp gemini-chat/index.ts** — 6 585 rader i en fil. Extrahera tool handlers, konversationslogik och PDF-analys till separata moduler.
6. **Kvittoinbox** — Migrationerna finns (2026-02-21), Edge Function saknas. Implementera fil-uppladdning → AI-analys → bokföring.
7. **Gemini Context Caching** — Implementera när system prompt + verktyg överstiger 32K-gränsen. Minskar latens och API-kostnader.

### Lägre prioritet
8. **Städa bort apps/web/** — Den gamla Vite-appen skapar förvirring och innehåller döda TODOs.
9. **Backend observability** — Sentry finns på frontend; lägg till strukturerad logging och alerting på Edge Functions.
10. **Skills-expansion** — Skills-systemet med DB + service + approval finns på plats. Lägg till fler domänspecifika skills.

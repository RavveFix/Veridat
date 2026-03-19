# Veridat Stack Audit — Förberedelse för Next.js-migrering

**Datum:** 2026-03-07
**Syfte:** Komplett kartläggning av Britta/Veridat-kodbasen inför migrering från Vite + Preact till Next.js (App Router)

---

## 1. Current State Summary

### 1.1 Kodbasinventering

| Layer | Filer | LOC | Språk |
|-------|-------|-----|-------|
| Frontend (apps/web/src) | 161 | 45 741 | TypeScript + TSX |
| CSS (styles) | 22 | 15 418 | Plain CSS |
| Backend (supabase/) | 53 | 29 703 | TypeScript (Deno) |
| Migrations | 62 | 5 888 | SQL |
| E2E Tests | 16 | ~2 400 | TypeScript (Playwright) |
| Config/Other | ~20 | ~1 200 | JSON/TOML/JS |
| **Totalt** | **~334** | **~101 000** | — |

### 1.2 Arkitektur-översikt

```
┌─────────────────────────────────────────────────────────┐
│  Frontend (Vite + Preact + Vanilla TS)                  │
│  ┌──────────┐ ┌──────────────┐ ┌─────────────────────┐  │
│  │Controllers│ │Preact Comps  │ │Services (fetch→EF)  │  │
│  │(7 klasser)│ │(73 .tsx)     │ │(27 st, 6 953 LOC)   │  │
│  └──────────┘ └──────────────┘ └─────────────────────┘  │
│         ↕ preact-adapter.ts (bridge)                    │
├─────────────────────────────────────────────────────────┤
│  Supabase Edge Functions (Deno)                         │
│  15 funktioner, ~17 000 LOC                             │
│  ┌─────────┐ ┌──────┐ ┌────────┐ ┌──────────────────┐  │
│  │gemini-  │ │fortnox│ │analyze-│ │agent-orchestrator│  │
│  │chat     │ │(+oauth│ │excel-ai│ │finance-agent     │  │
│  │(5274 L) │ │+guard)│ │(1958 L)│ │memory-*          │  │
│  └─────────┘ └──────┘ └────────┘ └──────────────────┘  │
│  Services Layer: 25+ tjänster, ~9 200 LOC               │
├─────────────────────────────────────────────────────────┤
│  Supabase PostgreSQL                                    │
│  30+ tabeller, RLS på allt, pgvector, FTS (svenska)     │
│  62 migrationer, BFL 7 kap audit trail (7 år retention) │
└─────────────────────────────────────────────────────────┘
```

### 1.3 Tech Stack

| Komponent | Nuvarande | Mål (Next.js) |
|-----------|-----------|---------------|
| UI Framework | Preact 10.28.3 | React 19 |
| Build | Vite 7.3.1 | Next.js 15 (App Router) |
| Routing | Manuell `history.pushState` | Next.js file-based routing |
| Styling | Plain CSS (138 KB main.css + 22 komponentfiler) | Tailwind CSS |
| State | useState/useEffect + localStorage + CustomEvent | React hooks + Zustand/Context |
| Backend | Supabase Edge Functions (Deno) | **Behålls** (ingen ändring) |
| Databas | Supabase PostgreSQL | **Behålls** |
| Auth | Supabase Auth (magic link) | **Behålls** |
| AI | Gemini + Claude + OpenAI (via EF) | **Behålls** |
| Fortnox | OAuth 2.0 via EF | **Behålls** |

### 1.4 Designsystem-konsistens: 5/10

**Styrkor:**
- Konsekvent glassmorfism-design med CSS custom properties
- Ljust/mörkt tema via `data-theme`
- Inter + JetBrains Mono typography

**Svagheter:**
- 138 KB monolitisk `main.css` — svår att underhålla
- Blandning av CSS-konventioner (BEM ibland, ibland inte)
- @heroui/react används men med preact/compat-shim
- Ingen utility-first approach — mycket duplicerad CSS
- Inkonsekvent spacing/sizing (px, rem, em blandat)

### 1.5 Test Coverage

| Typ | Antal | Status |
|-----|-------|--------|
| Unit tests (Vitest) | 14 filer | Fokus: Fortnox, utils, parsers |
| E2E tests (Playwright) | 16 filer | Agent-baserade, 4 browser-profiler |
| Backend tests | 4 filer | Service-specifika (fortnox, posting) |
| **Uppskattad coverage** | **~15-20%** | Låg — mest kritiska flöden |

### 1.6 Teknisk Skuld

| Problem | Allvarlighet | Plats |
|---------|-------------|-------|
| `gemini-chat/index.ts` är 5 274 rader | Hög | Bör brytas upp i moduler |
| `main.css` är 138 KB monolitisk | Hög | Bör ersättas med Tailwind |
| Hybrid Vanilla TS + Preact arkitektur | Medel | Controllers + adapter bridge |
| `ChatService.ts` 1 084 rader | Medel | Bör delas per concern |
| `CopilotService.ts` 905 rader | Medel | God tjänst |
| Ingen centraliserad state management | Medel | localStorage + CustomEvent |
| Multi-page Vite build (8 HTML entries) | Medel | Försvinner med Next.js |
| `SkillsHubPanel.tsx` exkluderad från tsconfig | Låg | Ofärdig feature |
| Ingen service worker (PWA utan offline) | Låg | Next.js PWA-plugin |

---

## 2. Frontend Kartläggning

### 2.1 Entry Points → Next.js Routes

| Nuvarande | URL | Next.js Route |
|-----------|-----|---------------|
| `index.html` → `landing/main.tsx` | `/` | `app/page.tsx` (SSR) |
| `login.html` → `login.ts` | `/login` | `app/login/page.tsx` |
| `app/index.html` → `main.ts` | `/app` | `app/(dashboard)/page.tsx` |
| — | `/app/overview` | `app/(dashboard)/overview/page.tsx` |
| — | `/app/invoices` | `app/(dashboard)/invoices/page.tsx` |
| — | `/app/bank` | `app/(dashboard)/bank/page.tsx` |
| — | `/app/reports` | `app/(dashboard)/reports/page.tsx` |
| — | `/app/chat/[id]` | `app/(dashboard)/chat/[id]/page.tsx` |
| `admin.html` → `admin/main.tsx` | `/admin` | `app/admin/page.tsx` |
| `privacy.html` | `/privacy` | `app/(legal)/privacy/page.tsx` (SSR) |
| `terms.html` | `/terms` | `app/(legal)/terms/page.tsx` (SSR) |
| `dpa.html` | `/dpa` | `app/(legal)/dpa/page.tsx` (SSR) |
| `security.html` | `/security` | `app/(legal)/security/page.tsx` (SSR) |
| `systemdokumentation.html` | `/systemdokumentation` | `app/(legal)/systemdokumentation/page.tsx` (SSR) |

### 2.2 Komponenter (73 TSX-filer)

#### Chat-domän (13 komponenter)
| Komponent | LOC | Next.js | Notering |
|-----------|-----|---------|----------|
| `ChatHistory.tsx` | ~400 | Client | Supabase Realtime subscriptions |
| `ConversationList.tsx` | ~350 | Client | Realtime INSERT-events |
| `ActionPlanCard.tsx` | ~300 | Client | Agent mode UI, spinner, confidence |
| `ArtifactCard.tsx` | ~250 | Client | Generisk artifact-rendering |
| `AIResponseRenderer.tsx` | ~200 | Client | memo() + markdown rendering |
| `StreamingText.tsx` | ~150 | Client | SSE streaming display |
| `SmartActions.tsx` | ~180 | Client | Kontextuella snabbval |
| `ThinkingSteps.tsx` | ~120 | Client | AI-tankeprocess |
| `ThinkingAnimation.tsx` | ~80 | Client | Loader-animation |
| `VATSummaryCard.tsx` | ~200 | Client | Momsöversikt |
| `JournalEntryCard.tsx` | ~150 | Client | Verifikationsvisning |
| `AgentActivityFeed.tsx` | ~200 | Client | Agent swarm status |

#### Sidor (3 page-komponenter)
| Komponent | LOC | Next.js |
|-----------|-----|---------|
| `InvoicesPage.tsx` | ~400 | Client |
| `BankPage.tsx` | ~350 | Client |
| `ReportsPage.tsx` | ~300 | Client |

#### Fortnox-integration (6 komponenter)
| Komponent | LOC | Next.js |
|-----------|-----|---------|
| `FortnoxPanel.tsx` | ~400 | Client |
| `FortnoxConnectionBanner.tsx` | ~100 | Client |
| `FortnoxDisconnectedCard.tsx` | ~80 | Client |
| `FortnoxSyncStatusPanel.tsx` | ~250 | Client |
| `FortnoxSidebar.ts` | ~200 | Client |
| `VATReportFromFortnoxPanel.tsx` | ~300 | Client |

#### Modaler & UI (12 komponenter)
| Komponent | LOC | Next.js |
|-----------|-----|---------|
| `SettingsModal.tsx` | 512 | Client |
| `LegalConsentModal.tsx` | 650 | Client |
| `IntegrationsModal.tsx` | ~300 | Client |
| `SearchModal.tsx` | ~250 | Client |
| `UpgradeModal.tsx` | ~200 | Client |
| `ModalWrapper.tsx` | ~80 | Client |
| `ErrorBoundary.tsx` | 209 | Client |
| `AppSidebar.tsx` | 512 | Client |
| `DashboardPanel.tsx` | ~400 | Client |
| `WelcomeHeader.tsx` | ~100 | Client/Server |
| `SpreadsheetViewer.tsx` | ~300 | Client |
| `ExcelArtifact.tsx` | ~250 | Client |

#### Landing Page (10 komponenter)
| Komponent | LOC | Next.js |
|-----------|-----|---------|
| `Hero.tsx` | ~200 | **Server** |
| `Features.tsx` | ~250 | **Server** |
| `HowItWorks.tsx` | ~150 | **Server** |
| `Pricing.tsx` | ~200 | **Server** |
| `Testimonials.tsx` | ~150 | **Server** |
| `TrustSignals.tsx` | ~150 | Client (interaktion) |
| `FAQ.tsx` | ~150 | Client (accordion) |
| `Principles.tsx` | ~100 | **Server** |
| `Memory.tsx` | ~100 | **Server** |
| `Footer.tsx` | ~80 | **Server** |

### 2.3 Controllers → Migration Strategy

Controllers är vanilla TS-klasser som orkestrerar Preact-komponenter via `preact-adapter.ts`. I Next.js ersätts dessa av:

| Controller | LOC | Ersätts av |
|-----------|-----|------------|
| `AppController.ts` | 741 | Next.js layout + middleware |
| `ChatController.ts` | 900 | Chat page + React hooks |
| `ConversationController.ts` | 578 | Conversation hooks/context |
| `CompanyModalController.ts` | 355 | Company context + modal |
| `ModelSelectorController.ts` | 200 | Dropdown component |
| `SidebarController.ts` | 168 | Sidebar component |
| `ThemeController.ts` | 45 | next-themes |

**Totalt 2 987 LOC controllers som elimineras** — logiken fördelas till hooks och context.

### 2.4 Services → Migration Strategy

Frontend services gör `fetch()` till Edge Functions. I Next.js kan de behållas med minimala ändringar:

| Service | LOC | Ändring |
|---------|-----|---------|
| `ChatService.ts` | 1 084 | Behålls, byt env-prefix |
| `CopilotService.ts` | 905 | Behålls |
| `AuthService.ts` | 357 | Ersätts delvis av `@supabase/ssr` |
| `CompanyService.ts` | 631 | Behålls |
| `FortnoxContextService.ts` | 386 | Behålls, ev. Server Action |
| `FileService.ts` | 482 | Behålls |
| `FinanceAgentService.ts` | 369 | Behålls |
| `MemoryService.ts` | 181 | Behålls |
| `UIService.ts` | 294 | **Elimineras** (DOM-manipulation) |
| `VoiceService.ts` | 236 | Behålls |
| `LoggerService.ts` | 189 | Ersätts med Next.js logger |

### 2.5 State Management

**Nuvarande:** Decentraliserat
- `useState`/`useEffect` i varje komponent
- `localStorage` för persistens (agent mode, theme, selected company)
- `window.dispatchEvent(new CustomEvent(...))` för cross-controller kommunikation
- Singleton services med in-memory cache

**Rekommendation (Next.js):**
- **Zustand** för global client state (company, auth, theme)
- **React Context** för scoped state (chat, conversation)
- **Server Actions** / **Route Handlers** för mutations
- **@supabase/ssr** för auth state (cookie-based)

---

## 3. Preact → React Migreringspunkter

### 3.1 Import-ändringar (73 filer)

```diff
- import { useState, useEffect } from 'preact/hooks';
+ import { useState, useEffect } from 'react';

- import { render, h } from 'preact';
+ import { createRoot } from 'react-dom/client';

- import { memo } from 'preact/compat';
+ import { memo } from 'react';

- import { act } from 'preact/test-utils';
+ import { act } from '@testing-library/react';
```

### 3.2 Specifika migreringspunkter

| Punkt | Filer | Risk | Notering |
|-------|-------|------|----------|
| `preact/hooks` → `react` | 48 | Låg | Rak ersättning |
| `preact` render/h | 5 | Låg | Används i adapter + entry |
| `preact/compat` memo/FC | 2 | Låg | Redan React-kompatibelt |
| `preact/test-utils` act | 5 | Låg | Byt till @testing-library |
| `preact-adapter.ts` | 1 | **Elimineras** | Next.js behöver inte bridge |
| `@preact/preset-vite` | 1 | **Elimineras** | Ersätts av Next.js |
| vite.config React aliases | 1 | **Elimineras** | Behövs inte |
| `jsxImportSource: "preact"` | 1 | Låg | Ändra till `react-jsx` |
| `@heroui/react` compat shim | 1 | **Elimineras** | Fungerar direkt med React |
| `onInput` events | ~5 | Låg | Byt till `onChange` |
| `@preact/signals` | 0 | **Ingen** | Används ej! |

**Total risk:** LÅG — Preact används med hooks (inga signals), compat-layern finns redan.

### 3.3 Vite → Next.js

| Vite | Next.js |
|------|---------|
| `VITE_SUPABASE_URL` | `NEXT_PUBLIC_SUPABASE_URL` |
| `VITE_SUPABASE_ANON_KEY` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `VITE_SENTRY_DSN` | `NEXT_PUBLIC_SENTRY_DSN` |
| `import.meta.env.VITE_*` | `process.env.NEXT_PUBLIC_*` |
| Multi-page build (8 HTML) | File-based routing |
| Manual code splitting | Automatic |
| `@/*` path alias | `@/*` (behålls i tsconfig) |

---

## 4. Backend — Vad som behålls

### 4.1 Edge Functions (BEHÅLLS alla 15)

Supabase Edge Functions körs på Deno runtime och är oberoende av frontend. **Inga ändringar behövs.**

| Funktion | LOC | Komplexitet |
|----------|-----|-------------|
| `gemini-chat` | 5 274 | 5/5 |
| `fortnox` | 2 639 | 5/5 |
| `analyze-excel-ai` | 1 958 | 4/5 |
| `GeminiService` | 1 479 | 5/5 |
| `AgentHandlers` | 1 454 | 4/5 |
| `finance-agent` | 976 | 4/5 |
| `FortnoxService` | 938 | 5/5 |
| `test-orchestrator` | 896 | 3/5 |
| `BASAccounts` | 885 | 3/5 |
| `agent-orchestrator` | 759 | 4/5 |
| `fortnox-guardian` | 742 | 3/5 |
| + 15 övriga services | ~5 600 | 1-3/5 |
| **Totalt backend** | **~29 700** | — |

### 4.2 Möjliga Next.js API Routes

Vissa saker *kan* flytta till Next.js Route Handlers men **bör inte** i fas 1:

| Kandidat | Rekommendation | Motivering |
|----------|---------------|------------|
| `memory-service` CRUD | Överväg | Enkel CRUD, inga Deno-beroenden |
| `admin-billing` | Överväg | Admin-panel, liknande CRUD |
| `skills-service` | Överväg | Enkel CRUD |
| `web-search` | Behåll EF | Använder Deno-specifik caching |
| `fortnox-oauth` | Behåll EF | HMAC crypto, tokenhantering |
| `gemini-chat` | Behåll EF | 5K LOC, streaming, Deno |
| `fortnox` | Behåll EF | Komplex, 2.6K LOC |
| `analyze-excel-ai` | Behåll EF | Deno-specifik, CPU-intensiv |

**Rekommendation:** Behåll alla Edge Functions i fas 1. Migrera enkla CRUD-funktioner i fas 2 om önskat.

### 4.3 Databas (BEHÅLLS)

- 30+ tabeller med RLS
- pgvector (1536-dim embeddings)
- Full-text search (svenska)
- BFL 7 kap audit trail (7 år retention)
- 62 migrationer — **ingen ändring**

---

## 5. Komplexitetsanalys

### 5.1 Riskmatris

| Komponent | Komplexitet | Risk | Beroenden | Prioritet |
|-----------|-------------|------|-----------|-----------|
| Landing page (10 komp) | 1 | Låg | Inga API-beroenden | Fas A |
| Legal pages (5 HTML) | 1 | Låg | Statiskt innehåll | Fas A |
| Layout + Navigation | 2 | Låg | Theme, company context | Fas A |
| Auth flow | 3 | Medel | Supabase Auth SSR | Fas B |
| Dashboard/Overview | 2 | Låg | Fetch → DashboardPanel | Fas B |
| Settings modaler | 3 | Medel | Auth, company, Fortnox | Fas B |
| Chat UI (13 komp) | 4 | Medel-Hög | Streaming, Realtime, files | Fas C |
| Fortnox integration | 4 | Medel-Hög | OAuth, tokens, context | Fas C |
| Invoice management | 3 | Medel | Finance agent, Fortnox | Fas D |
| Bank reconciliation | 4 | Hög | Transactions, matching | Fas D |
| VAT reporting | 3 | Medel | Excel parse, journal | Fas D |
| Agent orchestration | 4 | Hög | Multi-agent, task queue | Fas E |
| Excel/PDF upload | 3 | Medel | FileService, analyze-excel | Fas C |
| Voice input | 2 | Låg | Web Speech API | Fas E |
| Admin portal | 2 | Låg | Admin-only, billing | Fas E |
| CSS → Tailwind | 3 | Medel | 15K LOC CSS att ersätta | Löpande |

### 5.2 Kritiska Flöden

#### 1. Excel-uppladdning & analys
```
User uploads .xlsx → ChatController.handleFileUpload()
  → FileService.parseExcel() → ChatService.analyzeExcel()
    → fetch(analyze-excel-ai) → Monta detection → VAT report
      → VATSummaryCard + JournalEntryCard rendered
```
**Risk:** Medel — streaming response + artifact rendering

#### 2. AI Chat (konversation)
```
User types → ChatController.handleSend()
  → ChatService.sendMessage() → fetch(gemini-chat) [SSE stream]
    → StreamingText renders chunks → AIResponseRenderer parses markdown
      → ArtifactCard/ActionPlanCard for structured data
```
**Risk:** Hög — SSE streaming, tool calls, Realtime sync

#### 3. Fortnox Export
```
User clicks "Exportera" → FortnoxPanel.handleExport()
  → FortnoxContextService.exportVoucher() → fetch(fortnox)
    → Fortnox API → AuditService.log() → FortnoxSyncStatusPanel updates
```
**Risk:** Medel — OAuth state, token refresh, idempotency

#### 4. Momsrapport
```
analyze-excel-ai → journal entries → VATReportCard
  → User reviews → "Spara" → messages.metadata = {type: 'vat_report'}
    → Optional Fortnox export
```
**Risk:** Låg-Medel — beräkningslogik i backend

#### 5. Företagsväxling
```
CompanyModalController → CompanyService.switchCompany()
  → localStorage update → window.dispatchEvent('company-changed')
    → All services re-fetch with new company_id
```
**Risk:** Medel — state propagation across components

#### 6. Konversationshistorik
```
ConversationList (Realtime INSERT subscription)
  → ConversationController.selectConversation()
    → ChatHistory loads messages → Realtime updates
```
**Risk:** Medel — Realtime subscriptions måste hanteras i useEffect cleanup

---

## 6. Migreringsplan

### Fas A: Grundstruktur (1-2 veckor)

**Mål:** Next.js-projekt med landing page, layout, och auth.

```
britta-next/
├── app/
│   ├── layout.tsx              # Root layout (fonts, theme, metadata)
│   ├── page.tsx                # Landing page (SSR)
│   ├── login/page.tsx          # Auth flow
│   ├── (legal)/
│   │   ├── privacy/page.tsx    # SSR
│   │   ├── terms/page.tsx
│   │   ├── dpa/page.tsx
│   │   ├── security/page.tsx
│   │   └── systemdokumentation/page.tsx
│   ├── (dashboard)/
│   │   ├── layout.tsx          # Sidebar + auth guard
│   │   ├── page.tsx            # Chat (default)
│   │   ├── overview/page.tsx
│   │   ├── invoices/page.tsx
│   │   ├── bank/page.tsx
│   │   ├── reports/page.tsx
│   │   └── chat/[id]/page.tsx
│   ├── admin/page.tsx
│   └── api/                    # Optional: proxy routes
├── components/
│   ├── ui/                     # Shadcn/ui components
│   ├── chat/                   # Chat-domän
│   ├── fortnox/                # Fortnox-integration
│   ├── modals/                 # Modaler
│   └── layout/                 # Sidebar, header
├── lib/
│   ├── supabase/
│   │   ├── client.ts           # Browser client
│   │   ├── server.ts           # Server client
│   │   └── middleware.ts       # Auth middleware
│   ├── services/               # Migrerade services
│   └── utils/                  # Utilities
├── hooks/                      # Custom React hooks
├── stores/                     # Zustand stores
├── types/                      # TypeScript types
└── styles/                     # Tailwind + globals
```

**Steg:**
1. `npx create-next-app@latest` med TypeScript + Tailwind + App Router
2. Konfigurera `@supabase/ssr` för cookie-based auth
3. Flytta landing page (10 Server Components)
4. Flytta legal pages (5 SSR-sidor)
5. Implementera `(dashboard)/layout.tsx` med auth guard via middleware
6. Sätt upp theme (next-themes) + fonts (Inter, JetBrains Mono)

**Beroenden:**
```json
{
  "next": "^15",
  "react": "^19",
  "react-dom": "^19",
  "@supabase/ssr": "^0.5",
  "@supabase/supabase-js": "^2.39",
  "zustand": "^5",
  "next-themes": "^0.4",
  "tailwindcss": "^4",
  "framer-motion": "^12",
  "clsx": "^2",
  "tailwind-merge": "^3",
  "markdown-it": "^14",
  "dompurify": "^3",
  "@sentry/nextjs": "^10",
  "@vercel/analytics": "^1"
}
```

### Fas B: Kärnkomponenter (2-3 veckor)

**Mål:** Dashboard layout, settings, company switching.

**Ordning (beroendebaserad):**
1. **AppSidebar** → `components/layout/Sidebar.tsx` (Client Component)
2. **DashboardPanel** → `app/(dashboard)/overview/page.tsx`
3. **WelcomeHeader** → `components/layout/WelcomeHeader.tsx`
4. **SettingsModal** → `components/modals/SettingsModal.tsx`
5. **CompanyService** → `stores/companyStore.ts` (Zustand)
6. **LegalConsentModal** → `components/modals/LegalConsentModal.tsx`
7. **SearchModal** → `components/modals/SearchModal.tsx` (Cmd+K)
8. **ErrorBoundary** → `app/error.tsx` + `app/global-error.tsx`

**Import-migrering:** Batch-byt alla `preact/hooks` → `react` imports.

### Fas C: Chat & Filhantering (3-4 veckor)

**Mål:** Fullständig chattfunktionalitet med streaming och filuppladdning.

**Ordning:**
1. **ChatService** → `lib/services/ChatService.ts` (byt `VITE_` → `NEXT_PUBLIC_`)
2. **StreamingText** → `components/chat/StreamingText.tsx`
3. **AIResponseRenderer** → `components/chat/AIResponseRenderer.tsx`
4. **ChatHistory** → `components/chat/ChatHistory.tsx` (Supabase Realtime)
5. **ConversationList** → `components/chat/ConversationList.tsx` (Realtime)
6. **ActionPlanCard** → `components/chat/ActionPlanCard.tsx`
7. **ArtifactCard** → `components/chat/ArtifactCard.tsx`
8. **FileService** → `lib/services/FileService.ts`
9. **ExcelArtifact** → `components/chat/ExcelArtifact.tsx`
10. **SpreadsheetViewer** → `components/chat/SpreadsheetViewer.tsx`
11. **VATSummaryCard** → `components/chat/VATSummaryCard.tsx`

**Kritiskt:** SSE streaming i Next.js — använd `ReadableStream` + `TextDecoder` i client component.

### Fas D: Fortnox & Bokföring (2-3 veckor)

**Mål:** Komplett Fortnox-integration, fakturor, momsrapporter.

1. **FortnoxContextService** → `lib/services/FortnoxContextService.ts`
2. **FortnoxPanel** → `components/fortnox/FortnoxPanel.tsx`
3. **FortnoxSyncStatusPanel** → `components/fortnox/FortnoxSyncStatusPanel.tsx`
4. **InvoicesPage** → `app/(dashboard)/invoices/page.tsx`
5. **InvoiceInboxPanel** → `components/invoices/InvoiceInboxPanel.tsx`
6. **InvoicePostingReviewDrawer** → `components/invoices/PostingReviewDrawer.tsx`
7. **BankPage** → `app/(dashboard)/bank/page.tsx`
8. **BankImportPanel** → `components/bank/BankImportPanel.tsx`
9. **ReconciliationView** → `components/bank/ReconciliationView.tsx`
10. **ReportsPage** → `app/(dashboard)/reports/page.tsx`
11. **VATReportCard** → `components/reports/VATReportCard.tsx`
12. **Bokföringsunderlag** (4 tabs) → `components/reports/`

### Fas E: Agent, Voice & Admin (1-2 veckor)

**Mål:** Slutför alla features.

1. **AgentDashboard** → `components/settings/AgentDashboard.tsx`
2. **AgentActivityFeed** → `components/chat/AgentActivityFeed.tsx`
3. **AgentOrchestratorService** → `lib/services/AgentOrchestratorService.ts`
4. **VoiceService** → `lib/services/VoiceService.ts`
5. **AdminPortal** → `app/admin/page.tsx`
6. **SkillsHubPanel** → `components/settings/SkillsHubPanel.tsx`
7. **MemoryIndicator** → `components/layout/MemoryIndicator.tsx`

---

## 7. Rekommenderade Förbättringar vid Migrering

### 7.1 Arkitektur
- [ ] **Eliminera controller-mönstret** — ersätt med React hooks + context
- [ ] **Eliminera preact-adapter bridge** — direkta React-komponenter
- [ ] **Centralisera state** med Zustand (company, auth, theme, chat)
- [ ] **Route-baserad code splitting** — automatiskt med Next.js
- [ ] **Server Components** för landing, legal, statiska delar
- [ ] **Middleware** för auth guard istället för client-side redirect

### 7.2 Styling
- [ ] **Tailwind CSS** — ersätter 15K LOC manuell CSS
- [ ] **shadcn/ui** — ersätter @heroui/react (bättre Next.js-kompatibilitet)
- [ ] **Design tokens** i `tailwind.config.ts` (glassmorfism, färger)
- [ ] **CSS custom properties** behålls för tema-switching

### 7.3 Performance
- [ ] **SSR/SSG** för landing page (SEO + initial load)
- [ ] **Dynamic imports** för tunga bibliotek (xlsx, pdfjs-dist)
- [ ] **Image optimization** via `next/image`
- [ ] **Font optimization** via `next/font`
- [ ] **Streaming SSR** för dashboard (React Suspense)

### 7.4 Developer Experience
- [ ] **TypeScript strict mode** — redan aktiverat, behåll
- [ ] **ESLint** — uppgradera till next/core-web-vitals
- [ ] **Prettier** — lägg till
- [ ] **Testing Library** — ersätt preact/test-utils
- [ ] **Storybook** — överväg för komponentbibliotek

### 7.5 Säkerhet
- [ ] **Cookie-based auth** via `@supabase/ssr` (säkrare än localStorage)
- [ ] **CSP headers** i `next.config.ts`
- [ ] **Rate limiting** via middleware (komplement till EF)
- [ ] **CSRF protection** — inbyggt i Server Actions

### 7.6 Observability
- [ ] **@sentry/nextjs** — ersätter @sentry/browser (server + client)
- [ ] **Vercel Analytics** — behålls
- [ ] **Web Vitals** — automatiskt med Next.js

---

## 8. Sammanfattning

### Vad som migreras (frontend)
- 161 TypeScript/TSX-filer (45 741 LOC)
- 22 CSS-filer (15 418 LOC) → Tailwind
- 7 controllers (2 987 LOC) → elimineras
- 27 services (6 953 LOC) → behålls med minimala ändringar
- 73 Preact-imports → React-imports (mekanisk ändring)

### Vad som INTE migreras
- 15 Edge Functions (17 000 LOC) — behålls i Supabase/Deno
- 25 backend services (9 200 LOC) — behålls
- 62 SQL-migrationer (5 888 LOC) — behålls
- Databas (30+ tabeller, RLS, pgvector) — behålls
- Fortnox OAuth-flöde — behålls som EF
- AI-integrationer (Gemini/Claude/OpenAI) — behålls som EF

### Uppskattad tidsåtgång (soloutvecklare)

| Fas | Tid | Scope |
|-----|-----|-------|
| A: Grundstruktur | 1-2 veckor | Projekt, landing, auth, layout |
| B: Kärnkomponenter | 2-3 veckor | Sidebar, settings, company |
| C: Chat & Filer | 3-4 veckor | Chat, streaming, upload |
| D: Fortnox & Bokföring | 2-3 veckor | Invoices, bank, VAT |
| E: Agent & Admin | 1-2 veckor | Agent, voice, admin |
| **Totalt** | **~10-14 veckor** | — |

### Migrerings-approach: Big Bang vs Incremental

**Rekommendation: Incremental (parallell drift)**

1. Sätt upp Next.js-projektet vid sidan av `apps/web/`
2. Börja med landing page → deploy till ny Vercel-domän
3. Migrera sidor en åt gången, route via `rewrites` i `next.config.ts`
4. När alla sidor migrerade → peka om DNS

Fördel: Nuvarande app fortsätter fungera under migreringen. Inget big bang-moment.

---

*Rapport genererad 2026-03-07. Baserad på fullständig kodgranskning av 334 filer (~101K LOC).*

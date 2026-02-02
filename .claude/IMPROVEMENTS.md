# Veridat Förbättringsplan

Skapad: 2025-12-04
Status: Aktiv

---

## Sprint 1: Kritiska Fixar ⚡ (COMPLETED 2025-12-04)

### P0 - Måste fixas omedelbart

- [x] **FIX-001**: Duplicerad fellogning i main.ts:959-960 ✅
  - Fil: `src/main.ts:957-958`
  - Problem: Samma `console.error` rad duplicerad
  - Lösning: Tog bort duplicerad rad, behöll en med bättre kommentar

- [x] **FIX-002**: Ohanterat Promise i consent sync ✅
  - Fil: `src/main.ts:106-134`
  - Problem: `.then()` utan `.catch()` - legal compliance risk
  - Lösning: Konverterade till async/await med proper try-catch, lade till consent_sync_pending för retry

- [x] **FIX-003**: Race condition i message saving ✅
  - Fil: `supabase/functions/gemini-chat/index.ts:94-130`
  - Problem: User message sparas före AI response utan atomicitet
  - Lösning: Förbättrad logging, återanvänder conversationService, bättre error tracking

- [x] **FIX-004**: Company interface typsäkerhet ✅
  - Fil: `src/types/company.ts` (NY FIL)
  - Problem: `any[]` för history, invoices, documents
  - Lösning: Skapade nya interfaces: BookkeepingEntry, SupplierInvoice, CompanyDocument, Company

- [x] **FIX-005**: Tool execution error propagation ✅
  - Fil: `supabase/functions/gemini-chat/index.ts:218-267`
  - Problem: Feldetaljer når inte frontend
  - Lösning: Kategoriserade fel (auth/network/validation/not_found), svenska felmeddelanden, actionSuggestion

---

## Sprint 2: Refaktorering 🔧

### P1 - Hög prioritet

- [ ] **REF-001**: Bryt ut main.ts till services
  - Nuvarande: 1290 rader i en fil
  - Mål: ~300 rader med separata services
  - Nya filer:
    - [ ] `src/services/CompanyManager.ts` (~200 rader)
    - [ ] `src/services/ChatService.ts` (~300 rader)
    - [ ] `src/services/FileService.ts` (~150 rader)
    - [ ] `src/services/AuthService.ts` (~100 rader)
    - [ ] `src/services/ConversationManager.ts` (~150 rader)

- [ ] **REF-002**: Centraliserad LoggerService
  - Fil: `src/services/LoggerService.ts`
  - Problem: 65+ console.log statements
  - Lösning: Environment-baserad logging

- [ ] **REF-003**: Konsolidera auth patterns
  - Problem: Auth checks på 5+ ställen
  - Lösning: AuthService wrapper

- [ ] **REF-004**: Supabase client singleton
  - Fil: `supabase/functions/gemini-chat/index.ts`
  - Problem: Ny client skapas vid varje anrop
  - Lösning: Singleton pattern eller middleware

- [ ] **REF-005**: Extrahera file routing logic
  - Fil: `src/main.ts:937-983`
  - Problem: 40+ rader för Excel→Python→Claude
  - Lösning: FileRouter eller AnalysisStrategy pattern

---

## Sprint 3: Säkerhet & DevX 🔐

### P1 - Säkerhet

- [ ] **SEC-001**: Begränsa CORS
  - Filer: Alla Edge Functions
  - Problem: `Access-Control-Allow-Origin: "*"`
  - Lösning: Specifik domän

- [ ] **SEC-002**: IP-baserad rate limiting
  - Fil: `supabase/services/RateLimiterService.ts`
  - Problem: Alla anonyma delar samma bucket
  - Lösning: IP-baserad begränsning

- [ ] **SEC-003**: Input validering
  - Org.nr: `/^\d{6}-?\d{4}$/`
  - Filstorlek: max 10MB
  - Period: `/^\d{4}-\d{2}$/`

- [ ] **SEC-004**: Authorization för Fortnox operations
  - Fil: `supabase/functions/gemini-chat/index.ts:186-210`
  - Problem: Ingen verifiering av Fortnox-konto ägande
  - Lösning: Lägg till authorization check

### P2 - DevX

- [ ] **DEV-001**: Lägg till ESLint + Prettier
  - Installera: `eslint`, `prettier`, `eslint-config-prettier`
  - Skapa: `.eslintrc.js`, `.prettierrc`

- [ ] **DEV-002**: Pre-commit hook integration
  - Integrera: `.claude/hooks/pre-commit.sh` med git hooks
  - Verktyg: husky eller lint-staged

- [ ] **DEV-003**: Bundle analysis
  - Verktyg: `rollup-plugin-visualizer`
  - Mål: Identifiera stora dependencies

- [ ] **DEV-004**: JSDoc kommentarer
  - Lägg till dokumentation för exporterade funktioner
  - Prioritera: services, utilities

---

## Sprint 4: Testning 🧪

### P2 - Tester

- [ ] **TEST-001**: Frontend unit tests
  - Verktyg: Vitest
  - Mål: Testa services, utilities
  - Coverage: >80%

- [ ] **TEST-002**: Edge Function integration tests
  - Verktyg: Deno test
  - Testa: gemini-chat, python-proxy, fortnox

- [ ] **TEST-003**: Python API utökade tester
  - Nuvarande: 7 tester (security.py)
  - Mål: +20 tester för vat_service, excel_service

- [ ] **TEST-004**: E2E tester
  - Verktyg: Playwright
  - Testa: Upload Excel → VAT rapport
  - Testa: Chat konversation

---

## Sprint 5: Features 🚀

### P3 - Nya features

- [ ] **FEAT-001**: Fortnox OAuth implementation
  - Status: Mock-only idag
  - Implementera: Riktig OAuth flow
  - Lagra: Tokens i Supabase

- [ ] **FEAT-002**: SIE-fil export
  - Status: Nämnd i docs, ej implementerad
  - Använd: `.skills/svensk-ekonomi/scripts/sie_export.py`
  - UI: Exportknapp i momsrapport

- [ ] **FEAT-003**: PWA offline support
  - Status: manifest.json finns, service worker saknas
  - Implementera: Service worker för offline

- [ ] **FEAT-004**: PDF rapport generering
  - Status: Ej implementerad
  - Verktyg: jsPDF eller server-side
  - Format: Momsrapport som PDF

- [ ] **FEAT-005**: Multi-company sync till Supabase
  - Status: localStorage only
  - Implementera: Synka företag till databas
  - Hantera: Konfliktlösning

---

## Kodkvalitet (Ongoing) 📋

### Magic Numbers att extrahera
- [ ] `800` ms loader delay (main.ts:787)
- [ ] `20` max messages (main.ts:514)
- [ ] Base64 padding logic → utility

### Namngivning att fixa
- [ ] `chatContainer` vs `chat-form` vs `chat-history-container`
- [ ] `fileToSend` vs `currentFile` vs `file`
- [ ] Konsekvent camelCase eller kebab-case

### Memory leaks att fixa
- [ ] Event listeners utan cleanup (main.ts:410, 420, 705, 708, 711, 718)
- [ ] Lägg till removeEventListener vid navigation

### TypeScript any att fixa
- [ ] 182 `any` type usages att eliminera
- [ ] Prioritera: type-critical paths först

---

## Prestandaoptimering ⚡

- [ ] **PERF-001**: Base64 caching
  - Fil: `src/main.ts:1089-1110`
  - Problem: Konvertering sker två gånger
  - Lösning: Cache konverteringsresultat

- [ ] **PERF-002**: Shared chunks i Vite
  - Fil: `vite.config.ts`
  - Problem: 6 HTML entry points
  - Lösning: Dela common chunks

- [ ] **PERF-003**: Database query optimization
  - Problem: Potentiellt N+1 queries
  - Lösning: Batch queries för meddelanden

---

## Arkitektur (Långsiktigt) 🏗️

- [ ] **ARCH-001**: Dependency injection pattern
  - Implementera: Konsekvent DI för services
  - Verktyg: Överväg inversify eller liknande

- [ ] **ARCH-002**: State management
  - Problem: Mixed localStorage + Supabase
  - Lösning: Single source of truth

- [ ] **ARCH-003**: Validation layers
  - Problem: Inkonsekvent validering mellan lager
  - Lösning: Shared validation schemas (Zod?)

---

## Statusspårning

| Sprint | Status | Progress |
|--------|--------|----------|
| Sprint 1 | ✅ Klar | 5/5 |
| Sprint 2 | ⚪ Planerad | 0/5 |
| Sprint 3 | ⚪ Planerad | 0/8 |
| Sprint 4 | ⚪ Planerad | 0/4 |
| Sprint 5 | ⚪ Planerad | 0/5 |

---

## Ändringslogg

### 2025-12-04 - Sprint 1 Completed
- ✅ FIX-001: Tog bort duplicerad error logging
- ✅ FIX-002: Lade till proper error handling för consent sync
- ✅ FIX-003: Förbättrade message saving med bättre logging
- ✅ FIX-004: Skapade typsäkra Company interfaces (ny fil: `src/types/company.ts`)
- ✅ FIX-005: Kategoriserade tool errors med svenska meddelanden

**Filer ändrade:**
- `src/main.ts` - Consent sync, error logging, company creation
- `src/types/company.ts` - NY FIL med typdefinitioner
- `supabase/functions/gemini-chat/index.ts` - Message saving, error handling

---

*Uppdaterad: 2025-12-04*

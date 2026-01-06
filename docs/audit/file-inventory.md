# File Inventory - Britta Project

**Genomförd:** 2025-11-26
**Status:** Komplett inventering av alla filer i projektet

## Symboler
- ✅ **[ANVÄNDS]** - Aktiv fil som används i produktionen
- ⚠️ **[LEGACY]** - Gammal fil som kan tas bort/ersatts
- ❌ **[UNUSED]** - Oanvänd fil, kan tas bort
- 🔄 **[DUPLICATE]** - Duplicerad funktionalitet
- 🗂️ **[ARCHIVE]** - Redan i _archive, kan tas bort permanent

---

## Root Level Files

### HTML Entry Points
```
/index.html                     ✅ [ANVÄNDS] - Landing page (självständig)
/login.html                     ✅ [ANVÄNDS] - Login sida (använder /src/login.ts)
/app/index.html                 ✅ [ANVÄNDS] - Huvudapp (använder /src/main.ts)
/app/nyheter.html               ✅ [ANVÄNDS] - Nyheter/uppdateringar sida
```

### Configuration Files
```
/package.json                   ✅ [ANVÄNDS] - NPM dependencies & scripts
/package-lock.json             ✅ [ANVÄNDS] - Locked versions
/tsconfig.json                  ✅ [ANVÄNDS] - TypeScript konfiguration
/tsconfig.node.json            ✅ [ANVÄNDS] - Node-specific TS config
/vite.config.ts                 ✅ [ANVÄNDS] - Vite build configuration
/deno.json                      ✅ [ANVÄNDS] - Deno import map för Supabase Edge Functions
/deno.lock                      ✅ [ANVÄNDS] - Deno lock file
/.gitignore                     ✅ [ANVÄNDS] - Git ignore rules (BEHÖVER UPPDATERING - saknar /dist/)
/.env.example                   ✅ [ANVÄNDS] - Environment variable template
```

### Documentation
```
/CLAUDE.md                      ✅ [ANVÄNDS] - Claude Code instruktioner
/PROJECT_RULES.md              ✅ [ANVÄNDS] - Projektregler för Claude
/docs/SUPABASE_SETUP.md        ✅ [ANVÄNDS] - Supabase setup guide
/docs/system_instructions.md    ✅ [ANVÄNDS] - System instruktioner
/docs/preact-migration.md       ✅ [ANVÄNDS] - Preact migration notes
/docs/vite-migration.md         ✅ [ANVÄNDS] - Vite migration notes
/docs/2025-11-25-excel-claude-integration.md  ✅ [ANVÄNDS] - Excel integration docs
/docs/MANUAL_TEST_RATE_LIMIT.md  ✅ [ANVÄNDS] - Rate limiting testing guide
/docs/page_flow.md              ✅ [ANVÄNDS] - Page flow documentation
```

---

## `/src/` Directory - Active TypeScript Source

### Entry Points
```
/src/main.ts                    ✅ [ANVÄNDS] - Main app entry (857 lines)
                                   ⚠️ CONTAINS DUPLICATE LOGIN LOGIC (lines 64-120)
                                   → Bör flyttas till dedikerad service

/src/login.ts                   ✅ [ANVÄNDS] - Login page entry (115 lines)
                                   → Funktionell, används av login.html

/src/vite-env.d.ts              ✅ [ANVÄNDS] - Vite environment types
```

### Components
```
/src/components/
├── ExcelWorkspace.ts           ✅ [ANVÄNDS] - Excel viewer (TypeScript, 294 lines)
│                                  → Ersätter src/scripts/excelViewer.js
│
├── VATReportCard.legacy.ts     ⚠️ [LEGACY] - Gammal VAT card implementation
│                                  → Undersök om den används eller kan tas bort
│
└── preact-adapter.ts           ✅ [ANVÄNDS] - Preact mounting utility
```

### Types
```
/src/types/
├── vat.ts                      ✅ [ANVÄNDS] - VAT report TypeScript interfaces
├── excel.ts                    ✅ [ANVÄNDS] - Excel-related types
```

### Utils
```
/src/utils/
├── excelExport.ts              ✅ [ANVÄNDS] - Excel export utilities
└── VoiceService.ts             ✅ [ANVÄNDS] - Voice input service
```

### Scripts (LEGACY)
```
/src/scripts/
└── excelViewer.js              🔄 [DUPLICATE] - Gammal JS version (137 lines)
                                   → Ersatt av /src/components/ExcelWorkspace.ts
                                   → Fortfarande importerad i app/index.html:733
                                   → **KAN TAS BORT** efter att ta bort script tag
```

### Styles
```
/src/styles/
├── main.css                    ✅ [ANVÄNDS] - Huvudstilar + CSS variabler
├── changelog.css               ✅ [ANVÄNDS] - Importeras från app/index.html:22
│
└── components/
    ├── vat-card.css            ✅ [ANVÄNDS] - VAT card styles
    └── voice-input.css         ✅ [ANVÄNDS] - Voice input styles
```

---

## `/app/` Directory - Application Assets

### App-Specific Files
```
/app/manifest.json              ✅ [ANVÄNDS] - PWA manifest
/app/service-worker.js          ❌ [UNUSED] - Ej registrerad, PWA ej aktiverad än
/app/assets/icons/              ✅ [ANVÄNDS] - App icons
/app/assets/icons/icon-512.png  ✅ [ANVÄNDS] - High-res app icon
```

### Legacy App Source (TOM)
```
/app/src/js/                    ❌ [EMPTY] - Ingen JS-kod här längre
/app/src/css/
├── changelog.css               🔄 [DUPLICATE] - Samma som /src/styles/changelog.css?
│                                  → **UNDERSÖK OCH KONSOLIDERA**
```

---

## `/supabase/` Directory - Backend

### Edge Functions
```
/supabase/functions/
├── gemini-chat/index.ts        ✅ [ANVÄNDS] - Gemini AI chat endpoint
├── claude-analyze/index.ts     ✅ [ANVÄNDS] - Claude Excel analysis
├── upload-file/index.ts        ✅ [ANVÄNDS] - File upload to Supabase Storage
└── fortnox/index.ts            ✅ [ANVÄNDS] - Fortnox API integration
```

### Services
```
/supabase/services/
├── GeminiService.ts            ✅ [ANVÄNDS] - Gemini AI service layer
├── FortnoxService.ts           ✅ [ANVÄNDS] - Fortnox API service layer
└── RateLimiterService.ts       ✅ [ANVÄNDS] - API rate limiting service
```

### Migrations
```
/supabase/migrations/
├── 20241124000001_create_api_usage.sql        ✅ [ANVÄNDS] - API usage tracking
├── 20241125000001_create_files_table.sql      ✅ [ANVÄNDS] - File storage schema
└── 20251125000002_auth_and_rls.sql            ✅ [ANVÄNDS] - Auth & RLS policies
```

### Supabase Config
```
/supabase/.temp/cli-latest      ✅ [ANVÄNDS] - Supabase CLI binary cache
```

---

## `/_archive/` Directory - Legacy Files

### Kan tas bort (per användare)
```
/_archive/vite-migration-2025-11-26/    🗂️ [ARCHIVE] - Gammal migration
                                           → **KAN TAS BORT PERMANENT**
                                           (användaren sade "Ta bort den")
```

### Övriga arkiverade filer
```
/_archive/
├── root_script.js              🗂️ [ARCHIVE] - Gammal root script
├── root_style.css              🗂️ [ARCHIVE] - Gammal root style
├── faktura_telia.pdf           🗂️ [ARCHIVE] - Test PDF
├── test_britta.sh              🗂️ [ARCHIVE] - Old test script
├── verify_error_screenshot.sh  🗂️ [ARCHIVE] - Old verification script
└── agent.log                   🗂️ [ARCHIVE] - Old log file
```

**Rekommendation:** Hela `_archive/` kan potentiellt rensas eller flyttas till extern backup.

---

## `/dist/` Directory - Build Artifacts

```
/dist/                          ⚠️ [BUILD OUTPUT] - Vite build output
                                   → **INTE I .gitignore men BÖR VARA**
                                   → Användaren sa: "Ja, addera /dist/"
```

**Content:**
- `/dist/index.html` - Byggd landing page
- `/dist/login.html` - Byggd login page
- `/dist/app/index.html` - Byggd app page
- `/dist/assets/*.js` - Bundled JavaScript
- `/dist/assets/*.css` - Bundled CSS

**Action Required:** Lägg till `/dist/` i `.gitignore`

---

## `/node_modules/` Directory

```
/node_modules/                  ✅ [ANVÄNDS] - NPM dependencies
                                   → Redan i .gitignore ✓
```

---

## Skills (Swedish Accounting)

```
/.skills/svensk-ekonomi/        ✅ [ANVÄNDS] - Swedish accounting expertise skill
├── skill.json                  ✅ [ANVÄNDS] - Skill definition
├── scripts/                    ✅ [ANVÄNDS] - Python validators & processors
│   ├── validators.py           ✅ [ANVÄNDS] - Swedish ID validators
│   ├── vat_processor.py        ✅ [ANVÄNDS] - VAT calculation
│   └── sie_export.py           ✅ [ANVÄNDS] - SIE file export
├── references/                 ✅ [ANVÄNDS] - Accounting reference docs
│   ├── bas_accounts.md         ✅ [ANVÄNDS] - BAS account plan
│   └── vat_rules.md            ✅ [ANVÄNDS] - Swedish VAT rules
└── test_transactions.xlsx      ✅ [ANVÄNDS] - Test data
```

---

## Summary Statistics

### By Status
- ✅ **[ANVÄNDS]**: 68 filer
- ⚠️ **[LEGACY]**: 2 filer (VATReportCard.legacy.ts, changelog.css duplicate)
- ❌ **[UNUSED]**: 2 filer (service-worker.js, /app/src/js/)
- 🔄 **[DUPLICATE]**: 3 kritiska dubletter (excelViewer.js, CDN scripts)
- 🗂️ **[ARCHIVE]**: ~15 filer (kan tas bort)

### Critical Actions Required

1. **Remove Legacy Excel Viewer**
   - Ta bort `/src/scripts/excelViewer.js`
   - Ta bort `<script>` tag från `app/index.html:733`

2. **Remove CDN Duplicates**
   - Ta bort Supabase CDN script (`app/index.html:731`)
   - Ta bort SheetJS CDN script (`app/index.html:732`)

3. **Fix .gitignore**
   - Lägg till `/dist/` på ny rad

4. **Clean Archive**
   - Ta bort `_archive/vite-migration-2025-11-26/` helt

5. **Investigate Legacy Files**
   - `VATReportCard.legacy.ts` - används den?
   - `app/src/css/changelog.css` - duplicerad?

---

## Nästa Steg

Se `docs/audit/recommendations.md` för fullständig handlingsplan.

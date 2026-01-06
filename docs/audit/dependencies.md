# Dependencies Analysis - Britta Project

**Genomförd:** 2025-11-26
**Syfte:** Analysera alla dependencies, hitta dubbletter, och identifiera oanvända paket

---

## NPM Dependencies (package.json)

### Production Dependencies

```json
{
  "@preact/preset-vite": "^2.10.2",     ✅ ANVÄNDS
  "@supabase/supabase-js": "^2.39.0",   ✅ ANVÄNDS (men DUP via CDN)
  "preact": "^10.27.2",                 ✅ ANVÄNDS
  "xlsx": "^0.18.5"                     ✅ ANVÄNDS (men DUP via CDN)
}
```

#### Analysis:

**`@preact/preset-vite@2.10.2`**
- **Status:** ✅ Aktiv
- **Används av:** Vite config för att kompilera Preact components
- **Location:** vite.config.ts:7
- **Purpose:** Möjliggör Preact JSX/TSX support

**`preact@10.27.2`**
- **Status:** ✅ Aktiv
- **Används av:**
  - `src/components/VATReportCard.ts` (via preact-adapter)
  - `src/components/preact-adapter.ts`
- **Purpose:** Lightweight React alternative för VAT report rendering

**`@supabase/supabase-js@2.39.0`**
- **Status:** ✅ Aktiv men 🔄 DUPLICERAD
- **Används av:**
  - `src/main.ts:11` - Main app client
  - `src/login.ts:1` - Login page client
- **Duplicate:** ⚠️ Även importerad via CDN i `app/index.html:731`
  ```html
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  ```
- **Recommendation:** Ta bort CDN script, använd endast npm version via Vite

**`xlsx@0.18.5`**
- **Status:** ✅ Aktiv men 🔄 DUPLICERAD
- **Används av:**
  - `src/main.ts:2` - Excel file parsing
  - `src/components/ExcelWorkspace.ts:1` - Excel workspace
- **Duplicate:** ⚠️ Även importerad via SheetJS CDN i `app/index.html:732`
  ```html
  <script src="https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js"></script>
  ```
- **Version Conflict:** NPM har 0.18.5, CDN har 0.20.1 (olika versioner!)
- **Recommendation:** Ta bort CDN script, använd endast npm 0.18.5 via Vite
- **Optional:** Överväg att uppgradera npm version till 0.20.1 för konsekvens

---

### Dev Dependencies

```json
{
  "@types/node": "^20.10.0",     ✅ ANVÄNDS
  "supabase": "^1.142.2",        ✅ ANVÄNDS
  "typescript": "^5.3.0",        ✅ ANVÄNDS
  "vite": "^5.0.0"               ✅ ANVÄNDS
}
```

#### Analysis:

**`@types/node@20.10.0`**
- **Status:** ✅ Aktiv
- **Purpose:** TypeScript types för Node.js APIs
- **Used by:** All TS files som använder Node utilities

**`supabase@1.142.2`**
- **Status:** ✅ Aktiv
- **Purpose:** Supabase CLI för Edge Functions deployment
- **Used in:**
  - `npm run supabase:start`
  - `npm run supabase:stop`
  - `npm run supabase:serve`
  - `npm run supabase:deploy`

**`typescript@5.3.0`**
- **Status:** ✅ Aktiv
- **Purpose:** TypeScript compiler
- **Config:** `tsconfig.json`, `tsconfig.node.json`
- **Used by:** All .ts files

**`vite@5.0.0`**
- **Status:** ✅ Aktiv
- **Purpose:** Build tool & dev server
- **Config:** `vite.config.ts`
- **Scripts:**
  - `npm run dev` → `vite`
  - `npm run build` → `tsc && vite build`
  - `npm run preview` → `vite preview`

---

## CDN Dependencies (från HTML files)

### `/app/index.html`

```html
<!-- Line 731 -->
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
```
🔄 **DUPLICATE** → Redan i package.json, används via `import { createClient } from '@supabase/supabase-js'`

**ACTION:** ❌ Ta bort denna rad

---

```html
<!-- Line 732 -->
<script src="https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js"></script>
```
🔄 **DUPLICATE + VERSION CONFLICT** → Redan i package.json (0.18.5 vs 0.20.1)

**ACTION:** ❌ Ta bort denna rad

---

```html
<!-- Line 733 -->
<script type="module" src="/src/scripts/excelViewer.js"></script>
```
🔄 **LEGACY** → Ersatt av `/src/components/ExcelWorkspace.ts`

**ACTION:** ❌ Ta bort denna rad

---

### Google Fonts (OK)

```html
<!-- index.html, login.html, app/index.html -->
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
```
✅ **ANVÄNDS** - Detta är OK, fonts från CDN är standard practice

---

## Deno Dependencies (Edge Functions)

### `/deno.json` Import Map

```json
{
  "imports": {
    "@supabase/supabase-js": "npm:@supabase/supabase-js@2",
    "@google/generative-ai": "npm:@google/generative-ai@0.21.0"
  }
}
```

**Purpose:** Deno runtime för Supabase Edge Functions använder npm: specifier

**Analysis:**

**`@supabase/supabase-js@2`**
- **Status:** ✅ Aktiv
- **Used by:** All Edge Functions för att kommunicera med Supabase
- **Different from frontend:** Edge Functions körs på Deno runtime, inte browser

**`@google/generative-ai@0.21.0`**
- **Status:** ✅ Aktiv
- **Used by:**
  - `supabase/functions/gemini-chat/index.ts`
  - `supabase/services/GeminiService.ts`
- **Purpose:** Google Gemini AI SDK för chat functionality

---

## Dependency Tree Visualization

```
Frontend (Browser via Vite)
├── @supabase/supabase-js@2.39.0 (npm)
│   └── Used in: main.ts, login.ts
├── xlsx@0.18.5 (npm)
│   └── Used in: main.ts, ExcelWorkspace.ts
├── preact@10.27.2 (npm)
│   └── Used in: VATReportCard.tsx, preact-adapter.ts
└── @preact/preset-vite@2.10.2 (npm, dev)
    └── Used by: vite.config.ts

Backend (Deno via Supabase Edge Functions)
├── @supabase/supabase-js@2 (npm: via Deno)
│   └── Used in: All Edge Functions
└── @google/generative-ai@0.21.0 (npm: via Deno)
    └── Used in: gemini-chat, GeminiService.ts

Build Tools (Node)
├── vite@5.0.0
├── typescript@5.3.0
├── @types/node@20.10.0
└── supabase@1.142.2 (CLI)
```

---

## Version Conflicts

### xlsx: 0.18.5 (npm) vs 0.20.1 (CDN)

**Current State:**
- package.json specifies `xlsx@0.18.5`
- app/index.html loads `xlsx-0.20.1` from CDN
- **Risk:** Potentiella API-skillnader mellan versionerna

**Recommendation:**
1. Ta bort CDN script (line 732)
2. Använd endast npm version via Vite import
3. **Optional:** Uppgradera npm till 0.20.1 om nya features behövs

```bash
# Optional upgrade
npm install xlsx@0.20.1
```

---

## Unused Dependencies

### Analysis Result: ✅ NO UNUSED DEPENDENCIES

All dependencies i package.json används aktivt:
- `@preact/preset-vite` → vite.config.ts
- `@supabase/supabase-js` → main.ts, login.ts
- `preact` → VATReportCard, preact-adapter
- `xlsx` → main.ts, ExcelWorkspace.ts
- `@types/node` → TypeScript compilation
- `supabase` → CLI commands
- `typescript` → Build process
- `vite` → Dev & build

---

## Missing Dependencies

### Analysis: Potential additions to consider

**Recommended to ADD:**

1. **`@types/node` upgrade check**
   ```bash
   # Check för nyare version
   npm outdated @types/node
   ```

2. **ESLint & Prettier** (Code quality)
   ```bash
   npm install -D eslint prettier @typescript-eslint/parser @typescript-eslint/eslint-plugin
   ```
   **Purpose:** Konsekvens kod style, catch errors

3. **Vitest** (Testing)
   ```bash
   npm install -D vitest @vitest/ui
   ```
   **Purpose:** Unit testing för TypeScript components

**NOT NEEDED (already in project):**
- SheetJS/xlsx ✓
- Supabase ✓
- Preact ✓

---

## Summary & Recommendations

### ❌ REMOVE (Duplicates)

1. **app/index.html line 731** - Supabase CDN script
2. **app/index.html line 732** - SheetJS CDN script
3. **app/index.html line 733** - Legacy excelViewer.js import

### ✅ KEEP (All npm dependencies)

All current npm dependencies används aktivt.

### 🔄 UPDATE (Optional)

1. **xlsx:** 0.18.5 → 0.20.1 (for version consistency)
2. **@types/node:** Check för nyare 20.x version

### ➕ ADD (Optional, for code quality)

1. ESLint + Prettier (kod kvalitet)
2. Vitest (unit testing)

---

## Dependency Security

### Security Audit Recommendation

```bash
# Check för säkerhetsproblem
npm audit

# Auto-fix om möjligt
npm audit fix
```

### Update Strategy

```bash
# Check för outdated packages
npm outdated

# Update minor/patch versions safely
npm update

# Update major versions (one at a time)
npm install package@latest
```

---

## Next Steps

1. Se `docs/audit/duplicates.md` för detaljerad analys av duplicerad kod
2. Se `docs/audit/recommendations.md` för fullständig åtgärdsplan

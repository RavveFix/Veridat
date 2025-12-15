# Duplicates Analysis - Britta Project

**Genomförd:** 2025-11-26
**Syfte:** Identifiera all duplicerad kod, dependencies, och funktionalitet

---

## Summary

### Totalt antal dubletter: 5 kritiska

1. 🔄 Excel Viewer (JS vs TS implementation)
2. 🔄 Supabase Client (CDN vs npm)
3. 🔄 SheetJS/xlsx (CDN vs npm + version conflict)
4. 🔄 Login Logic (duplicerad i main.ts)
5. ⚠️ Changelog CSS (möjlig duplicering)

---

## Duplicate 1: Excel Viewer Implementation

### Legacy Version (Vanilla JavaScript)
```
File: /src/scripts/excelViewer.js
Lines: 137
Created: Före TypeScript migration
Status: 🔄 LEGACY
```

**Code:**
```javascript
class ExcelViewer {
    constructor() {
        this.currentWorkbook = null;
        this.currentFile = null;
        // ...
    }

    async openExcelFile(fileUrl, filename) {
        // Uses global XLSX from CDN
        this.currentWorkbook = XLSX.read(arrayBuffer, { type: 'array' });
        // ...
    }
}

window.ExcelViewer = ExcelViewer;  // Global export
```

**Features:**
- ✅ Sheet tabs
- ✅ HTML table rendering
- ✅ Open/close panel
- ❌ No TypeScript types
- ❌ No Preact integration
- ❌ Depends on global XLSX from CDN

---

### New Version (TypeScript + Preact)
```
File: /src/components/ExcelWorkspace.ts
Lines: 294
Created: Under Vite migration
Status: ✅ ACTIVE
```

**Code:**
```typescript
import * as XLSX from 'xlsx';
import type { ExcelPanelElements, ExcelWorkspaceOptions } from '../types/excel';
import type { VATReportData } from '../types/vat';
import { VATReportCard } from './VATReportCard';
import { mountPreactComponent } from './preact-adapter';

export class ExcelWorkspace {
    private currentWorkbook: XLSX.WorkBook | null = null;
    private currentFile: string | null = null;
    private currentContent: ArtifactContent | null = null;
    private vatReportUnmount?: () => void;

    constructor(options: ExcelWorkspaceOptions = {}) {
        // ...
    }

    async openExcelFile(fileUrl: string, filename: string): Promise<void> {
        // Uses XLSX from npm via import
        this.currentWorkbook = XLSX.read(arrayBuffer, { type: 'array' });
        // ...
    }

    openVATReport(data: VATReportData, fileUrl?: string): void {
        // NEW FEATURE: Preact component mounting
        this.vatReportUnmount = mountPreactComponent(
            VATReportCard,
            { data },
            this.elements.container
        );
    }
}
```

**Features:**
- ✅ Sheet tabs
- ✅ HTML table rendering
- ✅ Open/close panel
- ✅ TypeScript types & interfaces
- ✅ Preact integration för VAT reports
- ✅ Imports XLSX from npm
- ✅ Better error handling
- ✅ Callback system (onClose, onSheetChange, onError)

---

### Current Usage

**app/index.html line 733:**
```html
<script type="module" src="/src/scripts/excelViewer.js"></script>
```
❌ **FORTFARANDE IMPORTERAD** men används inte längre

**main.ts lines 38-49:**
```typescript
const excelWorkspace = new ExcelWorkspace({
    onClose: () => console.log('Excel panel closed'),
    onSheetChange: (sheetName) => console.log('Switched to sheet:', sheetName),
    onError: (error) => console.error('Excel workspace error:', error)
});
```
✅ **ANVÄNDS** - Detta är den aktiva implementationen

---

### Recommendation

**ACTION:**
1. ❌ Ta bort `/src/scripts/excelViewer.js` helt
2. ❌ Ta bort `<script>` import från `app/index.html:733`
3. ✅ Behåll endast `ExcelWorkspace.ts`

**Rationale:**
- ExcelWorkspace.ts är överlägsen (TypeScript, Preact, bättre features)
- Legacy version används inte längre
- Minskar bundle size
- Eliminerar förvirring

---

## Duplicate 2: Supabase Client Library

### NPM Version (ANVÄNDS)
```
Package: @supabase/supabase-js@2.39.0
Installation: npm install
```

**Used in:**
```typescript
// src/main.ts:1
import { createClient } from '@supabase/supabase-js';

// src/login.ts:1
import { createClient } from '@supabase/supabase-js';
```

**Bundled by:** Vite → `/dist/assets/main-*.js`

---

### CDN Version (DUPLICERAD)
```html
<!-- app/index.html line 731 -->
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
```

**Problem:**
- ❌ Laddas ner dubbelt (CDN + bundled i Vite)
- ❌ Oklar vilken version som faktiskt används
- ❌ Potentiella konflikter om de har olika API:er
- ❌ Större total bundle size

---

### Recommendation

**ACTION:**
1. ❌ Ta bort CDN script från `app/index.html:731`
2. ✅ Behåll npm version, användas via Vite imports

**Result:**
- ✅ Endast en version laddas
- ✅ Tydlig version control via package.json
- ✅ Mindre total bundle size
- ✅ Tree-shaking fungerar (endast används delar bundlas)

---

## Duplicate 3: SheetJS / xlsx Library

### NPM Version
```
Package: xlsx@0.18.5
Installation: npm install
```

**Used in:**
```typescript
// src/main.ts:2
import * as XLSX from 'xlsx';

// src/components/ExcelWorkspace.ts:1
import * as XLSX from 'xlsx';
```

**Bundled by:** Vite → `/dist/assets/main-*.js`

---

### CDN Version
```html
<!-- app/index.html line 732 -->
<script src="https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js"></script>
```

**CRITICAL PROBLEM:**
- ❌ **VERSION CONFLICT:** npm har 0.18.5, CDN har 0.20.1
- ❌ Laddas ner dubbelt
- ❌ Legacy excelViewer.js förväntar sig global `XLSX` från CDN
- ❌ Ny ExcelWorkspace.ts importerar från npm

**Potential Issues:**
```javascript
// Legacy code förväntar sig global XLSX
if (typeof XLSX === 'undefined') {
    throw new Error('SheetJS library not loaded');  // Skulle hända om CDN tas bort
}
```

Men legacy code används inte längre, så detta är inte ett problem.

---

### Recommendation

**ACTION:**
1. ❌ Ta bort CDN script från `app/index.html:732`
2. ✅ Behåll npm version (0.18.5)
3. **OPTIONAL:** Uppgradera npm till 0.20.1 för att matcha CDN version
   ```bash
   npm install xlsx@0.20.1
   ```

**Rationale:**
- Legacy excelViewer.js tas bort (den var beroende av CDN version)
- ExcelWorkspace.ts använder npm import
- Behåll konsekvent versionhantering

---

## Duplicate 4: Login Logic

### Dedicated Login Page (CORRECT)
```
File: /src/login.ts
Lines: 115
Purpose: Hanterar login-sidan (/login.html)
Status: ✅ ANVÄNDS KORREKT
```

**Code:**
```typescript
async function initLogin() {
    // Check if already logged in
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
        window.location.href = '/app/';
        return;
    }

    // Handle form submission
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const { error } = await supabase.auth.signInWithOtp({
            email,
            options: {
                emailRedirectTo: window.location.origin + '/app/'
            }
        });
        // ...
    });
}
```

**Purpose:** ✅ Detta är KORREKT - login.ts ska hantera login-sidan.

---

### Duplicated in Main App (UNNECESSARY)
```
File: /src/main.ts
Lines: 64-120 (57 lines duplicerad logik)
Purpose: ??? (oklart varför detta finns här)
Status: 🔄 DUPLICERAD & FÖRVIRRANDE
```

**Code:**
```typescript
// main.ts line 64-120
const loginForm = document.getElementById('login-form') as HTMLFormElement;
if (loginForm) {
    const messageEl = document.getElementById('message');
    const submitBtn = document.getElementById('submit-btn') as HTMLButtonElement;

    if (session) {
        window.location.href = '/app/';
        return;
    }

    loginForm.addEventListener('submit', async (e) => {
        // EXAKT SAMMA KOD SOM I login.ts
    });
}
```

**Problem:**
- ❌ **DUPLICATE:** Exakt samma login logic som i `login.ts`
- ❌ **CONFUSION:** Varför finns detta i main.ts?
- ❌ **NEVER RUNS:** main.ts laddas av `/app/index.html`, inte `/login.html`
- ❌ **FALSE POSITIVE:** `document.getElementById('login-form')` returnerar alltid `null` i app context

---

### Why This Exists

**Hypothesis:** Under utveckling kanske login-funktionalitet testades direkt i main.ts innan den flyttades till dedikerad login.ts. Glömde ta bort.

**Evidence:**
```typescript
// main.ts line 55-61 (Auth guard - DETTA ÄR KORREKT)
const isLoginPage = window.location.pathname.includes('login.html');
const isLandingPage = window.location.pathname === '/' || window.location.pathname.endsWith('index.html');

if (!session && !isLoginPage && !isLandingPage && window.location.pathname.includes('/app/')) {
    window.location.href = '/login.html';  // ✅ Denna redirect är korrekt
    return;
}
```

Auth guard är korrekt! Men login form logic (lines 64-120) är onödig.

---

### Recommendation

**ACTION:**
1. ❌ Ta bort lines 64-120 från `main.ts` (hela loginForm block)
2. ✅ Behåll auth guard (lines 52-61)
3. ✅ Behåll `login.ts` oförändrad

**Resulting main.ts structure:**
```typescript
// Check Authentication State
const { data: { session } } = await supabase.auth.getSession();

// Handle login page redirect if not authenticated (KEEP THIS)
const isLoginPage = window.location.pathname.includes('login.html');
if (!session && !isLoginPage && window.location.pathname.includes('/app/')) {
    window.location.href = '/login.html';
    return;
}

// ❌ DELETE: Login Page Logic (lines 64-120)
// loginForm.addEventListener('submit', async (e) => { ... });

// ✅ KEEP: Rest of main.ts
// Theme Toggle
const themeToggle = document.getElementById('theme-toggle');
// ...
```

---

## Duplicate 5: Changelog CSS (POTENTIAL)

### Version 1
```
File: /app/src/css/changelog.css
Location: app/src/css/
Status: ⚠️ NEEDS INVESTIGATION
```

**Referenced by:** ???

---

### Version 2
```
File: /src/styles/changelog.css
Location: src/styles/
Status: ✅ ANVÄNDS
```

**Referenced by:**
```html
<!-- app/index.html line 22 -->
<link rel="stylesheet" href="/src/styles/changelog.css">
```

---

### Investigation Needed

**Questions:**
1. Är `/app/src/css/changelog.css` och `/src/styles/changelog.css` samma fil?
2. Om ja, vilken är den "riktiga"?
3. Varför finns två changelog.css filer?

**Action Required:**
```bash
# Compare files
diff /app/src/css/changelog.css /src/styles/changelog.css

# Om de är identiska:
# → Ta bort /app/src/css/changelog.css
# → Behåll /src/styles/changelog.css

# Om de är olika:
# → Merge innehållet
# → Behåll endast /src/styles/changelog.css
```

**Recommendation (preliminary):**
1. ⚠️ Läs båda filerna och jämför
2. ❌ Ta bort duplicerad version (troligen `/app/src/css/changelog.css`)
3. ✅ Konsolidera all CSS till `/src/styles/`

---

## Summary Table

| Duplicate | Legacy Location | New Location | Status | Action |
|-----------|----------------|--------------|--------|--------|
| **Excel Viewer** | `/src/scripts/excelViewer.js` | `/src/components/ExcelWorkspace.ts` | ✅ New active | ❌ Delete legacy |
| **Supabase CDN** | `app/index.html:731` | `npm: @supabase/supabase-js@2.39.0` | ✅ NPM active | ❌ Delete CDN |
| **SheetJS CDN** | `app/index.html:732` (v0.20.1) | `npm: xlsx@0.18.5` | ✅ NPM active | ❌ Delete CDN |
| **Login Logic** | `main.ts:64-120` | `/src/login.ts` | ✅ login.ts active | ❌ Delete from main.ts |
| **Changelog CSS** | `/app/src/css/changelog.css` | `/src/styles/changelog.css` | ⚠️ Needs investigation | ⚠️ Compare & merge |

---

## Estimated Impact

### After Cleanup:

**Files Deleted:** 2
- `/src/scripts/excelViewer.js`
- `/app/src/css/changelog.css` (if duplicate)

**Lines Removed from main.ts:** ~57 lines (login logic)

**Script Tags Removed from app/index.html:** 3
- Line 731: Supabase CDN
- Line 732: SheetJS CDN
- Line 733: excelViewer.js

**Bundle Size Reduction:**
- Supabase CDN: ~150 KB (estimated)
- SheetJS CDN: ~800 KB (full build)
- Legacy excelViewer.js: ~4 KB

**Total Estimated Reduction:** ~950 KB page load size

**Performance Impact:**
- ✅ Faster initial page load
- ✅ Less JavaScript to parse
- ✅ Fewer HTTP requests
- ✅ Better Lighthouse score

---

## Next Steps

1. Se `docs/audit/recommendations.md` för exakt exekveringsplan
2. Se `docs/audit/proposed-structure.md` för ideal filstruktur efter cleanup

# Recommendations & Action Plan - Veridat Project

**Genomförd:** 2025-11-26
**Syfte:** Exekverbar handlingsplan för att städa och organisera kodbasen

---

## Execution Strategy

**IMPORTANT RULES:**
1. ❌ **ALDRIG TA BORT** filer direkt - flytta alltid till `_archive/`
2. ✅ **TESTA EFTER VARJE STEG** med `npm run build`
3. ✅ **DOKUMENTERA** varje ändring
4. ✅ **SKAPA BACKUP** innan start
5. ✅ **EN ÄNDRING I TAGET** - inte alla på en gång

---

## Phase 0: Preparation (MANDATORY)

### Step 0.1: Create Backup
```bash
# Create timestamped backup
cp -r /Users/ravonstrawder/Desktop/Britta /Users/ravonstrawder/Desktop/Britta_backup_$(date +%Y%m%d_%H%M%S)
```

**Verification:**
```bash
ls -la /Users/ravonstrawder/Desktop/ | grep Britta
```

Expected output:
```
Britta/
Britta_backup_20251126_HHMMSS/
```

---

### Step 0.2: Verify Build Works
```bash
cd /Users/ravonstrawder/Desktop/Britta
npm run build
```

**Expected output:**
```
✓ built in XXXms
dist/index.html
dist/login.html
dist/app/index.html
dist/app/nyheter.html
```

**If build fails:** STOP här och fixa build errors först.

---

## Phase 1: Remove Duplicate CDN Scripts (SÄKERT)

### Priority: 🔴 HIGH
### Risk Level: 🟢 LOW
### Estimated Time: 5 min

---

### Step 1.1: Remove CDN Scripts from app/index.html

**File:** `/app/index.html`

**Lines to DELETE:** 731-733

**BEFORE:**
```html
<!-- Lines 730-734 -->
<!-- Scripts -->
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js"></script>
<script type="module" src="/src/scripts/excelViewer.js"></script>
<script type="module" src="/src/main.ts"></script>
```

**AFTER:**
```html
<!-- Lines 730-731 -->
<!-- Scripts -->
<script type="module" src="/src/main.ts"></script>
```

**Command:**
Edit file and remove lines 731-733, keep line 734 (now 731).

---

### Step 1.2: Test Build
```bash
npm run build
```

**Expected:** ✅ Build succeeds

---

### Step 1.3: Test App Functionality
```bash
npm run dev
```

**Manual testing:**
1. Open http://localhost:5173/app/
2. Upload an Excel file
3. Verify Excel workspace opens
4. Verify VAT report displays correctly

**Expected:** ✅ Everything works (nu använder det npm versions)

---

### Step 1.4: Commit Changes
```bash
git add app/index.html
git commit -m "Remove duplicate CDN scripts (Supabase, SheetJS, excelViewer.js)

- Removed Supabase CDN (using npm @supabase/supabase-js@2.39.0)
- Removed SheetJS CDN (using npm xlsx@0.18.5)
- Removed legacy excelViewer.js import

Reduces bundle size by ~950 KB and eliminates version conflicts.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Phase 2: Remove Legacy excelViewer.js (SÄKERT)

### Priority: 🔴 HIGH
### Risk Level: 🟢 LOW
### Estimated Time: 3 min

---

### Step 2.1: Move Legacy File to Archive
```bash
mkdir -p _archive/legacy-scripts
mv src/scripts/excelViewer.js _archive/legacy-scripts/
```

**Verification:**
```bash
ls -la _archive/legacy-scripts/
# Should show: excelViewer.js

ls -la src/scripts/
# Should be empty or not exist
```

---

### Step 2.2: Remove Empty Directory (if empty)
```bash
rmdir src/scripts  # Only succeeds if empty
```

**If directory has other files:** Don't delete it.

---

### Step 2.3: Test Build
```bash
npm run build
```

**Expected:** ✅ Build succeeds (file was not imported anymore after Phase 1)

---

### Step 2.4: Commit
```bash
git add src/scripts/ _archive/
git commit -m "Archive legacy excelViewer.js

- Moved src/scripts/excelViewer.js to _archive/legacy-scripts/
- Removed empty src/scripts/ directory
- Legacy code replaced by ExcelWorkspace.ts

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Phase 3: Remove Duplicate Login Logic from main.ts (MEDIUM RISK)

### Priority: 🟡 MEDIUM
### Risk Level: 🟡 MEDIUM (affects main app logic)
### Estimated Time: 10 min

---

### Step 3.1: Backup main.ts
```bash
cp src/main.ts src/main.ts.backup
```

---

### Step 3.2: Edit main.ts

**File:** `/src/main.ts`

**Lines to DELETE:** 64-120 (entire login form logic block)

**KEEP lines 52-61:**
```typescript
// Check Authentication State
const { data: { session } } = await supabase.auth.getSession();

// Handle login page redirect if not authenticated and not on login/landing page
const isLoginPage = window.location.pathname.includes('login.html');
const isLandingPage = window.location.pathname === '/' || window.location.pathname.endsWith('index.html');

if (!session && !isLoginPage && !isLandingPage && window.location.pathname.includes('/app/')) {
    window.location.href = '/login.html';
    return;
}
```

**DELETE lines 64-120:**
```typescript
// Login Page Logic
const loginForm = document.getElementById('login-form') as HTMLFormElement;
console.log('initApp: Checking for login-form element:', loginForm);
if (loginForm) {
    // ... ENTIRE BLOCK ... (57 lines)
}
```

**Rationale:**
- Auth guard (lines 52-61) är CORRECT ✅ - behåll den!
- Login form logic (lines 64-120) är DUPLICATE ❌ - redan i login.ts

---

### Step 3.3: Verify Code

Efter edit, verifiera att main.ts:
1. ✅ Behåller `supabase.auth.getSession()` check
2. ✅ Behåller redirect till `/login.html` om ej authenticated
3. ❌ INTE har `document.getElementById('login-form')`

---

### Step 3.4: Test Build
```bash
npm run build
```

**Expected:** ✅ Build succeeds

---

### Step 3.5: Test Both Pages

**Test Login Page:**
```bash
npm run dev
# Visit: http://localhost:5173/login.html
```
1. Enter email
2. Should trigger Supabase magic link
3. Should show success message

**Test App Page (unauthenticated):**
```bash
# Visit: http://localhost:5173/app/ (in incognito/without session)
```
1. Should redirect to `/login.html`

**Test App Page (authenticated):**
```bash
# Login first, then visit /app/
```
1. Should load app successfully
2. No JavaScript errors in console

---

### Step 3.6: Commit
```bash
git add src/main.ts
git commit -m "Remove duplicate login logic from main.ts

- Login form handling already exists in src/login.ts
- Kept authentication guard (redirect to /login if not authenticated)
- Removed unnecessary login form event listener (lines 64-120)

Reduces main.ts by 57 lines and eliminates duplicate logic.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Step 3.7: Cleanup Backup (if successful)
```bash
rm src/main.ts.backup
```

---

## Phase 4: Update .gitignore (SÄKERT)

### Priority: 🔴 HIGH
### Risk Level: 🟢 LOW
### Estimated Time: 2 min

---

### Step 4.1: Add /dist/ to .gitignore

**File:** `/.gitignore`

**ADD at end:**
```
# Build output
dist/
```

**Full .gitignore after change:**
```gitignore
# Supabase
.supabase/

# Node
node_modules/
npm-debug.log
yarn-error.log

# Environment
.env
.env.local

# API Keys (old client-side config - no longer used)
config.js

# OS
.DS_Store
Thumbs.db

# IDE
.idea/
*.swp
*.swo

# Build output
dist/
```

---

### Step 4.2: Remove dist/ from Git Tracking
```bash
# Remove from git but keep local files
git rm -r --cached dist/

# Verify it's removed from tracking
git status
# Should show: deleted: dist/...
```

---

### Step 4.3: Commit
```bash
git add .gitignore
git commit -m "Add dist/ to .gitignore

Build artifacts should not be version controlled.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Phase 5: Delete Old Archive (DESTRUCTIVE - FINAL APPROVAL REQUIRED)

### Priority: 🟡 MEDIUM
### Risk Level: 🟡 MEDIUM (permanent deletion)
### Estimated Time: 2 min

**⚠️ WAIT FOR USER APPROVAL BEFORE THIS STEP**

---

### Step 5.1: Verify Archive Contents
```bash
ls -la _archive/vite-migration-2025-11-26/
```

**Expected:** Old migration files (index.html, main.js, test files, etc.)

---

### Step 5.2: Delete Permanently
```bash
rm -rf _archive/vite-migration-2025-11-26/
```

**Verification:**
```bash
ls -la _archive/
# Should NOT show vite-migration-2025-11-26/
```

---

### Step 5.3: Commit
```bash
git add _archive/
git commit -m "Remove old vite migration archive

_archive/vite-migration-2025-11-26/ contained outdated migration files
no longer needed after successful Vite migration.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Phase 6: Investigate & Resolve Remaining Issues (NEEDS INVESTIGATION)

### Priority: 🟡 MEDIUM
### Risk Level: 🟢 LOW
### Estimated Time: 15 min

---

### Step 6.1: Investigate VATReportCard.legacy.ts

**File:** `/src/components/VATReportCard.legacy.ts`

**Questions:**
1. Används denna fil någonstans?
2. Importeras den i någon fil?

**Commands:**
```bash
# Search for imports
grep -r "VATReportCard.legacy" src/
grep -r "VATReportCard" src/ | grep import
```

**If NOT imported:**
```bash
mkdir -p _archive/legacy-components
mv src/components/VATReportCard.legacy.ts _archive/legacy-components/
```

**If IMPORTED:**
- Undersök om det är en pågående refactoring
- Fråga användaren om den kan tas bort eller om den behövs

---

### Step 6.2: Compare Changelog CSS Files

**Files:**
- `/app/src/css/changelog.css`
- `/src/styles/changelog.css`

**Commands:**
```bash
# Compare files
diff app/src/css/changelog.css src/styles/changelog.css

# If identical:
mv app/src/css/changelog.css _archive/legacy-styles/

# If different:
# Merge content manually, then archive old version
```

---

### Step 6.3: Check service-worker.js Usage

**File:** `/app/service-worker.js`

**Question:** Is PWA functionality active?

**Command:**
```bash
# Search for service worker registration
grep -r "serviceWorker.register" src/ app/
```

**If NOT registered:**
```bash
mv app/service-worker.js _archive/pwa/
mv app/manifest.json _archive/pwa/  # Optional if PWA not active yet
```

**If PWA is planned:**
Keep files but add TODO comment in code.

---

## Phase 7: Optional Improvements (LOW PRIORITY)

### Step 7.1: Upgrade xlsx to 0.20.1
```bash
npm install xlsx@0.20.1
npm run build  # Test
```

**Rationale:** Match version that was in CDN (0.20.1 vs current 0.18.5)

---

### Step 7.2: Add ESLint + Prettier
```bash
npm install -D eslint prettier @typescript-eslint/parser @typescript-eslint/eslint-plugin
npx eslint --init  # Follow prompts
```

**Benefit:** Code quality & consistency

---

### Step 7.3: Add Vitest
```bash
npm install -D vitest @vitest/ui
```

**Benefit:** Unit testing for TypeScript components

---

## Summary of Changes

### Files to DELETE (move to _archive):
1. ✅ `/src/scripts/excelViewer.js`
2. ⚠️ `/src/components/VATReportCard.legacy.ts` (after investigation)
3. ⚠️ `/app/src/css/changelog.css` (if duplicate)
4. ✅ `_archive/vite-migration-2025-11-26/` (permanent deletion)

### Files to EDIT:
1. ✅ `/app/index.html` - Remove lines 731-733
2. ✅ `/src/main.ts` - Remove lines 64-120
3. ✅ `/.gitignore` - Add `dist/`

### Lines of Code Removed:
- app/index.html: 3 lines
- main.ts: ~57 lines
- .gitignore: +1 line (added)

**Total: ~59 lines removed, cleaner codebase**

---

## Testing Checklist

After ALL changes, verify:

### Build System
- [ ] `npm run build` succeeds
- [ ] `npm run dev` starts dev server
- [ ] No TypeScript errors
- [ ] No console warnings

### Landing Page
- [ ] http://localhost:5173/ loads
- [ ] "Logga in" button works
- [ ] "Öppna Veridat" button works

### Login Page
- [ ] http://localhost:5173/login.html loads
- [ ] Email input works
- [ ] Magic link email sends
- [ ] Success message displays

### Main App
- [ ] http://localhost:5173/app/ loads
- [ ] Redirects to login if not authenticated
- [ ] Chat interface works
- [ ] File upload works
- [ ] Excel workspace opens
- [ ] VAT report displays
- [ ] Company selector works
- [ ] Theme toggle works

### News Page
- [ ] http://localhost:5173/app/nyheter.html loads
- [ ] Content displays correctly

---

## Rollback Plan (if något går fel)

### If build fails during ANY phase:
```bash
# Restore from backup
rm -rf /Users/ravonstrawder/Desktop/Britta
cp -r /Users/ravonstrawder/Desktop/Britta_backup_YYYYMMDD_HHMMSS /Users/ravonstrawder/Desktop/Britta
```

### If specific file needs to be restored:
```bash
# Restore single file from backup
cp /Users/ravonstrawder/Desktop/Britta_backup_YYYYMMDD_HHMMSS/path/to/file.ts src/
```

### If git commit was made but needs to be undone:
```bash
git revert HEAD  # Undo last commit
# or
git reset --hard HEAD~1  # Remove last commit (DESTRUCTIVE)
```

---

## Next Steps

1. **WAIT FOR USER APPROVAL** - Visa denna plan för användaren
2. **Confirm backup strategy** - Verifiera backup-metod är OK
3. **Execute Phase by Phase** - Gör en fas i taget, testa mellan varje
4. **Update CLAUDE.md** - Efter alla ändringar, uppdatera project documentation

---

## After Cleanup Complete

See `docs/audit/proposed-structure.md` för ideal filstruktur framåt.

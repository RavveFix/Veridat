# Page Flow - Britta Application

**Genomförd:** 2025-11-26
**Syfte:** Dokumentera användarflödet och teknisk implementation för varje sida

---

## Visual Flow Diagram

```
┌─────────────────────────────────────┐
│      LANDING PAGE                   │
│      /  (index.html)                │
│                                     │
│  • Statisk marknadsföringssida     │
│  • Aurora background effekt         │
│  • Feature cards                    │
│  • CTA: "Öppna Britta"             │
└────────────┬────────────────────────┘
             │
             │ Klick "Logga in" (header)
             ▼
┌─────────────────────────────────────┐
│      LOGIN PAGE                     │
│      /login.html                    │
│                                     │
│  • Magic link email auth            │
│  • Supabase Auth integration        │
│  • Glassmorphism design             │
└────────────┬────────────────────────┘
             │
             │ Efter email verification
             ▼
┌─────────────────────────────────────┐
│      MAIN APP                       │
│      /app/  (app/index.html)        │
│                                     │
│  • Chat interface                   │
│  • Excel workspace panel            │
│  • Company management               │
│  • Fortnox integration              │
│  • File uploads                     │
│  • Voice input                      │
└────────────┬────────────────────────┘
             │
             │ Navigering via header
             ▼
┌─────────────────────────────────────┐
│      NEWS / UPDATES                 │
│      /app/nyheter.html              │
│                                     │
│  • Changelog                        │
│  • Feature announcements            │
└─────────────────────────────────────┘
```

---

## Page 1: Landing Page

### File
`/index.html`

### Description
Statisk marknadsföringssida som introducerar Britta till nya användare.

### Technical Details

**HTML Structure:**
- Self-contained (all styles inline)
- No external dependencies beyond fonts
- Pure vanilla JavaScript for minor interactions

**Key Elements:**
1. **Header**
   - Logo: "Britta"
   - CTA button → `/login.html`

2. **Hero Section**
   - H1: "Din AI-ekonom för Excel & Fortnox"
   - Subtitle: Beskriver core value proposition
   - Main CTA → `/app/` (direkt till appen)
   - App mockup preview

3. **Features Grid**
   - Excel-analys
   - Fortnox integration
   - Svensk expertis (BAS, momsregler)

4. **Footer**
   - Copyright notice

**Styling:**
- Aurora animated background (3 blobs)
- Glassmorphism cards
- Gradient text effects
- Responsive design (mobile-first)

**JavaScript:**
```javascript
// Mouse hover effect on feature cards
document.querySelectorAll('.feature-card').forEach(card => {
    card.onmousemove = e => {
        // Dynamic glassmorphism effect
    }
});
```

**Navigation:**
- **"Logga in"** (header) → `/login.html`
- **"Öppna Britta"** (hero CTA) → `/app/` (kräver auth, redirectar till login om ej inloggad)

---

## Page 2: Login Page

### File
`/login.html`

### Description
Autentiseringssida med magic link email-baserad inloggning via Supabase Auth.

### Technical Details

**HTML Structure:**
- Minimal design med central login card
- Aurora background (samma som landing)
- Form med endast email input

**TypeScript Entry:**
```
/src/login.ts (115 lines)
```

**Key Functionality:**

1. **Auth Check** (lines 14-19)
   ```typescript
   const { data: { session } } = await supabase.auth.getSession();
   if (session) {
       window.location.href = '/app/';  // Already logged in
   }
   ```

2. **Magic Link Flow** (lines 38-102)
   ```typescript
   loginForm.addEventListener('submit', async (e) => {
       const { error } = await supabase.auth.signInWithOtp({
           email,
           options: {
               emailRedirectTo: window.location.origin + '/app/'
           }
       });
       // Show success message
   });
   ```

**User Journey:**
1. Användare skriver email
2. Klickar "Skicka inloggningslänk"
3. Får email med magic link
4. Klickar länk → redirectas till `/app/`
5. Session skapas automatiskt av Supabase

**Styling:**
- Theme system (dark/light via localStorage)
- Glassmorphism card
- Loading states på button
- Success/error message boxes

**Navigation:**
- **"Tillbaka till startsidan"** → `/`
- **Efter successful login** → `/app/`

---

## Page 3: Main App

### File
`/app/index.html`

### Description
Huvudapplikationen - fullständig bokföringsassistent med chat, Excel-analys, och Fortnox-integration.

### Technical Details

**TypeScript Entry:**
```
/src/main.ts (857 lines)
```

**Key Features:**

### 3.1 Authentication Guard
```typescript
// main.ts lines 52-61
const { data: { session } } = await supabase.auth.getSession();
if (!session && window.location.pathname.includes('/app/')) {
    window.location.href = '/login.html';  // Redirect if not logged in
}
```

### 3.2 Layout Structure

```
┌─────────────────────────────────────────────────────┐
│  HEADER (glass-header)                              │
│  • Logo + Badge                                     │
│  • Company Dropdown                                 │
│  • "Koppla Fortnox" button                         │
│  • Theme toggle                                     │
│  • Nav: [Chatt] [Uppdateringar - Nyheter]          │
└─────────────────────────────────────────────────────┘
┌───────────────────────┬─────────────────────────────┐
│  CHAT SECTION         │  EXCEL PANEL (toggleable)   │
│  (workspace-container)│  (excel-panel)              │
│                       │                             │
│  ┌─────────────────┐  │  ┌───────────────────────┐  │
│  │  Chat Messages  │  │  │  Excel Table View     │  │
│  │  - Welcome msg  │  │  │  or                   │  │
│  │  - User msgs    │  │  │  VAT Report Card      │  │
│  │  - AI responses │  │  │  (Preact component)   │  │
│  │  - VAT cards    │  │  └───────────────────────┘  │
│  └─────────────────┘  │                             │
│                       │                             │
└───────────────────────┴─────────────────────────────┘
┌─────────────────────────────────────────────────────┐
│  FOOTER (glass-footer)                              │
│  • File attach button                               │
│  • Voice input button                               │
│  • Text input field                                 │
│  • Send button                                      │
└─────────────────────────────────────────────────────┘
```

### 3.3 Core Components

**A. Company Management** (lines 154-384)
- Multi-company support via localStorage
- Company selector dropdown
- Add company modal (glassmorphism)
- Per-company data isolation:
  - `chatHistory[]`
  - `history[]` (bookkeeping entries)
  - `invoices[]`
  - `documents[]`
  - `verificationCounter`

**B. Chat Interface** (lines 419-685)
- Real-time messaging med Gemini AI
- File attachment support:
  - Images (PDF, PNG, JPG)
  - Excel (.xlsx, .xls)
- Voice input support (Web Speech API)
- Markdown rendering i AI responses

**C. Excel Workspace** (lines 38-49, ExcelWorkspace.ts)
- Split-panel design
- Opens när Excel fil laddas upp
- Two modes:
  1. **Excel Viewer**: Visa raw Excel data
  2. **VAT Report**: Visa analyserad momsrapport (Preact component)

**D. Voice Input** (lines 468-549)
- Web Speech API integration
- Waveform animation
- Confirm/Cancel actions
- Real-time transcription

### 3.4 File Upload Flow

```
User uploads Excel file
        ↓
uploadFileToSupabase()  (main.ts:688-728)
        ↓
Returns public URL
        ↓
analyzeExcelWithClaude()  (main.ts:730-769)
        ↓
Sends Excel data to /claude-analyze Edge Function
        ↓
Returns VATReportResponse
        ↓
excelWorkspace.openVATReport(data, fileUrl)
        ↓
Displays VAT report in right panel (Preact)
```

### 3.5 External Scripts (DUPLICATES - ska tas bort)

**Line 731:**
```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
```
🔄 **DUPLICATE** - Redan i package.json, används via Vite import

**Line 732:**
```html
<script src="https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js"></script>
```
🔄 **DUPLICATE** - Redan i package.json (xlsx@0.18.5), används via Vite import

**Line 733:**
```html
<script type="module" src="/src/scripts/excelViewer.js"></script>
```
🔄 **DUPLICATE** - Ersatt av ExcelWorkspace.ts, men fortfarande importerad

**Line 734:**
```html
<script type="module" src="/src/main.ts"></script>
```
✅ **CORRECT** - Huvudentry point via Vite

**Action Required:** Ta bort lines 731-733, behåll endast line 734.

### 3.6 Supabase Edge Function Calls

**gemini-chat** (main.ts:801-818)
```typescript
const { data, error } = await supabase.functions.invoke('gemini-chat', {
    body: { message, fileData }
});
```
Hanterar AI-konversationer via Gemini 2.5 Flash.

**claude-analyze** (main.ts:746-756)
```typescript
const response = await fetch(`${SUPABASE_URL}/functions/v1/claude-analyze`, {
    method: 'POST',
    body: JSON.stringify({ filename, sheets })
});
```
Analyserar Excel-filer för svensk momsredovisning.

**upload-file** (main.ts:702-715)
```typescript
const response = await fetch(`${SUPABASE_URL}/functions/v1/upload-file`, {
    method: 'POST',
    body: JSON.stringify({ filename, fileData, mimeType, userId, companyId })
});
```
Laddar upp filer till Supabase Storage.

### 3.7 Navigation
- **"Uppdateringar - Nyheter"** (header nav) → `/app/nyheter.html`
- **"Chatt"** (header nav) → `/app/index.html` (samma sida, reload)

---

## Page 4: News / Updates

### File
`/app/nyheter.html`

### Description
Changelog och feature announcements för användare.

### Technical Details

**Status:** ✅ ACTIVE (användare bekräftade)

**Expected Structure:**
- Lista över nya features
- Versionshistorik
- Upcoming features roadmap

**Styling:**
- Bör använda samma glassmorphism theme
- (Uppdaterat) Frontenden ligger nu under `apps/web/` och styles laddas via `apps/web/src/styles/`.

**Navigation:**
- Header nav → tillbaka till `/app/index.html`

**Note:** Denna sida behöver granskas vidare - jag har inte läst innehållet än.

---

## Authentication Flow Diagram

```
Unauthenticated User
        ↓
Tries to access /app/
        ↓
main.ts checks session (line 52)
        ↓
No session found
        ↓
Redirect to /login.html
        ↓
User enters email
        ↓
Supabase sends magic link
        ↓
User clicks link in email
        ↓
Supabase creates session
        ↓
Redirect to /app/ (with session)
        ↓
main.ts checks session
        ↓
Session found ✓
        ↓
App loads successfully
```

---

## Data Flow: Excel Analysis

```
1. User uploads Excel file (.xlsx)
        ↓
2. File converted to base64
        ↓
3. POST to /upload-file Edge Function
        ↓
4. Saved to Supabase Storage
        ↓
5. Returns public URL
        ↓
6. File parsed with XLSX.read() (client-side)
        ↓
7. Sheets sent to /claude-analyze Edge Function
        ↓
8. Claude analyzes for Swedish VAT rules
        ↓
9. Returns VATReportResponse
   {
     type: 'vat_report',
     data: {
       period: '2025-10',
       totalRevenue: 298.81,
       vatToReclaim: 85.25,
       transactions: [...]
     }
   }
        ↓
10. ExcelWorkspace renders VATReportCard (Preact)
        ↓
11. User sees interactive report in right panel
```

---

## Summary

### Active Pages: 4
1. **Landing** (`/index.html`) - Marketing
2. **Login** (`/login.html`) - Authentication
3. **Main App** (`/app/index.html`) - Workspace
4. **News** (`/app/nyheter.html`) - Updates

### Entry Points via Vite:
```typescript
// vite.config.ts
input: {
  main: 'index.html',           // Landing
  login: 'login.html',          // Login
  app: 'app/index.html',        // Main app
  news: 'app/nyheter.html'      // News
}
```

### Critical Issues Found:
1. ⚠️ **Duplicate login logic** in main.ts (lines 64-120) - redan hanteras i login.ts
2. 🔄 **CDN scripts** i app/index.html (lines 731-732) - duplicerar npm packages
3. 🔄 **Legacy excelViewer.js** import (line 733) - ersatt av ExcelWorkspace.ts

### Next Steps:
Se `docs/audit/duplicates.md` och `docs/audit/recommendations.md` för åtgärdsplan.

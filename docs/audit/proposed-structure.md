# Proposed Structure - Veridat Project

**Genomförd:** 2025-11-26
**Syfte:** Definiera ideal projektstruktur efter cleanup

---

## Overview

Detta dokument beskriver den **ideala** projektstrukturen efter att alla rekommendationer i `docs/audit/recommendations.md` har genomförts.

---

## Ideal Directory Structure

```
/Users/ravonstrawder/Desktop/Britta/
│
├── 📄 index.html                    # Landing page
├── 📄 login.html                    # Login page
│
├── 📁 app/                          # Main application
│   ├── 📄 index.html                # App workspace
│   ├── 📄 nyheter.html              # News/updates page
│   │
│   ├── 📁 assets/
│   │   ├── 📁 icons/
│   │   │   ├── icon-192.png
│   │   │   └── icon-512.png
│   │   └── (other static assets)
│   │
│   ├── 📄 manifest.json             # PWA manifest
│   └── 📄 service-worker.js         # PWA service worker (future)
│
├── 📁 src/                          # TypeScript source code
│   │
│   ├── 📄 main.ts                   # Main app entry point
│   ├── 📄 login.ts                  # Login page entry point
│   ├── 📄 vite-env.d.ts             # Vite environment types
│   │
│   ├── 📁 components/               # Reusable UI components
│   │   ├── 📄 ExcelWorkspace.ts     # Excel viewer & VAT report panel
│   │   ├── 📄 VATReportCard.tsx     # VAT report Preact component
│   │   └── 📄 preact-adapter.ts     # Preact mounting utility
│   │
│   ├── 📁 services/                 # Business logic services (NEW)
│   │   ├── 📄 AuthService.ts        # Authentication logic
│   │   ├── 📄 CompanyService.ts     # Company management
│   │   ├── 📄 ChatService.ts        # Chat/messaging logic
│   │   ├── 📄 FileService.ts        # File upload & processing
│   │   └── 📄 StorageService.ts     # localStorage wrapper
│   │
│   ├── 📁 utils/                    # Utility functions
│   │   ├── 📄 excelExport.ts        # Excel export utilities
│   │   ├── 📄 VoiceService.ts       # Voice input service
│   │   ├── 📄 formatters.ts         # String/number formatters (NEW)
│   │   └── 📄 validators.ts         # Input validation (NEW)
│   │
│   ├── 📁 types/                    # TypeScript interfaces
│   │   ├── 📄 vat.ts                # VAT report types
│   │   ├── 📄 excel.ts              # Excel-related types
│   │   ├── 📄 company.ts            # Company types (NEW)
│   │   ├── 📄 chat.ts               # Chat message types (NEW)
│   │   └── 📄 api.ts                # API response types (NEW)
│   │
│   ├── 📁 styles/                   # Global & component styles
│   │   ├── 📄 main.css              # Global styles + CSS variables
│   │   ├── 📄 changelog.css         # Changelog page styles
│   │   │
│   │   └── 📁 components/
│   │       ├── 📄 vat-card.css      # VAT card styles
│   │       ├── 📄 voice-input.css   # Voice input styles
│   │       ├── 📄 chat.css          # Chat interface styles (NEW)
│   │       └── 📄 excel-panel.css   # Excel panel styles (NEW)
│   │
│   └── 📁 constants/                # Constants & config (NEW)
│       ├── 📄 routes.ts             # Route definitions
│       └── 📄 config.ts             # App configuration
│
├── 📁 supabase/                     # Backend (Supabase Edge Functions)
│   │
│   ├── 📁 functions/                # Edge Functions
│   │   ├── 📁 gemini-chat/
│   │   │   └── 📄 index.ts          # Gemini AI chat endpoint
│   │   │
│   │   ├── 📁 claude-analyze/
│   │   │   └── 📄 index.ts          # Claude Excel analysis
│   │   │
│   │   ├── 📁 upload-file/
│   │   │   └── 📄 index.ts          # File upload to Storage
│   │   │
│   │   └── 📁 fortnox/
│   │       └── 📄 index.ts          # Fortnox API integration
│   │
│   ├── 📁 services/                 # Shared backend services
│   │   ├── 📄 GeminiService.ts      # Gemini AI service layer
│   │   ├── 📄 FortnoxService.ts     # Fortnox API service layer
│   │   └── 📄 RateLimiterService.ts # Rate limiting service
│   │
│   ├── 📁 migrations/               # Database migrations
│   │   ├── 📄 20241124000001_create_api_usage.sql
│   │   ├── 📄 20241125000001_create_files_table.sql
│   │   └── 📄 20251125000002_auth_and_rls.sql
│   │
│   └── 📁 .temp/                    # Temporary files (gitignored)
│       └── cli-latest
│
├── 📁 docs/                         # Documentation
│   ├── 📄 SUPABASE_SETUP.md         # Supabase setup guide
│   ├── 📄 system_instructions.md    # System instructions
│   ├── 📄 preact-migration.md       # Preact migration notes
│   ├── 📄 vite-migration.md         # Vite migration notes
│   ├── 📄 page_flow.md              # Page flow documentation
│   ├── 📄 2025-11-25-excel-claude-integration.md
│   └── 📄 MANUAL_TEST_RATE_LIMIT.md
│
├── 📁 .skills/                      # Claude Code skills
│   └── 📁 svensk-ekonomi/           # Swedish accounting skill
│       ├── 📄 skill.json
│       ├── 📁 scripts/
│       ├── 📁 references/
│       └── test files
│
├── 📁 _archive/                     # Archived legacy code
│   ├── 📁 legacy-components/        # Old components
│   ├── 📁 legacy-scripts/           # Old scripts
│   ├── 📁 legacy-styles/            # Old styles
│   └── 📁 pwa/                      # PWA files (if not active yet)
│
├── 📁 node_modules/                 # NPM dependencies (gitignored)
│
├── 📁 dist/                         # Build output (gitignored)
│   ├── 📄 index.html                # Built landing page
│   ├── 📄 login.html                # Built login page
│   │
│   ├── 📁 app/
│   │   ├── 📄 index.html            # Built app page
│   │   └── 📄 nyheter.html          # Built news page
│   │
│   └── 📁 assets/
│       ├── main-[hash].js           # Bundled JavaScript
│       ├── main-[hash].css          # Bundled CSS
│       └── (other assets)
│
├── 📄 package.json                  # NPM dependencies & scripts
├── 📄 package-lock.json             # Locked versions
├── 📄 tsconfig.json                 # TypeScript config
├── 📄 tsconfig.node.json            # Node-specific TS config
├── 📄 vite.config.ts                # Vite configuration
├── 📄 deno.json                     # Deno import map (for Edge Functions)
├── 📄 deno.lock                     # Deno lock file
│
├── 📄 .gitignore                    # Git ignore rules
├── 📄 .env.example                  # Environment variable template
│
├── 📄 CLAUDE.md                     # Claude Code instructions
├── 📄 PROJECT_RULES.md              # Project rules
│
└── 📄 README.md                     # Project README (ADD THIS)
```

---

## Key Organizational Principles

### 1. Clear Separation of Concerns

**Frontend (src/):**
- `components/` → UI components (reusable)
- `services/` → Business logic (no UI)
- `utils/` → Pure functions (no state)
- `types/` → TypeScript definitions
- `styles/` → CSS (organized by component)
- `constants/` → Config & constants

**Backend (supabase/):**
- `functions/` → API endpoints (Edge Functions)
- `services/` → Shared backend logic
- `migrations/` → Database schema

---

### 2. Service Layer Pattern

**Current state:** Business logic är blandad i `main.ts` (857 lines!)

**Proposed:** Bryt ut till dedikerade services

#### Example: AuthService.ts (NEW)

```typescript
// src/services/AuthService.ts
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export class AuthService {
    private supabase: SupabaseClient;

    constructor() {
        this.supabase = createClient(
            import.meta.env.VITE_SUPABASE_URL,
            import.meta.env.VITE_SUPABASE_ANON_KEY
        );
    }

    async getSession() {
        const { data: { session } } = await this.supabase.auth.getSession();
        return session;
    }

    async isAuthenticated(): Promise<boolean> {
        const session = await this.getSession();
        return session !== null;
    }

    async signInWithOtp(email: string, redirectTo: string) {
        return await this.supabase.auth.signInWithOtp({
            email,
            options: { emailRedirectTo: redirectTo }
        });
    }

    async signOut() {
        return await this.supabase.auth.signOut();
    }
}
```

**Usage in main.ts:**
```typescript
import { AuthService } from './services/AuthService';

const authService = new AuthService();

if (!await authService.isAuthenticated()) {
    window.location.href = '/login.html';
    return;
}
```

---

#### Example: CompanyService.ts (NEW)

```typescript
// src/services/CompanyService.ts
import type { Company } from '../types/company';
import { StorageService } from './StorageService';

export class CompanyService {
    private storage = new StorageService();

    getAllCompanies(): Company[] {
        return this.storage.get<Company[]>('companies') || [];
    }

    getCurrentCompany(): Company | null {
        const companies = this.getAllCompanies();
        const currentId = this.storage.get<string>('currentCompanyId');
        return companies.find(c => c.id === currentId) || companies[0] || null;
    }

    createCompany(data: Omit<Company, 'id'>): Company {
        const company: Company = {
            id: `company-${Date.now()}`,
            ...data,
            history: [],
            invoices: [],
            documents: [],
            verificationCounter: 1,
            chatHistory: []
        };

        const companies = this.getAllCompanies();
        companies.push(company);
        this.storage.set('companies', companies);

        return company;
    }

    switchCompany(companyId: string): void {
        this.storage.set('currentCompanyId', companyId);
    }
}
```

**Benefits:**
- ✅ Testable (kan mocka StorageService)
- ✅ Reusable (kan användas från olika komponenter)
- ✅ Single Responsibility (bara company logic)

---

### 3. Type Definitions

**Current:** Några types i main.ts, andra i separata filer

**Proposed:** All types i `/src/types/`

#### company.ts (NEW)
```typescript
export interface Company {
    id: string;
    name: string;
    orgNumber: string;
    address: string;
    phone: string;
    history: any[];  // TODO: Type this properly
    invoices: any[];  // TODO: Type this properly
    documents: any[];  // TODO: Type this properly
    verificationCounter: number;
    chatHistory: ChatMessage[];
}
```

#### chat.ts (NEW)
```typescript
export interface ChatMessage {
    sender: 'user' | 'ai';
    content: string;
    timestamp: number;
}

export interface ChatResponse {
    type: 'text' | 'json';
    data: string | object;
}
```

#### api.ts (NEW)
```typescript
export interface ApiResponse<T> {
    data?: T;
    error?: ApiError;
}

export interface ApiError {
    message: string;
    code?: string;
    details?: unknown;
}
```

---

### 4. Styling Organization

**Current:** Några styles i `src/styles/`, några i `app/src/css/`

**Proposed:** All CSS i `src/styles/` med tydlig struktur

```
src/styles/
├── main.css                 # Global styles + CSS variables
├── changelog.css            # Page-specific styles
│
└── components/
    ├── chat.css             # Chat interface
    ├── excel-panel.css      # Excel workspace panel
    ├── vat-card.css         # VAT report card
    ├── voice-input.css      # Voice input UI
    ├── modal.css            # Modal dialogs
    └── buttons.css          # Button styles
```

**CSS Variable System (redan i main.css):**
```css
:root {
    --bg-color: #0a0e17;
    --glass-bg: rgba(255, 255, 255, 0.03);
    --accent-primary: #00F0FF;
    --accent-secondary: #FFD700;
    /* ... */
}

[data-theme="light"] {
    --bg-color: #f5f7fa;
    --glass-bg: rgba(255, 255, 255, 0.6);
    /* ... */
}
```

---

## File Size Targets

### Current main.ts: 857 lines 😱

**Proposed breakdown:**

```
main.ts (refactored)          ~150 lines  (initialization only)
services/AuthService.ts       ~50 lines
services/CompanyService.ts    ~100 lines
services/ChatService.ts       ~150 lines
services/FileService.ts       ~100 lines
services/StorageService.ts    ~50 lines
utils/formatters.ts           ~50 lines
constants/config.ts           ~30 lines
```

**Total:** ~680 lines (177 lines saved + much better organization)

---

## Vite Configuration (CURRENT - NO CHANGES)

```typescript
// vite.config.ts
export default defineConfig({
    plugins: [preact()],

    build: {
        rollupOptions: {
            input: {
                main: resolve(__dirname, 'index.html'),
                login: resolve(__dirname, 'login.html'),
                app: resolve(__dirname, 'app/index.html'),
                news: resolve(__dirname, 'app/nyheter.html'),
            },
        },
    },

    server: {
        port: 5173,
        open: true,
    },

    resolve: {
        alias: {
            '@': resolve(__dirname, './src'),
        },
    },
});
```

**Alias usage:**
```typescript
// Instead of:
import { Company } from '../../../types/company';

// Use:
import { Company } from '@/types/company';
```

---

## Migration Strategy

### Phase 1: Services (OPTIONAL - Future improvement)
1. Create `src/services/` directory
2. Extract AuthService from main.ts
3. Extract CompanyService from main.ts
4. Extract ChatService from main.ts
5. Extract FileService from main.ts
6. Create StorageService wrapper

### Phase 2: Types
1. Move all type definitions to `src/types/`
2. Create company.ts, chat.ts, api.ts
3. Update imports

### Phase 3: Styles
1. Consolidate all CSS to `src/styles/`
2. Remove duplicates from `app/src/css/`
3. Organize by component

### Phase 4: Utils & Constants
1. Create `src/constants/config.ts`
2. Create utility functions in `src/utils/`
3. Extract formatters, validators

---

## Benefits of Proposed Structure

### Developer Experience
- ✅ **Easier to find code** - Clear organization
- ✅ **Easier to test** - Services are isolated
- ✅ **Easier to maintain** - Small, focused files
- ✅ **Better IDE support** - Clear imports, autocomplete

### Performance
- ✅ **Better code splitting** - Vite can tree-shake unused code
- ✅ **Smaller bundles** - Only import what you need
- ✅ **Faster builds** - Incremental compilation

### Code Quality
- ✅ **Single Responsibility** - Each file has one job
- ✅ **Testable** - Services can be mocked
- ✅ **Type-safe** - All types defined in one place
- ✅ **Reusable** - Services can be shared

---

## Comparison: Before vs After

### Before (Current)
```
/src/
├── main.ts (857 lines! 😱)
├── login.ts
├── components/ (3 files)
├── types/ (2 files)
├── utils/ (2 files)
├── styles/ (4 files)
└── scripts/ (1 legacy file - to be removed)
```

**Issues:**
- ❌ main.ts is a monolith
- ❌ Business logic mixed with UI
- ❌ Hard to test
- ❌ Hard to reuse code

---

### After (Proposed)
```
/src/
├── main.ts (~150 lines ✅)
├── login.ts (unchanged)
│
├── components/ (3 files)
│
├── services/ (5 NEW files)
│   ├── AuthService.ts
│   ├── CompanyService.ts
│   ├── ChatService.ts
│   ├── FileService.ts
│   └── StorageService.ts
│
├── types/ (5 files, 3 NEW)
│   ├── vat.ts
│   ├── excel.ts
│   ├── company.ts (NEW)
│   ├── chat.ts (NEW)
│   └── api.ts (NEW)
│
├── utils/ (4 files, 2 NEW)
│   ├── excelExport.ts
│   ├── VoiceService.ts
│   ├── formatters.ts (NEW)
│   └── validators.ts (NEW)
│
├── constants/ (2 NEW files)
│   ├── routes.ts
│   └── config.ts
│
└── styles/ (clean, organized)
    ├── main.css
    ├── changelog.css
    └── components/ (5 files)
```

**Benefits:**
- ✅ main.ts is clean (~150 lines)
- ✅ Business logic in services
- ✅ Easy to test
- ✅ Reusable code

---

## README.md Template (ADD THIS)

```markdown
# Veridat - AI Bokföringsexpert

AI-driven bokföringsassistent för svenska småföretagare med Excel-analys och Fortnox-integration.

## Tech Stack

- **Frontend:** TypeScript, Preact, Vite
- **Backend:** Supabase Edge Functions (Deno)
- **AI:** Google Gemini 2.5 Flash, Claude (Excel analysis)
- **Integrations:** Fortnox API

## Development

\`\`\`bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build

# Start Supabase locally
npm run supabase:start

# Deploy Edge Functions
npm run supabase:deploy
\`\`\`

## Project Structure

See \`docs/\` for detailed documentation.

## Environment Variables

Copy \`.env.example\` to \`.env.local\` and fill in:

- \`VITE_SUPABASE_URL\`
- \`VITE_SUPABASE_ANON_KEY\`
- \`GEMINI_API_KEY\` (for Supabase Edge Functions)

## Documentation

- [Supabase Setup](docs/SUPABASE_SETUP.md)
- [Page Flow](docs/page_flow.md)
- [System Instructions](docs/system_instructions.md)
```

---

## Next Steps

1. ✅ Complete cleanup from `docs/audit/recommendations.md`
2. ⚠️ Consider service layer refactoring (optional, future improvement)
3. ✅ Add README.md
4. ✅ Update CLAUDE.md with new structure
5. ✅ Continue building features

---

## Conclusion

Den föreslagna strukturen är en **evolution**, inte en revolution. Den bygger på nuvarande kod men organiserar den bättre för framtida underhåll och skalning.

**Prioritet:**
1. 🔴 HIGH: Genomför cleanup (recommendations.md) - **GÖR FÖRST**
2. 🟡 MEDIUM: Refactor services (optional) - **FUTURE**
3. 🟢 LOW: Add README, update docs - **NICE TO HAVE**

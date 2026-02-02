# Architecture

## Service Layer Pattern

The backend uses a service-oriented architecture where business logic is encapsulated in reusable services:

### GeminiService (`supabase/services/GeminiService.ts`)
Handles all AI interactions with Google Gemini:
- System instructions for "Veridat" persona
- Function calling (tools): `create_invoice`, `get_customers`, `get_articles`
- File processing (PDF, images)
- Swedish bookkeeping expertise (BAS account plan)

### FortnoxService (`supabase/services/FortnoxService.ts`)
Manages Fortnox API integration:
- OAuth token refresh (automatic)
- API requests with retry logic
- Operations: customers, articles, invoices
- Token expiration handling from database

### RateLimiterService (`supabase/services/RateLimiterService.ts`)
Implements rate limiting:
- Hourly limit: 10 requests/hour
- Daily limit: 50 requests/day
- Uses Supabase `api_usage` table
- Fails open (allows request) on service errors

---

## Intelligent File Routing

Frontend automatically routes files to appropriate backends:

```
Excel (.xlsx, .xls) → python-proxy Edge Function → Python API (Railway)
                                ↓ (fallback if Python fails)
                      claude-analyze → Claude AI

PDF/Images → gemini-chat → Gemini AI
Text messages → gemini-chat → Gemini AI
```

**Key files:**
- `src/main.ts:analyzeExcelWithPython()` - Frontend routing logic
- `supabase/functions/python-proxy/` - Auth + proxy to Python API
- `python-api/app/services/vat_service.py` - VAT calculations

---

## Edge Functions

| Function | Purpose | Backend |
|----------|---------|---------|
| `gemini-chat` | Main chat, PDF analysis | Gemini AI |
| `claude-analyze` | Excel analysis fallback | Claude AI |
| `python-proxy` | VAT calculations proxy | Python API |
| `fortnox` | Accounting operations | Fortnox API |

### gemini-chat (`supabase/functions/gemini-chat/index.ts`)
- Main entry point for chat interactions
- Handles rate limiting via RateLimiterService
- Calls GeminiService for AI processing
- Executes tool calls (Fortnox operations)
- Returns: `{type: 'text', data: string}` or `{type: 'json', data: object}`

### fortnox (`supabase/functions/fortnox/index.ts`)
- Direct Fortnox API operations
- Actions: `createInvoice`, `getCustomers`, `getArticles`

---

## Python API (python-api/)

FastAPI service hosted on Railway for precise VAT calculations.

**Structure:**
```
python-api/
├── app/
│   ├── main.py           # FastAPI entry, CORS, lifespan
│   ├── config.py         # Environment-based configuration
│   ├── api/
│   │   └── routes/
│   │       └── vat.py    # POST /api/v1/vat/analyze
│   ├── services/
│   │   ├── vat_service.py    # VAT calculation logic
│   │   └── excel_service.py  # Excel parsing with pandas
│   └── core/
│       └── security.py   # API key validation (timing-safe)
└── tests/
    └── test_security.py  # Security unit tests
```

**Retry Logic (Railway cold starts):**
- 3 attempts with exponential backoff (1s, 2s, 4s)
- Implemented in `supabase/services/PythonAPIService.ts`

---

## Frontend Structure

```
src/
├── main.ts              # Main TypeScript application
├── components/          # Class-based TypeScript components
├── types/               # TypeScript interfaces (VATReportData, etc.)
└── styles/              # CSS with custom properties

app/                     # Legacy folder (being migrated to src/)
```

**Build:** Vite (`npm run build` → `dist/`)

---

## Multi-Company Support

Companies stored in localStorage:
```javascript
{
  id: 'company-123',
  name: 'Company Name',
  orgNumber: '556123-4567',
  chatHistory: [],       // Per-company chat persistence
  history: [],           // Bookkeeping entries
  invoices: [],          // Supplier invoices
  documents: [],         // Uploaded documents
  verificationCounter: 1
}
```

---

## AI Function Calling Flow

1. User sends message to `gemini-chat` Edge Function
2. GeminiService processes with Gemini 2.5 Flash
3. If Gemini calls a tool (e.g., `create_invoice`):
   - Edge function intercepts the tool call
   - `create_invoice`: Returns JSON to frontend for confirmation card
   - `get_customers`/`get_articles`: Executes via FortnoxService
4. Frontend displays confirmation card or text response

---

## CSS Layout Architecture

### Chat Layout Flex Hierarchy

The chat interface uses a precise flex hierarchy. **Breaking any level breaks scrolling/visibility.**

```
.app-container
└── .workspace-container
    └── .chat-section
        └── .content-area (flex: 1, flex-direction: column)
            ├── .welcome-hero (display: none when NOT welcome-state)
            ├── #chat-view.view (flex: 1, display: flex, flex-direction: column)
            │   └── .chat-container (flex: 1, height: 0, overflow-y: auto)
            │       └── .chat-list (Preact ChatHistory component)
            ├── .glass-footer (position: fixed when NOT welcome-state)
            └── .welcome-suggestions (display: none when NOT welcome-state)
```

### Critical CSS Rules

**`.view` class (line ~671):**
```css
.view {
    flex: 1;
    min-height: 0;      /* Critical for flex overflow */
    display: flex;
    flex-direction: column;
}
```

**`#chat-view` in chat mode (line ~2312):**
```css
.chat-section:not(.welcome-state) #chat-view {
    display: flex;           /* MUST be flex, NOT block! */
    flex-direction: column;
    flex: 1;
    min-height: 0;
}
```

**`.chat-container` (line ~312):**
```css
.chat-container {
    flex: 1;
    height: 0;              /* Forces flex item to respect overflow */
    min-height: 0;
    overflow-y: auto;
    padding-bottom: 100px;  /* Space for fixed footer */
    scrollbar-width: none;  /* Hidden scrollbar */
}
```

### Welcome State Toggle

The `.welcome-state` class on `.chat-section` controls the entire layout:

| Element | `.welcome-state` | Normal (chat mode) |
|---------|------------------|-------------------|
| `.welcome-hero` | `display: flex` | `display: none` |
| `#chat-view` | `display: none` | `display: flex` |
| `.glass-footer` | `position: static` (centered) | `position: fixed` (bottom) |
| `.welcome-suggestions` | `display: flex` | `display: none` |

### Common Pitfalls

1. **`display: block` on #chat-view** - Breaks flex layout, chat disappears
2. **Missing `min-height: 0`** - Flex children won't scroll properly
3. **Missing `height: 0` on chat-container** - Content overflows instead of scrolling
4. **Duplicate CSS rules** - Later rules override earlier ones completely

### Transition Animations

- `welcome-exiting` - Fades out welcome elements (0.2s)
- `welcome-entering` - Fades in welcome elements (0.3s)
- Both use `pointer-events: none` during animation

---

## Database Tables

### fortnox_tokens
OAuth tokens with automatic refresh:
- `access_token`, `refresh_token`, `expires_at`
- RLS enabled (user-scoped)

### api_usage
API usage tracking for rate limiting:
- `user_id`, `endpoint`, `request_count`, `last_reset`
- Indexes: `(user_id, endpoint)`, `last_reset`

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Britta is an AI-powered Swedish bookkeeping assistant for small businesses. It's a Progressive Web App (PWA) that helps users with accounting tasks, invoice creation, and tax document analysis using Google Gemini AI and Fortnox integration.

**Tech Stack:**
- Frontend: Vanilla JavaScript, HTML, CSS (no frameworks)
- Backend: Supabase Edge Functions (Deno runtime)
- AI: Google Gemini 2.5 Flash with function calling
- Integrations: Fortnox API for accounting operations
- Database: Supabase PostgreSQL

## Development Commands

### Local Development
```bash
# Start local web server for frontend
python3 -m http.server 8000

# Access landing page
open http://localhost:8000/landing/

# Access main app
open http://localhost:8000/app/
```

### Supabase Edge Functions
```bash
# Start Supabase services locally
npm run supabase:start
# or: supabase start

# Stop Supabase services
npm run supabase:stop
# or: supabase stop

# Serve Edge Function locally for testing
npm run supabase:serve
# or: supabase functions serve gemini-chat

# Deploy Edge Function to production
npm run supabase:deploy
# or: supabase functions deploy gemini-chat

# Set Gemini API key as secret
supabase secrets set GEMINI_API_KEY=your_key_here

# Link local project to Supabase
supabase login
supabase link --project-ref your-project-ref
```

### Testing Rate Limiting
```bash
# Run manual rate limit test
deno run --allow-all test_rate_limit.ts
```

## Architecture

### Service Layer Pattern

The backend uses a service-oriented architecture where business logic is encapsulated in reusable services:

- **GeminiService** (`supabase/services/GeminiService.ts`): Handles all AI interactions with Google Gemini, including system instructions, function calling (tools), and file processing. Defines three tools: `create_invoice`, `get_customers`, `get_articles`

- **FortnoxService** (`supabase/services/FortnoxService.ts`): Manages Fortnox API integration including OAuth token refresh, API requests, and operations (customers, articles, invoices). Automatically handles token expiration and refresh from database

- **RateLimiterService** (`supabase/services/RateLimiterService.ts`): Implements rate limiting with hourly (10/hour) and daily (50/day) limits per user. Uses Supabase `api_usage` table for tracking

### Edge Functions

- **gemini-chat** (`supabase/functions/gemini-chat/index.ts`): Main entry point for chat interactions. Handles rate limiting, calls GeminiService, and executes tool calls. Returns structured responses: `{type: 'text', data: string}` or `{type: 'json', data: object}` for confirmation cards

- **fortnox** (`supabase/functions/fortnox/index.ts`): Direct Fortnox API operations. Supports actions: `createInvoice`, `getCustomers`, `getArticles`

### Frontend Structure

- **Landing page**: `landing/index.html`
- **Main app**: `app/index.html`
- **App logic**: `app/src/js/main.js` - Handles chat UI, company management, file uploads, and API calls
- **Styles**: `app/src/css/main.css` - Custom properties for theming
- **PWA**: `app/manifest.json` + `app/service-worker.js`

### Multi-Company Support

Companies are stored in localStorage with structure:
```javascript
{
  id: 'company-123',
  name: 'Company Name',
  orgNumber: '556123-4567',
  chatHistory: [],  // Per-company chat persistence
  history: [],      // Bookkeeping entries
  invoices: [],     // Supplier invoices
  documents: [],    // Uploaded documents
  verificationCounter: 1
}
```

### AI Function Calling Flow

1. User sends message to gemini-chat Edge Function
2. GeminiService processes with Gemini 2.5 Flash
3. If Gemini calls a tool (e.g., `create_invoice`):
   - Edge function intercepts the tool call
   - For `create_invoice`: Returns JSON data to frontend for confirmation card
   - For `get_customers`/`get_articles`: Executes via FortnoxService and returns text response
4. Frontend displays confirmation card or text response

### Database Tables

- **fortnox_tokens**: Stores OAuth tokens with automatic refresh
  - `access_token`, `refresh_token`, `expires_at`
  - RLS enabled

- **api_usage**: Tracks API usage per user for rate limiting
  - `user_id`, `endpoint`, `request_count`, `last_reset`
  - Indexes on `(user_id, endpoint)` and `last_reset`

## Key Implementation Details

### Deno Import Maps
Use `npm:` specifier for npm packages in Deno:
```typescript
import { GoogleGenerativeAI } from "npm:@google/generative-ai@0.21.0";
import { createClient } from "npm:@supabase/supabase-js@2";
```

Versions are pinned in `deno.json` imports map.

### CORS Headers
All Edge Functions require CORS headers:
```typescript
const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-user-id",
};
```

### Rate Limiting Implementation
- User ID extracted from `x-user-id` header or Authorization token
- Falls back to 'anonymous' if not provided
- Returns 429 with headers: `X-RateLimit-Remaining`, `X-RateLimit-Reset`
- Fails open (allows request) if rate limiting service errors

### Gemini System Instructions
The AI persona "Britta" is configured in `GeminiService.ts` with:
- Swedish bookkeeping expertise (BAS account plan)
- PDF/image tax document analysis capabilities
- Proactive advice on tax deadlines and bookkeeping entries
- Tool usage workflow for invoice creation

### File Processing
Frontend converts files to base64 and sends with mimeType:
```javascript
{
  message: "Analyze this PDF",
  fileData: {
    mimeType: "application/pdf",
    data: "base64-encoded-data"
  }
}
```

## Environment Variables

Required in Supabase Edge Functions:
- `GEMINI_API_KEY`: Google Gemini API key
- `SUPABASE_URL`: Auto-provided by Supabase
- `SUPABASE_SERVICE_ROLE_KEY`: Auto-provided by Supabase
- `FORTNOX_CLIENT_ID`: Fortnox OAuth client ID
- `FORTNOX_CLIENT_SECRET`: Fortnox OAuth client secret

Set secrets with:
```bash
supabase secrets set KEY=value
```

## Skills

### svensk-ekonomi
Located in `.skills/svensk-ekonomi/`, this skill provides Swedish accounting expertise:

**Capabilities:**
- Swedish VAT/moms handling (25%, 12%, 6%, 0% rates)
- BAS account plan (Swedish standard chart of accounts)
- SIE file export for accounting software (Fortnox, Visma)
- Validators for Swedish org.nr, VAT numbers, bankgiro/plusgiro
- EV charging station accounting (CPO/eMSP transactions, OCPI roaming)
- Accrual and depreciation calculations (K2/K3)

**CLI Usage:**
```bash
# Validate Swedish identifiers
python3 .skills/svensk-ekonomi/scripts/validators.py org 5561839191
python3 .skills/svensk-ekonomi/scripts/validators.py vat SE556183919101

# Process transactions and generate VAT report
python3 .skills/svensk-ekonomi/scripts/vat_processor.py transactions.xlsx \
  --output report.json \
  --company "Företag AB" \
  --org "5561839191" \
  --period "2025-11"

# Export to SIE format for Fortnox/Visma
python3 .skills/svensk-ekonomi/scripts/sie_export.py report.json \
  --output export.sie \
  --year 2025
```

**Python Usage:**
```python
from scripts.vat_processor import VATProcessor
processor = VATProcessor()
result = processor.process_transactions(df)
```

**Excel Input Format:**
Required columns: `amount`, `subAmount`, `vat`, `vatRate`, `transactionName`
Optional: `id`, `kwh` (for EV charging)

**Reference files:**
- `references/bas_accounts.md` - BAS account mapping for EV charging
- `references/vat_rules.md` - Detailed Swedish VAT rules

**Test files:** See `test_transactions.xlsx`, `vat_report.json`, `export.sie` for working examples

**Triggers:** Swedish moms, BAS-konto, SIE-fil, elbilsladdning, Skatteverket, bokföring Sverige

## Important Notes

- The project uses Swedish language for all user-facing content
- All accounting follows Swedish standards (BAS account plan)
- Frontend has no build step - plain JavaScript, HTML, CSS
- LocalStorage is primary data store for frontend (no Supabase auth yet)
- Rate limiting is per-user but currently defaults to 'anonymous' for unauthenticated users
- Fortnox tokens must be initially obtained through OAuth flow and stored in database

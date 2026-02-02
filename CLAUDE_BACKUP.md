# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Veridat is an AI-powered Swedish bookkeeping assistant for small businesses. It's a Progressive Web App (PWA) that helps users with accounting tasks, invoice creation, and tax document analysis using Google Gemini AI and Fortnox integration.

**Tech Stack:**
- Frontend: Vite + TypeScript (vanilla, class-based components)
- Backend: Supabase Edge Functions (Deno) + Python FastAPI (Railway)
- AI: Google Gemini (chat/PDF), Claude (fallback), Python (VAT-beräkningar)
- Integrations: Fortnox API for accounting operations
- Database: Supabase PostgreSQL with RLS

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

### Python API (VAT Calculations)
```bash
# Local development
cd python-api
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8080

# Test health
curl http://localhost:8080/health

# Production (Railway)
# Auto-deploys from git push
# Environment: ENV=production, DEBUG=false, ALLOWED_ORIGINS=https://...
```

## Architecture

### Service Layer Pattern

The backend uses a service-oriented architecture where business logic is encapsulated in reusable services:

- **GeminiService** (`supabase/services/GeminiService.ts`): Handles all AI interactions with Google Gemini, including system instructions, function calling (tools), and file processing. Defines three tools: `create_invoice`, `get_customers`, `get_articles`

- **FortnoxService** (`supabase/services/FortnoxService.ts`): Manages Fortnox API integration including OAuth token refresh, API requests, and operations (customers, articles, invoices). Automatically handles token expiration and refresh from database

- **RateLimiterService** (`supabase/services/RateLimiterService.ts`): Implements rate limiting with hourly (10/hour) and daily (50/day) limits per user. Uses Supabase `api_usage` table for tracking

### Intelligent File Routing

The frontend automatically routes files to the appropriate backend:
```
Excel (.xlsx, .xls) → python-proxy Edge Function → Python API (Railway)
                                ↓ (fallback if Python fails)
                      claude-analyze → Claude AI

PDF/Images → gemini-chat → Gemini AI
Text messages → gemini-chat → Gemini AI
```

**Key files:**
- `src/main.ts`: Frontend routing logic (analyzeExcelWithPython, fallback to Claude)
- `supabase/functions/python-proxy/`: Auth + proxy to Python API
- `python-api/app/services/vat_service.py`: VAT calculations

### Edge Functions

| Function | Purpose | Backend |
|----------|---------|---------|
| `gemini-chat` | Main chat, PDF analysis | Gemini AI |
| `claude-analyze` | Excel analysis fallback | Claude AI |
| `python-proxy` | VAT calculations proxy | Python API |
| `fortnox` | Accounting operations | Fortnox API |

- **gemini-chat** (`supabase/functions/gemini-chat/index.ts`): Main entry point for chat interactions. Handles rate limiting, calls GeminiService, and executes tool calls. Returns structured responses: `{type: 'text', data: string}` or `{type: 'json', data: object}` for confirmation cards

- **fortnox** (`supabase/functions/fortnox/index.ts`): Direct Fortnox API operations. Supports actions: `createInvoice`, `getCustomers`, `getArticles`

### Python API (python-api/)

FastAPI service hosted on Railway for precise VAT calculations.

**Structure:**
- `app/main.py` - FastAPI entry, CORS, startup validation
- `app/config.py` - Environment-based configuration
- `app/api/routes/vat.py` - POST /api/v1/vat/analyze
- `app/services/vat_service.py` - VAT calculation logic
- `app/services/excel_service.py` - Excel parsing with pandas
- `app/core/security.py` - Optional API key validation

**Environment Variables (Railway):**
- `ENV=production`
- `DEBUG=false`
- `ALLOWED_ORIGINS=https://your-supabase.supabase.co`
- `PYTHON_API_KEY` (optional, for API auth)

### Frontend Structure

- **Entry**: `src/main.ts` - Main TypeScript application
- **Components**: `src/components/` - Class-based TypeScript components
- **Types**: `src/types/` - TypeScript interfaces (VATReportData, etc.)
- **Styles**: `src/styles/` - CSS with custom properties
- **Build**: Vite (`npm run build` → `dist/`)
- **Legacy**: `app/` folder (being migrated to src/)

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
The AI persona "Veridat" is configured in `GeminiService.ts` with:
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

### Frontend (.env)
- `VITE_SUPABASE_URL`: Supabase project URL
- `VITE_SUPABASE_ANON_KEY`: Supabase anonymous key

### Supabase Secrets
```bash
supabase secrets set GEMINI_API_KEY=...
supabase secrets set PYTHON_API_URL=https://your-railway-app.railway.app
supabase secrets set PYTHON_API_KEY=...  # Optional
supabase secrets set FORTNOX_CLIENT_ID=...
supabase secrets set FORTNOX_CLIENT_SECRET=...
```

### Railway (Python API)
- `ENV=production`
- `DEBUG=false`
- `ALLOWED_ORIGINS=https://...`
- `PYTHON_API_KEY` (optional)

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

## Current Status

- [x] Python API deployed on Railway
- [x] Security fixes implemented (CORS, DEBUG, startup validation)
- [x] Intelligent routing (Excel → Python, fallback → Claude)
- [x] Edge Functions deployed (gemini-chat, python-proxy, claude-analyze)
- [x] RLS policies optimized
- [ ] Production frontend deployment
- [ ] E2E testing

## Quick Reference
```bash
# Start everything locally
npm run dev                              # Frontend (Vite)
cd python-api && uvicorn app.main:app   # Python API
supabase functions serve                 # Edge Functions

# Deploy
git push                                 # Railway auto-deploys Python
supabase functions deploy               # Deploy Edge Functions
npm run build && vercel deploy          # Frontend to Vercel

# Testing
cd python-api && pytest tests/ -v       # Run unit tests
cd python-api && python3 verify_api.py  # Run API verification
```

---

## Recent Improvements (2025-12-03)

### Security Enhancements 🔒

**Timing Attack Protection** (`python-api/app/core/security.py`)
- Implemented `secrets.compare_digest()` for constant-time API key comparison
- Prevents timing attacks where hackers measure response time to guess API keys character by character
- Maintains fail-open design: authentication bypassed if `PYTHON_API_KEY` not configured

**Authentication Error Handling** (`src/components/LegalConsentModal.tsx`)
- Added comprehensive error handling for `supabase.auth.getUser()`
- Handles both response errors and network exceptions gracefully
- Users see clear error messages instead of crashes during auth failures

**Test Coverage** (`python-api/tests/test_security.py`)
- 7 unit tests covering all security.py code paths (100% coverage)
- Tests: fail-open behavior, API key validation, timing attack resistance, edge cases
- Configured pytest with asyncio support (`pytest.ini`)
- Command: `pytest tests/ -v` → **7/7 passing ✅**

### Reliability Improvements 🛡️

**FastAPI Modern Lifespan** (`python-api/app/main.py`)
- Migrated from deprecated `@app.on_event("startup")` to modern `lifespan` context manager
- Future-proof for FastAPI 0.109+ versions
- Cleaner startup/shutdown handling with proper async context

**Railway Cold Start Handling** (`supabase/services/PythonAPIService.ts`)
- Implemented retry logic: 3 attempts with exponential backoff (1s, 2s, 4s)
- Automatically handles Railway cold starts (when API "wakes up" from sleep)
- Users no longer see "Internal server error" on first request after idle
- Detailed logging for each retry attempt

**Consent Email Retry** (`src/components/LegalConsentModal.tsx`)
- 3 retry attempts with exponential backoff (1s, 2s) for email delivery
- Non-blocking: user can proceed immediately while email sends in background
- 🚨 CRITICAL error logging when all retries fail (for admin monitoring)
- Future integration point: trigger alerts to admins on persistent failures

**Error Detail Preservation** (`supabase/functions/python-proxy/index.ts`)
- Preserves error details when forwarding from Python API to frontend
- Tracks error source: `python_api` vs `edge_function`
- Extracts and includes HTTP status codes in error responses
- Better debugging with structured error objects:
  ```typescript
  {
    error: "python_api_error",
    message: "Python API error (400): Invalid base64",
    source: "python_api",
    details: { status_code: 400 }
  }
  ```

### Code Quality 🧹

**Clean Code Practices** (`python-api/verify_api.py`)
- Removed unused `Decimal` import
- Extracted magic number (0.02) to named constant: `FLOAT_TOLERANCE`
- Made `BASE_URL` configurable via `PYTHON_API_URL` environment variable
- Default: `http://localhost:8080`, override for production testing

---

## Critical Debugging Session (2025-12-03) 🐛

### Problem: Inconsistent VAT Calculations

**Symptom**: Same Excel file returned different results on every upload:
- Upload 1: Försäljning 298.81 SEK, Kostnader 426.56 SEK
- Upload 2: Försäljning 299.01 SEK, Kostnader 461.27 SEK
- Upload 3: Försäljning 314.81 SEK, Kostnader 526.55 SEK

**Root Causes Discovered**:

1. **Authentication Failure (401 Unauthorized)**
   - Railway Python API had `PYTHON_API_KEY` environment variable set
   - Supabase Edge Function did NOT have matching `PYTHON_API_KEY` secret
   - All requests were rejected with 401, triggering Claude AI fallback
   - **Fix**: Set matching API key in Supabase secrets

2. **Pydantic Validation Error (500 Internal Server Error)**
   - `ValidationResult` expected `errors: List[str]`
   - Railway's Python API returned `errors: List[dict]` format
   - Mismatch caused: `ValidationError: Input should be a valid string [type=string_type, input_value={'field': 'org_number', ...}]`
   - **Fix**: Changed to `errors: List[Union[str, dict]]` for compatibility

### Solutions Implemented

**1. Frontend Base64 Validation** (`src/main.ts`)
```typescript
// Added comprehensive logging
console.log('[Python API] Base64 data length BEFORE padding:', base64Data.length);
console.log('[Python API] First 50 chars:', base64Data.substring(0, 50));
console.log('[Python API] Last 50 chars:', base64Data.substring(base64Data.length - 50));

// Auto-padding for base64 strings (must be multiple of 4)
while (base64Data.length % 4 !== 0) {
    base64Data += '=';
}
```

**2. Edge Function Debug Logging** (`supabase/functions/python-proxy/index.ts`)
```typescript
// Log received data for debugging
console.log("[python-proxy] Received file_data length:", body.file_data?.length || 0);
console.log("[python-proxy] Received file_data first 50 chars:", body.file_data?.substring(0, 50));
```

**3. Enhanced Excel Service Validation** (`python-api/app/services/excel_service.py`)
```python
# Validate base64 string before decoding
if not file_data:
    raise FileProcessingError("Empty base64 data received")

if len(file_data) < 10:
    raise FileProcessingError(f"Base64 data too short: {len(file_data)} characters")

# Decode with validation
try:
    file_bytes = base64.b64decode(file_data, validate=True)
except Exception as decode_error:
    raise FileProcessingError(f"Invalid base64 encoding: {str(decode_error)}")
```

**4. Pydantic Model Compatibility** (`python-api/app/api/models/response.py`)
```python
from typing import Union

class ValidationResult(BaseModel):
    is_valid: bool
    errors: List[Union[str, dict]]  # Accept both formats
    warnings: List[Union[str, dict]]  # Accept both formats
```

### Debugging Workflow Used

1. **Console Analysis**: Checked frontend logs → Base64 data correct (14392 chars)
2. **Railway Logs**: Found 401 Unauthorized errors
3. **API Key Sync**: Matched `PYTHON_API_KEY` between Railway and Supabase
4. **Pydantic Error**: Discovered validation type mismatch in errors/warnings
5. **Union Type Fix**: Made model accept both string and dict formats
6. **Deployment**: Railway auto-deployed from git push
7. **Verification**: Same Excel file now returns consistent results every time

### Testing & Verification

**Test Script Created**: `python-api/test_validation_format.py`
- Validates that errors/warnings are formatted correctly
- Confirms local Python API returns strings, not dicts
- Railway compatibility ensured through Union types

**Result**:
```
✅ [Python API] Success
✅ [Router] Python API succeeded
✅ No Claude fallback
✅ Consistent results: 298.81 SEK försäljning, 426.48 SEK kostnader
```

### Key Learnings

1. **API Key Management**: Always ensure secrets are synced between Railway and Supabase
2. **Type Flexibility**: Use `Union` types for backward compatibility during migrations
3. **Comprehensive Logging**: Debug logs at each pipeline stage (Frontend → Edge Function → Python API)
4. **Railway Caching**: Python API may cache old code; wait 2-3 minutes for deployments
5. **Error Propagation**: 500 errors don't always mean code bugs—check authentication first!

**Testing Infrastructure** (`python-api/requirements.txt`, `pytest.ini`)
- Added pytest, pytest-asyncio, httpx to dependencies
- Configured async test mode for FastAPI testing
- Test discovery configured for `tests/` directory
- Ready for CI/CD integration

### Test Commands

```bash
# Run all unit tests
cd python-api
pytest tests/ -v

# Run specific test file
pytest tests/test_security.py -v

# Run API verification (requires running server)
python3 verify_api.py

# Test against production API
PYTHON_API_URL=https://your-api.railway.app python3 verify_api.py
```

### Monitoring & Debugging

**Railway Logs (Python API):**
```
✅ Environment validated: ENV=production, DEBUG=False
✅ Allowed origins: ['https://...']
Application startup complete
```

**Supabase Edge Function Logs (Retry Example):**
```
[PythonAPIService] Attempt 1/3
❌ Attempt 1/3 failed: fetch failed
⏳ Waiting 1000ms before retry...
[PythonAPIService] Attempt 2/3
✅ Success on attempt 2
```

**Frontend Console (Email Retry):**
```
[Consent Email] Attempt 1/3...
❌ Email attempt 1/3 failed: ...
[Consent Email] Attempt 2/3...
✅ Consent confirmation email sent successfully
```

**Critical Failure Alert:**
```
🚨 CRITICAL: Failed to send consent email after all retries
{
  userId: "...",
  email: "...",
  error: {...},
  timestamp: "2025-12-03T..."
}
```

### Git History
```
6596263 - refactor: Low priority code quality improvements
f67f860 - feat: Medium priority improvements - testing, retry, error handling
1dbe52d - fix: Critical security and reliability improvements
```

### Production Checklist
- [x] Timing attack protection (constant-time comparison)
- [x] Auth error handling (graceful degradation)
- [x] FastAPI modern patterns (lifespan)
- [x] Railway cold start handling (retry with backoff)
- [x] Email delivery retry (3 attempts)
- [x] Error detail preservation (source tracking)
- [x] Unit tests (7 tests, 100% security coverage)
- [x] Clean code (no magic numbers, configurable URLs)
- [x] Production deployment (Railway auto-deploy)

---

## Best Practices for Future Sessions

### For Maintaining Context Between Sessions:

1. **Update CLAUDE.md** - Document all significant changes here
2. **Use Descriptive Commits** - Clear commit messages help understand changes
3. **Keep CHANGELOG.md** - Track version history and breaking changes
4. **Reference Line Numbers** - Use `file:line` format in documentation
5. **Document Decisions** - Explain "why" not just "what" in comments

### When Starting a New Session:

Claude will automatically read CLAUDE.md and understand:
- Current architecture and patterns
- Recent changes and improvements
- Environment setup and deployment process
- Testing procedures and commands
- Known issues and TODOs

# Development Guide

## Quick Start

### Start All Services
```bash
# Option 1: Use /dev-start command (recommended)
/dev-start

# Option 2: Manual startup
npm run dev                                    # Frontend (Vite :5173)
cd python-api && uvicorn app.main:app --reload # Python API (:8080)
npm run supabase:start                         # Supabase services
```

### Stop All Services
```bash
/dev-stop
# or manually stop each service
```

### Check Status
```bash
/dev-status
```

---

## Local Development URLs

| Service | URL | Purpose |
|---------|-----|---------|
| Frontend | http://localhost:5173 | Vite dev server |
| Python API | http://localhost:8080 | FastAPI VAT calculations |
| Supabase Studio | http://localhost:54323 | Database admin |
| Supabase API | http://localhost:54321 | Edge Functions |

---

## Frontend Development

```bash
# Start Vite dev server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Access pages
open http://localhost:5173/landing/  # Landing page
open http://localhost:5173/app/      # Main app
```

---

## Supabase Edge Functions

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

# Set secrets
supabase secrets set GEMINI_API_KEY=your_key_here
supabase secrets set PYTHON_API_KEY=your_key_here

# Link local project to Supabase
supabase login
supabase link --project-ref your-project-ref
```

---

## Python API Development

```bash
cd python-api

# First-time setup
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Start development server
uvicorn app.main:app --reload --port 8080

# Test health endpoint
curl http://localhost:8080/health

# Run unit tests
pytest tests/ -v

# Run API verification
python3 verify_api.py
```

---

## Testing

### Unit Tests (Python)
```bash
cd python-api
pytest tests/ -v                    # All tests
pytest tests/test_security.py -v    # Specific file
```

### API Verification
```bash
cd python-api
python3 verify_api.py                                              # Local
PYTHON_API_URL=https://your-api.railway.app python3 verify_api.py  # Production
```

### Rate Limiting Test
```bash
deno run --allow-all test_rate_limit.ts
```

---

## Deno Import Maps

Use `npm:` specifier for npm packages in Edge Functions:
```typescript
import { GoogleGenerativeAI } from "npm:@google/generative-ai@0.21.0";
import { createClient } from "npm:@supabase/supabase-js@2";
```

Versions pinned in `deno.json` imports map.

---

## File Processing

Frontend converts files to base64:
```javascript
{
  message: "Analyze this PDF",
  fileData: {
    mimeType: "application/pdf",
    data: "base64-encoded-data"
  }
}
```

**Base64 Validation:**
- Auto-padding for strings not multiple of 4
- Logging at each pipeline stage for debugging

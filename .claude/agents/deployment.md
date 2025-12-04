---
name: deployment
version: 1.0.0
description: Multi-service deployment orchestrator for Britta. Handles Railway, Supabase, and Vercel deployments.
allowed-tools:
  - Bash
  - Read
  - Grep
  - WebFetch
triggers:
  - deploy
  - production
  - release
  - Railway
  - Supabase
  - Vercel
  - driftsätt
---

# Deployment Agent

Du är en deployment-specialist för Britta-projektet och orkestrerar deployment till flera plattformar.

## Tjänster & Plattformar

| Tjänst | Plattform | Deployment |
|--------|-----------|------------|
| Python API | Railway | Auto-deploy on git push |
| Edge Functions | Supabase | Manual via CLI |
| Frontend | Vercel | Manual via CLI |

---

## Deployment Workflow

### Fas 1: Pre-Deploy Validering

```bash
#!/bin/bash
echo "🔍 Kör pre-deploy validering..."

# 1. Kör unit tests
echo "[1/5] Kör unit tests..."
cd python-api && pytest tests/ -v
cd ..

# 2. Verifiera Python API
echo "[2/5] Verifierar Python API..."
cd python-api && python3 verify_api.py
cd ..

# 3. Bygg frontend
echo "[3/5] Bygger frontend..."
npm run build

# 4. Kontrollera git status
echo "[4/5] Kontrollerar git status..."
if [ -n "$(git status --porcelain)" ]; then
    echo "❌ Uncommitted changes detected!"
    git status --short
    exit 1
fi

# 5. Validera miljövariabler
echo "[5/5] Validerar secrets..."
supabase secrets list
```

---

### Fas 2: Backend Deployment

#### Python API (Railway)
```bash
# Railway auto-deploys från git push
git push origin main

# Vänta på deployment (2-3 min för cold start)
echo "⏳ Väntar på Railway deployment..."
sleep 180

# Verifiera health endpoint
curl https://your-api.railway.app/health
```

**Railway Environment Variables:**
```
ENV=production
DEBUG=false
ALLOWED_ORIGINS=https://your-supabase.supabase.co
PYTHON_API_KEY=your_secret_key
```

#### Edge Functions (Supabase)
```bash
# Deploy alla funktioner
supabase functions deploy gemini-chat
supabase functions deploy python-proxy
supabase functions deploy claude-analyze
supabase functions deploy fortnox

# Verifiera deployment
supabase functions list
```

**Supabase Secrets:**
```bash
supabase secrets set GEMINI_API_KEY=...
supabase secrets set PYTHON_API_URL=https://your-railway-app.railway.app
supabase secrets set PYTHON_API_KEY=...
supabase secrets set FORTNOX_CLIENT_ID=...
supabase secrets set FORTNOX_CLIENT_SECRET=...
```

---

### Fas 3: Frontend Deployment

```bash
# Bygg för produktion
npm run build

# Deploy till Vercel
vercel deploy --prod

# Eller preview deploy
vercel deploy
```

---

### Fas 4: Post-Deploy Verifiering

```bash
#!/bin/bash
echo "✅ Kör post-deploy verifiering..."

# 1. Test VAT calculation
echo "[1/4] Testar VAT-beräkning..."
# Upload test_transactions.xlsx och verifiera resultat

# 2. Test Gemini chat
echo "[2/4] Testar Gemini chat..."
# Skicka testmeddelande

# 3. Test rate limiting
echo "[3/4] Testar rate limiting..."
# Gör 10 requests, verifiera 11:e blockeras

# 4. Monitorera loggar
echo "[4/4] Monitorerar loggar..."
supabase functions logs gemini-chat --tail
```

---

## Smoke Tests

### 1. Health Check
```bash
curl https://your-railway-app.railway.app/health
# Förväntat: {"status": "healthy"}
```

### 2. VAT Calculation
- Ladda upp `test_transactions.xlsx`
- Verifiera konsistenta resultat
- Kontrollera att Python API används (inte Claude fallback)

### 3. Gemini Chat
- Skicka "Hej Britta!"
- Verifiera svar på svenska

### 4. Rate Limiting
- Gör 10 requests inom 1 minut → Alla lyckas
- 11:e request → 429 Too Many Requests

---

## Rollback Procedurer

### Railway (Python API)
1. Gå till Railway dashboard
2. Välj service → Deployments
3. Klicka "Rollback" på tidigare lyckad deployment

### Supabase Edge Functions
```bash
# Lista versioner
supabase functions list

# Återställ till tidigare version
supabase functions deploy gemini-chat@previous
```

### Vercel
```bash
# Rollback via CLI
vercel rollback

# Eller via dashboard
# https://vercel.com/[team]/[project]/deployments
```

---

## Deployment Checklista

### Pre-Deploy
- [ ] Unit tests passerar (`pytest tests/ -v`)
- [ ] API verification passerar (`python3 verify_api.py`)
- [ ] Frontend bygger (`npm run build`)
- [ ] Inga uncommitted changes (`git status`)
- [ ] Secrets är synkade (Railway ↔ Supabase)

### During Deploy
- [ ] Git push till main (Railway)
- [ ] Edge Functions deployed (Supabase)
- [ ] Frontend deployed (Vercel)

### Post-Deploy
- [ ] Health endpoint svarar
- [ ] VAT-beräkning fungerar
- [ ] Gemini chat fungerar
- [ ] Rate limiting fungerar
- [ ] Inga errors i loggar

---

## Felsökning

### Railway Deployment Misslyckades
```bash
# Kontrollera Railway logs
# https://railway.app/project/[id]/service/[id]

# Vanliga problem:
# - Felaktig requirements.txt
# - Saknade miljövariabler
# - Python version mismatch
```

### Edge Function Deployment Misslyckades
```bash
# Kontrollera Supabase status
supabase status

# Kontrollera function logs
supabase functions logs gemini-chat

# Vanliga problem:
# - Import errors (npm: specifier)
# - Saknade secrets
# - CORS headers saknas
```

### 401 Unauthorized Efter Deploy
```bash
# API-nyckel matchar inte
# Synka mellan Railway och Supabase:
supabase secrets set PYTHON_API_KEY=your_railway_key
supabase functions deploy python-proxy
```

### Inkonsistenta VAT-Resultat
```bash
# Fallback till Claude istället för Python
# Kontrollera:
# 1. Python API health
curl https://your-api.railway.app/health

# 2. API key sync
supabase secrets list

# 3. Vänta på Railway cold start (2-3 min)
```

---

## Automatisering

### Full Deploy Script
```bash
#!/bin/bash
set -e

echo "🚀 Starting Britta Full Deployment..."

# Pre-deploy
cd /Users/ravonstrawder/Desktop/Britta
echo "📋 Pre-deploy validation..."
cd python-api && pytest tests/ -v && cd ..
npm run build

# Backend
echo "🔧 Deploying backend..."
git add . && git commit -m "deploy: $(date +%Y-%m-%d)" && git push origin main
supabase functions deploy gemini-chat
supabase functions deploy python-proxy
supabase functions deploy claude-analyze
supabase functions deploy fortnox

# Wait for Railway
echo "⏳ Waiting for Railway (180s)..."
sleep 180

# Verify
echo "✅ Post-deploy verification..."
curl https://your-api.railway.app/health

echo "🎉 Deployment complete!"
```

---

## Monitoring

### Railway Logs
```
✅ Environment validated: ENV=production, DEBUG=False
✅ Allowed origins: ['https://...']
Application startup complete
```

### Supabase Logs
```bash
supabase functions logs gemini-chat --tail
supabase functions logs python-proxy --tail
```

### Kritiska Loggar att Övervaka
- `❌` - Errors
- `401` - Auth failures
- `500` - Internal errors
- `429` - Rate limit exceeded

---

## Referenser

- `.claude/docs/03-deployment.md` - Deployment guide
- `.claude/docs/04-security.md` - Secrets management
- `.claude/docs/05-testing.md` - Test procedures
- `railway-env-checklist.md` - Railway environment checklist

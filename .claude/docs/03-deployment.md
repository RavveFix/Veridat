# Deployment Guide

## Overview

| Service | Platform | Deployment Method |
|---------|----------|-------------------|
| Python API | Railway | Auto-deploy on git push |
| Edge Functions | Supabase | Manual deploy via CLI |
| Frontend | Vercel | Manual deploy (TBD) |

---

## Pre-Deployment Checklist

```bash
# 1. Run unit tests
cd python-api && pytest tests/ -v

# 2. Verify API locally
python3 verify_api.py

# 3. Build frontend
npm run build

# 4. Check git status (no uncommitted changes)
git status

# 5. Validate environment secrets
supabase secrets list
```

---

## Python API (Railway)

### Automatic Deployment
```bash
# Push to main branch triggers auto-deploy
git push origin main
```

### Environment Variables (Railway Dashboard)
```
ENV=production
DEBUG=false
ALLOWED_ORIGINS=https://your-supabase.supabase.co
PYTHON_API_KEY=your_secret_key  # Optional
```

### Verify Deployment
```bash
# Wait 2-3 minutes for Railway cold start
curl https://your-api.railway.app/health

# Test VAT endpoint
PYTHON_API_URL=https://your-api.railway.app python3 verify_api.py
```

### Railway Logs
```
✅ Environment validated: ENV=production, DEBUG=False
✅ Allowed origins: ['https://...']
Application startup complete
```

---

## Supabase Edge Functions

### Deploy All Functions
```bash
supabase functions deploy gemini-chat
supabase functions deploy python-proxy
supabase functions deploy claude-analyze
supabase functions deploy fortnox
```

### Deploy Single Function
```bash
npm run supabase:deploy
# or: supabase functions deploy gemini-chat
```

### Set Secrets
```bash
supabase secrets set GEMINI_API_KEY=...
supabase secrets set PYTHON_API_URL=https://your-railway-app.railway.app
supabase secrets set PYTHON_API_KEY=...
supabase secrets set FORTNOX_CLIENT_ID=...
supabase secrets set FORTNOX_CLIENT_SECRET=...
```

### Verify Secrets
```bash
supabase secrets list
```

---

## Frontend (Vercel)

### Build
```bash
npm run build
```

### Deploy (when configured)
```bash
vercel deploy --prod
```

---

## Post-Deployment Verification

### 1. Test VAT Calculation
- Upload `test_transactions.xlsx`
- Verify consistent results
- Check no Claude fallback in logs

### 2. Test Gemini Chat
- Send simple message
- Verify response in Swedish

### 3. Test Rate Limiting
- Make 10 requests in < 1 minute
- Verify 429 response on 11th request

### 4. Monitor Logs
```bash
# Supabase Edge Function logs
supabase functions logs gemini-chat

# Railway logs (in dashboard)
# https://railway.app/project/[id]/service/[id]
```

---

## Rollback Procedures

### Railway (Python API)
1. Go to Railway dashboard
2. Select service → Deployments
3. Click "Rollback" on previous successful deployment

### Supabase Edge Functions
```bash
# Deploy previous version
supabase functions deploy gemini-chat@previous
```

### Vercel
```bash
vercel rollback
# or use Vercel dashboard
```

---

## Troubleshooting

### 401 Unauthorized (Python API)
- Check `PYTHON_API_KEY` matches between Railway and Supabase
- Verify `supabase secrets set PYTHON_API_KEY=...`

### 500 Internal Server Error
- Check Railway logs for startup errors
- Verify `ALLOWED_ORIGINS` includes Supabase URL
- Wait 2-3 minutes for Railway cold start

### Inconsistent VAT Results
- Verify Python API is responding (not Claude fallback)
- Check frontend console for `[Python API] Success`
- Ensure base64 padding is correct

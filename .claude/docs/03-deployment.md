# Deployment Guide

## Overview

| Service | Platform | Deployment Method |
|---------|----------|-------------------|
| Edge Functions | Supabase | Auto-deploy via GitHub Actions on push to main |
| Frontend | Vercel | Auto-deploy on push to main (or `vercel deploy --prod`) |
| Database | Supabase | Migrations applied via `supabase db push` |

---

## Pre-Deployment Checklist

```bash
# 1. Run linter
npm run lint

# 2. Run unit tests
npm run test

# 3. Build frontend
npm run build

# 4. Check git status (no uncommitted changes)
git status

# 5. Validate environment secrets
supabase secrets list
```

---

## Supabase Edge Functions

### Auto-Deploy (GitHub Actions)
Pushing to `main` triggers `.github/workflows/supabase-deploy.yml` which:
1. Links to the Supabase project
2. Runs `supabase db push` (applies pending migrations)
3. Deploys all Edge Functions found in `supabase/functions/`

### Manual Deploy
```bash
# Deploy all functions
supabase functions deploy gemini-chat fortnox fortnox-oauth analyze-excel-ai memory-generator --project-ref baweorbvueghhkzlyncu

# Deploy single function
supabase functions deploy fortnox --project-ref baweorbvueghhkzlyncu
```

### Required Secrets
```bash
supabase secrets set GEMINI_API_KEY=...
supabase secrets set OPENAI_API_KEY=...
supabase secrets set FORTNOX_CLIENT_ID=...
supabase secrets set FORTNOX_CLIENT_SECRET=...
supabase secrets set FORTNOX_OAUTH_STATE_SECRET=...  # Critical for OAuth CSRF
```

### Verify Secrets
```bash
supabase secrets list
```

---

## Frontend (Vercel)

### Environment Variables (Vercel Dashboard)
```
VITE_SUPABASE_URL=https://baweorbvueghhkzlyncu.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
VITE_SENTRY_DSN=<sentry-dsn>  # Optional
```

### Build Settings
- Framework: Vite
- Build command: `npm run build`
- Output directory: `dist`
- Node version: 20

### Deploy
```bash
vercel deploy --prod
```

### Custom Domain
1. Vercel Dashboard → Project → Settings → Domains
2. Add `veridat.se` + `www.veridat.se`
3. DNS: CNAME → `cname.vercel-dns.com`

---

## Post-Deployment Verification

See `docs/PRE_PROD_CHECKLIST.md` for full checklist:

1. **Auth**: Log in with magic link → verify redirect to `/app`
2. **Files**: Upload PDF + Excel → verify signed URLs (not public)
3. **Fortnox**: Connect OAuth → run a read action
4. **VAT Report**: Open Momsdeklaration → verify invoice data
5. **AI Chat**: Send messages → verify Swedish response
6. **Rate Limiting**: Verify 10/hour limit is enforced
7. **Memories**: Send messages → wait 30s → verify generation

### Monitor Logs
```bash
# Supabase Edge Function logs
supabase functions logs gemini-chat --project-ref baweorbvueghhkzlyncu
supabase functions logs fortnox --project-ref baweorbvueghhkzlyncu
```

---

## Rollback Procedures

### Supabase Edge Functions
```bash
# Redeploy from a previous commit
git checkout <commit-hash> -- supabase/functions/
supabase functions deploy <function-name> --project-ref baweorbvueghhkzlyncu
```

### Vercel
```bash
vercel rollback
# or use Vercel dashboard
```

---

## Troubleshooting

### Fortnox OAuth Fails
- Verify `FORTNOX_OAUTH_STATE_SECRET` is set in Supabase secrets
- Check redirect URI in Fortnox Developer Portal

### 401 Unauthorized on Edge Functions
- Verify user session is valid (not expired)
- Check Authorization header is being sent

### Token Refresh Fails (invalid_grant)
- Race condition: multiple concurrent requests tried to refresh simultaneously
- Fix is built in: service re-reads DB for token refreshed by another process
- If persistent: user needs to reconnect Fortnox via OAuth

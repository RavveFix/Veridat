# Railway Deployment Guide

## Prerequisites

✅ Railway CLI installed (version 4.11.2)
✅ Python API ready in `/python-api` directory
✅ All files created:
  - `Procfile` - Deployment command
  - `requirements.txt` - Python dependencies
  - `railway.toml` - Railway configuration
  - `.env.example` - Environment template

## Step-by-Step Deployment

### Step 1: Login to Railway

```bash
cd /Users/ravonstrawder/Desktop/Britta/python-api
railway login
```

This will open your browser for authentication. Sign in with:
- GitHub account (recommended)
- Email/password
- Google account

### Step 2: Initialize Railway Project

```bash
railway init
```

Choose:
- Create a new project
- Name it: `britta-vat-api`

### Step 3: Deploy to Railway

```bash
railway up
```

This will:
1. Detect Python application
2. Install dependencies from `requirements.txt`
3. Start the app using the `Procfile` command
4. Deploy to Railway infrastructure

### Step 4: Configure Environment Variables

```bash
railway variables set ENV=production
railway variables set DEBUG=false
railway variables set ALLOWED_ORIGINS="*"
```

Or set them in the Railway dashboard:
1. Go to https://railway.app
2. Select your project
3. Click "Variables" tab
4. Add:
   - `ENV=production`
   - `DEBUG=false`
   - `ALLOWED_ORIGINS=*` (or specific Supabase URL)

### Step 5: Get Deployment URL

```bash
railway status
```

Or:
```bash
railway domain
```

The URL will look like: `https://britta-vat-api.up.railway.app`

### Step 6: Test Deployed API

```bash
# Replace with your actual Railway URL
curl https://your-app.up.railway.app/health
```

Expected response:
```json
{"status":"healthy","service":"britta-vat-api"}
```

### Step 7: Save URL for Supabase Integration

Copy your Railway URL - you'll need it for Phase 3 (Supabase integration):

```bash
# This URL will be set as PYTHON_API_URL in Supabase secrets
echo "https://your-app.up.railway.app" > railway-url.txt
```

## Alternative: Deploy via Railway Dashboard

If CLI doesn't work:

1. Go to https://railway.app
2. Click "New Project"
3. Choose "Deploy from GitHub repo"
4. Connect your GitHub account
5. Select the Britta repository
6. Set root directory to `python-api`
7. Railway will auto-detect Python and deploy

## Troubleshooting

### Build Fails

Check logs:
```bash
railway logs
```

Common issues:
- Missing dependencies in `requirements.txt`
- Wrong Python version (need 3.11+)
- Path issues with `svensk-ekonomi` skill

### Health Check Fails

Verify:
- Port is set to `$PORT` environment variable
- Health endpoint is at `/health`
- CORS is configured correctly

### Monitoring

```bash
# View live logs
railway logs --follow

# Check deployment status
railway status

# View all variables
railway variables
```

## Cost

Railway offers:
- **Free tier**: $5 credit/month (enough for testing)
- **Pro plan**: $20/month for production use

## Next Steps

Once deployed successfully:
1. Note your Railway URL
2. Test the `/health` endpoint
3. Proceed to Phase 3: Supabase Integration

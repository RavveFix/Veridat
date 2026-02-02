# Railway Environment Variables Checklist

Gå till Railway Dashboard → Python API Service → Variables

## REQUIRED (måste finnas):

```bash
ENV=production
DEBUG=false
ALLOWED_ORIGINS=https://baweorbvueghhkzlyncu.supabase.co,https://ditt-frontend-domain.com
```

## OPTIONAL (men rekommenderat):

```bash
PYTHON_API_KEY=din-api-nyckel-här
API_HOST=0.0.0.0
API_PORT=8080
```

## Steg för att fixa:

1. Gå till: https://railway.app/project/veridat
2. Klicka på Python API service
3. Gå till "Variables" tab
4. Lägg till/uppdatera:
   - ENV = production
   - DEBUG = false
   - ALLOWED_ORIGINS = https://baweorbvueghhkzlyncu.supabase.co
5. Klicka "Deploy" eller vänta på auto-redeploy
6. Kolla "Logs" för att se om det startar

## Vanliga fel i logs:

❌ "DEBUG=true is not allowed in production"
   → Sätt DEBUG=false

❌ "CORS allows all origins (*) in production"
   → Sätt ALLOWED_ORIGINS till rätt domäner

❌ "localhost origins not allowed in production"
   → Ta bort localhost från ALLOWED_ORIGINS

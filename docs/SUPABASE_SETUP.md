# Supabase Setup Guide for Veridat

Denna guide hjälper dig att sätta upp Supabase Edge Functions för Veridat.

## Steg 1: Installera Supabase CLI

```bash
npm install -g supabase
```

## Steg 2: Skapa Supabase-projekt (om du inte redan har ett)

1. Gå till https://app.supabase.com
2. Skapa ett nytt projekt
3. Anteckna din **Project Reference ID** från Settings → General

## Steg 3: Länka lokalt projekt till Supabase

```bash
cd /Users/ravonstrawder/Desktop/Veridat
supabase login
supabase link --project-ref your-project-ref-here
```

## Steg 4: Sätt AI-secrets (OpenAI eller Gemini)

### OpenAI (rekommenderat)

```bash
supabase secrets set OPENAI_API_KEY=sk-...
supabase secrets set OPENAI_MODEL=gpt-5.2
supabase secrets set LLM_PROVIDER=openai
```

### Gemini (om du vill köra Gemini)

```bash
supabase secrets set GEMINI_API_KEY=your_gemini_api_key_here
supabase secrets set GEMINI_MODEL=gemini-2.5-flash
supabase secrets set LLM_PROVIDER=gemini
```

Mer detaljer: `docs/AI_MODELS.md`

## Steg 5: Deploya Edge Function

```bash
supabase functions deploy gemini-chat
```

Detta kommer att deploya funktionen till:
```
https://your-project-ref.supabase.co/functions/v1/gemini-chat
```

## Steg 6: Uppdatera frontend

Öppna `script.js` och uppdatera `SUPABASE_URL`:

```javascript
// Ändra från:
const SUPABASE_URL = 'http://localhost:54321';

// Till:
const SUPABASE_URL = 'https://your-project-ref.supabase.co';
```

## Lokal testning (valfritt)

För att testa lokalt innan deployment:

```bash
# Starta Supabase lokalt
supabase start

# I ett annat terminalfönster, kör Edge Function
supabase functions serve gemini-chat
```

Funktionen körs på: `http://localhost:54321/functions/v1/gemini-chat`

## Felsökning

### Fel: "Function not found"
- Kontrollera att du har deploayat funktionen: `supabase functions deploy gemini-chat`
- Verifiera URL:en i `script.js`

### Fel: "GEMINI_API_KEY not found"
- Sätt secreten igen: `supabase secrets set GEMINI_API_KEY=your_key`
- Lista alla secrets: `supabase secrets list`

### CORS-fel
- Edge Function har redan CORS konfigurerat
- Kontrollera att du använder rätt URL (inte blanda localhost och production)

## Nästa steg

När allt fungerar kan du:
1. Migrera localStorage-data till Supabase Database
2. Lägga till användarautentisering
3. Spara bokföringshistorik i databasen

# Supabase Setup Guide for Britta

Denna guide hjälper dig att sätta upp Supabase Edge Functions för Britta.

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
cd /Users/ravonstrawder/Desktop/Britta
supabase login
supabase link --project-ref your-project-ref-here
```

## Steg 4: Sätt Gemini API-nyckel

Din Gemini API-nyckel måste sparas som en secret i Supabase:

```bash
supabase secrets set GEMINI_API_KEY=AIzaSyCASS0jo8a_ON-NijIqp8b-fxNCi3wWXx4
```

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

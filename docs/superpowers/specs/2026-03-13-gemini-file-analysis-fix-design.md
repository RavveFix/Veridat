# Fix: Gemini ignorerar bifogade PDF/bilder i chatten

**Datum:** 2026-03-13
**Status:** Godkänd

## Problem

Användaren bifogar en PDF (kvitto) med meddelandet "hur bokför jag kvittot". Gemini ignorerar filen och svarar med leverantörsdata från Fortnox istället.

**Rotorsak:** Koden skickar filen korrekt som `inlineData` till Gemini API. Men `[VERKTYGSREGLER]`-blocket som prepend:as till varje meddelande biasar Gemini starkt mot tool use. Utan en explicit "läs filen först"-instruktion i meddelandekontexten defaultar Gemini till `search_supplier_invoices` när den ser nyckelord som "kvitto" eller "faktura".

## Lösning

### A) Meddelandeaugmentering (edge function)

**Fil:** `supabase/functions/gemini-chat/index.ts`
**Plats:** Mellan `[VERKTYGSREGLER]`-prepend (~rad 3591) och provider switch (~rad 3593)

När `geminiFileData` är satt (PDF eller bild) OCH data inte är tom, prepend:a en fil-prioriteringsinstruktion till `finalMessage`. Eftersom båda blocken använder prepend hamnar den sista prepend:en överst — fil-instruktionen läggs till EFTER VERKTYGSREGLER men hamnar FÖRE i läsordning:

```
Slutlig meddelandeordning:
[BIFOGAD FIL: kvitto.pdf (application/pdf)]    ← prepend #2 (överst)
VIKTIGT: Analysera filinnehållet FÖRST...

[VERKTYGSREGLER]                                 ← prepend #1
Du har tillgång till Fortnox-verktyg...

hur bokför jag kvittot?                          ← original meddelande
```

```typescript
if (geminiFileData && geminiFileData.data && geminiFileData.data.length > 0) {
  const safeFileName = fileName || "okänd fil";
  const safeMime = geminiFileData.mimeType || "unknown";
  logger.info("File attached for Gemini", {
    fileName: safeFileName,
    mimeType: safeMime,
    dataLength: geminiFileData.data.length,
  });
  finalMessage = `[BIFOGAD FIL: ${safeFileName} (${safeMime})]\n` +
    `VIKTIGT: Användaren har bifogat en fil. Analysera filinnehållet FÖRST — ` +
    `extrahera all relevant information (belopp, moms, leverantör, datum) ` +
    `innan du använder Fortnox-verktyg. Basera ditt konteringsförslag på filens innehåll.\n\n` +
    finalMessage;
} else if (geminiFileData) {
  logger.warn("geminiFileData present but data is empty", {
    mimeType: geminiFileData.mimeType,
    fileName: fileName || "unknown",
  });
}
```

**Täcker båda paths:** `finalMessage` modifieras innan streaming/non-streaming branchen, så både `sendMessageStreamToGemini` och `sendMessageToGemini` får den augmenterade texten.

### B) System prompt-förstärkning (GeminiService)

**Fil:** `supabase/services/GeminiService.ts`
**Plats:** `SYSTEM_INSTRUCTION`, punkt 1 "Proaktiv dokumentanalys" (~rad 95)

Ersätt befintlig punkt 1. Behåller den befintliga "föreslå kontering direkt"-direktivet:

**Nuvarande text (rad 95):**
```
1. **Proaktiv dokumentanalys**: När en fil laddas upp, analysera ALLTID och ge ett komplett konteringsförslag via propose_action_plan-verktyget. Vänta inte på att användaren frågar — föreslå kontering direkt.
```

**Ny text:**
```
1. **Proaktiv dokumentanalys**: När en fil (PDF, bild) bifogas meddelandet:
   - LÄSA och ANALYSERA filinnehållet FÖRST — innan du använder några verktyg
   - Identifiera dokumenttyp (kvitto, faktura, kontoutdrag, skattekonto, etc.)
   - Extrahera: leverantör/butik, datum, belopp (inkl. moms), momssats, momsbelopp, beskrivning
   - Föreslå kontering direkt med BAS-konton via propose_action_plan — vänta inte på att användaren frågar
   - Använd ALDRIG search_supplier_invoices eller andra läsverktyg som substitut för att läsa den bifogade filen
   - Om något är otydligt i dokumentet, fråga användaren
```

### C) Diagnostisk loggning

Lägg till loggning på två punkter:

1. **Vid fildata-mottagning** (efter `hasFileAttachment`-tilldelningen, ~rad 1737):
```typescript
if (fileData) {
  logger.info("Received fileData", {
    mimeType: fileData.mimeType,
    dataLength: fileData.data?.length || 0,
  });
}
```

2. **Vid geminiFileData-resolving** (efter fil-routing, ~rad 3601):
```typescript
logger.info("File routing result", {
  hasGeminiFileData: !!geminiFileData,
  mimeType: geminiFileData?.mimeType || "none",
});
```

Loggar INTE filinnehåll — enbart metadata (mimeType, fileName, dataLength).

## Kända begränsningar (ej i scope)

- **Flersidig PDF via fileDataPages:** Nuvarande kod skickar bara `imagePages[0]` (första sidan) till Gemini. Fakturor med totaler på sida 2+ kan missas. Befintligt beteende — ändras ej i denna fix.
- **documentText-path:** När text extraherats client-side skickas den som `DOKUMENTKONTEXT` i `finalMessage` (rad ~3380). Samma bias-problem kan gälla men hanteras separat — `geminiFileData` är null i det fallet.
- **Excel-routing:** Excel-filer (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`) filtreras bort av `isSupportedFile`-kontrollen. Ska egentligen gå till `analyze-excel-ai` men det är en separat feature.

## Vad som INTE ändras

- Frontend filuppladdning (fungerar korrekt — base64-konvertering, Storage-upload, request payload)
- `sendMessageStreamToGemini` / `sendMessageToGemini` i GeminiService (`inlineData`-hantering fungerar)
- Excel-routing (separat problem)
- Supabase Storage / signed URLs

## Berörda filer

| Fil | Ändring |
|-----|---------|
| `supabase/functions/gemini-chat/index.ts` | Meddelandeaugmentering + loggning |
| `supabase/services/GeminiService.ts` | System prompt punkt 1 |

## Verifiering

1. `npm run build` passerar
2. Ladda upp PDF-kvitto + "hur bokför jag kvittot?" → AI refererar till filinnehållet, föreslår kontering
3. Ladda upp bild av kvitto → AI läser texten i bilden
4. Skicka meddelande utan fil → fungerar som innan (regression)
5. Kontrollera edge function-loggar: `Received fileData`, `File routing result`, `File attached for Gemini` syns
6. Testa med tom fil → logger.warn utlöses, inget crash

## Commit-meddelande

```
fix(chat): prioritize attached file analysis over Fortnox tool use

- Prepend file-priority instruction when geminiFileData is present
- Strengthen system prompt document analysis instructions
- Add diagnostic logging for file routing in edge function
- Guard against empty file data
```

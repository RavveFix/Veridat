# AI-modeller & providers (ändra enkelt senare)

Den här appen pratar med AI via Supabase Edge Functions. Frontend anropar bara en endpoint (`gemini-chat`), så du kan byta modell/provider i backend utan att behöva röra UI-flödet.

## Var i koden sitter AI:n?

- Chat: `supabase/functions/gemini-chat/index.ts`
- OpenAI-klient: `supabase/services/OpenAIService.ts`
- Gemini-klient: `supabase/services/GeminiService.ts`
- PDF-prepp (text + ev. sidbilder): `apps/web/src/services/FileService.ts` (`extractPdfForChat`)
- Excel (deterministisk matematik): `supabase/functions/analyze-excel-ai/index.ts`
- Frontend-anropet till chat: `apps/web/src/services/ChatService.ts`

## Kör OpenAI (GPT‑5.2)

Sätt secrets i Supabase:

```bash
supabase secrets set OPENAI_API_KEY=sk-...
supabase secrets set OPENAI_MODEL=gpt-5.2
supabase secrets set LLM_PROVIDER=openai
```

Obs:
- GPT‑5-modeller kräver `max_completion_tokens` (inte `max_tokens`) i Chat Completions. Detta är redan hanterat i backend.
- PDF skickas som extraherad text + ev. sidbilder (för scannade PDFs). Ingen “tyst” fallback till annan provider.
- `analyze-excel-ai` räknar alltid deterministiskt (öre) och använder OpenAI bara för kolumnmappning om heuristiken inte räcker.

## Kör Gemini (om du vill)

```bash
supabase secrets set GEMINI_API_KEY=your_gemini_api_key_here
supabase secrets set GEMINI_MODEL=gemini-2.5-flash
supabase secrets set LLM_PROVIDER=gemini
```

## Deploy

Efter kodändringar:

```bash
supabase functions deploy gemini-chat analyze-excel-ai python-proxy
```

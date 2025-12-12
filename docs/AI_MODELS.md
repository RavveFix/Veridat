# AI-modeller & providers (ändra enkelt senare)

Den här appen pratar med AI via Supabase Edge Functions. Frontend anropar bara en endpoint (`gemini-chat`), så du kan byta modell/provider i backend utan att behöva röra UI-flödet.

## Var i koden sitter AI:n?

- Chat: `supabase/functions/gemini-chat/index.ts`
- Gemini-klient: `supabase/services/GeminiService.ts`
- Excel fallback (Claude): `supabase/functions/analyze-excel-ai/index.ts` och `supabase/functions/claude-analyze/index.ts`
- Frontend-anropet till chat: `src/services/ChatService.ts`

## Snabbt: byt Gemini-modell (utan kod)

Gemini-modellen läses från env/secrets:

- `GEMINI_MODEL` (default: `gemini-2.5-flash`)

Sätt/ändra med Supabase CLI:

```bash
supabase secrets set GEMINI_MODEL=gemini-2.5-pro
```

## Snabbt: byt Claude/Anthropic-modell (Excel-fallback)

Claude-modellen kan styras via:

- `CLAUDE_MODEL` eller `ANTHROPIC_MODEL` (default: `claude-sonnet-4-20250514`)

Exempel:

```bash
supabase secrets set CLAUDE_MODEL=claude-sonnet-4-20250514
```

## Byta till ChatGPT/OpenAI senare (rekommenderat upplägg)

Idag är `gemini-chat` kopplad till Gemini. För att enkelt kunna ha flera providers framåt, gör så här:

1. Skapa en gemensam “provider”-interface (t.ex. `sendMessage({ message, history, fileData, tools })`).
2. Implementera en adapter per provider:
   - `GeminiProvider` (befintlig logik från `GeminiService.ts`)
   - `OpenAIProvider` (ny) med `OPENAI_API_KEY` + `OPENAI_MODEL`
   - (ev. Anthropic för chat)
3. I `supabase/functions/gemini-chat/index.ts` väljer du provider via env:
   - `LLM_PROVIDER=gemini|openai|anthropic`
4. Logga/spara `provider` + `model` på varje AI-svar (bra för debugging, kostnad, QA).

Minimal “toggle” du vill åt:

- Ändra bara env: `LLM_PROVIDER` + `*_MODEL`, utan att ändra frontend.

## Deploy

Efter kodändringar i Edge Functions:

```bash
supabase functions deploy gemini-chat analyze-excel-ai python-proxy
```


# Dual-Model Routing: Flash-Lite + Flash + Pro

## Context

Veridat använder idag `gemini-3-flash-preview` för alla free-plan-chattar (både vanlig chatt och agent mode). Agent mode har ~20% failure rate på tool calls. Gemini 3-modeller har strict function calling validation som borde minska detta avsevärt.

Genom att använda Flash-Lite för enkel chatt och Flash för agent mode får vi:
- **Lägre kostnad/latens** för vanliga frågor (Flash-Lite)
- **Bättre tool calling** i agent mode (Flash med strict validation)
- **Framtidssäkring** — backend äger modell-routing, inga frontend-deploys vid modellbyten

## Modell-mapping

| UI-knapp | Vanlig chatt | Agent mode |
|----------|-------------|------------|
| **Standard** | `gemini-3-flash-lite-preview` | `gemini-3-flash-preview` |
| **Pro** | `gemini-3.1-pro-preview` | `gemini-3.1-pro-preview` |

## Arkitektur

### Frontend → Backend kontraktsändring

**Före:** Frontend skickar exakt modell-ID (`"gemini-3-flash-preview"`)
**Efter:** Frontend skickar abstrakt tier (`"standard"` | `"pro"`)

Backend resolvar till rätt modell-ID baserat på:
1. `model` tier ("standard" / "pro")
2. `assistantMode` (null / "agent" / "skill_assist")
3. User plan (free → kan inte välja pro)

### Filer som ändras

| Fil | Ändring |
|-----|---------|
| `apps/web/src/services/ModelService.ts` | `apiModel` → `"standard"` / `"pro"`. Uppdatera displayNames. |
| `apps/web/app/index.html` | Label "Flash" → "Standard", beskrivning uppdateras |
| `supabase/functions/gemini-chat/index.ts` | Ny `resolveModel(tier, assistantMode, plan)` funktion |
| `supabase/services/GeminiService.ts` | Ingen ändring — tar emot resolved modell-ID som idag |
| `supabase/services/AIRouter.ts` | Uppdatera `GEMINI_MODELS` mapping |

### Ny resolveModel-funktion (edge function)

```typescript
const MODEL_MAP = {
  standard: {
    chat: 'gemini-3-flash-lite-preview',
    agent: 'gemini-3-flash-preview',
  },
  pro: {
    chat: 'gemini-3.1-pro-preview',
    agent: 'gemini-3.1-pro-preview',
  },
} as const;

function resolveModel(
  tier: 'standard' | 'pro',
  assistantMode: 'agent' | 'skill_assist' | null,
  plan: string
): string {
  // Free users can't use pro
  const effectiveTier = (tier === 'pro' && plan !== 'pro') ? 'standard' : tier;
  const mode = assistantMode === 'agent' ? 'agent' : 'chat';
  return MODEL_MAP[effectiveTier][mode];
}
```

## UI-ändringar

### Modell-dropdown (index.html)
- "Gemini 3 Flash" → "Standard" med beskrivning: "Smart routing — optimerad för varje uppgift"
- "Gemini 3 Pro" behålls med PRO-badge

### ModelService.ts
```typescript
const MODELS: Record<ModelType, ModelInfo> = {
  flash: {  // behåll 'flash' som intern key för bakåtkompatibilitet med localStorage
    id: 'flash',
    name: 'Standard',
    displayName: 'Standard',
    apiModel: 'standard',  // abstrakt tier, inte modell-ID
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    displayName: 'Gemini 3.1 Pro',
    apiModel: 'pro',
  },
};
```

## Bakåtkompatibilitet

- localStorage-key `veridat_selected_model` behålls (`"flash"` / `"pro"`)
- Backend hanterar gamla exakta modell-IDs som fallback under övergångsperiod:
  - `"gemini-3-flash-preview"` → behandlas som `"standard"`
  - `"gemini-3.1-pro-preview"` → behandlas som `"pro"`

## Verifiering

1. **Vanlig chatt med Standard:** Kontrollera i edge function-loggar att `gemini-3-flash-lite-preview` används
2. **Agent mode med Standard:** Kontrollera att `gemini-3-flash-preview` används + tool calls fungerar
3. **Pro-knappen:** Free user → fallback till Standard. Pro user → `gemini-3.1-pro-preview`
4. **Bakåtkompatibilitet:** Testa med `veridat_selected_model: "flash"` i localStorage
5. **skill_assist mode:** Ska använda chat-modellen (Flash-Lite/Pro), inte agent-modellen

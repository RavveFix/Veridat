# Design: 3 buggar + 7 UI-förbättringar

**Datum:** 2026-03-04

## Kontext

Användaren har identifierat 3 kritiska buggar och 7 förbättringsförslag. Buggarna påverkar grundläggande UX: meddelanden försvinner vid fel, engelska blandas in i svensk app, och placeholder tappar synlighet vid navigation.

---

## Bugg 1: Felhantering vid misslyckad sändning

**Problem:** `ChatController.ts` catch-block (rad ~823) anropar `resetToWelcomeState()` — meddelandet försvinner tyst.

**Lösning:**
- Ta bort `resetToWelcomeState()` och `restoreButton()` från catch-blocket
- Behåll användarens meddelande i chatten
- Visa röd felbubbla under meddelandet med "Försök igen"-knapp
- Retry dispatchar befintligt `chat-retry` event

**Filer:** `ChatController.ts`, `ChatHistory.tsx`, `main.css`

## Bugg 2: Engelska text → Svenska

**Problem:** `index.html:201-203` har "Data Assistant" / "Designed to help manage sales..."

**Lösning:**
- `"Data Assistant"` → `"Excel-assistent"`
- `"Designed to help manage sales..."` → `"Analysera försäljning, kostnader och moms"`

**Fil:** `index.html`

## Bugg 3: Placeholder försvinner vid navigation

**Problem:** Animerad placeholder (`TextAnimate`) tappar synlighet vid konversationsbyte. `updateInputForConversationLoading()` visar inte placeholder korrekt efter laddning.

**Lösning:**
- Lägg till explicit `togglePlaceholder(true)` efter att `conversationLoading` sätts till false
- Säkerställ att `userInput.placeholder` rensas korrekt

**Fil:** `ChatController.ts`

---

## Förbättring 1: Auto-titlar i sidebar

- Vid första meddelandet: `title = message.slice(0, 40) + "..."`
- AI-förbättrad titel genereras asynkront efter AI-svar
- Ny metod `updateTitle()` i ConversationController

## Förbättring 2: Suggestion-kort — "Populär" badge

- `<span class="popular-badge">Populär</span>` på primär-kortet
- Gradient badge styling

## Förbättring 3: Agent-mode micro-toast

- Visa inline toast vid toggle: "Agent-läge aktiverat/avaktiverat"
- Använd befintligt `.toast-inline` mönster, 2s auto-dismiss

## Förbättring 4: PRO-badge — Crown för betalande

- `.model-option:not(.locked) .pro-badge::before { content: "👑 " }`
- Behåll 🔒 för free-users

## Förbättring 5: Minne-badge puls — SKIP

Redan implementerat med `memory-badge-pulse` animation.

## Förbättring 6: Welcome-state vertikal centrering

- `.welcome-hero`: `min-height: calc(100vh - 200px)` + `justify-content: center`

## Förbättring 7: Input border-radius 100px → 12px

- `.floating-form { border-radius: 12px }`
- `.send-btn-round { border-radius: 8px }`

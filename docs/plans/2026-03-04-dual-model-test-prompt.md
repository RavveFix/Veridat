# Testprompt: Dual-Model Routing Verifiering

Kopiera detta till Claude i webbläsaren (på Veridat-appen) för att testa.

---

## Prompt att ge Claude-extensionen:

```
Jag vill att du testar att vår nya modell-routing fungerar korrekt i Veridat. Gå till appen på localhost:5173 (eller produktions-URL) och gör följande tester steg för steg:

### Test 1: UI — Modell-dropdown
1. Logga in i appen
2. Klicka på modellväljaren (kugghjulsikonen vid chattfältet)
3. Verifiera att det finns två alternativ:
   - **"Standard"** med beskrivning "Smart routing — optimerad för varje uppgift"
   - **"Gemini 3.1 Pro"** med PRO-badge
4. Verifiera att "Standard" är förvalt (aktiv med checkmark)
5. Screenshot och bekräfta

### Test 2: Standard — Vanlig chatt
1. Välj "Standard" i dropdown
2. Öppna DevTools → Network-tabben
3. Skriv ett enkelt meddelande: "Vad är moms?"
4. Kolla request payload i Network-tabben → POST till gemini-chat
5. Verifiera att `model`-fältet i request body är `"standard"` (INTE ett modell-ID som "gemini-3-flash-preview")
6. Verifiera att du får ett svar tillbaka
7. Screenshot av Network payload

### Test 3: Standard — Agent mode
1. Välj "Standard" i dropdown
2. Skriv ett meddelande som triggar agent mode, t.ex.: "Skapa en kundfaktura till Testföretag AB för konsulttjänster, 10 000 kr"
3. Kolla request payload i Network-tabben
4. Verifiera att `model` = `"standard"` och `assistantMode` = `"agent"`
5. Verifiera att ActionPlanCard visas (agent-svaret kommer som ett förslag)
6. Screenshot

### Test 4: Pro-knappen (free user)
1. Klicka på "Gemini 3.1 Pro" i dropdown
2. Verifiera att en upgrade-modal visas (du behöver pro-plan)
3. Modellen ska INTE byta till Pro
4. Screenshot

### Test 5: localStorage-kompatibilitet
1. Öppna DevTools → Application → Local Storage
2. Kolla att nyckeln `veridat_selected_model` finns och har värdet `"flash"`
3. Verifiera att detta fortfarande fungerar (Standard ska vara vald)

### Test 6: Svar-kvalitet
1. Ställ en vanlig bokföringsfråga: "Hur bokför jag en kontorsmöbel för 5000 kr?"
2. Verifiera att svaret är relevant och på svenska
3. Testa en agent-fråga: "Skapa faktura till Kund AB, 3 timmar konsulttjänster à 800 kr"
4. Verifiera att action plan visas med rätt belopp

---

Rapportera resultat för varje test med PASS/FAIL och eventuella screenshots.
```

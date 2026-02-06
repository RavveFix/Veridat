# Personuppgiftsbiträdesavtal (DPA)

**Senast uppdaterad:** 2026-02-05

Detta personuppgiftsbiträdesavtal ("DPA") reglerar behandling av personuppgifter som Fixverse AB ("Biträdet") utför för kund ("Personuppgiftsansvarig") i samband med tjänsten Veridat AI.

## 1. Parter
**Personuppgiftsansvarig (Kund)**
- Namn: [[KUNDENS NAMN]]
- Org.nr: [[ORG.NR]]
- Adress: [[ADRESS]]
- Kontakt: [[E-POST / TELEFON]]

**Personuppgiftsbiträde**
- Fixverse AB (driver tjänsten "Veridat AI")
- Org.nr: 559461-3589
- Dialoggatan 12 b, 703 74 Örebro
- Kontakt: privacy@veridat.se

## 2. Bakgrund och syfte
Kunden använder Veridat AI för bokföring, analys och administration. Biträdet behandlar personuppgifter för att tillhandahålla tjänsten enligt Kundens instruktioner och gällande GDPR. AI‑analys sker i nuläget via Google Gemini‑modeller. OpenAI kan komma att användas som alternativ efter kundinformation och uppdatering av underbiträdeslistan.

## 3. Definitioner
Termer som "personuppgiftsansvarig", "personuppgiftsbiträde", "personuppgifter" och "behandling" har den betydelse som anges i GDPR.

## 4. Föremål, varaktighet och art
Behandlingen omfattar de personuppgifter som krävs för att tillhandahålla och förbättra Veridat AI under avtalstiden. Behandlingens art och ändamål framgår av Bilaga 1.

## 5. Biträdets åtaganden
Biträdet ska:
1. Endast behandla personuppgifter enligt dokumenterade instruktioner från Kunden.
2. Säkerställa att personer som behandlar personuppgifter omfattas av sekretess.
3. Vidta lämpliga tekniska och organisatoriska åtgärder enligt Bilaga 2.
4. Underrätta Kunden utan onödigt dröjsmål och senast inom **72 timmar** efter att ha blivit medveten om en personuppgiftsincident, i enlighet med punkt 9.
5. Bistå Kunden vid:
   - begäran om registrerades rättigheter (Art. 15–22),
   - konsekvensbedömningar (DPIA) och samråd med tillsynsmyndighet (Art. 35–36),
   - säkerhetsåtgärder och incidentutredningar (Art. 32–34).
6. Hålla register över behandlingar enligt Art. 30.
7. Radera eller återlämna personuppgifter vid avtalets upphörande enligt punkt 12.
8. Säkerställa att underbiträden uppfyller motsvarande skyldigheter (punkt 8).

## 6. Kundens åtaganden
Kunden ansvarar för att:
- behandlingen har giltig rättslig grund,
- registrerade informeras i enlighet med GDPR,
- lämpliga instruktioner ges till Biträdet.

## 7. Underbiträden
Biträdet har generell skriftlig auktorisation att anlita underbiträden. Aktuella underbiträden listas i Bilaga 3.

Biträdet ska informera Kunden om väsentliga förändringar av underbiträden. Kunden har rätt att invända inom 30 dagar efter meddelande.

## 8. Överföring till tredjeland
Om personuppgifter överförs utanför EES ska Biträdet säkerställa en giltig överföringsmekanism, t.ex. EU:s standardavtalsklausuler (SCC 2021/914). Detaljer framgår av Bilaga 4.

## 9. Personuppgiftsincident
Biträdet ska utan onödigt dröjsmål och senast inom **72 timmar** rapportera incidenten till Kunden. Rapporten ska om möjligt innehålla:
- incidentens art och omfattning,
- berörda kategorier av personuppgifter och registrerade,
- sannolika konsekvenser,
- vidtagna eller planerade åtgärder.

## 10. Revision och tillsyn
Kunden har rätt att genomföra revision av Biträdet, högst en gång per år, med skälig förvarning. Revision kan ske genom dokumentgranskning om parterna enas.

## 11. Ansvar
Ansvar och ansvarsbegränsningar regleras i huvudavtalet mellan parterna.

## 12. Radering och återlämning
Vid avtalets upphörande ska Biträdet, enligt Kundens val, radera eller återlämna personuppgifter, om inte lag kräver fortsatt lagring.

## 13. Tillämplig lag
Avtalet regleras av svensk lag. Tvister avgörs av svensk allmän domstol.

## 14. Signaturer
**Kunden (Personuppgiftsansvarig)**

Namn: ________________________________

Datum: ________________________________

**Fixverse AB (Personuppgiftsbiträde)**

Namn: ________________________________

Datum: ________________________________

---

# Bilaga 1 – Behandlingsbeskrivning

**Ändamål**
- Tillhandahålla Veridat AI, inklusive kontohantering, AI‑baserad analys, bokföringsstöd och Fortnox‑integration.

**Kategorier av registrerade**
- Kundens anställda/användare.
- Kundens kunder/leverantörer (i bokföringsdata).

**Kategorier av personuppgifter**
- Identitets- och kontaktuppgifter (namn, e‑post, telefon).
- Företagsuppgifter (org.nr, adress, kontaktpersoner).
- Bokförings- och transaktionsdata (fakturor, verifikationer, journalposter).
- Chatthistorik och uppladdade dokument.
- Loggar och metadata (IP‑adress, user‑agent, åtkomstloggar).
- API‑ och integrationsuppgifter (t.ex. Fortnox‑token, synkloggar).

**Lagringstid (utgångspunkt)**
- Kontoinformation: aktivt konto + 12 månader.
- Chatthistorik: upp till 24 månader (eller tills användaren raderar).
- Uppladdade dokument: upp till 12 månader efter senaste åtkomst.
- Tekniska loggar: upp till 90 dagar.
- Bokföringsrelaterade loggar/audit: upp till 7 år (BFL 7:1).

---

# Bilaga 2 – Tekniska och organisatoriska åtgärder (TOMs)
Följande åtgärder tillämpas som utgångspunkt:
- Åtkomstkontroll: principen om minsta behörighet och rollbaserad åtkomst.
- Autentisering: MFA där det är möjligt och krävs för administrativ åtkomst.
- Kryptering: data i transit skyddas med TLS; känsliga hemligheter hanteras via miljövariabler/hemlighetshantering.
- Loggning och spårbarhet: applikationsloggar och leverantörsloggar (t.ex. Supabase) för säkerhet och bokföring (audit trail).
- Säkerhetskopiering och återställning: regelbundna backuper och test av återställning.
- Incidenthantering: process för identifiering, åtgärd och rapportering.
- Sårbarhetshantering: regelbundna uppdateringar av beroenden och granskning av sårbarheter.

---

# Bilaga 3 – Underbiträden
| Underbiträde | Tjänst | Plats | Behandlingsändamål | Data kategorier |
| --- | --- | --- | --- | --- |
| Supabase (AWS) | Databas och lagring | EU (eu‑west‑1) | Drift av tjänsten | Kontodata, filer, loggar |
| Google (Gemini API) | AI‑analys | EES + ev. tredjeland | AI‑behandling | Chat, dokument, metadata |
| Fortnox | Bokföringsintegration | Sverige/EU | Synk av bokföringsdata | Kunder, leverantörer, fakturor |
| OpenAI (valfritt, ej aktivt i prod) | AI‑analys | Tredjeland | AI‑behandling | Chat, dokument, metadata |

---

# Bilaga 4 – Överföringsmekanismer
Vid överföring till tredjeland tillämpas EU:s standardavtalsklausuler (SCC 2021/914). Relevant modul används beroende på rollförhållande mellan parterna och underbiträdet.

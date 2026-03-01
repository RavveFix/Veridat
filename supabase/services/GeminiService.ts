// Deno-compatible Gemini Service for Supabase Edge Functions
// Using @google/generative-ai package compatible with Deno
/// <reference path="../functions/types/deno.d.ts" />

import { createLogger } from "./LoggerService.ts";

import { GoogleGenerativeAI, SchemaType, type Tool } from "npm:@google/generative-ai@0.21.0";

const logger = createLogger("gemini");

/**
 * Rate limit error information extracted from Google API errors
 */
export interface GoogleRateLimitError {
    isRateLimit: boolean;
    retryAfter: number | null;  // seconds
    message: string;
}

/**
 * Custom error class for Google API rate limits
 */
export class GeminiRateLimitError extends Error {
    public readonly retryAfter: number | null;
    public readonly isRateLimit = true;

    constructor(message: string, retryAfter: number | null = null) {
        super(message);
        this.name = 'GeminiRateLimitError';
        this.retryAfter = retryAfter;
    }
}

/**
 * Extract rate limit information from Google API errors
 * Google errors look like: [GoogleGenerativeAI Error]: Error fetching from ... : [429 Too Many Requests]
 * May include retryDelay in the error details
 */
export function extractGoogleRateLimitInfo(error: unknown): GoogleRateLimitError {
    const result: GoogleRateLimitError = {
        isRateLimit: false,
        retryAfter: null,
        message: 'Unknown error'
    };

    if (error instanceof Error) {
        result.message = error.message;

        // Check for 429 status code in error message
        const is429 = /\[429\s*(Too Many Requests)?\]/i.test(error.message) ||
                      /Resource.*exhausted/i.test(error.message) ||
                      /rate.*limit/i.test(error.message) ||
                      /quota.*exceeded/i.test(error.message);

        if (is429) {
            result.isRateLimit = true;

            // Try to extract retry delay from error message
            // Format: retryDelay: "30s" or "30000ms" or similar
            const retryMatch = error.message.match(/retry.*?(\d+)\s*(s|ms|seconds?|milliseconds?)?/i);
            if (retryMatch) {
                const value = parseInt(retryMatch[1], 10);
                const unit = retryMatch[2]?.toLowerCase() || 's';
                result.retryAfter = unit.startsWith('ms') ? Math.ceil(value / 1000) : value;
            } else {
                // Default retry after 30 seconds if not specified
                result.retryAfter = 30;
            }

            result.message = 'Google API rate limit exceeded. Försök igen om en stund.';
        }
    } else if (typeof error === 'string') {
        result.message = error;
        if (/429|rate.*limit|quota.*exceeded/i.test(error)) {
            result.isRateLimit = true;
            result.retryAfter = 30;
            result.message = 'Google API rate limit exceeded. Försök igen om en stund.';
        }
    }

    return result;
}

export const SYSTEM_INSTRUCTION = `Du är Veridat, en autonom AI-agent och expert på svensk bokföring.
Du hjälper användaren att hantera bokföring och fakturering i Fortnox via API.
Du kan läsa och analysera uppladdade dokument (PDF, bilder) som fakturor, kvitton och skattekonton.

## Din roll:
1. **Analysera**: Förstå vad användaren vill göra (t.ex. skapa faktura, kolla kunder, analysera skattekonto).
2. **Agera**: Använd tillgängliga verktyg (tools) för att hämta data eller utföra åtgärder i Fortnox.
3. **Svara**: Ge ett tydligt och trevligt svar på svenska baserat på resultatet.

## Autonomt agentbeteende:

1. **Proaktiv dokumentanalys**: När en fil laddas upp, analysera ALLTID och ge ett komplett konteringsförslag via propose_action_plan-verktyget. Vänta inte på att användaren frågar — föreslå kontering direkt.

2. **Godkännande före åtgärd**: Använd ALLTID propose_action_plan istället för att direkt anropa create_supplier_invoice, create_invoice, export_journal_to_fortnox eller book_supplier_invoice. Visa förslaget med konteringstabell och vänta på användarens godkännande.

3. **Mönsteranvändning**: Referera till inlärda mönster proaktivt. Exempel: "Baserat på 7 tidigare transaktioner bokför ni alltid Telia på konto 6212 — stämmer det?" Om du inte har mönster, fråga användaren om rätt konto.

4. **Kedjade operationer**: Efter varje slutförd åtgärd, föreslå nästa logiska steg:
   - Skapad leverantörsfaktura → "Vill du att jag bokför den?"
   - Bokförd faktura → "Vill du registrera betalningen?"
   - Uppladdad fil → fullständig analys + konteringsförslag

5. **Konteringstabell**: Visa ALLTID en debet/kredit-tabell i propose_action_plan med posting_rows:
   - BAS-kontonummer + kontonamn
   - Belopp med 2 decimaler
   - Momssats och momsbelopp separat
   - Kommentar per rad

6. **Fortnox-data proaktivt**: Hämta data från Fortnox (get_suppliers, get_vouchers etc.) för att berika förslag. Kontrollera t.ex. om leverantören redan finns innan du föreslår att skapa en ny.

7. **Faktura-bokföring**: När användaren nämner en faktura (t.ex. "faktura 24"), hämta ALLTID fakturan med get_invoice eller get_supplier_invoice först. Analysera belopp, moms, och kundinfo. Föreslå sedan bokföring via propose_action_plan med korrekt debet/kredit.

## VIKTIGT — Intern process:
Visa ALDRIG din interna tankeprocess, verktygsval eller exekveringsplan för användaren.
Skriv ALDRIG saker som "Wait, I have a tool...", "Let's use...", "Execution:", "Let me search..." eller liknande.
Kör verktyg tyst i bakgrunden och presentera bara det slutliga resultatet på svenska.
Svara alltid på svenska — aldrig på engelska.

## Minne och kontext:
Du har tillgång till användarens tidigare konversationer. Använd proaktivt:
- **conversation_search**: När användaren refererar till något ni pratat om förut, eller när tidigare kontext kan vara relevant
- **recent_chats**: När du behöver överblick av senaste konversationer

Var proaktiv - sök i historiken om du misstänker att relevant information finns där.
Nämn aldrig att du "söker" eller "letar" - presentera informationen naturligt.

## Personlig assistent:
Du lär känna varje företag över tid. När du har kontext om företaget:
- Bekräfta din förståelse: "Jag vet att ni är ett konsultbolag — vill ni att jag bokför detta som 6580?"
- Föreslå baserat på mönster: "Förra gången bokförde vi Telia på 6212 — ska vi göra likadant?"
- Var ödmjuk: om du är osäker, fråga. Säg aldrig "jag minns" utan "baserat på tidigare konversationer".
- När du använder information från minnet, bekräfta gärna kort att du har rätt förståelse.

## Verktyg (Tools):
- **conversation_search**: Söker i användarens tidigare konversationer. Använd när något verkar referera till tidigare diskussioner.
- **recent_chats**: Hämtar de senaste konversationerna för att få överblick.
- **web_search**: Söker upp uppdaterad, officiell information om svensk redovisning (t.ex. Skatteverket, Bokföringsnämnden, BAS, FAR, Riksdagen). Använd när frågan är tidskänslig eller regelstyrd. Redovisa alltid källa och datum i svaret.
- **create_invoice**: Skapar ett fakturautkast i Fortnox. Kräver kundnummer och artiklar.
- **get_customers**: Hämtar en lista på kunder från Fortnox. Returnerar namn och kundnummer.
- **get_articles**: Hämtar en lista på artiklar från Fortnox. Returnerar beskrivning, artikelnummer och pris.
- **get_suppliers**: Hämtar en lista på leverantörer från Fortnox. Returnerar namn och leverantörsnummer.
- **get_vouchers**: Hämtar verifikationer från Fortnox. Kan filtreras per räkenskapsår och serie.
- **get_invoice**: Hämtar en specifik kundfaktura från Fortnox med fakturanummer. Returnerar kund, belopp, moms, status.
- **get_supplier_invoice**: Hämtar en specifik leverantörsfaktura från Fortnox med löpnummer. Returnerar leverantör, belopp, moms, status.
- **create_supplier**: Skapar en ny leverantör i Fortnox med namn, organisationsnummer och kontaktuppgifter.
- **create_supplier_invoice**: Skapar en leverantörsfaktura i Fortnox med kontering och momsbehandling.
- **export_journal_to_fortnox**: Exporterar ett lokalt verifikat till Fortnox som en verifikation.
- **book_supplier_invoice**: Bokför en befintlig leverantörsfaktura i Fortnox.
- **propose_action_plan**: Skapar en handlingsplan med konteringsförslag som visas för användaren med debet/kredit-tabell. Användaren kan godkänna, ändra eller avbryta planen. Använd ALLTID detta istället för att direkt skapa fakturor eller verifikat.
- **register_payment**: Registrerar en betalning för en kund- eller leverantörsfaktura i Fortnox.

## Arbetsflöde för Fakturering:
1. Om användaren vill skapa en faktura men inte anger kundnummer eller artikelnummer:
   - Använd **get_customers** och **get_articles** för att hitta rätt information.
   - Fråga användaren om det är otydligt vilken kund eller artikel som avses.
2. När du har all information (Kundnr, Artikelnr, Antal):
   - Anropa **create_invoice** med korrekt data.
3. Bekräfta för användaren att fakturautkastet är skapat.

## Arbetsflöde för Leverantörsfakturor:
1. Om användaren nämner en leverantörsfaktura eller kostnad från en leverantör:
   - Använd **get_suppliers** för att kontrollera om leverantören redan finns.
   - Om leverantören inte finns, fråga om du ska skapa den med **create_supplier**.
2. När du har leverantörsnummer, fakturadetaljer (belopp, datum, moms):
   - Anropa **create_supplier_invoice** med korrekt data och kontering.
3. Bekräfta för användaren med sammanfattning av bokföring och belopp.

## Arbetsflöde för Fortnox-export:
1. När användaren vill exportera ett verifikat till Fortnox:
   - Använd **export_journal_to_fortnox** med verifikat-ID:t.
2. Bekräfta exportstatus och verifikatnummer i Fortnox.

## Webbsök (uppdaterad information):
Använd **web_search** när frågan gäller lagar, regler, datum, gränsvärden eller annan tidskänslig information inom svensk redovisning.
Redovisa alltid källa och datum i svaret. Om inga tillförlitliga källor hittas, säg det tydligt.

## Datahantering:
- När du får data från **get_customers**, notera särskilt "CustomerNumber" och "Name".
- När du får data från **get_articles**, notera "ArticleNumber", "Description" och "SalesPrice".
- Använd dessa exakta värden när du anropar **create_invoice**.

## 📄 Skattekonto-analys (PDF):
När användaren laddar upp ett dokument från Skatteverket (skattekonto som PDF eller ger information om sitt skattekonto):

### Extrahera och analysera:
1. **Nyckeldata att identifiera:**
   - Organisationsnummer
   - Aktuellt saldo (positivt = tillgodo, negativt = skuld)
   - Kommande förfallodatum för betalningar
   - Senaste transaktioner (inbetalningar och debiteringar)
   - Typ av skatter (moms, arbetsgivaravgifter, F-skatt, etc.)
   - Eventuella restföranden eller påminnelseavgifter

2. **Ge proaktiva råd:**
   - Påminn om nästa förfallodag och hur många dagar som återstår
   - Varna om restföranden eller påminnelseavgifter
   - Föreslå att sätta upp betalning om förfallodagen är nära
   - Förklara vad olika skatteposter innebär om användaren undrar

3. **Bokföringsförslag för skattebetalningar (via skattekonto 1630):**
   När användaren ska betala skatt eller när Skatteverket drar/återbetalar:
   
   **När du betalar in till skattekontot:**
   - Debet: 1630 (Skattekonto)
   - Kredit: 1930 (Företagskonto/checkräkningskonto)
   
   **När Skatteverket drar moms:**
   - Debet: 2650 (Redovisningskonto för moms)
   - Kredit: 1630 (Skattekonto)
   
   **När Skatteverket drar arbetsgivaravgifter:**
   - Debet: 2730/2731 (Sociala avgifter)
   - Kredit: 1630 (Skattekonto)
   
   **När Skatteverket drar personalskatt:**
   - Debet: 2710 (Personalskatt)
   - Kredit: 1630 (Skattekonto)
   
   **När Skatteverket drar F-skatt/preliminärskatt:**
   - Debet: 2510 (Skatteskuld)
   - Kredit: 1630 (Skattekonto)
   
   **Vid återbetalning från skattekontot:**
   - Debet: 1930 (Företagskonto)
   - Kredit: 1630 (Skattekonto)

4. **Presentationsformat:**
   Ge alltid ett strukturerat svar med:
   - 📊 Tydlig sammanfattning av läget
   - ⚠️ Varningar om viktiga datum
   - 💡 Konkreta bokföringsförslag med verifikationsmall
   - ✅ Nästa steg för användaren

## 📄 Leverantörsfaktura-analys (PDF/Bild):
När användaren laddar upp en leverantörsfaktura (faktura från en leverantör som företaget ska betala):

### Du KAN och SKA läsa och analysera den uppladdade filen:
1. **Extrahera all nyckeldata från fakturan:**
   - Leverantörens namn och organisationsnummer
   - Fakturanummer och fakturadatum
   - Förfallodatum (viktigt för betalning)
   - Totalt belopp att betala (inklusive moms)
   - Nettobelopp (exklusive moms)
   - Momsbelopp och momssats (vanligtvis 25%, 12%, 6% eller 0%)
   - Betalningsuppgifter (bankgiro, plusgiro, IBAN)
   - Fakturarader med artiklar/tjänster, antal, à-pris
   - Eventuell betalningsreferens/OCR-nummer

2. **Analysera och kategorisera inköpet:**
   Identifiera typ av kostnad och föreslå rätt BAS-konto (exempel - kontrollera er kontoplan):

   **Komplett BAS-kontolista (BAS 2024) — VÄLJ ALLTID FRÅN DENNA LISTA:**

   **Tillgångar (1xxx — köp av anläggningstillgångar):**
   - 1110 Byggnader | 1150 Markanläggningar
   - 1210 Maskiner/inventarier | 1220 Inventarier och verktyg
   - 1230 Installationer | 1240 Bilar/transportmedel
   - 1260 Leasade tillgångar (K3) | 1280 Pågående nyanläggningar
   - 1310 Andelar i koncernföretag | 1320 Fordringar koncernföretag
   - 1460 Skattefordringar | 1630 Skattekonto
   - 1710 Förutbetalda hyror | 1790 Övriga förutbetalda kostnader

   **Eget kapital & skulder (2xxx):**
   - 2081 Aktiekapital | 2091 Balanserad vinst/förlust
   - 2098 Vinst/förlust föregående år | 2099 Årets resultat
   - 2220 Checkräkningskredit | 2350 Övriga långfristiga skulder
   - 2510 Skatteskulder | 2920 Upplupna semesterlöner
   - 2940 Upplupna sociala avgifter | 2990 Övriga upplupna kostnader

   **Varuinköp (4xxx):**
   - 4010 Varuinköp (varor för återförsäljning)
   - 4515 Inköp varor EU | 4516 Inköp varor utanför EU
   - 4531 Import av tjänster (omvänd skattskyldighet)
   - 4400 Material/tillbehör
   - 4600 Legoarbeten (underentreprenader)

   **Lokalkostnader (5xxx):**
   - 5010 Lokalhyra
   - 5020 El | 5030 Värme | 5040 Vatten
   - 5060 Städning och renhållning
   - 5070 Reparation och underhåll
   - 5400 Förbrukningsinventarier (under halvårsgräns)
   - 5460 Förbrukningsmaterial

   **Fordon & resor (5xxx):**
   - 5611 Drivmedel (bensin, diesel, el-laddning)
   - 5615 Leasing personbilar
   - 5800 Resekostnader (generellt)
   - 5810 Biljetter (flyg, tåg, taxi)
   - 5820 Hotell och logi
   - 5831 Traktamenten inrikes | 5832 Traktamenten utrikes

   **Marknadsföring (5xxx):**
   - 5910 Annonsering, digital marknadsföring
   - 5930 Reklamtrycksaker

   **Representation:**
   - 6071 Representation, avdragsgill
   - 6072 Representation, ej avdragsgill

   **Kontor & kommunikation (6xxx):**
   - 6110 Kontorsmaterial
   - 6211 Telefon | 6212 Mobiltelefon
   - 6230 Datakommunikation (internet, fiber, bredband)
   - 6250 Porto

   **Försäkringar:**
   - 6310 Företagsförsäkringar
   - 6340 Leasingavgifter (utrustning, ej fordon)
   - 6350 Bilförsäkring

   **Tjänster (6xxx) — enligt BAS 2024:**
   - 6420 Frakter och transporter
   - 6423 Löneadministration (lönebyrå)
   - 6530 Redovisningstjänster (löpande bokföring, bokslut, deklarationer, revision)
   - 6540 IT-tjänster (programvara, SaaS, hosting)
   - 6550 Konsultarvoden (management, strategi, teknik — EJ redovisning/juridik/IT)
   - 6560 Serviceavgifter till branschorganisationer (Swish, Klarna, Stripe)
   - 6570 Bankkostnader
   - 6580 Advokat- och rättegångskostnader (juridisk rådgivning, advokat)
   - 6590 Övriga externa tjänster
   - 6800 Inhyrd personal (bemanningsföretag)

   **Utbildning & föreningar:**
   - 6910 Utbildning (kurser, konferenser)
   - 6980 Föreningsavgifter (branschorg., nätverk)

   **Personal (7xxx):**
   - 7010 Löner tjänstemän | 7210 Löner kollektivanställda
   - 7081 Sjuklöner | 7082 Semesterlöner
   - 7240 Styrelsearvoden | 7385 Förmånsvärde (bil/bostad)
   - 7510 Arbetsgivaravgifter | 7530 Särskild löneskatt pension
   - 7533 Avtalspension | 7570 Personalförsäkringar
   - 7620 Sjuk- och hälsovård (friskvård)
   - 7631 Personalrepresentation (avdragsgill) | 7632 (ej avdragsgill)
   - 7690 Övriga personalkostnader

   **Finansiellt (8xxx):**
   - 8010 Utdelning koncernföretag | 8070 Resultat försäljning koncernandelar
   - 8300 Ränteintäkter | 8330 Valutakursvinster
   - 8400 Räntekostnader | 8420 Dröjsmålsräntor
   - 8430 Valutakursförluster | 8490 Övriga finansiella kostnader

   **Övrigt:**
   - 3740 Öresavrundning

   **VIKTIGT — välj rätt konto (BAS 2024 standard):**
   - Ekonomibyrå, redovisningskonsult, löpande bokföring → **6530**
   - Bokslut, årsredovisning, revision → **6530** (allt under redovisningstjänster)
   - Övriga konsulter (management, strategi, teknik) → **6550**
   - Advokat, juridisk rådgivning → **6580**
   - Inhyrd personal, bemanningsföretag → **6800**
   - OBS: 6520 = Ritnings-/kopieringskostnader — INTE redovisning!
   - Använd ALDRIG 6550 eller 6580 för redovisning/bokföring — det ska vara **6530**.
   - Dröjsmålsränta → **8420** (INTE 8400 som är vanlig ränta)

   ## ⚠️ OBLIGATORISK MOMSANALYS — UTFÖR ALLTID FÖRE KONTOVAL:

   **Steg 1:** Extrahera momsbelopp och momssats från fakturan/kvittot.
   **Steg 2:** Kontrollera valuta — är fakturan i SEK eller utländsk valuta?
   **Steg 3:** Fatta beslut enligt nedanstående beslutsträd:

   **A) Fakturan visar explicit svensk moms (t.ex. "Moms 25%", "VAT 25%", momsbelopp > 0):**
      → Använd STANDARD ingående moms (2641 för 25%, 2640 generellt)
      → Använd ALDRIG omvänd skattskyldighet (2614/2645) i detta fall
      → Detta gäller OAVSETT leverantörens hemvist (även Google Ireland, AWS EMEA, OpenAI, etc.)
      → Många utländska bolag är momsregistrerade i Sverige och debiterar svensk moms

   **B) Fakturan anger uttryckligen "Reverse Charge", "Omvänd skattskyldighet",
      eller visar 0% moms från utländsk leverantör:**
      → EU-varuinköp: konto **4515** + omvänd moms (debet 2645, kredit 2614)
      → EU-tjänsteinköp: konto **4531** + omvänd skattskyldighet (debet 2645, kredit 2615)
      → Sätt is_reverse_charge = true vid create_supplier_invoice

   **C) Fakturan saknar momsspecifikation (momsbelopp ej angivet):**
      → Fråga användaren: "Jag kan inte se momsbeloppet på fakturan.
         Finns det en momsrad? Är leverantören momsregistrerad i Sverige?"
      → Gör ALDRIG antaganden om omvänd skattskyldighet utan att fråga

3. **Ge komplett bokföringsförslag:**

   **Exempel — utländsk leverantör MED svensk moms (vanligt!):**
   Google Ireland Ltd fakturerar Google Workspace, 1 250 kr inkl 25% moms:
   Debet: 6540 IT-tjänster                              1 000,00 SEK
   Debet: 2641 Ingående moms 25%                          250,00 SEK
       Kredit: 2440 Leverantörsskulder                            1 250,00 SEK
   (Google Ireland är momsregistrerat i Sverige — INTE omvänd skattskyldighet)

   **Exempel — utländsk leverantör UTAN moms (omvänd skattskyldighet):**
   Stripe Payments Europe Ltd, 1 000 kr, 0% moms, "Reverse Charge":
   Debet: 6560 Serviceavgifter                           1 000,00 SEK
   Debet: 2645 Ingående moms omvänd                        250,00 SEK
       Kredit: 2614 Utgående moms omvänd                          250,00 SEK
       Kredit: 2440 Leverantörsskulder                            1 000,00 SEK

   **Vid momsfri faktura (0% moms, inrikes):**
   Debet: [Kostnadskonto]                              X,XX SEK
       Kredit: 2440 (Leverantörsskulder)                     X,XX SEK

   **Valutahantering:**
   - Om fakturan är i utländsk valuta (USD, EUR, etc.): ange valutan
   - Gissa ALDRIG växelkurser — be användaren bekräfta beloppet i SEK från bankutdraget
   - Föreslå att kontrollera bankens växelkurs vid betalning

4. **Presentera strukturerat svar:**
   - 📋 **Fakturasammanfattning**: Leverantör, belopp, förfallodatum
   - 💰 **Belopp**: Netto, moms, totalt
   - 📊 **Bokföringsförslag**: Exakt kontering med BAS-konton
   - 💡 **Förklaring**: Varför dessa konton valdes
   - ⚠️ **Viktigt**: Påminnelser om förfallodatum eller speciella noteringar
   - ✅ **Nästa steg**: "Godkänn och betala före [datum]", "Kontakta leverantör vid fel", etc.

5. **Proaktiva råd:**
   - Varna om fakturan snart förfaller
   - Föreslå att kontrollera att varor/tjänster mottagits innan betalning
   - Påminn om att spara verifikationer digitalt
   - Om beloppet är stort, nämn att betala i tid för att undvika dröjsmålsränta

## Bokföringsregler:
1. Svara alltid på svenska.
2. Följ god redovisningssed och BAS-kontoplanen.
3. Om något går fel, förklara problemet enkelt för användaren.
4. Var proaktiv - ge råd innan användaren frågar.

## ⚠️ Matmoms — sänkning fr.o.m. 1 april 2026:
Moms på livsmedel sänks från 12% till 6% fr.o.m. 1 april 2026 (tillfälligt t.o.m. 31 december 2027).
- **Livsmedel** (mat i butik): 6% (tidigare 12%)
- **Restaurang och catering**: kvarstår på 12%
- **Hotell**: kvarstår på 12%
Kontrollera alltid transaktionsdatum: transaktioner FÖRE 1 april 2026 ska använda 12% för livsmedel.
Rättslig grund: Prop. 2025/26:55

## 📅 Deklarationsdatum att känna till:
Påminn proaktivt användaren om kommande deadlines baserat på företagets storlek:
- **Momsdeklaration (omsättning < 1 MSEK):** Årsvis, senast 26 februari
- **Momsdeklaration (1–40 MSEK):** Kvartalsvis, 12:e i 2:a månaden efter kvartal
- **Momsdeklaration (> 40 MSEK):** Månadsvis, 26:e i följande månad
- **Årsredovisning (AB):** 7 månader efter räkenskapsårets slut
- **Arbetsgivardeklaration:** 12:e varje månad
- **Inkomstdeklaration (enskild firma):** 2 maj
- **Inkomstdeklaration (AB):** 1 juli (kalenderår)

## 📋 K2/K3 — redovisningsregelverk:
De flesta små företag tillämpar **K2** (BFNAR 2013:2). K3 är standard för större företag.
- **K2-gräns:** max 50 anställda, 40 MSEK balansomslutning, 80 MSEK nettoomsättning (2 av 3)
- K2 har förenklingsregler för t.ex. avskrivningar och periodiseringar
- Om företagets storlek överskrider gränserna, informera om att K3 kan krävas.

## ⚖️ Ansvarsfriskrivning:
Du är en AI-assistent, inte en auktoriserad redovisningskonsult eller revisor.
- Alla bokföringsförslag bör granskas av användaren innan de bokförs
- Vid komplexa frågor (t.ex. omstrukturering, internationella transaktioner), rekommendera alltid kontakt med revisor
- Företagaren ansvarar alltid för sin bokföring enligt Bokföringslagen (BFL)

## 📊 Bokföringsassistent (Direktbokning via Chat)
Du kan hjälpa användaren att bokföra transaktioner direkt i chatten genom att skapa verifikationer.

### När ska du bokföra?
Känna igen förfrågningar som:
- "boka en intäkt på 100 kronor inklusive moms"
- "bokför försäljning 250 kr inkl moms"
- "registrera en kostnad på 500 kr + moms"
- "skapa verifikat för inköp 1000 kr exkl moms"

### Parametrar att extrahera:
1. **Transaktionstyp**:
   - Intäkt/försäljning/inkomst → type: "revenue"
   - Kostnad/inköp/utgift → type: "expense"

2. **Belopp**:
   - "100 kr inkl moms" → gross_amount: 100
   - "100 kr exkl moms" → beräkna brutto: 100 × 1.25 = 125 (för 25% moms)

3. **Momssats**:
   - Om inte angiven, använd 25% (svensk standardmoms)
   - Acceptera: 25, 12, 6, eller 0

4. **Beskrivning**:
   - Om användaren anger (t.ex. "försäljning konsulttjänst"), använd det
   - Annars generera passande beskrivning (t.ex. "Försäljning 25% moms")

### Validering och förtydligande:
- Om beloppet är oklart, fråga användaren
- Om "inkl/exkl moms" inte anges, anta "inkl moms" och informera användaren
- Om momsats inte anges, använd 25% och informera användaren

### Efter bokföring:
Förklara verifikatet tydligt:
"✅ Verifikat VERIDAT-2026-02-001 skapat!

**Försäljning 100 kr inkl moms (25%)**
- Bank: +100 kr (debet)
- Försäljning: 80 kr (kredit)
- Utgående moms: 20 kr (kredit)

Bokföringen är balanserad."

**VIKTIGT**: Använd verktyget create_journal_entry för att skapa verifikatet.
`;

const tools: Tool[] = [
    {
        functionDeclarations: [
            {
                name: "conversation_search",
                description: "Söker i användarens tidigare konversationer för att hitta relevant kontext. Använd proaktivt när användaren refererar till tidigare diskussioner, eller när historisk information kan vara användbar.",
                parameters: {
                    type: SchemaType.OBJECT,
                    properties: {
                        query: {
                            type: SchemaType.STRING,
                            description: "Sökfråga - vad du letar efter i tidigare konversationer (t.ex. 'moms Q3', 'faktura till Acme')"
                        }
                    },
                    required: ["query"]
                }
            },
            {
                name: "recent_chats",
                description: "Hämtar de senaste konversationerna för att få överblick över vad användaren pratat om nyligen. Använd när du behöver kontext eller överblick.",
                parameters: {
                    type: SchemaType.OBJECT,
                    properties: {
                        limit: {
                            type: SchemaType.NUMBER,
                            description: "Antal konversationer att hämta (max 10, standard 5)"
                        }
                    }
                }
            },
            {
                name: "web_search",
                description: "Söker upp uppdaterad, officiell information om svensk redovisning. Använd när frågan är tidskänslig eller regelstyrd.",
                parameters: {
                    type: SchemaType.OBJECT,
                    properties: {
                        query: {
                            type: SchemaType.STRING,
                            description: "Sökfråga för att hitta officiella källor om svensk bokföring/moms/lagar (t.ex. 'bokföringsnämnden K3 uppdatering 2024')"
                        },
                        max_results: {
                            type: SchemaType.NUMBER,
                            description: "Max antal resultat (1-8, standard 5)"
                        },
                        recency_days: {
                            type: SchemaType.NUMBER,
                            description: "Begränsa till senaste N dagar (t.ex. 365)."
                        }
                    },
                    required: ["query"]
                }
            },
            {
                name: "create_invoice",
                description: "Skapar ett fakturautkast i Fortnox. Använd detta när användaren vill fakturera.",
                parameters: {
                    type: SchemaType.OBJECT,
                    properties: {
                        CustomerNumber: {
                            type: SchemaType.STRING,
                            description: "Kundnumret i Fortnox (t.ex. '1001')"
                        },
                        InvoiceRows: {
                            type: SchemaType.ARRAY,
                            description: "Lista på fakturarader",
                            items: {
                                type: SchemaType.OBJECT,
                                properties: {
                                    ArticleNumber: {
                                        type: SchemaType.STRING,
                                        description: "Artikelnumret (t.ex. 'ART1')"
                                    },
                                    DeliveredQuantity: {
                                        type: SchemaType.STRING,
                                        description: "Antal levererade enheter (t.ex. '10')"
                                    }
                                },
                                required: ["ArticleNumber", "DeliveredQuantity"]
                            }
                        }
                    },
                    required: ["CustomerNumber", "InvoiceRows"]
                }
            },
            {
                name: "get_customers",
                description: "Hämtar lista på kunder från Fortnox. Används för att slå upp kundnummer.",
                parameters: {
                    type: SchemaType.OBJECT,
                    properties: {}, // No parameters needed
                }
            },
            {
                name: "get_articles",
                description: "Hämtar lista på artiklar från Fortnox. Används för att slå upp artikelnummer och priser.",
                parameters: {
                    type: SchemaType.OBJECT,
                    properties: {}, // No parameters needed
                }
            },
            {
                name: "create_journal_entry",
                description: "Skapar ett balanserat verifikat (journal entry) för svensk bokföring. Använd när användaren ber dig bokföra en transaktion (t.ex. 'boka intäkt 100 kr', 'bokför kostnad 500 kr').",
                parameters: {
                    type: SchemaType.OBJECT,
                    properties: {
                        type: {
                            type: SchemaType.STRING,
                            description: "Typ av transaktion: 'revenue' för intäkter/försäljning, 'expense' för kostnader/inköp",
                            enum: ["revenue", "expense"]
                        },
                        gross_amount: {
                            type: SchemaType.NUMBER,
                            description: "Bruttobelopp inklusive moms (t.ex. 125.00 för 100 kr + 25% moms)"
                        },
                        vat_rate: {
                            type: SchemaType.NUMBER,
                            description: "Momssats i procent. Giltiga värden: 25 (standard), 12, 6 eller 0. Om användaren inte anger momssats, använd 25."
                        },
                        description: {
                            type: SchemaType.STRING,
                            description: "Beskrivning av transaktionen (t.ex. 'Försäljning konsulttjänst', 'Inköp kontorsmaterial')"
                        },
                        is_roaming: {
                            type: SchemaType.BOOLEAN,
                            description: "För EV-laddning: true om det är roamingintäkt (moms enligt motpart/land och filens momsdata). Default: false"
                        }
                    },
                    required: ["type", "gross_amount", "vat_rate", "description"]
                }
            },
            {
                name: "get_suppliers",
                description: "Hämtar lista på leverantörer från Fortnox. Används för att slå upp leverantörsnummer och kontrollera om en leverantör redan finns.",
                parameters: {
                    type: SchemaType.OBJECT,
                    properties: {},
                }
            },
            {
                name: "get_vouchers",
                description: "Hämtar verifikationer från Fortnox. Används för att visa bokförda transaktioner.",
                parameters: {
                    type: SchemaType.OBJECT,
                    properties: {
                        financial_year: {
                            type: SchemaType.NUMBER,
                            description: "Räkenskapsår (t.ex. 2026). Om inte angivet, hämtas innevarande år."
                        },
                        series: {
                            type: SchemaType.STRING,
                            description: "Verifikatserie (t.ex. 'A'). Om inte angivet, hämtas alla serier."
                        }
                    }
                }
            },
            {
                name: "get_invoice",
                description: "Hämtar en specifik kundfaktura från Fortnox med fakturanummer. Använd för att se detaljer om en befintlig faktura innan bokföring.",
                parameters: {
                    type: SchemaType.OBJECT,
                    properties: {
                        invoice_number: {
                            type: SchemaType.STRING,
                            description: "Fakturanumret i Fortnox (t.ex. '24')"
                        }
                    },
                    required: ["invoice_number"]
                }
            },
            {
                name: "get_supplier_invoice",
                description: "Hämtar en specifik leverantörsfaktura från Fortnox med löpnummer. Använd för att se detaljer om en befintlig leverantörsfaktura innan bokföring.",
                parameters: {
                    type: SchemaType.OBJECT,
                    properties: {
                        given_number: {
                            type: SchemaType.STRING,
                            description: "Löpnumret i Fortnox (t.ex. '15')"
                        }
                    },
                    required: ["given_number"]
                }
            },
            {
                name: "create_supplier",
                description: "Skapar en ny leverantör i Fortnox. Använd när en leverantör saknas och användaren vill lägga till den.",
                parameters: {
                    type: SchemaType.OBJECT,
                    properties: {
                        name: {
                            type: SchemaType.STRING,
                            description: "Leverantörens företagsnamn (t.ex. 'Ellevio AB')"
                        },
                        org_number: {
                            type: SchemaType.STRING,
                            description: "Organisationsnummer (t.ex. '556037-7326')"
                        },
                        email: {
                            type: SchemaType.STRING,
                            description: "E-postadress till leverantören (valfritt)"
                        }
                    },
                    required: ["name"]
                }
            },
            {
                name: "create_supplier_invoice",
                description: "Skapar en leverantörsfaktura i Fortnox. Använd när användaren vill registrera och bokföra en leverantörsfaktura.",
                parameters: {
                    type: SchemaType.OBJECT,
                    properties: {
                        supplier_number: {
                            type: SchemaType.STRING,
                            description: "Leverantörsnummer i Fortnox"
                        },
                        invoice_number: {
                            type: SchemaType.STRING,
                            description: "Fakturanummer från leverantören"
                        },
                        total_amount: {
                            type: SchemaType.NUMBER,
                            description: "Totalbelopp inklusive moms"
                        },
                        vat_rate: {
                            type: SchemaType.NUMBER,
                            description: "Momssats (25, 12, 6 eller 0)"
                        },
                        account: {
                            type: SchemaType.NUMBER,
                            description: "BAS-kontot för kostnaden (t.ex. 5020 för el, 6540 för IT - justera efter kontoplan)"
                        },
                        description: {
                            type: SchemaType.STRING,
                            description: "Beskrivning av inköpet"
                        },
                        due_date: {
                            type: SchemaType.STRING,
                            description: "Förfallodatum (YYYY-MM-DD)"
                        },
                        vat_amount: {
                            type: SchemaType.NUMBER,
                            description: "Momsbelopp extraherat direkt från fakturan. Ange 0 om ingen moms debiteras."
                        },
                        is_reverse_charge: {
                            type: SchemaType.BOOLEAN,
                            description: "True om fakturan ska bokföras med omvänd skattskyldighet (ingen moms debiterad av utländsk leverantör). False för normal moms."
                        },
                        currency: {
                            type: SchemaType.STRING,
                            description: "Valutakod (t.ex. 'SEK', 'EUR', 'USD'). Standard: SEK."
                        }
                    },
                    required: ["supplier_number", "total_amount", "vat_rate", "vat_amount", "is_reverse_charge", "account", "description"]
                }
            },
            {
                name: "export_journal_to_fortnox",
                description: "Exporterar ett lokalt verifikat till Fortnox som en verifikation. Använd verifikations-ID från en tidigare create_journal_entry.",
                parameters: {
                    type: SchemaType.OBJECT,
                    properties: {
                        journal_entry_id: {
                            type: SchemaType.STRING,
                            description: "Verifikations-ID (t.ex. 'VERIDAT-2026-02-001')"
                        }
                    },
                    required: ["journal_entry_id"]
                }
            },
            {
                name: "book_supplier_invoice",
                description: "Bokför en befintlig leverantörsfaktura i Fortnox. Gör fakturan definitiv.",
                parameters: {
                    type: SchemaType.OBJECT,
                    properties: {
                        invoice_number: {
                            type: SchemaType.STRING,
                            description: "Fakturanummer att bokföra"
                        }
                    },
                    required: ["invoice_number"]
                }
            },
            {
                name: "propose_action_plan",
                description: "Skapar en handlingsplan med konteringsförslag som kräver användarens godkännande innan den utförs i Fortnox. Använd ALLTID detta verktyg istället för att direkt anropa create_supplier_invoice, create_invoice, export_journal_to_fortnox eller book_supplier_invoice. Visa förslaget för användaren och vänta på godkännande.",
                parameters: {
                    type: SchemaType.OBJECT,
                    properties: {
                        summary: {
                            type: SchemaType.STRING,
                            description: "Kort sammanfattning av vad planen gör (t.ex. 'Bokför leverantörsfaktura från Telia på 1 250 kr')"
                        },
                        actions: {
                            type: SchemaType.ARRAY,
                            description: "Lista på åtgärder som ska utföras efter godkännande",
                            items: {
                                type: SchemaType.OBJECT,
                                properties: {
                                    action_type: {
                                        type: SchemaType.STRING,
                                        description: "Typ av åtgärd: 'create_supplier_invoice', 'create_invoice', 'export_journal_to_fortnox', 'book_supplier_invoice', 'create_supplier', 'register_payment'"
                                    },
                                    description: {
                                        type: SchemaType.STRING,
                                        description: "Beskrivning av åtgärden på svenska"
                                    },
                                    parameters: {
                                        type: SchemaType.OBJECT,
                                        description: "Parametrar som ska skickas till åtgärden (samma som respektive verktyg kräver)"
                                    },
                                    posting_rows: {
                                        type: SchemaType.ARRAY,
                                        description: "Konteringsrader med debet/kredit",
                                        items: {
                                            type: SchemaType.OBJECT,
                                            properties: {
                                                account: {
                                                    type: SchemaType.STRING,
                                                    description: "BAS-kontonummer (t.ex. '6212')"
                                                },
                                                accountName: {
                                                    type: SchemaType.STRING,
                                                    description: "Kontonamn (t.ex. 'Mobiltelefon')"
                                                },
                                                debit: {
                                                    type: SchemaType.NUMBER,
                                                    description: "Debetbelopp (0 om kredit)"
                                                },
                                                credit: {
                                                    type: SchemaType.NUMBER,
                                                    description: "Kreditbelopp (0 om debet)"
                                                },
                                                comment: {
                                                    type: SchemaType.STRING,
                                                    description: "Kommentar (t.ex. 'Moms 25%')"
                                                }
                                            },
                                            required: ["account", "accountName", "debit", "credit"]
                                        }
                                    },
                                    confidence: {
                                        type: SchemaType.NUMBER,
                                        description: "Konfidensgrad 0-1 för förslaget"
                                    }
                                },
                                required: ["action_type", "description", "parameters"]
                            }
                        },
                        assumptions: {
                            type: SchemaType.ARRAY,
                            description: "Antaganden som gjorts (t.ex. 'Momssats 25% baserat på fakturan')",
                            items: { type: SchemaType.STRING }
                        }
                    },
                    required: ["summary", "actions"]
                }
            },
            {
                name: "register_payment",
                description: "Registrerar en betalning för en kund- eller leverantörsfaktura i Fortnox.",
                parameters: {
                    type: SchemaType.OBJECT,
                    properties: {
                        payment_type: {
                            type: SchemaType.STRING,
                            description: "Typ av betalning: 'customer' för kundfaktura, 'supplier' för leverantörsfaktura",
                            enum: ["customer", "supplier"]
                        },
                        invoice_number: {
                            type: SchemaType.STRING,
                            description: "Fakturanummer i Fortnox"
                        },
                        amount: {
                            type: SchemaType.NUMBER,
                            description: "Betalningsbelopp"
                        },
                        payment_date: {
                            type: SchemaType.STRING,
                            description: "Betalningsdatum (YYYY-MM-DD). Om inte angivet används dagens datum."
                        }
                    },
                    required: ["payment_type", "invoice_number", "amount"]
                }
            },
            {
                name: "learn_accounting_pattern",
                description: "Spara en konteringsregel som användaren bekräftat eller korrigerat. Anropa detta när användaren: 1) korrigerar ditt kontoförslag ('nej, det ska vara konto 5420'), 2) bekräftar att en kontering stämmer, eller 3) ger en ny regel ('bokför alltid Telia på 6212'). Detta gör att du kan föreslå rätt konto automatiskt nästa gång.",
                parameters: {
                    type: SchemaType.OBJECT,
                    properties: {
                        supplier_name: {
                            type: SchemaType.STRING,
                            description: "Leverantörens/motpartens namn (t.ex. 'Telia', 'Ellevio AB')"
                        },
                        bas_account: {
                            type: SchemaType.STRING,
                            description: "BAS-kontonummer (t.ex. '5420', '6212')"
                        },
                        bas_account_name: {
                            type: SchemaType.STRING,
                            description: "Kontonamn (t.ex. 'Programvaror', 'Telekommunikation')"
                        },
                        vat_rate: {
                            type: SchemaType.NUMBER,
                            description: "Momssats i procent (25, 12, 6 eller 0)"
                        },
                        expense_type: {
                            type: SchemaType.STRING,
                            description: "Typ: 'cost' för kostnad/inköp, 'sale' för intäkt/försäljning",
                            enum: ["cost", "sale"]
                        },
                        amount: {
                            type: SchemaType.NUMBER,
                            description: "Beloppet (valfritt, hjälper med anomalidetektering)"
                        },
                        description_keywords: {
                            type: SchemaType.ARRAY,
                            description: "Nyckelord från beskrivningen (valfritt, t.ex. ['abonnemang', 'bredband'])",
                            items: { type: SchemaType.STRING }
                        }
                    },
                    required: ["supplier_name", "bas_account", "bas_account_name", "vat_rate", "expense_type"]
                }
            }
        ]
    }
];


export interface FileData {
    mimeType: string;
    data: string; // base64 encoded
}

// Tool argument types for different Fortnox operations
export type InvoiceRowArgs = {
    ArticleNumber: string;
    DeliveredQuantity: string;
    [key: string]: unknown;
};

export type CreateInvoiceArgs = {
    CustomerNumber: string;
    InvoiceRows: InvoiceRowArgs[];
    [key: string]: unknown;
};

export type ConversationSearchArgs = {
    query: string;
    [key: string]: unknown;
};

export type RecentChatsArgs = {
    limit?: number;
    [key: string]: unknown;
};

export type WebSearchArgs = {
    query: string;
    max_results?: number;
    recency_days?: number;
    [key: string]: unknown;
};

export type CreateJournalEntryArgs = {
    type: 'revenue' | 'expense';
    gross_amount: number;
    vat_rate: 25 | 12 | 6 | 0;
    description: string;
    is_roaming?: boolean;
    [key: string]: unknown;
};

export type GetVouchersArgs = {
    financial_year?: number;
    series?: string;
    [key: string]: unknown;
};

export type CreateSupplierArgs = {
    name: string;
    org_number?: string;
    email?: string;
    [key: string]: unknown;
};

export type CreateSupplierInvoiceArgs = {
    supplier_number: string;
    invoice_number?: string;
    total_amount: number;
    vat_rate: number;
    vat_amount: number;
    is_reverse_charge: boolean;
    account: number;
    description: string;
    due_date?: string;
    currency?: string;
    [key: string]: unknown;
};

export type ExportJournalToFortnoxArgs = {
    journal_entry_id: string;
    [key: string]: unknown;
};

export type BookSupplierInvoiceArgs = {
    invoice_number: string;
    [key: string]: unknown;
};

export type LearnAccountingPatternArgs = {
    supplier_name: string;
    bas_account: string;
    bas_account_name: string;
    vat_rate: number;
    expense_type: 'cost' | 'sale';
    amount?: number;
    description_keywords?: string[];
    [key: string]: unknown;
};

export type ToolCall =
    | { tool: 'conversation_search'; args: ConversationSearchArgs }
    | { tool: 'recent_chats'; args: RecentChatsArgs }
    | { tool: 'web_search'; args: WebSearchArgs }
    | { tool: 'create_invoice'; args: CreateInvoiceArgs }
    | { tool: 'get_customers'; args: Record<string, never> }
    | { tool: 'get_articles'; args: Record<string, never> }
    | { tool: 'get_suppliers'; args: Record<string, never> }
    | { tool: 'get_vouchers'; args: GetVouchersArgs }
    | { tool: 'create_supplier'; args: CreateSupplierArgs }
    | { tool: 'create_supplier_invoice'; args: CreateSupplierInvoiceArgs }
    | { tool: 'create_journal_entry'; args: CreateJournalEntryArgs }
    | { tool: 'export_journal_to_fortnox'; args: ExportJournalToFortnoxArgs }
    | { tool: 'book_supplier_invoice'; args: BookSupplierInvoiceArgs }
    | { tool: 'learn_accounting_pattern'; args: LearnAccountingPatternArgs };

export interface GeminiResponse {
    text?: string;
    toolCall?: ToolCall;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeCreateInvoiceArgs(value: unknown): CreateInvoiceArgs | null {
    if (!isRecord(value)) return null;

    const rawCustomerNumber = value.CustomerNumber;
    const rawRows = value.InvoiceRows;

    const customerNumber = (typeof rawCustomerNumber === 'string' || typeof rawCustomerNumber === 'number')
        ? String(rawCustomerNumber).trim()
        : '';
    if (!customerNumber) return null;

    if (!Array.isArray(rawRows) || rawRows.length === 0) return null;

    const rows: InvoiceRowArgs[] = [];
    for (const row of rawRows) {
        if (!isRecord(row)) continue;
        const rawArticleNumber = row.ArticleNumber;
        const rawDeliveredQuantity = row.DeliveredQuantity;

        const articleNumber = (typeof rawArticleNumber === 'string' || typeof rawArticleNumber === 'number')
            ? String(rawArticleNumber).trim()
            : '';
        const deliveredQuantity = (typeof rawDeliveredQuantity === 'string' || typeof rawDeliveredQuantity === 'number')
            ? String(rawDeliveredQuantity).trim()
            : '';

        if (!articleNumber || !deliveredQuantity) continue;
        rows.push({ ...row, ArticleNumber: articleNumber, DeliveredQuantity: deliveredQuantity });
    }

    if (rows.length === 0) return null;

    return {
        ...value,
        CustomerNumber: customerNumber,
        InvoiceRows: rows
    } as CreateInvoiceArgs;
}

export const sendMessageToGemini = async (
    message: string,
    fileData?: FileData,
    history?: Array<{ role: string, content: string }>,
    apiKey?: string,
    modelOverride?: string,
    options?: { disableTools?: boolean; forceToolCall?: string }
): Promise<GeminiResponse> => {
    try {
        const key = apiKey || Deno.env.get("GEMINI_API_KEY");

        if (!key) {
            throw new Error("GEMINI_API_KEY not found in environment");
        }

        const genAI = new GoogleGenerativeAI(key);

        // Model priority: explicit override > env variable > default
        const modelName = modelOverride || Deno.env.get("GEMINI_MODEL") || "gemini-3-flash-preview";
        logger.info(`Using Gemini model: ${modelName}`);

        const model = genAI.getGenerativeModel({
            model: modelName,
            systemInstruction: SYSTEM_INSTRUCTION,
            tools: options?.disableTools ? undefined : tools,
            toolConfig: options?.forceToolCall ? {
                functionCallingConfig: {
                    mode: "ANY" as any,
                    allowedFunctionNames: [options.forceToolCall],
                },
            } : undefined,
        });

        // Build conversation contents from history
        const contents = [];

        // Add previous messages from history
        if (history && history.length > 0) {
            for (const msg of history) {
                contents.push({
                    role: msg.role === 'user' ? 'user' : 'model',
                    parts: [{ text: msg.content }]
                });
            }
        }

        // Add current message with optional file
        type ContentPart = { text: string } | { inlineData: { mimeType: string; data: string } };
        const currentParts: ContentPart[] = [];

        // Add file if present
        if (fileData) {
            currentParts.push({
                inlineData: {
                    mimeType: fileData.mimeType,
                    data: fileData.data,
                },
            });
        }

        // Add text message
        currentParts.push({ text: message });

        contents.push({ role: "user", parts: currentParts });

        const result = await model.generateContent({
            contents: contents,
            generationConfig: {
                temperature: 1.0, // Gemini 3 recommended setting
                maxOutputTokens: 2048,
            },
        });

        const response = await result.response;

        // Check for function calls
        const functionCall = response.functionCalls()?.[0];
        if (functionCall) {
            // Memory tools
            if (functionCall.name === 'conversation_search') {
                const query = (functionCall.args as Record<string, unknown>)?.query;
                if (typeof query === 'string' && query.trim()) {
                    return {
                        toolCall: {
                            tool: 'conversation_search',
                            args: { query: query.trim() }
                        }
                    };
                }
            }

            if (functionCall.name === 'recent_chats') {
                const rawLimit = (functionCall.args as Record<string, unknown>)?.limit;
                const limit = typeof rawLimit === 'number' ? Math.min(Math.max(rawLimit, 1), 10) : 5;
                return {
                    toolCall: {
                        tool: 'recent_chats',
                        args: { limit }
                    }
                };
            }

            if (functionCall.name === 'web_search') {
                const rawArgs = (functionCall.args as Record<string, unknown>) || {};
                const rawQuery = rawArgs?.query;
                const query = typeof rawQuery === 'string' ? rawQuery.trim() : '';
                if (query) {
                    const rawMax = rawArgs?.max_results;
                    const rawRecency = rawArgs?.recency_days;
                    const max_results = typeof rawMax === 'number'
                        ? Math.min(Math.max(rawMax, 1), 8)
                        : 5;
                    const recency_days = typeof rawRecency === 'number'
                        ? Math.min(Math.max(rawRecency, 1), 3650)
                        : undefined;
                    return {
                        toolCall: {
                            tool: 'web_search',
                            args: {
                                query,
                                max_results,
                                ...(recency_days ? { recency_days } : {})
                            }
                        }
                    };
                }
            }

            // Fortnox read-only tools (no args)
            if (functionCall.name === 'get_customers' || functionCall.name === 'get_articles' || functionCall.name === 'get_suppliers') {
                return {
                    toolCall: {
                        tool: functionCall.name,
                        args: {}
                    }
                };
            }

            // Fortnox tools with args (pass through)
            if (functionCall.name === 'get_vouchers' || functionCall.name === 'create_supplier' ||
                functionCall.name === 'create_supplier_invoice' || functionCall.name === 'create_journal_entry' ||
                functionCall.name === 'export_journal_to_fortnox' ||
                functionCall.name === 'book_supplier_invoice') {
                return {
                    toolCall: {
                        tool: functionCall.name as ToolCall['tool'],
                        args: (functionCall.args || {}) as any
                    }
                };
            }

            if (functionCall.name === 'create_invoice') {
                const normalized = normalizeCreateInvoiceArgs(functionCall.args);
                if (normalized) {
                    return {
                        toolCall: {
                            tool: 'create_invoice',
                            args: normalized
                        }
                    };
                }

                return {
                    text: "Jag kan hjälpa dig skapa en faktura, men jag saknar kundnummer och/eller fakturarader. Vilken kund (kundnummer) och vilka artiklar/antal ska faktureras?"
                };
            }
        }

        const text = response.text();
        return { text: text || "Jag kunde inte generera ett svar just nu." };
    } catch (error) {
        logger.error("Gemini API Error", error);

        // Check for rate limit errors and throw structured error
        const rateLimitInfo = extractGoogleRateLimitInfo(error);
        if (rateLimitInfo.isRateLimit) {
            throw new GeminiRateLimitError(rateLimitInfo.message, rateLimitInfo.retryAfter);
        }

        throw error;
    }
};

/**
 * Send a message to Gemini and get a stream of responses
 */
export const sendMessageStreamToGemini = async (
    message: string,
    fileData?: FileData,
    history?: Array<{ role: string, content: string }>,
    apiKey?: string,
    modelOverride?: string,
    options?: { disableTools?: boolean; forceToolCall?: string }
) => {
    try {
        const key = apiKey || Deno.env.get("GEMINI_API_KEY");
        if (!key) throw new Error("GEMINI_API_KEY not found");

        const genAI = new GoogleGenerativeAI(key);
        // Model priority: explicit override > env variable > default
        const modelName = modelOverride || Deno.env.get("GEMINI_MODEL") || "gemini-3-flash-preview";
        logger.info(`Using Gemini model (streaming): ${modelName}`);

        const model = genAI.getGenerativeModel({
            model: modelName,
            systemInstruction: SYSTEM_INSTRUCTION,
            tools: options?.disableTools ? undefined : tools,
            toolConfig: options?.forceToolCall ? {
                functionCallingConfig: {
                    mode: "ANY" as any,
                    allowedFunctionNames: [options.forceToolCall],
                },
            } : undefined,
        });

        const contents = [];
        if (history && history.length > 0) {
            for (const msg of history) {
                contents.push({
                    role: msg.role === 'user' ? 'user' : 'model',
                    parts: [{ text: msg.content }]
                });
            }
        }

        const currentParts = [];
        if (fileData) {
            currentParts.push({
                inlineData: {
                    mimeType: fileData.mimeType,
                    data: fileData.data,
                },
            });
        }
        currentParts.push({ text: message });
        contents.push({ role: "user", parts: currentParts });

        // Start streaming
        const result = await model.generateContentStream({
            contents: contents,
            generationConfig: {
                temperature: 1.0, // Gemini 3 recommended setting
                maxOutputTokens: 2048,
            },
        });

        return result.stream;
    } catch (error) {
        logger.error("Gemini Streaming API Error", error);

        // Check for rate limit errors and throw structured error
        const rateLimitInfo = extractGoogleRateLimitInfo(error);
        if (rateLimitInfo.isRateLimit) {
            throw new GeminiRateLimitError(rateLimitInfo.message, rateLimitInfo.retryAfter);
        }

        throw error;
    }
};

/**
 * Generate a short, descriptive title for a conversation (max 5 words)
 * Uses Gemini Flash for speed and low cost
 */
export const generateConversationTitle = async (
    userMessage: string,
    aiResponse: string,
    apiKey?: string
): Promise<string> => {
    try {
        const key = apiKey || Deno.env.get("GEMINI_API_KEY");
        if (!key) {
            logger.warn("No API key for title generation, using fallback");
            return userMessage.substring(0, 50) + (userMessage.length > 50 ? '...' : '');
        }

        const genAI = new GoogleGenerativeAI(key);
        // Use flash model for speed and low cost
        const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

        const prompt = `Generera en kort svensk titel (max 5 ord) som sammanfattar denna konversation. Svara ENDAST med titeln, inget annat.

Användare: ${userMessage.substring(0, 300)}
AI: ${aiResponse.substring(0, 300)}

Titel:`;

        const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.3,
                maxOutputTokens: 30,
            },
        });

        const title = result.response.text()?.trim();

        // Validate and clean the title
        if (!title || title.length < 2 || title.length > 60) {
            return userMessage.substring(0, 50) + (userMessage.length > 50 ? '...' : '');
        }

        // Remove quotes if AI added them
        return title.replace(/^["']|["']$/g, '').trim();
    } catch (error) {
        logger.warn("Title generation failed, using fallback", { error });
        return userMessage.substring(0, 50) + (userMessage.length > 50 ? '...' : '');
    }
};

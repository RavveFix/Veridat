# Svenska momsregler för elbilsladdning

## Momssatser

| Sats | Procent | Tillämpning |
|------|---------|-------------|
| Standard | 25% | Laddning till konsument, de flesta tjänster |
| Reducerad | 12% | Livsmedel, hotell, restaurang |
| Låg | 6% | Böcker, kultur, kollektivtrafik |
| Momsfri | 0% | Export, sjukvård, finans, fastighetsuthyrning |

## Elbilsladdning - specifika regler

### Laddning som tjänst (inte elförsäljning)

Skatteverket har klargjort att elbilsladdning ska klassificeras som en **tjänst**, inte som elförsäljning. Detta innebär:

- Standard 25% moms tillämpas
- Kan inte använda reducerad skattesats för energi
- Gäller både publik och semi-publik laddning

### Publik laddning (CPO - Charge Point Operator)

När du driver publika laddstationer:

**Intäkter:**
- Laddning till privatperson: 25% moms
- Laddning till företag: 25% moms (köparen drar av)
- Inkommande roaming (B2B): Se nedan

**Kostnader:**
- Elförbrukning: 25% ingående moms (avdragsgill)
- Plattformsavgifter: 25% ingående moms (avdragsgill)
- Hårdvara: 25% ingående moms (avdragsgill)

### Roaming mellan operatörer

#### Inkommande roaming (du är CPO)

När externa användare laddar via din station:

```
Du (CPO) ← Pengar från eMSP (Plugsurfing/Easypark)
```

**Momshantering:**
- B2B-transaktion mellan momsregistrerade företag
- Om eMSP är svenskt: 25% moms
- Om eMSP är i annat EU-land: Omvänd skattskyldighet (0% faktureras)
- Om eMSP utanför EU: Momsfri export

#### Utgående roaming (du är eMSP)

När dina kunder laddar på externa stationer:

```
Du (eMSP) → Pengar till CPO
```

**Momshantering:**
- B2B-transaktion
- Ingående moms avdragsgill om svensk CPO
- Omvänd skattskyldighet om CPO i annat EU-land

### Bostadsrättsförening som CPO

Särskilda regler gäller:

- BRF är normalt inte momsregistrerad
- Kan frivilligt momsregistrera sig för laddverksamhet
- Alternativ: Anlita extern operatör som hanterar moms

## Avdragsrätt

### Fullt avdrag (100%)

- Laddstationer för uthyrning/försäljning
- El till publik laddning
- Plattformsavgifter för laddtjänster
- Marknadsföring av laddtjänster

### Begränsat avdrag

**Personbilar (företag):**
- 50% avdrag för moms på driftskostnader
- Gäller om bilen används delvis privat

**Hyrbil:**
- 100% avdrag om enbart för verksamheten

### Inget avdrag

- Privat elförbrukning
- Representation (begränsad avdragsrätt)

## Fakturering

### Obligatoriska uppgifter på momsfaktura

1. Säljarens namn och adress
2. Säljarens VAT-nummer (SE + 12 siffror)
3. Köparens namn och adress
4. Köparens VAT-nummer (vid B2B inom EU)
5. Fakturanummer (löpnummer)
6. Fakturadatum
7. Leveransdatum eller betalningsdatum
8. Beskrivning av tjänsten
9. Kvantitet (t.ex. kWh)
10. Pris exkl. moms
11. Momssats (%)
12. Momsbelopp
13. Totalt inkl. moms

### Förenklad faktura (under 4 000 kr)

Vid mindre belopp räcker:
- Säljarens namn och VAT-nummer
- Datum
- Beskrivning av tjänsten
- Totalbelopp inkl. moms
- Momssats

## Redovisningsperioder

### Momsdeklaration

| Omsättning | Period | Deklarationsdatum |
|------------|--------|-------------------|
| > 40 MSEK | Månadsvis | 26:e följande månad |
| 1-40 MSEK | Kvartalsvis | 12:e andra månaden |
| < 1 MSEK | Årsvis | Senast 26 feb |

### Särskilda datum 2025

| Period | Deklarationsdatum |
|--------|-------------------|
| Jan-Mar | 12 maj |
| Apr-Jun | 17 aug |
| Jul-Sep | 12 nov |
| Okt-Dec | 12 feb 2026 |

## EU-försäljning

### OSS (One Stop Shop)

Om du säljer till privatpersoner i andra EU-länder:

- Kan använda OSS för att rapportera moms i ett land
- Gäller inte B2B-försäljning
- Tröskelvärde: 10 000 EUR/år

### VIES-rapportering

Vid B2B-försäljning till andra EU-länder:
- Rapportera i periodisk sammanställning
- Deadline: 25:e månaden efter

## Kontroller och revisioner

### Dokumentationskrav

Spara i minst 7 år:
- Alla fakturor (sälj och köp)
- Bokföringsunderlag
- Avtal med roaming-partners
- Teknisk dokumentation (kWh-mätning)

### Vanliga felkällor

1. **Fel momssats på roaming** - Kontrollera motpartens land
2. **Saknad omvänd skattskyldighet** - EU-handel kräver korrekt hantering
3. **Bristfällig dokumentation** - Spara alla kvitton
4. **Periodiseringsfel** - Abonnemang ska fördelas

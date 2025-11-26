# BAS-kontoplan för Elbilsladdning

## Relevanta konton för laddoperatörer (CPO)

### Intäktskonton (klass 3)

| Konto | Namn | Användning |
|-------|------|------------|
| 3010 | Försäljning tjänster 25% | Laddningssessioner till slutkund |
| 3011 | Försäljning tjänster momsfri | Export, omvänd skattskyldighet |
| 3012 | Försäljning roaming | Inkommande roaming-intäkter (CPO) |
| 3013 | Försäljning abonnemang | Laddabonnemang till kunder |

### Kostnadskonton (klass 4-6)

| Konto | Namn | Användning |
|-------|------|------------|
| 4010 | Inköp varor | Elkostnader för laddning |
| 5410 | Förbrukningsinventarier | Laddstationer under 25 000 kr |
| 6590 | Övriga externa tjänster | Plattformsavgifter (Monta, etc.) |
| 6591 | Transaktionsavgifter | Per-laddning avgifter |
| 6592 | Abonnemangsavgifter | Clean Charge, etc. |

### Momskonton (klass 26)

| Konto | Namn | Användning |
|-------|------|------------|
| 2611 | Utgående moms 25% | Moms på laddningssessioner |
| 2621 | Utgående moms 12% | (sällan för laddning) |
| 2631 | Utgående moms 6% | (ej tillämpligt) |
| 2641 | Ingående moms | Avdragsgill moms på kostnader |
| 2650 | Momsredovisning | Nettomoms att betala/återfå |

### Kund/Leverantör (klass 1-2)

| Konto | Namn | Användning |
|-------|------|------------|
| 1510 | Kundfordringar | Fordringar på laddningskunder |
| 1580 | Fordringar roaming | Fordringar på roaming-partners |
| 2440 | Leverantörsskulder | Skulder till plattformsleverantörer |

## Transaktionstyper och kontering

### Laddningssession (direkt kund)

```
Debet 1510 Kundfordringar          125,00
    Kredit 3010 Försäljning 25%            100,00
    Kredit 2611 Utgående moms 25%           25,00
```

### Inkommande roaming (CPO-intäkt)

När en extern användare (via Plugsurfing, Easypark etc.) laddar på din laddstation:

```
Debet 1580 Fordringar roaming       65,84
    Kredit 3012 Försäljning roaming        65,84
```

*Notera: Ofta momsfritt mellan operatörer (B2B)*

### Plattformsavgift (kostnad)

```
Debet 6590 Externa tjänster         80,00
Debet 2641 Ingående moms            20,00
    Kredit 2440 Leverantörsskulder        100,00
```

### Abonnemangsavgift

```
Debet 6592 Abonnemangsavgifter     195,20
Debet 2641 Ingående moms            48,80
    Kredit 2440 Leverantörsskulder        244,00
```

## Specialfall

### Omvänd skattskyldighet (EU-handel)

Vid inköp av tjänster från annat EU-land:

```
Debet 6590 Externa tjänster        100,00
Debet 2641 Ingående moms            25,00
    Kredit 2614 Utgående moms omvänd       25,00
    Kredit 2440 Leverantörsskulder        100,00
```

### Förmånsbeskattning privat laddning

Om arbetsgivare tillhandahåller fri laddning:
- Förmånsvärde beräknas på faktisk kostnad per kWh
- Bokförs som lönekostnad (konto 7389)
- Arbetsgivaravgifter tillkommer

## Periodisering

### Månadsabonnemang

Om abonnemang betalas i förskott:

```
Vid betalning:
Debet 1710 Förutbetalda kostnader  244,00
    Kredit 1930 Bank                      244,00

Per månad (periodisering):
Debet 6592 Abonnemangsavgifter     195,20
Debet 2641 Ingående moms            48,80
    Kredit 1710 Förutbetalda kostnader    244,00
```

## Tips för bokslut

1. **Avstäm momsredovisning** mot Skatteverkets uppgifter
2. **Kontrollera roaming-fordringar** mot operatörsrapporter
3. **Periodisera abonnemang** över rätt räkenskapsperiod
4. **Dokumentera** alla transaktionstyper och deras kontering

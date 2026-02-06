---
name: monta-excel-analys
description: Analyze Monta transaction exports (CSV/XLSX) to answer questions about transaction fees, 0% VAT rows, roaming revenue, subscriptions, and Swedish bookkeeping summaries. Use when a user provides Monta export data or asks “vad tar Monta i transaktionsavgifter”, “hur mycket är 0% moms”, or “vad ska vi bokföra” from Monta data.
---

# Monta Excel Analys

## Overview
Analysera Monta-exporter och sammanställ avgifter, 0%-momsrader, roaming-intäkter och abonnemang så att bokföring och kontroll går snabbt.

## Snabbstart
1. Om filen är `.numbers`, exportera först till `.xlsx` eller `.csv`.
1. För `.csv`, se till att fält med kommatecken är korrekt citerade. Om osäker, använd `.xlsx`.
1. Kör skriptet och skriv ut JSON‑rapport:

```bash
node .skills/monta-excel-analys/scripts/monta_excel_report.mjs /path/to/monta.xlsx --out report.json
```

## Indata (minimikrav)
Filen ska innehålla minst dessa kolumner (rubriknamn):
- `transactionName`
- `amount`
- `subAmount`
- `vat`
- `vatRate`
- `currency`
- `note`
- `reference`
- `created`

## Kategorisering (nuvarande regler)
- `Transaktionsavgifter` eller note som innehåller “Platform fee” → `platform_fee` (Monta transaktionsavgift)
- `Laddningsavgift` eller note som innehåller “Percentage operator fee” → `operator_fee`
- `abonnemang` eller “subscription” i reference/note → `subscription`
- `Inkommande roaming` → `roaming_revenue`
- `Laddningssessioner` → `charging_revenue`
- Övriga rader → `uncategorized`

## Viktiga fält i rapporten
- `monta_fees.platform_fee` visar total transaktionsavgift (abs‑värden).
- `monta_fees.operator_fee` visar procentuell operatörsavgift (abs‑värden).
- `zero_vat` summerar rader med 0% moms eller 0 momsbelopp.
- `unknown_rows` listar rader som inte matchade reglerna.

## Bokföringshint (Sverige)
Följande är ett startförslag som måste verifieras mot ert upplägg och fakturor.
- `platform_fee` och `operator_fee`: ofta 6590 (övriga externa tjänster) med 2641 ingående moms om 25%.
- `subscription`: ofta 6540 (IT‑tjänster) med 2641 ingående moms om 25%.
- `charging_revenue`: ofta 3010 (försäljning 25%) med 2611 utgående moms.
- `roaming_revenue` (0%): ofta 3011/3012 (momsfri/roaming), ingen utgående moms.

För momslogik och EU‑omvänd skattskyldighet, läs `references/monta_vat.md`.

## Resurser
- Script: `scripts/monta_excel_report.mjs`
- Referens: `references/monta_vat.md`

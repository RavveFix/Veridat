---
name: svensk-ekonomi
description: |
  Svensk redovisning, momshantering och bokföring enligt BAS-kontoplanen. Använd denna skill för:
  (1) Momsredovisning med svenska momssatser (25%, 12%, 6%, 0%)
  (2) Bokföring enligt BAS-kontoplanen
  (3) Elbilsladdning - CPO/eMSP-transaktioner, roaming (OCPI), förmånsbeskattning
  (4) SIE-filexport för bokföringsprogram (Fortnox, Visma, etc.)
  (5) Validering av svenska org.nr, VAT-nummer och bankgiro/plusgiro
  (6) Periodisering och avskrivningar enligt K2/K3
  Triggas av: svensk moms, BAS-konto, SIE-fil, elbilsladdning redovisning, Skatteverket, bokföring Sverige
---

# Svensk Ekonomi

## Snabbstart

Analysera transaktioner och skapa momsredovisning:

```python
from scripts.vat_processor import VATProcessor

processor = VATProcessor()
result = processor.process_transactions(df)
# Returnerar validerad momsrapport med BAS-konton
```

## Momsregler

| Momssats | Användning |
|----------|------------|
| 25% | Standard (varor, tjänster, elbilsladdning) |
| 12% | Livsmedel, hotell, restaurang |
| 6% | Böcker, kultur, kollektivtrafik |
| 0% | Export, sjukvård, utbildning, vissa finansiella tjänster |

### Elbilsladdning specifikt

- **Laddning till kund**: 25% moms
- **Inkommande roaming (CPO)**: Omvänd skattskyldighet vid EU-handel, annars 25%
- **Plattformsavgifter**: Ingående moms avdragsgill

## Valideringsregler

Alla beräkningar valideras mot:
1. Momsbelopp = Nettobelopp × Momssats
2. Bruttobelopp = Nettobelopp + Moms
3. Utgående moms - Ingående moms = Nettomoms
4. BAS-kontosummor balanserar

## Filstruktur

- `scripts/vat_processor.py` - Huvudprocessor för momsberäkning
- `scripts/validators.py` - Svenska valideringsregler
- `scripts/sie_export.py` - Export till SIE4-format
- `references/bas_accounts.md` - BAS-kontoplan för elbilsladdning
- `references/vat_rules.md` - Detaljerade momsregler

## Användning med Claude Code

```bash
# Installera som MCP-server eller kör direkt
cd svensk-ekonomi
python scripts/vat_processor.py input.xlsx --output rapport.json
```

Se `references/bas_accounts.md` för kontoförslag och `references/vat_rules.md` för detaljerade regler.

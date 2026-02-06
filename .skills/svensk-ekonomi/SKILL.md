---
name: svensk-ekonomi
description: |
  Svensk redovisning, momshantering och bokföring enligt BAS-kontoplanen.
  Specialiserad på elbilsladdning, CPO/eMSP-transaktioner och OCPI roaming.
allowed-tools:
  - Read
  - Bash
  - Grep
  - WebFetch
metadata:
  version: 1.0.0
  author: Veridat Team
  triggers:
    - svensk moms
    - BAS-konto
    - SIE-fil
    - elbilsladdning
    - Skatteverket
    - bokföring Sverige
    - momsredovisning
    - VAT calculation
    - momssats
    - moms
  capabilities:
    - name: vat-calculation
      description: Svenska momssatser (25%, 12%, 6%, 0%)
      entry: scripts/vat_processor.py
    - name: bas-accounts
      description: BAS-kontoplanen för bokföring
      reference: references/bas_accounts.md
    - name: sie-export
      description: SIE4-filexport för Fortnox/Visma
      entry: scripts/sie_export.py
    - name: validators
      description: Validering av org.nr, VAT-nummer, bankgiro
      entry: scripts/validators.py
  dependencies:
    - pandas>=2.2.3
    - openpyxl==3.1.5
  examples:
    - name: Process transactions
      command: python3 scripts/vat_processor.py input.xlsx --output report.json
    - name: Validate org number
      command: python3 scripts/validators.py org 5561839191
    - name: Export to SIE
      command: python3 scripts/sie_export.py report.json --output export.sie
---

# Svensk Ekonomi

Skill för svensk bokföring, momshantering och SIE-filexport.

## Snabbstart

### CLI-Användning

```bash
# Validera svenskt organisationsnummer
python3 .skills/svensk-ekonomi/scripts/validators.py org 5561839191

# Validera VAT-nummer
python3 .skills/svensk-ekonomi/scripts/validators.py vat SE556183919101

# Bearbeta transaktioner och skapa momsrapport
python3 .skills/svensk-ekonomi/scripts/vat_processor.py transactions.xlsx \
  --output report.json \
  --company "Företag AB" \
  --org "5561839191" \
  --period "2025-11"

# Exportera till SIE-format för Fortnox/Visma
python3 .skills/svensk-ekonomi/scripts/sie_export.py report.json \
  --output export.sie \
  --year 2025
```

### Python-Användning

```python
from scripts.vat_processor import VATProcessor

processor = VATProcessor()
result = processor.process_transactions(df)
# Returnerar validerad momsrapport med BAS-konton
```

---

## Momssatser

| Momssats | Beskrivning | Exempel |
|----------|-------------|---------|
| **25%** | Standardsats | De flesta varor och tjänster, elbilsladdning |
| **12%** | Reducerad | Livsmedel, hotell, restaurang |
| **6%** | Låg | Böcker, tidningar, kultur, kollektivtrafik |
| **0%** | Momsfri | Export, sjukvård, utbildning, finans |

### Elbilsladdning Specifikt

| Scenario | Momssats | Anteckning |
|----------|----------|------------|
| Laddning till kund | 25% | Standard |
| Inkommande roaming (CPO) | 25%/omvänd | EU-handel: omvänd skattskyldighet |
| Utgående roaming (eMSP) | 25% | Debiteras av partner |
| Plattformsavgifter | 25% ingående | Avdragsgill |

---

## BAS-Konton

### Försäljning (3xxx)
- **3001**: Försäljning 25% moms
- **3002**: Försäljning 12% moms
- **3003**: Försäljning 6% moms
- **3004**: Försäljning momsfri

### Inköp (4xxx)
- **4010**: Inköp varor 25% moms
- **4020**: Inköp tjänster

### Moms (26xx)
- **2610**: Utgående moms 25%
- **2620**: Utgående moms 12%
- **2630**: Utgående moms 6%
- **2640**: Ingående moms

Se `references/bas_accounts.md` för komplett kontoplan.

---

## Valideringsregler

Alla beräkningar valideras enligt:

1. **Momsberäkning**: Momsbelopp = Nettobelopp × Momssats
2. **Bruttoberäkning**: Bruttobelopp = Nettobelopp + Moms
3. **Momsbalans**: Utgående moms - Ingående moms = Nettomoms
4. **Kontobalans**: BAS-kontosummor balanserar

---

## Excel-Format

### Obligatoriska Kolumner
| Kolumn | Typ | Beskrivning |
|--------|-----|-------------|
| amount | float | Bruttobelopp (inkl. moms) |
| subAmount | float | Nettobelopp (exkl. moms) |
| vat | float | Momsbelopp |
| vatRate | float | Momssats (0.25, 0.12, 0.06, 0) |
| transactionName | string | Transaktionsnamn |

### Valfria Kolumner
| Kolumn | Typ | Beskrivning |
|--------|-----|-------------|
| id | string | Transaktions-ID |
| kwh | float | kWh för elbilsladdning |
| date | date | Transaktionsdatum |

---

## Filstruktur

```
.skills/svensk-ekonomi/
├── SKILL.md              # Denna fil
├── scripts/
│   ├── vat_processor.py  # Huvudprocessor för momsberäkning
│   ├── validators.py     # Svenska valideringsregler
│   └── sie_export.py     # Export till SIE4-format
├── references/
│   ├── bas_accounts.md   # BAS-kontoplan
│   └── vat_rules.md      # Detaljerade momsregler
└── __pycache__/          # Python cache
```

---

## Integration med Veridat

Denna skill används automatiskt av Veridat-projektet:

1. **Frontend** (`src/main.ts`) laddar upp Excel-filer
2. **python-proxy Edge Function** routar till Python API
3. **Python API** använder `vat_service.py` (baserad på denna skill)
4. **Resultat** visas på svenska med BAS-kontonummer

### Relaterade Filer
- `python-api/app/services/vat_service.py` - VAT calculation service
- `supabase/functions/python-proxy/` - Edge Function proxy
- `.claude/agents/vat-calculator.md` - VAT Calculator agent

---

## SIE-Export

SIE4 är svensk standard för bokföringsdata. Stöds av:
- Fortnox
- Visma
- Bokföringsmallen
- De flesta svenska bokföringsprogram

```bash
# Skapa SIE-fil
python3 scripts/sie_export.py report.json --output export.sie --year 2025
```

---

## Skattedatum (Skatteverket)

### Månatlig Rapportering
- **Momsdeklaration**: 12:e i månaden efter (eller 26:e för större företag)
- **Arbetsgivardeklaration**: 12:e i månaden efter

### Årlig Rapportering
- **Inkomstdeklaration 2 (AB)**: 1 maj
- **Årsredovisning**: 7 månader efter räkenskapsårets slut

---

## Referenser

- `references/bas_accounts.md` - Komplett BAS-kontoplan
- `references/vat_rules.md` - Detaljerade momsregler
- [Skatteverket](https://www.skatteverket.se) - Officiella regler
- [BAS-intressenternas Förening](https://www.bas.se) - BAS-kontoplan

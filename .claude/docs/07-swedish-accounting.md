# Swedish Accounting Reference

## VAT/Moms Rates

| Rate | Description | Examples |
|------|-------------|----------|
| 25% | Standard rate | Most goods and services |
| 12% | Reduced rate | Food, restaurants, hotels |
| 6% | Low rate | Books, newspapers, public transport |
| 0% | Zero rate | Exports, international transport |

---

## BAS Account Plan

Swedish standard chart of accounts used for bookkeeping.

### Common Accounts

**Sales (3xxx)**
- 3001: Försäljning 25% moms
- 3002: Försäljning 12% moms
- 3003: Försäljning 6% moms
- 3004: Försäljning momsfri

**Purchases (4xxx)**
- 4010: Inköp varor 25% moms
- 4020: Inköp tjänster

**VAT (26xx)**
- 2610: Utgående moms 25%
- 2620: Utgående moms 12%
- 2630: Utgående moms 6%
- 2640: Ingående moms

### EV Charging Accounts

See `.skills/svensk-ekonomi/references/bas_accounts.md` for complete mapping.

---

## SIE File Format

Swedish standard for accounting data exchange.

**Supported by:**
- Fortnox
- Visma
- Bokföringsmallen

**Export Command:**
```bash
python3 .skills/svensk-ekonomi/scripts/sie_export.py report.json \
  --output export.sie \
  --year 2025
```

---

## Swedish Identifiers

### Organization Number (Org.nr)
Format: `NNNNNN-NNNN` or `NNNNNNNNNN`

**Validation:**
```bash
python3 .skills/svensk-ekonomi/scripts/validators.py org 5561839191
```

### VAT Number (Momsnummer)
Format: `SE` + Org.nr + `01`

**Validation:**
```bash
python3 .skills/svensk-ekonomi/scripts/validators.py vat SE556183919101
```

### Bankgiro/Plusgiro
Used for payment references.

---

## Tax Deadlines (Skatteverket)

### Monthly Reporting
- **Momsdeklaration:** 12th of following month (or 26th for larger companies)
- **Arbetsgivardeklaration:** 12th of following month

### Annual
- **Inkomstdeklaration 2 (AB):** May 1st
- **Årsredovisning:** 7 months after fiscal year end

---

## Britta AI Persona

Configured in `GeminiService.ts`:
- Swedish bookkeeping expertise
- BAS account plan knowledge
- PDF/image tax document analysis
- Proactive tax deadline reminders
- Invoice creation via Fortnox

---

## Skill Reference

See `.skills/svensk-ekonomi/` for:
- `SKILL.md` - Skill definition and capabilities
- `scripts/vat_processor.py` - VAT calculation logic
- `scripts/sie_export.py` - SIE file export
- `scripts/validators.py` - Swedish identifier validation
- `references/bas_accounts.md` - BAS account mapping
- `references/vat_rules.md` - Detailed VAT rules

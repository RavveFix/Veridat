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

### EV Charging Accounts (CPO - Charge Point Operator)

| Account | Name | Description |
|---------|------|-------------|
| 3010 | Försäljning laddtjänster | Private charging 25% VAT |
| 3011 | Roaming-försäljning | Export to eMSP (0% VAT) |
| 6540 | IT-tjänster | Monta subscriptions (25% VAT) |
| 6590 | Övriga externa tjänster | Operator & platform fees |
| 2611 | Utgående moms 25% | Outgoing VAT on private sales |
| 2640 | Ingående moms | Incoming VAT (deductible) |

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

## Veridat AI Persona

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

---

## Monta Excel Parser (Deterministic)

### Overview

The `analyze-excel-ai` Edge Function includes a **deterministic parser** for Monta transaction exports. This ensures 100% accuracy for EV charging VAT reports - no AI guessing involved.

**File:** `supabase/functions/analyze-excel-ai/index.ts`

### Detection Logic

A file is identified as Monta export if it contains these columns:
- `amount` (gross amount incl. VAT)
- `subAmount` (net amount excl. VAT)
- `vat` (VAT amount)
- `roamingOperator` or `kwh`

### Transaction Categories

| Category | Detection Rule | VAT | BAS Account |
|----------|---------------|-----|-------------|
| **SALES (amount > 0)** |
| Private charging | No `roamingOperator` | 25% | 3010 |
| Roaming export | Has `roamingOperator` | 0% | 3011 |
| **COSTS (amount < 0)** |
| Subscription | `reference` contains "SUBSCRIPTION" | 25% | 6540 |
| Operator fee | `note` contains "operator fee" | 25% | 6590 |
| Platform fee | `note` contains "Platform fee" | 0% | 6590 |

### Legal Basis

- **EU Court Ruling C-60/23 (Digital Charging Solutions):** EV charging = supply of goods (electricity), eMSP acts as commission agent
- **OCPI Protocol:** Open Charge Point Interface for roaming
- **Swedish VAT (ML 5 kap 9§):** Export to foreign eMSP = 0% VAT

### VAT Calculation

```
OUTGOING VAT (on sales):
- Private charging: 25% on net amount
- Roaming export: 0% (tax-free export)

INCOMING VAT (on costs, deductible):
- Subscriptions: 25% (deductible)
- Operator fees: 25% (deductible)
- Platform fees: 0% (no VAT to deduct - Monta invoices from abroad)

NET VAT = Outgoing - Incoming
- Positive = VAT to pay
- Negative = VAT refund
```

### Example Output

For a typical Monta export with 20 transactions:

```
SALES:           315.10 SEK
  - Private:      81.46 SEK (25% VAT = 16.29)
  - Roaming:     233.65 SEK (0% VAT)

COSTS:           528.01 SEK
  - Subscriptions: 488.00 SEK (25% VAT = 97.60)
  - Operator fees:  19.69 SEK (25% VAT = 3.94)
  - Platform fees:  20.32 SEK (0% VAT)

OUTGOING VAT:     16.29 SEK
INCOMING VAT:    101.54 SEK
NET VAT:         -85.25 SEK (refund)
```

### Fallback

For non-Monta files, the system falls back to Claude AI analysis with a simplified prompt.

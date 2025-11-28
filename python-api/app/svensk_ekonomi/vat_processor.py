#!/usr/bin/env python3
"""
Svensk momsprocessor för elbilsladdning och allmän redovisning.
Validerar mot svenska regler och BAS-kontoplanen.
"""

import json
import re
from dataclasses import dataclass, field, asdict
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from enum import Enum
from typing import Optional
import pandas as pd


class VATRate(Enum):
    """Svenska momssatser"""
    STANDARD = Decimal("0.25")
    REDUCED_12 = Decimal("0.12")
    REDUCED_6 = Decimal("0.06")
    ZERO = Decimal("0")


@dataclass
class ValidationError:
    field: str
    message: str
    severity: str = "error"  # error, warning, info


@dataclass
class Transaction:
    id: str
    date: datetime
    description: str
    gross_amount: Decimal
    net_amount: Decimal
    vat_amount: Decimal
    vat_rate: VATRate
    account_debit: str
    account_credit: str
    counterpart: Optional[str] = None
    is_roaming: bool = False
    kwh: Optional[Decimal] = None


@dataclass
class VATReport:
    period: str
    company_name: str
    org_number: str
    
    # Utgående moms (försäljning)
    sales_25: Decimal = Decimal("0")
    sales_12: Decimal = Decimal("0")
    sales_6: Decimal = Decimal("0")
    sales_0: Decimal = Decimal("0")
    
    outgoing_vat_25: Decimal = Decimal("0")
    outgoing_vat_12: Decimal = Decimal("0")
    outgoing_vat_6: Decimal = Decimal("0")
    
    # Ingående moms (kostnader)
    purchases_25: Decimal = Decimal("0")
    purchases_12: Decimal = Decimal("0")
    purchases_0: Decimal = Decimal("0")
    
    incoming_vat: Decimal = Decimal("0")
    
    # Beräknade fält
    total_outgoing_vat: Decimal = Decimal("0")
    net_vat: Decimal = Decimal("0")
    
    # Validering
    validations: list = field(default_factory=list)
    is_valid: bool = True
    
    # Verifikationer
    journal_entries: list = field(default_factory=list)


class SwedishValidators:
    """Validerare för svenska format och regler"""
    
    @staticmethod
    def validate_org_number(org_nr: str) -> tuple[bool, str]:
        """Validerar svenskt organisationsnummer (NNNNNN-NNNN)"""
        clean = re.sub(r'[^0-9]', '', org_nr)
        
        if len(clean) != 10:
            return False, "Organisationsnummer måste vara 10 siffror"
        
        # Luhn-algoritm för kontrollsiffra
        digits = [int(d) for d in clean]
        checksum = 0
        for i, d in enumerate(digits[:-1]):
            if i % 2 == 0:
                doubled = d * 2
                checksum += doubled if doubled < 10 else doubled - 9
            else:
                checksum += d
        
        expected_check = (10 - (checksum % 10)) % 10
        if digits[-1] != expected_check:
            return False, f"Ogiltig kontrollsiffra (förväntat {expected_check})"
        
        return True, "OK"
    
    @staticmethod
    def validate_vat_number(vat_nr: str) -> tuple[bool, str]:
        """Validerar svenskt VAT-nummer (SE + 12 siffror)"""
        if not vat_nr.upper().startswith("SE"):
            return False, "Svenskt VAT-nummer måste börja med SE"
        
        digits = re.sub(r'[^0-9]', '', vat_nr)
        if len(digits) != 12:
            return False, "VAT-nummer måste ha 12 siffror efter SE"
        
        # Kontrollera att de första 10 siffrorna är ett giltigt org.nr
        org_valid, org_msg = SwedishValidators.validate_org_number(digits[:10])
        if not org_valid:
            return False, f"Ogiltigt organisationsnummer i VAT: {org_msg}"
        
        # De sista två siffrorna ska vara 01
        if digits[10:] != "01":
            return False, "VAT-nummer ska sluta med 01"
        
        return True, "OK"
    
    @staticmethod
    def validate_vat_calculation(net: Decimal, vat: Decimal, rate: VATRate, 
                                  tolerance: Decimal = Decimal("0.02")) -> tuple[bool, str]:
        """Validerar att moms är korrekt beräknad"""
        expected_vat = (net * rate.value).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        diff = abs(vat - expected_vat)
        
        if diff > tolerance:
            return False, f"Momsbelopp {vat} stämmer inte med {rate.value*100}% av {net} (förväntat {expected_vat})"
        
        return True, "OK"
    
    @staticmethod
    def validate_gross_amount(net: Decimal, vat: Decimal, gross: Decimal,
                               tolerance: Decimal = Decimal("0.02")) -> tuple[bool, str]:
        """Validerar att bruttobelopp = netto + moms"""
        expected_gross = net + vat
        diff = abs(gross - expected_gross)
        
        if diff > tolerance:
            return False, f"Bruttobelopp {gross} ≠ netto {net} + moms {vat} (diff: {diff})"
        
        return True, "OK"


class BASAccounts:
    """BAS-kontoplan för elbilsladdning"""
    
    # Intäkter
    SALES_SERVICES_25 = "3010"  # Försäljning tjänster 25%
    SALES_SERVICES_0 = "3011"   # Försäljning tjänster momsfri
    SALES_ROAMING = "3012"      # Roaming-intäkter
    
    # Kostnader
    EXTERNAL_SERVICES = "6590"  # Övriga externa tjänster
    PLATFORM_FEES = "6591"      # Plattformsavgifter
    SUBSCRIPTION_COSTS = "6592" # Abonnemangskostnader
    
    # Moms
    OUTGOING_VAT_25 = "2611"    # Utgående moms 25%
    OUTGOING_VAT_12 = "2621"    # Utgående moms 12%
    OUTGOING_VAT_6 = "2631"     # Utgående moms 6%
    INCOMING_VAT = "2641"       # Ingående moms
    VAT_SETTLEMENT = "2650"     # Momsredovisning
    
    # Kund/Leverantör
    ACCOUNTS_RECEIVABLE = "1510"  # Kundfordringar
    ACCOUNTS_PAYABLE = "2440"     # Leverantörsskulder
    
    @classmethod
    def get_sales_account(cls, vat_rate: VATRate, is_roaming: bool = False) -> str:
        if is_roaming:
            return cls.SALES_ROAMING
        if vat_rate == VATRate.ZERO:
            return cls.SALES_SERVICES_0
        return cls.SALES_SERVICES_25
    
    @classmethod
    def get_vat_account(cls, vat_rate: VATRate, is_outgoing: bool = True) -> str:
        if not is_outgoing:
            return cls.INCOMING_VAT
        
        mapping = {
            VATRate.STANDARD: cls.OUTGOING_VAT_25,
            VATRate.REDUCED_12: cls.OUTGOING_VAT_12,
            VATRate.REDUCED_6: cls.OUTGOING_VAT_6,
            VATRate.ZERO: None
        }
        return mapping.get(vat_rate)


class VATProcessor:
    """Huvudprocessor för svensk momsredovisning"""
    
    def __init__(self):
        self.validators = SwedishValidators()
        self.accounts = BASAccounts()
    
    def process_transactions(self, df: pd.DataFrame, 
                             company_name: str = "",
                             org_number: str = "",
                             period: str = "") -> dict:
        """
        Processerar transaktioner och returnerar validerad momsrapport.
        
        Args:
            df: DataFrame med kolumner: amount, subAmount, vat, vatRate, transactionName, etc.
            company_name: Företagsnamn
            org_number: Organisationsnummer
            period: Redovisningsperiod (YYYY-MM)
        
        Returns:
            dict med momsrapport, valideringar och bokföringsförslag
        """
        
        report = VATReport(
            period=period or datetime.now().strftime("%Y-%m"),
            company_name=company_name,
            org_number=org_number
        )
        
        validations = []
        
        # Validera org.nummer om angivet
        if org_number:
            valid, msg = self.validators.validate_org_number(org_number)
            if not valid:
                validations.append(ValidationError("org_number", msg))
        
        # Separera intäkter och kostnader
        income = df[df['amount'] > 0].copy()
        costs = df[df['amount'] < 0].copy()
        
        # Processa intäkter (utgående moms)
        for _, row in income.iterrows():
            vat_rate = self._get_vat_rate(row.get('vatRate', 25))
            net = Decimal(str(row['subAmount']))
            vat = Decimal(str(row['vat']))
            gross = Decimal(str(row['amount']))
            
            # Validera beräkningar
            if vat_rate != VATRate.ZERO:
                valid, msg = self.validators.validate_vat_calculation(net, vat, vat_rate)
                if not valid:
                    validations.append(ValidationError(
                        f"transaction_{row.get('id', 'unknown')}", 
                        msg, 
                        "warning"
                    ))
            
            valid, msg = self.validators.validate_gross_amount(net, vat, gross)
            if not valid:
                validations.append(ValidationError(
                    f"transaction_{row.get('id', 'unknown')}", 
                    msg,
                    "warning"
                ))
            
            # Summera per momssats
            if vat_rate == VATRate.STANDARD:
                report.sales_25 += net
                report.outgoing_vat_25 += vat
            elif vat_rate == VATRate.REDUCED_12:
                report.sales_12 += net
                report.outgoing_vat_12 += vat
            elif vat_rate == VATRate.REDUCED_6:
                report.sales_6 += net
                report.outgoing_vat_6 += vat
            else:
                report.sales_0 += net
        
        # Processa kostnader (ingående moms)
        for _, row in costs.iterrows():
            vat_rate = self._get_vat_rate(row.get('vatRate', 25))
            net = abs(Decimal(str(row['subAmount'])))
            vat = abs(Decimal(str(row['vat'])))
            
            if vat_rate == VATRate.STANDARD:
                report.purchases_25 += net
                report.incoming_vat += vat
            elif vat_rate == VATRate.REDUCED_12:
                report.purchases_12 += net
                report.incoming_vat += vat
            elif vat_rate == VATRate.ZERO:
                report.purchases_0 += net
        
        # Beräkna totaler
        report.total_outgoing_vat = (
            report.outgoing_vat_25 + 
            report.outgoing_vat_12 + 
            report.outgoing_vat_6
        )
        report.net_vat = report.total_outgoing_vat - report.incoming_vat
        
        # Validera momsbalans
        self._validate_vat_balance(report, validations)
        
        # Skapa bokföringsförslag
        report.journal_entries = self._create_journal_entries(report)
        
        # Sammanställ valideringar
        report.validations = [asdict(v) for v in validations]
        report.is_valid = not any(v.severity == "error" for v in validations)
        
        return self._to_dict(report)
    
    def _get_vat_rate(self, rate_percent: float) -> VATRate:
        """Konverterar procentsats till VATRate"""
        rate_map = {
            25: VATRate.STANDARD,
            12: VATRate.REDUCED_12,
            6: VATRate.REDUCED_6,
            0: VATRate.ZERO
        }
        return rate_map.get(int(rate_percent), VATRate.STANDARD)
    
    def _validate_vat_balance(self, report: VATReport, validations: list):
        """Validerar att momsberäkningen balanserar"""
        calculated_net = report.total_outgoing_vat - report.incoming_vat
        if abs(calculated_net - report.net_vat) > Decimal("0.01"):
            validations.append(ValidationError(
                "vat_balance",
                f"Momsbalans stämmer inte: beräknad {calculated_net} ≠ rapporterad {report.net_vat}",
                "error"
            ))
    
    def _create_journal_entries(self, report: VATReport) -> list:
        """Skapar bokföringsförslag enligt BAS-kontoplanen"""
        entries = []
        
        if report.sales_25 > 0:
            entries.append({
                "account": BASAccounts.SALES_SERVICES_25,
                "account_name": "Försäljning tjänster 25% moms",
                "debit": 0,
                "credit": float(report.sales_25),
                "description": "Intäkter med 25% moms"
            })
        
        if report.sales_0 > 0:
            entries.append({
                "account": BASAccounts.SALES_SERVICES_0,
                "account_name": "Försäljning tjänster momsfri",
                "debit": 0,
                "credit": float(report.sales_0),
                "description": "Momsfria intäkter (t.ex. roaming)"
            })
        
        if report.outgoing_vat_25 > 0:
            entries.append({
                "account": BASAccounts.OUTGOING_VAT_25,
                "account_name": "Utgående moms 25%",
                "debit": 0,
                "credit": float(report.outgoing_vat_25),
                "description": "Utgående moms på försäljning"
            })
        
        if report.purchases_25 + report.purchases_12 + report.purchases_0 > 0:
            total_costs = report.purchases_25 + report.purchases_12 + report.purchases_0
            entries.append({
                "account": BASAccounts.EXTERNAL_SERVICES,
                "account_name": "Övriga externa tjänster",
                "debit": float(total_costs),
                "credit": 0,
                "description": "Kostnader för avgifter och abonnemang"
            })
        
        if report.incoming_vat > 0:
            entries.append({
                "account": BASAccounts.INCOMING_VAT,
                "account_name": "Ingående moms",
                "debit": float(report.incoming_vat),
                "credit": 0,
                "description": "Avdragsgill ingående moms"
            })
        
        return entries
    
    def _to_dict(self, report: VATReport) -> dict:
        """Konverterar rapport till JSON-serialiserbar dict"""
        return {
            "period": report.period,
            "company": {
                "name": report.company_name,
                "org_number": report.org_number
            },
            "sales": {
                "vat_25_percent": {
                    "net": float(report.sales_25),
                    "vat": float(report.outgoing_vat_25)
                },
                "vat_12_percent": {
                    "net": float(report.sales_12),
                    "vat": float(report.outgoing_vat_12)
                },
                "vat_6_percent": {
                    "net": float(report.sales_6),
                    "vat": float(report.outgoing_vat_6)
                },
                "vat_0_percent": {
                    "net": float(report.sales_0)
                },
                "total_net": float(report.sales_25 + report.sales_12 + report.sales_6 + report.sales_0),
                "total_outgoing_vat": float(report.total_outgoing_vat)
            },
            "purchases": {
                "vat_25_percent": {
                    "net": float(report.purchases_25)
                },
                "vat_12_percent": {
                    "net": float(report.purchases_12)
                },
                "vat_0_percent": {
                    "net": float(report.purchases_0)
                },
                "total_net": float(report.purchases_25 + report.purchases_12 + report.purchases_0),
                "incoming_vat": float(report.incoming_vat)
            },
            "vat_summary": {
                "outgoing_vat": float(report.total_outgoing_vat),
                "incoming_vat": float(report.incoming_vat),
                "net_vat": float(report.net_vat),
                "to_pay": float(report.net_vat) if report.net_vat > 0 else 0,
                "to_refund": float(abs(report.net_vat)) if report.net_vat < 0 else 0
            },
            "journal_entries": report.journal_entries,
            "validation": {
                "is_valid": report.is_valid,
                "errors": [v for v in report.validations if v["severity"] == "error"],
                "warnings": [v for v in report.validations if v["severity"] == "warning"]
            }
        }


# CLI-stöd
if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Svensk momsprocessor")
    parser.add_argument("input", help="Excel-fil med transaktioner")
    parser.add_argument("--output", "-o", help="Output JSON-fil")
    parser.add_argument("--company", help="Företagsnamn")
    parser.add_argument("--org", help="Organisationsnummer")
    parser.add_argument("--period", help="Period (YYYY-MM)")
    
    args = parser.parse_args()
    
    df = pd.read_excel(args.input)
    processor = VATProcessor()
    result = processor.process_transactions(
        df,
        company_name=args.company or "",
        org_number=args.org or "",
        period=args.period or ""
    )
    
    output = json.dumps(result, indent=2, ensure_ascii=False)
    
    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(output)
        print(f"Rapport sparad till {args.output}")
    else:
        print(output)

#!/usr/bin/env python3
"""
SIE4-export för svenska bokföringsprogram (Fortnox, Visma, etc.)
Genererar SIE4-filer enligt svensk standard.
"""

from datetime import datetime
from decimal import Decimal
from typing import Optional
import re


class SIEExporter:
    """Exporterar bokföringsdata till SIE4-format"""
    
    SIE_VERSION = "4"
    CHARSET = "CP437"  # SIE använder IBM PC-teckenuppsättning
    
    def __init__(self, company_name: str, org_number: str, 
                 fiscal_year_start: str = "0101",
                 fiscal_year_end: str = "1231"):
        self.company_name = company_name
        self.org_number = self._clean_org_number(org_number)
        self.fiscal_year_start = fiscal_year_start
        self.fiscal_year_end = fiscal_year_end
        self.accounts = {}
        self.verifications = []
        self.account_balances = {}
    
    def _clean_org_number(self, org_nr: str) -> str:
        """Tar bort bindestreck från org.nummer"""
        return re.sub(r'[^0-9]', '', org_nr)
    
    def add_account(self, account_number: str, account_name: str):
        """Lägger till ett konto i kontoplanen"""
        self.accounts[account_number] = account_name
    
    def add_verification(self, ver_number: int, ver_date: datetime,
                        description: str, transactions: list):
        """
        Lägger till en verifikation.
        
        Args:
            ver_number: Verifikationsnummer
            ver_date: Verifikationsdatum
            description: Beskrivning
            transactions: Lista med dict: {account, debit, credit}
        """
        self.verifications.append({
            "number": ver_number,
            "date": ver_date,
            "description": description,
            "transactions": transactions
        })
    
    def set_opening_balance(self, account: str, balance: Decimal):
        """Sätter ingående balans för ett konto"""
        self.account_balances[account] = balance
    
    def export(self, year: int, output_path: Optional[str] = None) -> str:
        """
        Exporterar till SIE4-format.
        
        Args:
            year: Räkenskapsår
            output_path: Sökväg för fil (valfritt)
        
        Returns:
            SIE-filinnehåll som sträng
        """
        lines = []
        
        # Header
        lines.append(f'#FLAGGA 0')
        lines.append(f'#FORMAT PC8')
        lines.append(f'#SIETYP {self.SIE_VERSION}')
        lines.append(f'#PROGRAM "svensk-ekonomi" 1.0')
        lines.append(f'#GEN {datetime.now().strftime("%Y%m%d")}')
        lines.append(f'#FNAMN "{self.company_name}"')
        lines.append(f'#ORGNR {self.org_number}')
        lines.append(f'#RAR 0 {year}{self.fiscal_year_start} {year}{self.fiscal_year_end}')
        lines.append(f'#KPTYP BAS2024')
        lines.append('')
        
        # Kontoplan
        lines.append('# Kontoplan')
        for account, name in sorted(self.accounts.items()):
            lines.append(f'#KONTO {account} "{name}"')
        lines.append('')
        
        # Ingående balanser
        if self.account_balances:
            lines.append('# Ingående balanser')
            for account, balance in sorted(self.account_balances.items()):
                lines.append(f'#IB 0 {account} {self._format_amount(balance)}')
            lines.append('')
        
        # Verifikationer
        if self.verifications:
            lines.append('# Verifikationer')
            for ver in self.verifications:
                ver_date = ver["date"].strftime("%Y%m%d")
                desc = ver["description"].replace('"', "'")
                lines.append(f'#VER "" {ver["number"]} {ver_date} "{desc}"')
                lines.append('{')
                
                for trans in ver["transactions"]:
                    amount = trans.get("debit", 0) - trans.get("credit", 0)
                    if amount != 0:
                        lines.append(f'    #TRANS {trans["account"]} {{}} {self._format_amount(amount)}')
                
                lines.append('}')
            lines.append('')
        
        content = '\n'.join(lines)
        
        if output_path:
            with open(output_path, 'w', encoding='cp437', errors='replace') as f:
                f.write(content)
        
        return content
    
    def _format_amount(self, amount) -> str:
        """Formaterar belopp för SIE (punkt som decimaltecken)"""
        if isinstance(amount, Decimal):
            return str(float(amount))
        return str(amount)


def create_sie_from_vat_report(vat_report: dict, year: int, 
                                ver_number: int = 1) -> str:
    """
    Skapar SIE-fil från momsrapport.
    
    Args:
        vat_report: Dict från VATProcessor.process_transactions()
        year: Räkenskapsår
        ver_number: Startnummer för verifikationer
    
    Returns:
        SIE-filinnehåll
    """
    exporter = SIEExporter(
        company_name=vat_report["company"]["name"],
        org_number=vat_report["company"]["org_number"]
    )
    
    # Lägg till konton från bokföringsförslag
    standard_accounts = {
        "1510": "Kundfordringar",
        "2440": "Leverantörsskulder",
        "2611": "Utgående moms 25%",
        "2621": "Utgående moms 12%",
        "2631": "Utgående moms 6%",
        "2641": "Ingående moms",
        "2650": "Momsredovisning",
        "3010": "Försäljning tjänster 25%",
        "3011": "Försäljning tjänster momsfri",
        "3012": "Roaming-intäkter",
        "6590": "Övriga externa tjänster",
        "6591": "Plattformsavgifter",
        "6592": "Abonnemangskostnader"
    }
    
    for account, name in standard_accounts.items():
        exporter.add_account(account, name)
    
    # Skapa verifikation från bokföringsförslag
    transactions = []
    for entry in vat_report.get("journal_entries", []):
        transactions.append({
            "account": entry["account"],
            "debit": entry.get("debit", 0),
            "credit": entry.get("credit", 0)
        })
    
    if transactions:
        exporter.add_verification(
            ver_number=ver_number,
            ver_date=datetime.now(),
            description=f"Momsredovisning {vat_report['period']}",
            transactions=transactions
        )
    
    return exporter.export(year)


# CLI-stöd
if __name__ == "__main__":
    import argparse
    import json
    
    parser = argparse.ArgumentParser(description="SIE4-export")
    parser.add_argument("input", help="JSON-fil från vat_processor")
    parser.add_argument("--output", "-o", help="Output SIE-fil", required=True)
    parser.add_argument("--year", "-y", type=int, default=datetime.now().year,
                       help="Räkenskapsår")
    
    args = parser.parse_args()
    
    with open(args.input, 'r', encoding='utf-8') as f:
        vat_report = json.load(f)
    
    sie_content = create_sie_from_vat_report(vat_report, args.year)
    
    with open(args.output, 'w', encoding='cp437', errors='replace') as f:
        f.write(sie_content)
    
    print(f"SIE-fil sparad till {args.output}")

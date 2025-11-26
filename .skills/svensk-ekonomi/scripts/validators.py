#!/usr/bin/env python3
"""
Svenska validerare för redovisning och identifierare.
"""

import re
from dataclasses import dataclass
from decimal import Decimal
from typing import Optional, Callable


@dataclass
class ValidationResult:
    is_valid: bool
    message: str
    field: Optional[str] = None
    value: Optional[str] = None


class SwedishValidators:
    """Samling av svenska validerare"""
    
    # === ORGANISATIONSNUMMER ===
    
    @staticmethod
    def validate_org_number(org_nr: str) -> ValidationResult:
        """
        Validerar svenskt organisationsnummer.
        Format: NNNNNN-NNNN eller NNNNNNNNNN
        Kontrollsiffra enligt Luhn-algoritmen.
        """
        clean = re.sub(r'[^0-9]', '', org_nr)
        
        if len(clean) != 10:
            return ValidationResult(
                False, 
                "Organisationsnummer måste vara 10 siffror",
                "org_number",
                org_nr
            )
        
        # Första siffran måste vara 1-9 (inte 0)
        if clean[0] == '0':
            return ValidationResult(
                False,
                "Organisationsnummer kan inte börja med 0",
                "org_number",
                org_nr
            )
        
        # Luhn-algoritm
        digits = [int(d) for d in clean]
        checksum = 0
        for i in range(9):
            d = digits[i]
            if i % 2 == 0:
                doubled = d * 2
                checksum += doubled if doubled < 10 else doubled - 9
            else:
                checksum += d
        
        expected_check = (10 - (checksum % 10)) % 10
        if digits[9] != expected_check:
            return ValidationResult(
                False,
                f"Ogiltig kontrollsiffra (förväntat {expected_check}, fick {digits[9]})",
                "org_number",
                org_nr
            )
        
        return ValidationResult(True, "Giltigt organisationsnummer", "org_number", org_nr)
    
    # === VAT-NUMMER ===
    
    @staticmethod
    def validate_vat_number(vat_nr: str) -> ValidationResult:
        """
        Validerar svenskt VAT-nummer.
        Format: SE + 10 siffror org.nr + 01
        """
        if not vat_nr:
            return ValidationResult(False, "VAT-nummer saknas", "vat_number", vat_nr)
        
        upper = vat_nr.upper().strip()
        
        if not upper.startswith("SE"):
            return ValidationResult(
                False,
                "Svenskt VAT-nummer måste börja med SE",
                "vat_number",
                vat_nr
            )
        
        digits = re.sub(r'[^0-9]', '', vat_nr)
        
        if len(digits) != 12:
            return ValidationResult(
                False,
                f"VAT-nummer måste ha 12 siffror efter SE (fick {len(digits)})",
                "vat_number",
                vat_nr
            )
        
        # Validera organisationsnummer (första 10 siffrorna)
        org_result = SwedishValidators.validate_org_number(digits[:10])
        if not org_result.is_valid:
            return ValidationResult(
                False,
                f"Ogiltigt organisationsnummer i VAT: {org_result.message}",
                "vat_number",
                vat_nr
            )
        
        # Sista två siffrorna ska vara 01
        if digits[10:] != "01":
            return ValidationResult(
                False,
                f"VAT-nummer ska sluta med 01 (fick {digits[10:]})",
                "vat_number",
                vat_nr
            )
        
        return ValidationResult(True, "Giltigt VAT-nummer", "vat_number", vat_nr)
    
    # === BANKGIRO ===
    
    @staticmethod
    def validate_bankgiro(bg_nr: str) -> ValidationResult:
        """
        Validerar bankgironummer.
        Format: NNN-NNNN eller NNNN-NNNN (7-8 siffror)
        Kontrollsiffra enligt modulus 10.
        """
        clean = re.sub(r'[^0-9]', '', bg_nr)
        
        if len(clean) < 7 or len(clean) > 8:
            return ValidationResult(
                False,
                "Bankgironummer måste vara 7-8 siffror",
                "bankgiro",
                bg_nr
            )
        
        # Luhn-algoritm (modulus 10)
        digits = [int(d) for d in clean]
        checksum = 0
        for i, d in enumerate(reversed(digits[:-1])):
            if i % 2 == 0:
                doubled = d * 2
                checksum += doubled if doubled < 10 else doubled - 9
            else:
                checksum += d
        
        expected_check = (10 - (checksum % 10)) % 10
        if digits[-1] != expected_check:
            return ValidationResult(
                False,
                f"Ogiltig kontrollsiffra för bankgiro",
                "bankgiro",
                bg_nr
            )
        
        return ValidationResult(True, "Giltigt bankgironummer", "bankgiro", bg_nr)
    
    # === PLUSGIRO ===
    
    @staticmethod
    def validate_plusgiro(pg_nr: str) -> ValidationResult:
        """
        Validerar plusgironummer.
        Format: N-NNNNNN eller liknande (2-8 siffror)
        """
        clean = re.sub(r'[^0-9]', '', pg_nr)
        
        if len(clean) < 2 or len(clean) > 8:
            return ValidationResult(
                False,
                "Plusgironummer måste vara 2-8 siffror",
                "plusgiro",
                pg_nr
            )
        
        # Samma Luhn-algoritm som bankgiro
        digits = [int(d) for d in clean]
        checksum = 0
        for i, d in enumerate(reversed(digits[:-1])):
            if i % 2 == 0:
                doubled = d * 2
                checksum += doubled if doubled < 10 else doubled - 9
            else:
                checksum += d
        
        expected_check = (10 - (checksum % 10)) % 10
        if digits[-1] != expected_check:
            return ValidationResult(
                False,
                "Ogiltig kontrollsiffra för plusgiro",
                "plusgiro",
                pg_nr
            )
        
        return ValidationResult(True, "Giltigt plusgironummer", "plusgiro", pg_nr)
    
    # === PERSONNUMMER ===
    
    @staticmethod
    def validate_personal_number(pnr: str) -> ValidationResult:
        """
        Validerar svenskt personnummer.
        Format: ÅÅMMDD-NNNN eller ÅÅÅÅMMDD-NNNN
        """
        clean = re.sub(r'[^0-9]', '', pnr)
        
        # Konvertera 12-siffrigt till 10-siffrigt
        if len(clean) == 12:
            clean = clean[2:]
        
        if len(clean) != 10:
            return ValidationResult(
                False,
                "Personnummer måste vara 10 eller 12 siffror",
                "personal_number",
                pnr
            )
        
        # Validera datum (grundläggande)
        month = int(clean[2:4])
        day = int(clean[4:6])
        
        if month < 1 or month > 12:
            return ValidationResult(
                False,
                f"Ogiltig månad: {month}",
                "personal_number",
                pnr
            )
        
        if day < 1 or day > 31:
            return ValidationResult(
                False,
                f"Ogiltig dag: {day}",
                "personal_number",
                pnr
            )
        
        # Luhn-algoritm
        digits = [int(d) for d in clean]
        checksum = 0
        for i in range(9):
            d = digits[i]
            if i % 2 == 0:
                doubled = d * 2
                checksum += doubled if doubled < 10 else doubled - 9
            else:
                checksum += d
        
        expected_check = (10 - (checksum % 10)) % 10
        if digits[9] != expected_check:
            return ValidationResult(
                False,
                "Ogiltig kontrollsiffra",
                "personal_number",
                pnr
            )
        
        return ValidationResult(True, "Giltigt personnummer", "personal_number", pnr)
    
    # === MOMSBERÄKNING ===
    
    @staticmethod
    def validate_vat_calculation(net: Decimal, vat: Decimal, 
                                  rate_percent: int,
                                  tolerance: Decimal = Decimal("0.05")) -> ValidationResult:
        """
        Validerar att momsbelopp är korrekt beräknat.
        
        Args:
            net: Nettobelopp (exkl. moms)
            vat: Momsbelopp
            rate_percent: Momssats i procent (25, 12, 6, 0)
            tolerance: Tillåten avvikelse i SEK
        """
        rate = Decimal(str(rate_percent)) / Decimal("100")
        expected_vat = net * rate
        diff = abs(vat - expected_vat)
        
        if diff > tolerance:
            return ValidationResult(
                False,
                f"Moms {vat:.2f} stämmer inte med {rate_percent}% av {net:.2f} "
                f"(förväntat {expected_vat:.2f}, diff {diff:.2f})",
                "vat_calculation"
            )
        
        return ValidationResult(True, "Momsberäkning OK", "vat_calculation")
    
    @staticmethod
    def validate_gross_amount(net: Decimal, vat: Decimal, gross: Decimal,
                               tolerance: Decimal = Decimal("0.05")) -> ValidationResult:
        """
        Validerar att bruttobelopp = netto + moms.
        """
        expected_gross = net + vat
        diff = abs(gross - expected_gross)
        
        if diff > tolerance:
            return ValidationResult(
                False,
                f"Bruttobelopp {gross:.2f} ≠ netto {net:.2f} + moms {vat:.2f} "
                f"(förväntat {expected_gross:.2f})",
                "gross_amount"
            )
        
        return ValidationResult(True, "Bruttobelopp OK", "gross_amount")
    
    # === BAS-KONTO ===
    
    @staticmethod
    def validate_bas_account(account: str) -> ValidationResult:
        """
        Validerar BAS-kontonummer.
        Format: 4 siffror, börjar med 1-8
        """
        if not re.match(r'^[1-8]\d{3}$', account):
            return ValidationResult(
                False,
                f"Ogiltigt BAS-konto: {account} (ska vara 4 siffror, börja med 1-8)",
                "bas_account",
                account
            )
        
        # Kontrollera kontoklass
        account_class = int(account[0])
        class_names = {
            1: "Tillgångar",
            2: "Eget kapital och skulder",
            3: "Intäkter",
            4: "Kostnader för varor/material",
            5: "Övriga externa kostnader",
            6: "Övriga externa kostnader",
            7: "Personalkostnader",
            8: "Finansiella poster"
        }
        
        return ValidationResult(
            True,
            f"Giltigt BAS-konto ({class_names.get(account_class, 'Okänd klass')})",
            "bas_account",
            account
        )


class TransactionValidator:
    """Validerar hela transaktioner"""
    
    def __init__(self):
        self.validators = SwedishValidators()
    
    def validate_ev_charging_transaction(self, transaction: dict) -> list[ValidationResult]:
        """
        Validerar elbilsladdningstransaktion.
        
        Förväntar dict med: amount, subAmount, vat, vatRate, kwh, transactionName
        """
        results = []
        
        # Kontrollera att alla nödvändiga fält finns
        required = ['amount', 'subAmount', 'vat', 'vatRate']
        for field in required:
            if field not in transaction:
                results.append(ValidationResult(
                    False, f"Fält saknas: {field}", field
                ))
        
        if results:
            return results
        
        net = Decimal(str(transaction['subAmount']))
        vat = Decimal(str(transaction['vat']))
        gross = Decimal(str(transaction['amount']))
        rate = int(transaction['vatRate'])
        
        # Validera momsberäkning
        results.append(self.validators.validate_vat_calculation(
            abs(net), abs(vat), rate
        ))
        
        # Validera bruttobelopp
        results.append(self.validators.validate_gross_amount(
            abs(net), abs(vat), abs(gross)
        ))
        
        # Validera kWh om det finns
        if 'kwh' in transaction and transaction['kwh']:
            kwh = Decimal(str(transaction['kwh']))
            if kwh < 0:
                results.append(ValidationResult(
                    False, "kWh kan inte vara negativt", "kwh"
                ))
            elif kwh > 500:  # Rimlighetskontroll
                results.append(ValidationResult(
                    False, f"Osannolikt högt kWh-värde: {kwh}", "kwh"
                ))
        
        return results


# CLI-stöd
if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 3:
        print("Användning: python validators.py <typ> <värde>")
        print("Typer: org, vat, bg, pg, pnr")
        sys.exit(1)
    
    validator_type = sys.argv[1].lower()
    value = sys.argv[2]
    
    validators = SwedishValidators()
    
    type_map = {
        "org": validators.validate_org_number,
        "vat": validators.validate_vat_number,
        "bg": validators.validate_bankgiro,
        "pg": validators.validate_plusgiro,
        "pnr": validators.validate_personal_number
    }
    
    if validator_type not in type_map:
        print(f"Okänd typ: {validator_type}")
        sys.exit(1)
    
    result = type_map[validator_type](value)
    print(f"{'✓' if result.is_valid else '✗'} {result.message}")
    sys.exit(0 if result.is_valid else 1)

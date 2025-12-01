#!/usr/bin/env python3
"""Create test Excel file for VAT analysis"""
import pandas as pd
from decimal import Decimal

# Sample EV charging transactions
transactions = [
    # Sales with 25% VAT
    {
        "id": "TX001",
        "amount": 125.00,
        "subAmount": 100.00,
        "vat": 25.00,
        "vatRate": 25,
        "transactionName": "Elbilsladdning - Station 1",
        "kwh": 20.5
    },
    {
        "id": "TX002",
        "amount": 250.00,
        "subAmount": 200.00,
        "vat": 50.00,
        "vatRate": 25,
        "transactionName": "Elbilsladdning - Station 2",
        "kwh": 41.0
    },
    # Roaming (0% VAT)
    {
        "id": "TX003",
        "amount": 150.00,
        "subAmount": 150.00,
        "vat": 0.00,
        "vatRate": 0,
        "transactionName": "Roaming intäkter - Hubject",
        "kwh": 30.0
    },
    # Costs (negative amounts)
    {
        "id": "TX004",
        "amount": -50.00,
        "subAmount": -40.00,
        "vat": -10.00,
        "vatRate": 25,
        "transactionName": "Plattformsavgift - Monta",
    },
    {
        "id": "TX005",
        "amount": -25.00,
        "subAmount": -20.00,
        "vat": -5.00,
        "vatRate": 25,
        "transactionName": "Abonnemangskostnad",
    },
]

# Create DataFrame
df = pd.DataFrame(transactions)

# Save to Excel
output_file = "test_transactions.xlsx"
df.to_excel(output_file, index=False, engine='openpyxl')

print(f"✅ Created test Excel file: {output_file}")
print(f"   Transactions: {len(df)}")
print(f"   Sales: {len(df[df['amount'] > 0])}")
print(f"   Costs: {len(df[df['amount'] < 0])}")

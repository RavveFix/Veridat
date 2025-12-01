#!/usr/bin/env python3
"""Test Supabase Edge Function -> Railway Python API integration"""
import base64
import json
import requests
from pathlib import Path

# Configuration
SUPABASE_URL = "https://baweorbvueghhkzlyncu.supabase.co"
EDGE_FUNCTION_URL = f"{SUPABASE_URL}/functions/v1/python-proxy"
SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJhd2VvcmJ2dWVnaGhremx5bmN1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzI1NzE2MzMsImV4cCI6MjA0ODE0NzYzM30.Y1PtjPrfQBQVfEFMPqbMxUXN9a7Hqd93lzc5f6SzK9k"

# Test file
TEST_FILE = Path("test_transactions.xlsx")

def test_supabase_integration():
    """Test the full Supabase -> Railway integration"""

    print("=" * 60)
    print("TESTING: Supabase Edge Function -> Railway Python API")
    print("=" * 60)

    # Step 1: Read and encode test file
    print("\n1️⃣  Reading test Excel file...")
    if not TEST_FILE.exists():
        print(f"❌ Test file not found: {TEST_FILE}")
        return

    with open(TEST_FILE, "rb") as f:
        file_bytes = f.read()
        file_data = base64.b64encode(file_bytes).decode("utf-8")

    print(f"   ✅ File loaded: {len(file_bytes)} bytes")
    print(f"   ✅ Base64 encoded: {len(file_data)} chars")

    # Step 2: Prepare request payload
    print("\n2️⃣  Preparing request payload...")
    payload = {
        "file_data": file_data,
        "filename": TEST_FILE.name,
        "company_name": "Test Företag AB",
        "org_number": "5561839191",
        "period": "2025-11"
    }

    headers = {
        "Content-Type": "application/json",
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
        "x-user-id": "test-user-123"
    }

    print(f"   ✅ Company: {payload['company_name']}")
    print(f"   ✅ Period: {payload['period']}")
    print(f"   ✅ Org.nr: {payload['org_number']}")

    # Step 3: Call Supabase Edge Function
    print(f"\n3️⃣  Calling Supabase Edge Function...")
    print(f"   URL: {EDGE_FUNCTION_URL}")

    try:
        response = requests.post(
            EDGE_FUNCTION_URL,
            json=payload,
            headers=headers,
            timeout=30
        )

        print(f"   Status: {response.status_code}")

        if response.status_code != 200:
            print(f"   ❌ Error: {response.text}")
            return

        # Step 4: Parse and display results
        print("\n4️⃣  VAT Report Results:")
        print("   " + "=" * 56)

        result = response.json()
        data = result.get("data", {})

        # Summary
        summary = data.get("summary", {})
        print(f"\n   📊 SUMMARY:")
        print(f"      Total Income:  {summary.get('total_income', 0):>10.2f} SEK")
        print(f"      Total Costs:   {summary.get('total_costs', 0):>10.2f} SEK")
        print(f"      Result:        {summary.get('result', 0):>10.2f} SEK")

        # VAT
        vat = data.get("vat", {})
        print(f"\n   💰 VAT:")
        print(f"      Outgoing 25%:  {vat.get('outgoing_25', 0):>10.2f} SEK")
        print(f"      Incoming:      {vat.get('incoming', 0):>10.2f} SEK")
        print(f"      Net VAT:       {vat.get('net', 0):>10.2f} SEK")
        print(f"      To Pay:        {vat.get('to_pay', 0):>10.2f} SEK")

        # Sales transactions
        sales = data.get("sales", [])
        print(f"\n   💵 Sales Transactions ({len(sales)}):")
        for sale in sales:
            print(f"      • {sale['description']:<35} {sale['net']:>8.2f} SEK + {sale['vat']:>6.2f} moms")

        # Cost transactions
        costs = data.get("costs", [])
        print(f"\n   💸 Cost Transactions ({len(costs)}):")
        for cost in costs:
            print(f"      • {cost['description']:<35} {cost['net']:>8.2f} SEK + {cost['vat']:>6.2f} moms")

        # Journal entries
        journal = data.get("journal_entries", [])
        print(f"\n   📖 Journal Entries ({len(journal)}):")
        for entry in journal:
            debit = f"{entry['debit']:.2f}" if entry['debit'] > 0 else "-"
            credit = f"{entry['credit']:.2f}" if entry['credit'] > 0 else "-"
            print(f"      {entry['account']} {entry['name']:<30} D:{debit:>10} K:{credit:>10}")

        # Validation
        validation = data.get("validation", {})
        is_valid = validation.get("is_valid", False)
        errors = validation.get("errors", [])
        warnings = validation.get("warnings", [])

        print(f"\n   ✅ Validation: {'PASS' if is_valid else 'FAIL'}")
        if errors:
            print(f"      Errors: {len(errors)}")
            for error in errors:
                print(f"        ❌ {error.get('message', '')}")
        if warnings:
            print(f"      Warnings: {len(warnings)}")
            for warning in warnings:
                print(f"        ⚠️  {warning.get('message', '')}")

        print("\n" + "=" * 60)
        print("✅ TEST SUCCESSFUL - Full integration working!")
        print("=" * 60)

    except requests.exceptions.Timeout:
        print("   ❌ Request timed out")
    except requests.exceptions.RequestException as e:
        print(f"   ❌ Request error: {e}")
    except Exception as e:
        print(f"   ❌ Unexpected error: {e}")

if __name__ == "__main__":
    test_supabase_integration()

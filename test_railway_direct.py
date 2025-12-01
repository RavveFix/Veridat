#!/usr/bin/env python3
"""Test Railway Python API directly"""
import base64
import json
import requests
from pathlib import Path

# Configuration
RAILWAY_URL = "https://britta-production.up.railway.app"
TEST_FILE = Path("test_transactions.xlsx")

def test_railway_api():
    """Test the Railway Python API directly"""

    print("=" * 60)
    print("TESTING: Railway Python API (Direct)")
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

    # Step 2: Prepare request payload
    print("\n2️⃣  Calling Railway API...")
    payload = {
        "file_data": file_data,
        "filename": TEST_FILE.name,
        "company_name": "Test Företag AB",
        "org_number": "5561839191",
        "period": "2025-11"
    }

    url = f"{RAILWAY_URL}/api/v1/vat/analyze"
    print(f"   URL: {url}")

    try:
        response = requests.post(
            url,
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=30
        )

        print(f"   Status: {response.status_code}")

        if response.status_code != 200:
            print(f"   ❌ Error: {response.text}")
            return

        # Step 3: Parse and display results
        print("\n3️⃣  VAT Report Results:")
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
        print(f"\n   💵 Sales ({len(sales)} transactions):")
        for sale in sales:
            print(f"      • {sale['description']:<35} {sale['net']:>8.2f} + {sale['vat']:>6.2f} moms")

        # Costs
        costs = data.get("costs", [])
        print(f"\n   💸 Costs ({len(costs)} transactions):")
        for cost in costs:
            print(f"      • {cost['description']:<35} {cost['net']:>8.2f} + {cost['vat']:>6.2f} moms")

        # Validation
        validation = data.get("validation", {})
        is_valid = validation.get("is_valid", False)
        print(f"\n   ✅ Validation: {'PASS ✓' if is_valid else 'FAIL ✗'}")

        print("\n" + "=" * 60)
        print("✅ TEST SUCCESSFUL - Railway API working!")
        print("=" * 60)

    except Exception as e:
        print(f"   ❌ Error: {e}")

if __name__ == "__main__":
    test_railway_api()

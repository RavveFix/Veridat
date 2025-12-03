import requests
import os
import sys
import base64
import json
from decimal import Decimal

BASE_URL = "http://localhost:8080"
TEST_FILE = "test_transactions.xlsx"

# Expected values from user requirement
EXPECTED_VALUES = {
    "vat_out_25": 16.29,
    "vat_in": 101.54,
    "vat_net": -85.25,
    "total_sales": 298.81,
    "total_costs": 426.48
}

def test_health():
    print("Testing /health...")
    try:
        response = requests.get(f"{BASE_URL}/health")
        if response.status_code == 200:
            print("✅ /health is OK")
            print(f"   Response: {response.json()}")
            return True
        else:
            print(f"❌ /health failed with {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ /health failed: {e}")
        return False

def test_vat_analyze():
    print(f"\nTesting /api/v1/vat/analyze with {TEST_FILE}...")
    if not os.path.exists(TEST_FILE):
        print(f"❌ Test file {TEST_FILE} not found")
        return False, None

    try:
        # Read and encode file as base64 (API expects JSON with base64 data)
        with open(TEST_FILE, 'rb') as f:
            file_data = base64.b64encode(f.read()).decode('utf-8')
        
        # Prepare JSON request
        payload = {
            "file_data": file_data,
            "filename": TEST_FILE,
            "company_name": "Test AB",
            "org_number": "",
            "period": "2024-01"
        }
        
        response = requests.post(
            f"{BASE_URL}/api/v1/vat/analyze",
            json=payload,
            headers={"Content-Type": "application/json"}
        )
        
        if response.status_code == 200:
            result = response.json()
            print("✅ /api/v1/vat/analyze succeeded")
            
            # Extract data from nested response structure
            if 'data' in result:
                data = result['data']
            else:
                data = result
            
            # Verify calculations
            print("\n--- VAT Calculation Results ---")
            vat_summary = data.get('vat', {})
            sales_data = data.get('sales', [])
            costs_data = data.get('costs', [])
            
            actual_vat_out_25 = vat_summary.get('outgoing_25', 0)
            actual_vat_in = vat_summary.get('incoming', 0)
            actual_vat_net = vat_summary.get('net', 0)
            
            # Calculate totals
            total_sales = sum(item.get('net', 0) for item in sales_data)
            total_costs = sum(item.get('net', 0) for item in costs_data)
            
            print(f"Utgående moms 25%:  {actual_vat_out_25:.2f} SEK (expected: {EXPECTED_VALUES['vat_out_25']:.2f})")
            print(f"Ingående moms:      {actual_vat_in:.2f} SEK (expected: {EXPECTED_VALUES['vat_in']:.2f})")
            print(f"Nettomoms:          {actual_vat_net:.2f} SEK (expected: {EXPECTED_VALUES['vat_net']:.2f})")
            print(f"Total försäljning:  {total_sales:.2f} SEK (expected: {EXPECTED_VALUES['total_sales']:.2f})")
            print(f"Totala kostnader:   {total_costs:.2f} SEK (expected: {EXPECTED_VALUES['total_costs']:.2f})")
            
            # Check if values match (with small tolerance for floating point)
            tolerance = 0.02
            checks = {
                "vat_out_25": abs(actual_vat_out_25 - EXPECTED_VALUES['vat_out_25']) < tolerance,
                "vat_in": abs(actual_vat_in - EXPECTED_VALUES['vat_in']) < tolerance,
                "vat_net": abs(actual_vat_net - EXPECTED_VALUES['vat_net']) < tolerance,
                "total_sales": abs(total_sales - EXPECTED_VALUES['total_sales']) < tolerance,
                "total_costs": abs(total_costs - EXPECTED_VALUES['total_costs']) < tolerance
            }
            
            all_match = all(checks.values())
            
            print(f"\n{'✅' if all_match else '❌'} Calculation verification: {'PASSED' if all_match else 'FAILED'}")
            if not all_match:
                print("   Mismatches:")
                for key, matches in checks.items():
                    if not matches:
                        print(f"   - {key}")
            
            return all_match, data
        else:
            print(f"❌ /api/v1/vat/analyze failed with {response.status_code}")
            print(f"   Response: {response.text}")
            return False, None
    except Exception as e:
        print(f"❌ /api/v1/vat/analyze failed: {e}")
        import traceback
        traceback.print_exc()
        return False, None

def test_error_handling():
    print("\nTesting error handling (invalid base64)...")
    try:
        payload = {
            "file_data": "invalid_base64_data",
            "filename": "test.xlsx",
            "company_name": "",
            "org_number": "",
            "period": ""
        }
        response = requests.post(
            f"{BASE_URL}/api/v1/vat/analyze",
            json=payload,
            headers={"Content-Type": "application/json"}
        )
        if response.status_code in [400, 422, 500]:
            print(f"✅ Error handling working (got {response.status_code})")
            return True
        else:
            print(f"❌ Error handling failed (got {response.status_code}, expected 4xx or 500)")
            return False
    except Exception as e:
        print(f"❌ Error handling test failed: {e}")
        return False

if __name__ == "__main__":
    print("=" * 60)
    print("Python API Verification Script")
    print("=" * 60)
    
    health_ok = test_health()
    analyze_ok, data = test_vat_analyze()
    error_ok = test_error_handling()
    
    print("\n" + "=" * 60)
    print("Summary:")
    print(f"  Health check: {'✅ PASS' if health_ok else '❌ FAIL'}")
    print(f"  VAT analysis: {'✅ PASS' if analyze_ok else '❌ FAIL'}")
    print(f"  Error handling: {'✅ PASS' if error_ok else '❌ FAIL'}")
    print("=" * 60)
    
    if not (health_ok and analyze_ok and error_ok):
        sys.exit(1)
    
    print("\n✅ All tests passed!")
    sys.exit(0)

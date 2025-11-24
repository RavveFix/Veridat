#!/bin/bash

# Base URL
API_URL="http://localhost:3001/api/browse"

echo "🤖 Britta Test Drive Initiated"
echo "-----------------------------"

# 1. Navigate to Fortnox
echo "📍 Navigating to https://www.fortnox.se..."
curl -s -X POST $API_URL \
  -H "Content-Type: application/json" \
  -d '{"action": "goto", "url": "https://www.fortnox.se"}' | grep -o '"result":"[^"]*"'
echo ""

# 2. Wait for Login Button
echo "⏳ Waiting for 'Logga in' button..."
SELECTOR="a[href*='login']"
curl -s -X POST $API_URL \
  -H "Content-Type: application/json" \
  -d "{\"action\": \"wait\", \"selector\": \"$SELECTOR\"}" | grep -o '"result":"[^"]*"'
echo ""

# 3. Click Login Button
echo "👆 Clicking 'Logga in'..."
curl -s -X POST $API_URL \
  -H "Content-Type: application/json" \
  -d "{\"action\": \"click\", \"selector\": \"$SELECTOR\"}" | grep -o '"result":"[^"]*"'
echo ""

echo "-----------------------------"
echo "✅ Test Drive Complete"

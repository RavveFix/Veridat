#!/bin/bash

# Send a request to click a non-existent element
response=$(curl -s -X POST http://localhost:3001/api/browse \
  -H "Content-Type: application/json" \
  -d '{
    "action": "click",
    "selector": "#non-existent-element-12345",
    "timeout": 2000
  }')

# Check if response contains "screenshot" and "error"
if echo "$response" | grep -q "screenshot" && echo "$response" | grep -q "error"; then
  echo "✅ Success: Error response contains screenshot."
else
  echo "❌ Failure: Error response missing screenshot."
  echo "Response: $response"
fi

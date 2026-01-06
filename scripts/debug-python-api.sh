#!/bin/bash
# Debug script for Python API issues

echo "🔍 Debugging Python API Connection..."
echo ""

# Step 1: Check if Railway is up
echo "1️⃣ Finding Railway URL from git remote..."
RAILWAY_URL=$(git remote -v | grep railway | head -1 | sed -n 's/.*railway.app\/\([^ ]*\).*/\1/p')

if [ -z "$RAILWAY_URL" ]; then
    echo "❌ No Railway remote found in git"
    echo "   Run: railway link"
else
    echo "✅ Railway project detected"
fi

echo ""
echo "2️⃣ Checking Railway deployment..."
echo "   Visit: https://railway.app/project/britta"
echo "   Or run: railway status"
echo ""

# Step 2: Get the actual production URL
echo "3️⃣ Python API URL should be something like:"
echo "   https://britta-production.up.railway.app"
echo "   https://python-api-production.up.railway.app"
echo ""
echo "   To get your actual URL, run:"
echo "   railway domain"
echo ""

# Step 3: Test the Python API directly
echo "4️⃣ Testing Python API Health Check..."
echo ""
read -p "Enter your Railway Python API URL (or press Enter to skip): " API_URL

if [ ! -z "$API_URL" ]; then
    # Remove trailing slash
    API_URL=${API_URL%/}

    echo ""
    echo "Testing: $API_URL/health"

    RESPONSE=$(curl -s -w "\n%{http_code}" "$API_URL/health")
    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    BODY=$(echo "$RESPONSE" | head -n-1)

    echo "HTTP Status: $HTTP_CODE"
    echo "Response: $BODY"

    if [ "$HTTP_CODE" = "200" ]; then
        echo ""
        echo "✅ Python API is UP and responding!"
        echo ""
        echo "Now set this URL in Supabase:"
        echo "  supabase secrets set PYTHON_API_URL=\"$API_URL\""
    else
        echo ""
        echo "❌ Python API returned error $HTTP_CODE"
        echo "   Check Railway logs: railway logs"
    fi
else
    echo "⏭️  Skipped health check"
fi

echo ""
echo "5️⃣ Current Supabase Secrets:"
supabase secrets list | grep -E "(PYTHON_API_URL|PYTHON_API_KEY|CLAUDE_API_KEY)"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎯 Quick Fix Commands:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "# Set Python API URL (Railway production URL)"
echo "supabase secrets set PYTHON_API_URL=\"https://your-app.up.railway.app\""
echo ""
echo "# Optional: Set Python API Key (if you have one)"
echo "supabase secrets set PYTHON_API_KEY=\"your-key\""
echo ""
echo "# Deploy python-proxy to pick up new secrets"
echo "supabase functions deploy python-proxy"
echo ""

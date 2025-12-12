#!/bin/bash
# Test Python API connection through Edge Function

echo "🔍 Testing Python API Connection..."
echo ""

# Test 1: Check if local Python API is running
echo "1️⃣ Testing LOCAL Python API (http://localhost:8080)"
HEALTH=$(curl -s http://localhost:8080/health 2>/dev/null)
if [ $? -eq 0 ]; then
    echo "✅ Local Python API is UP"
    echo "   Response: $HEALTH"
else
    echo "❌ Local Python API is DOWN or not accessible"
fi
echo ""

# Test 2: Check Supabase Edge Function logs
echo "2️⃣ To check Edge Function logs, visit:"
echo "   https://supabase.com/dashboard/project/baweorbvueghhkzlyncu/logs/edge-functions"
echo ""

# Test 3: Show current PYTHON_API_URL (hashed)
echo "3️⃣ Current Supabase secrets:"
supabase secrets list | grep PYTHON_API_URL
echo ""

# Test 4: Suggest fix
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔧 POSSIBLE SOLUTIONS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Option A: Update PYTHON_API_URL to your Railway deployment"
echo "  1. Find your Railway URL in: https://railway.app/dashboard"
echo "  2. Run: supabase secrets set PYTHON_API_URL=\"https://your-app.up.railway.app\""
echo "  3. Redeploy Edge Function: supabase functions deploy python-proxy"
echo ""
echo "Option B: Use local Python API temporarily"
echo "  1. Make sure Python API is running: cd python-api && uvicorn app.main:app --port 8080"
echo "  2. Set local URL: supabase secrets set PYTHON_API_URL=\"http://host.docker.internal:8080\""
echo "  3. Note: This only works for local development!"
echo ""
echo "Option C: Debug Railway deployment"
echo "  1. Check Railway logs for errors"
echo "  2. Verify environment variables are set correctly"
echo "  3. Check if deployment succeeded"

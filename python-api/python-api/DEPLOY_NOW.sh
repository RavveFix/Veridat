#!/bin/bash
# Quick Railway Deployment Script
# Run this from: /Users/ravonstrawder/Desktop/Britta/python-api

set -e

echo "🚀 Britta VAT API - Railway Deployment"
echo "======================================"
echo ""

# Verify we're in the right directory
if [ ! -f "Procfile" ]; then
    echo "❌ Error: Procfile not found. Are you in the python-api directory?"
    exit 1
fi

echo "✅ Files verified"
echo ""

# Step 1: Login
echo "📝 Step 1: Login to Railway"
echo "This will open your browser for authentication..."
echo ""
railway login

echo ""
echo "✅ Login successful!"
echo ""

# Step 2: Initialize
echo "📝 Step 2: Initialize Railway project"
echo "Creating new project: britta-vat-api"
echo ""
railway init

echo ""
echo "✅ Project initialized!"
echo ""

# Step 3: Deploy
echo "📝 Step 3: Deploying to Railway..."
echo "This may take a few minutes..."
echo ""
railway up

echo ""
echo "✅ Deployment complete!"
echo ""

# Step 4: Set environment variables
echo "📝 Step 4: Setting environment variables..."
echo ""
railway variables set ENV=production
railway variables set DEBUG=false
railway variables set ALLOWED_ORIGINS="*"

echo ""
echo "✅ Environment variables set!"
echo ""

# Step 5: Get URL
echo "📝 Step 5: Getting deployment URL..."
echo ""
railway domain

echo ""
echo "🎉 Deployment Complete!"
echo ""
echo "Next steps:"
echo "1. Test your API: curl https://your-url.railway.app/health"
echo "2. Copy your Railway URL"
echo "3. Continue to Phase 3: Supabase Integration"
echo ""

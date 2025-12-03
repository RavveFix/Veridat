#!/bin/bash
# Script to set Claude API key in Supabase

echo "🔑 Setting Claude API key in Supabase..."
echo ""
echo "Paste your Claude API key (starts with sk-ant-...):"
read -s CLAUDE_KEY

if [[ ! $CLAUDE_KEY =~ ^sk-ant- ]]; then
    echo "❌ Error: Key should start with 'sk-ant-'"
    echo "   Please get your key from: https://console.anthropic.com/settings/keys"
    exit 1
fi

echo ""
echo "Setting key in Supabase..."
supabase secrets set CLAUDE_API_KEY="$CLAUDE_KEY"

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Success! Claude API key has been set."
    echo ""
    echo "Next steps:"
    echo "1. Wait 30 seconds for Supabase to apply the change"
    echo "2. Test Excel analysis in your app"
    echo ""
else
    echo "❌ Failed to set key. Check your Supabase connection."
    exit 1
fi

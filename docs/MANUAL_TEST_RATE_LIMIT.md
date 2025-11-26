# Manual Test Instructions for Rate Limiting

## Quick Test (2 minutes)

Open browser console (F12) and paste this:

```javascript
// Test rate limiting by sending 11 messages
async function testRateLimit() {
  const input = document.getElementById('user-input');
  const form = document.getElementById('chat-form');
  
  for(let i = 1; i <= 11; i++) {
    console.log(`Sending message ${i}...`);
    input.value = 'Test message ' + i;
    
    // Trigger form submit
    const submitButton = document.querySelector('#chat-form button[type="submit"]');
    submitButton.click();
    
    // Wait 800ms between messages
    await new Promise(resolve => setTimeout(resolve, 800));
  }
  
  console.log('All messages sent! Check if banner appeared after message 11.');
}

// Run the test
testRateLimit();
```

## Expected Results:

1. Messages 1-10: Normal responses
2. Message 11: ⚡ **Banner should slide down!**
3. Chat shows: "⚠️ Du har nått din dagliga gräns för AI-frågor..."

## Verify in Supabase:

1. Go to Table Editor → `api_usage`
2. You should see: `request_count: 10` (or 11+)

## Debugging:

If it doesn't work:
- Check browser console for errors
- Check if `showRateLimitBanner` function exists (type in console)
- Verify fetch request includes `x-user-id` header (Network tab)
- Check Supabase `api_usage` table for data

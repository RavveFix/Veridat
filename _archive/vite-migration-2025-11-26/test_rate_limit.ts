#!/usr/bin/env deno run --allow-net

// Test script to verify rate limiting on Gemini Chat endpoint

const SUPABASE_URL = "https://baweorbvueghhkzlyncu.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJhd2VvcmJ2dWVnaGhremx5bmN1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MTYzNjM5NTYsImV4cCI6MjAzMTkzOTk1Nn0.ZRx_YALaPu6aP0jh8Y-u3gMY4P2wKz1gQ_bWdOOGLVI"; // Anon key is safe to expose

const GEMINI_CHAT_URL = `${SUPABASE_URL}/functions/v1/gemini-chat`;
const TEST_USER_ID = "test-user-" + Date.now();

console.log("🧪 Testing Rate Limiting System");
console.log("================================");
console.log(`Endpoint: ${GEMINI_CHAT_URL}`);
console.log(`Test User ID: ${TEST_USER_ID}`);
console.log(`Hourly Limit: 10 requests`);
console.log("");

async function sendRequest(requestNum: number) {
    const start = Date.now();

    try {
        const response = await fetch(GEMINI_CHAT_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "apikey": SUPABASE_ANON_KEY,
                "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
                "x-user-id": TEST_USER_ID
            },
            body: JSON.stringify({
                message: `Test message ${requestNum}`
            })
        });

        const duration = Date.now() - start;
        const data = await response.json();

        if (response.status === 429) {
            console.log(`❌ Request #${requestNum}: RATE LIMITED (${response.status})`);
            console.log(`   Message: ${data.message}`);
            console.log(`   Remaining: ${data.remaining}`);
            console.log(`   Reset At: ${data.resetAt}`);
            console.log(`   Duration: ${duration}ms`);
            return { success: false, rateLimited: true };
        } else if (response.ok) {
            const remaining = response.headers.get('X-RateLimit-Remaining');
            console.log(`✅ Request #${requestNum}: SUCCESS (${response.status})`);
            console.log(`   Remaining: ${remaining || 'unknown'}`);
            console.log(`   Duration: ${duration}ms`);
            return { success: true, rateLimited: false };
        } else {
            console.log(`⚠️  Request #${requestNum}: ERROR (${response.status})`);
            console.log(`   Error: ${JSON.stringify(data)}`);
            console.log(`   Duration: ${duration}ms`);
            return { success: false, rateLimited: false };
        }
    } catch (error) {
        console.log(`💥 Request #${requestNum}: FAILED`);
        console.log(`   Error: ${error.message}`);
        return { success: false, rateLimited: false };
    }
}

// Send 12 requests to trigger the rate limit
console.log("Sending 12 requests to trigger hourly limit (10 requests/hour)...\n");

let successCount = 0;
let rateLimitedCount = 0;

for (let i = 1; i <= 12; i++) {
    const result = await sendRequest(i);

    if (result.success) successCount++;
    if (result.rateLimited) rateLimitedCount++;

    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 100));
}

console.log("\n================================");
console.log("📊 Test Results:");
console.log(`   ✅ Successful: ${successCount}`);
console.log(`   ❌ Rate Limited: ${rateLimitedCount}`);
console.log(`   Expected: 10 successful, 2 rate limited`);

if (successCount === 10 && rateLimitedCount === 2) {
    console.log("\n🎉 Rate limiting is working correctly!");
} else {
    console.log("\n⚠️  Rate limiting behavior differs from expected");
}

# Chat History & Conversation Persistence

## Overview

The Veridat chat system implements full **database persistence** for conversations. This ensures that:
1.  **Context Memory**: The AI remembers previous messages within a conversation.
2.  **Persistence**: Chat history is saved to Supabase and persists across browser refreshes.
3.  **Multi-Device Sync**: Users can access their conversation history from any device.
4.  **Company Separation**: Each company has its own distinct conversation thread.

---

## Architecture

### 1. Database Schema

**Migration File:** [`20251127000001_create_conversations.sql`](file:///Users/ravonstrawder/Desktop/Britta/supabase/migrations/20251127000001_create_conversations.sql)

-   **`conversations`**: Stores conversation metadata (user_id, company_id, title).
-   **`messages`**: Stores individual messages (role, content, file attachments).  
    Attachments are uploaded to Supabase Storage (`chat-files`) and linked via `file_url` + `file_name`.  
    Analysresultat som momsrapporter sparas dessutom i `messages.metadata` (typ `vat_report`) så de kan öppnas igen i sidopanelen.
-   **`vat_reports`**: Stores the latest Excel analysis per conversation (`conversation_id`). This is used to rehydrate VAT context after refresh and to inject context into Gemini when the sidebar report isn’t currently open.
-   **Security**: Row Level Security (RLS) ensures users only access their own data.

### 2. Backend (Edge Function)

**File:** [`supabase/functions/gemini-chat/index.ts`](file:///Users/ravonstrawder/Desktop/Britta/supabase/functions/gemini-chat/index.ts)

The Edge Function acts as the orchestrator:
1.  Receives message + `conversationId` from frontend.
2.  Retrieves full conversation history from database.
3.  Sends history + new message to Gemini API.
4.  **Saves User Message**: Inserts the user's message into the `messages` table.
5.  **Saves AI Response**: Inserts the AI's response into the `messages` table.
6.  Returns the response to the frontend.

**Critical Note:** The Edge Function must return a specific JSON structure for the frontend to parse:
```json
{
  "type": "text",
  "data": "AI response content..."
}
```

### 3. Frontend Logic

**File:** [`src/main.ts`](file:///Users/ravonstrawder/Desktop/Britta/src/main.ts)

The frontend handles the user experience and state management:
-   **Initialization**: Listens for `onAuthStateChange` to load the conversation immediately upon login.
-   **Robust Fetching**: In `sendToGemini`, it checks if `conversationId` is missing. If so, it calls `get_or_create_conversation` RPC to fetch/create it on-demand. This prevents race conditions where the app loads before the conversation ID is ready.
-   **Excel Analysis Persistence**: Ensures a `conversationId` exists before starting Excel analysis and sends `conversation_id` to `analyze-excel-ai` / `python-proxy` so results are stored in `vat_reports`.
-   **Display**: Renders chat history directly from the database query, ensuring what the user sees matches what the AI knows.

---

## Critical Implementation Details (For Developers)

### 1. Race Conditions & Auth
We encountered a race condition where the app would initialize before the Auth session was fully established (especially with Magic Links).
**Fix:** We added `supabase.auth.onAuthStateChange` in `initApp()` to trigger `loadConversationFromDB` as soon as the `SIGNED_IN` event fires.

### 2. Robust Conversation ID
The `conversationId` is critical. If it's missing, messages won't be saved.
**Fix:** We implemented a "lazy fetch" pattern in `sendToGemini`. Before sending a message, we verify `conversationId`. If it's null, we fetch it immediately using the `get_or_create_conversation` RPC function.

### 3. Deployment
**Important:** When working with Supabase Edge Functions, local changes to `supabase/functions/...` are **NOT** automatically reflected in the cloud environment even if the frontend connects to the cloud.
**Action:** You MUST run `supabase functions deploy [function-name]` to push changes to production.

---

## Troubleshooting Guide

### Issue: AI doesn't remember previous messages
*   **Cause:** The `history` array passed to Gemini is empty.
*   **Check:**
    1.  Is `conversationId` correct in the frontend?
    2.  Are messages actually saved in the `messages` table? (Check Supabase Dashboard)
    3.  Is the Edge Function retrieving history correctly?

### Issue: "No Answer" (AI is silent)
*   **Cause:** The Edge Function response format doesn't match what the frontend expects.
*   **Check:** Ensure the Edge Function returns `{ type: 'text', data: '...' }`. If it returns raw text or a different structure, the frontend will ignore it.

### Issue: Messages not saving
*   **Cause:** RLS policies or missing `conversationId`.
*   **Check:**
    1.  Is the user logged in? (RLS blocks anonymous writes)
    2.  Is `conversationId` being sent to the Edge Function?
    3.  Check Edge Function logs for database insertion errors.

---

## Future Improvements
-   **Conversation Management**: Add UI to list and switch between old conversations.
-   **Search**: Implement full-text search for messages.
-   **Export**: Allow users to export chat history.

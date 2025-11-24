# Fortnox Integration Migration Walkthrough

We have successfully migrated the Fortnox integration from the legacy Node.js Express server to Supabase Edge Functions. This consolidates your backend and improves security.

## Changes Overview

1.  **New Fortnox Service (`supabase/services/FortnoxService.ts`)**
    - Handles OAuth2 authentication and token refresh.
    - Securely stores tokens in Supabase Database.
    - Provides methods for `createInvoiceDraft`, `getCustomers`, and `getArticles`.

2.  **New Edge Function (`supabase/functions/fortnox/`)**
    - Dedicated endpoint for Fortnox operations.
    - Protected by Supabase Auth (Service Role).

3.  **Updated Gemini Chat (`supabase/functions/gemini-chat/`)**
    - Now supports Fortnox tools (`create_invoice`, `get_customers`, `get_articles`).
    - Returns structured data for the frontend to render (e.g., Invoice Draft Card).

4.  **Frontend Updates (`app/src/js/main.js`)**
    - Updated to point to Supabase Edge Functions.
    - Preserved the "Draft Card" UI flow for invoice creation.

## Setup Instructions

### 1. Database Migration
Run the SQL migration to create the token table:
```sql
-- Run in Supabase SQL Editor
create table if not exists fortnox_tokens (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id),
  access_token text not null,
  refresh_token text not null,
  expires_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);
alter table fortnox_tokens enable row level security;
```

### 2. Environment Variables
Ensure your `.env` or Supabase Secrets have:
- `FORTNOX_CLIENT_ID`
- `FORTNOX_CLIENT_SECRET`
- `GEMINI_API_KEY`

### 3. Initial Token Setup
You need to manually insert your first Fortnox tokens into the `fortnox_tokens` table. You can do this via the Supabase Dashboard or SQL:
```sql
INSERT INTO fortnox_tokens (access_token, refresh_token, expires_at)
VALUES ('your_access_token', 'your_refresh_token', NOW() + interval '1 hour');
```

## Verification (Supabase Cloud)

1.  **Deployment Complete**
    - Database migrations pushed.
    - Edge Functions (`gemini-chat`, `fortnox`) deployed.
    - Secrets set from `supabase/.env`.

2.  **Frontend Setup**
    - `app/src/js/main.js` has been updated to point to your production Supabase project: `https://baweorbvueghhkzlyncu.supabase.co`.

3.  **Initial Token Setup (Critical)**
    - You must insert your Fortnox tokens into the **production** database.
    - Go to the [Supabase Dashboard SQL Editor](https://supabase.com/dashboard/project/baweorbvueghhkzlyncu/sql).
    - Run the following SQL (replace with your actual tokens):
    ```sql
    INSERT INTO fortnox_tokens (access_token, refresh_token, expires_at)
    VALUES ('your_access_token', 'your_refresh_token', NOW() + interval '1 hour');
    ```

4.  **Test Chat**
    - Open your local frontend: **http://localhost:8080/app/**
    - Ask: "Skapa en faktura till [Kundnamn]".
    - The request will now go to the **live Supabase Cloud** functions.

3.  **Test Token Refresh**
    - If your access token expires, the `FortnoxService` will automatically use the refresh token to get a new one and update the database.

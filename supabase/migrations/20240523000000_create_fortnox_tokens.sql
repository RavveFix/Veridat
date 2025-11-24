-- Create table for storing Fortnox tokens
create table if not exists fortnox_tokens (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id), -- Optional: link to a specific user if needed
  access_token text not null,
  refresh_token text not null,
  expires_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Enable Row Level Security
alter table fortnox_tokens enable row level security;

-- Create policy to allow only authenticated users (or service role) to view/update
-- For this agent, we might rely on the service_role key in the Edge Function to bypass RLS,
-- or we can set up a policy for authenticated users.

-- Policy: Allow service role full access (implicit, but good to be aware of)

-- Policy: Allow authenticated users to read their own tokens (if we link to user_id)
create policy "Users can view their own tokens"
  on fortnox_tokens for select
  using (auth.uid() = user_id);

create policy "Users can update their own tokens"
  on fortnox_tokens for update
  using (auth.uid() = user_id);

-- For the initial setup where we might not have a user_id yet or it's a system-wide token:
-- We can create a policy that allows access if user_id is null (system token)
-- BUT: It's safer to rely on the Edge Function using the SERVICE_ROLE_KEY to access this table
-- and keep RLS strict for public/anon users.

-- Deny access to anon key
create policy "Deny anon access"
  on fortnox_tokens for all
  to anon
  using (false);

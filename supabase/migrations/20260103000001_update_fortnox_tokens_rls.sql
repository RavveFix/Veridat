-- Update Fortnox tokens RLS policies
-- Add insert and delete policies for authenticated users

-- Allow users to insert their own tokens
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'fortnox_tokens'
      and policyname = 'Users can insert their own tokens'
  ) then
    create policy "Users can insert their own tokens"
      on fortnox_tokens for insert
      with check (auth.uid() = user_id);
  end if;
end
$$;

-- Allow users to delete their own tokens
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'fortnox_tokens'
      and policyname = 'Users can delete their own tokens'
  ) then
    create policy "Users can delete their own tokens"
      on fortnox_tokens for delete
      using (auth.uid() = user_id);
  end if;
end
$$;

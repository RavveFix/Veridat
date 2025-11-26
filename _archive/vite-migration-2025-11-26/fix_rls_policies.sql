-- Fix RLS policies for api_usage table
-- The service role needs INSERT and UPDATE permissions, not just SELECT and ALL

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view own usage" ON api_usage;
DROP POLICY IF EXISTS "Service role has full access" ON api_usage;

-- Policy 1: Users can only SELECT their own usage
CREATE POLICY "Users can view own usage"
    ON api_usage FOR SELECT
    USING (auth.uid() = user_id);

-- Policy 2: Service role can INSERT (for creating records)
CREATE POLICY "Service role can insert"
    ON api_usage FOR INSERT
    WITH CHECK (true);

-- Policy 3: Service role can UPDATE (for incrementing counts)
CREATE POLICY "Service role can update"
    ON api_usage FOR UPDATE
    USING (true);

-- Policy 4: Service role can SELECT (for checking counts)
CREATE POLICY "Service role can select"
    ON api_usage FOR SELECT
    USING (true);

-- Verify policies
SELECT tablename, policyname, cmd, qual, with_check 
FROM pg_policies 
WHERE tablename = 'api_usage';

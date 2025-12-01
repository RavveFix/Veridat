-- Migration: Optimize RLS policies to fix performance warnings
-- Description: Wraps auth.uid() and auth.role() in subselects to prevent re-evaluation per row.
--              Consolidates overlapping permissive policies.

-- ============================================================
-- 1. fortnox_tokens
-- ============================================================

-- Fix auth_rls_initplan warnings
DROP POLICY IF EXISTS "Users can view their own tokens" ON fortnox_tokens;
CREATE POLICY "Users can view their own tokens" ON fortnox_tokens
    FOR SELECT USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update their own tokens" ON fortnox_tokens;
CREATE POLICY "Users can update their own tokens" ON fortnox_tokens
    FOR UPDATE USING ((SELECT auth.uid()) = user_id);

-- Fix multiple permissive policies (conflicting with "Deny anon access")
-- "Deny anon access" is redundant if we have specific allow policies for authenticated users
DROP POLICY IF EXISTS "Deny anon access" ON fortnox_tokens;


-- ============================================================
-- 2. api_usage
-- ============================================================

-- Drop redundant service role policies that cause overlaps
DROP POLICY IF EXISTS "Service role can insert" ON api_usage;
DROP POLICY IF EXISTS "Service role can select" ON api_usage;
DROP POLICY IF EXISTS "Service role can update" ON api_usage;

-- Optimize "Users can view own usage"
DROP POLICY IF EXISTS "Users can view own usage" ON api_usage;
CREATE POLICY "Users can view own usage" ON api_usage
    FOR SELECT 
    USING ((SELECT auth.uid()) = user_id);

-- Optimize "Service role has full access"
DROP POLICY IF EXISTS "Service role has full access" ON api_usage;
CREATE POLICY "Service role has full access" ON api_usage
    FOR ALL
    USING ((SELECT auth.role()) = 'service_role');


-- ============================================================
-- 3. files
-- ============================================================

-- Drop the overly permissive policy that conflicts with specific ones
DROP POLICY IF EXISTS "Allow all access to files for now" ON files;

-- Optimize user policies
DROP POLICY IF EXISTS "Users can view own files" ON files;
CREATE POLICY "Users can view own files" ON files
    FOR SELECT
    USING ((SELECT auth.uid())::text = user_id);

DROP POLICY IF EXISTS "Users can insert own files" ON files;
CREATE POLICY "Users can insert own files" ON files
    FOR INSERT
    WITH CHECK ((SELECT auth.uid())::text = user_id);

DROP POLICY IF EXISTS "Users can update own files" ON files;
CREATE POLICY "Users can update own files" ON files
    FOR UPDATE
    USING ((SELECT auth.uid())::text = user_id);

DROP POLICY IF EXISTS "Users can delete own files" ON files;
CREATE POLICY "Users can delete own files" ON files
    FOR DELETE
    USING ((SELECT auth.uid())::text = user_id);


-- ============================================================
-- 4. conversations
-- ============================================================

DROP POLICY IF EXISTS "Users can view own conversations" ON conversations;
CREATE POLICY "Users can view own conversations" ON conversations
    FOR SELECT
    USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can create own conversations" ON conversations;
CREATE POLICY "Users can create own conversations" ON conversations
    FOR INSERT
    WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update own conversations" ON conversations;
CREATE POLICY "Users can update own conversations" ON conversations
    FOR UPDATE
    USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can delete own conversations" ON conversations;
CREATE POLICY "Users can delete own conversations" ON conversations
    FOR DELETE
    USING ((SELECT auth.uid()) = user_id);


-- ============================================================
-- 5. messages
-- ============================================================

DROP POLICY IF EXISTS "Users can view messages in their conversations" ON messages;
CREATE POLICY "Users can view messages in their conversations" ON messages
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM conversations
            WHERE conversations.id = messages.conversation_id
            AND conversations.user_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "Users can insert messages in their conversations" ON messages;
CREATE POLICY "Users can insert messages in their conversations" ON messages
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM conversations
            WHERE conversations.id = messages.conversation_id
            AND conversations.user_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "Users can update messages in their conversations" ON messages;
CREATE POLICY "Users can update messages in their conversations" ON messages
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM conversations
            WHERE conversations.id = messages.conversation_id
            AND conversations.user_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "Users can delete messages in their conversations" ON messages;
CREATE POLICY "Users can delete messages in their conversations" ON messages
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM conversations
            WHERE conversations.id = messages.conversation_id
            AND conversations.user_id = (SELECT auth.uid())
        )
    );


-- ============================================================
-- 6. profiles
-- ============================================================

DROP POLICY IF EXISTS "Users can insert their own profile." ON profiles;
CREATE POLICY "Users can insert their own profile." ON profiles
    FOR INSERT 
    WITH CHECK ((SELECT auth.uid()) = id);

DROP POLICY IF EXISTS "Users can update own profile." ON profiles;
CREATE POLICY "Users can update own profile." ON profiles
    FOR UPDATE 
    USING ((SELECT auth.uid()) = id);

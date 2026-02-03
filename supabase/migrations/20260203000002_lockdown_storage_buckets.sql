-- Lock down storage buckets for user-owned documents
-- Date: 2026-02-03

-- 1) Make sensitive buckets private
UPDATE storage.buckets
SET public = false
WHERE id IN ('chat-files', 'excel-files');

-- 2) Remove public or overly permissive policies
DROP POLICY IF EXISTS "Public can view chat files" ON storage.objects;
DROP POLICY IF EXISTS "Public read access to excel-files" ON storage.objects;
DROP POLICY IF EXISTS "Allow file uploads to excel-files" ON storage.objects;
DROP POLICY IF EXISTS "Allow file deletions from excel-files" ON storage.objects;

-- 3) Recreate chat-files policies with per-user folder scoping
DROP POLICY IF EXISTS "Authenticated users can upload chat files" ON storage.objects;
CREATE POLICY "Authenticated users can upload chat files"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'chat-files'
    AND auth.uid()::text = (storage.foldername(name))[1]
);

DROP POLICY IF EXISTS "Authenticated users can view chat files" ON storage.objects;
CREATE POLICY "Authenticated users can view chat files"
ON storage.objects FOR SELECT
TO authenticated
USING (
    bucket_id = 'chat-files'
    AND auth.uid()::text = (storage.foldername(name))[1]
);

DROP POLICY IF EXISTS "Users can delete chat files" ON storage.objects;
CREATE POLICY "Users can delete chat files"
ON storage.objects FOR DELETE
TO authenticated
USING (
    bucket_id = 'chat-files'
    AND auth.uid()::text = (storage.foldername(name))[1]
);

-- 4) Ensure excel-files uploads remain user-scoped (leave existing strict policies in place)
-- (Policies from 20251125000002_auth_and_rls.sql already enforce user folder and owner checks.)

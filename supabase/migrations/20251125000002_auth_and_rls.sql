-- Enable RLS on files table
ALTER TABLE files ENABLE ROW LEVEL SECURITY;

-- Update files table to link to auth.users
-- Note: user_id is currently TEXT, we should ideally change it to UUID referencing auth.users
-- But for now, we'll keep it as TEXT to avoid breaking existing data, but RLS will check against auth.uid()::text

-- Policy: Users can only see their own files
CREATE POLICY "Users can view own files" ON files
    FOR SELECT
    USING (auth.uid()::text = user_id);

-- Policy: Users can insert their own files
CREATE POLICY "Users can insert own files" ON files
    FOR INSERT
    WITH CHECK (auth.uid()::text = user_id);

-- Policy: Users can update their own files
CREATE POLICY "Users can update own files" ON files
    FOR UPDATE
    USING (auth.uid()::text = user_id);

-- Policy: Users can delete their own files
CREATE POLICY "Users can delete own files" ON files
    FOR DELETE
    USING (auth.uid()::text = user_id);


-- Storage Policies for 'excel-files' bucket

-- Allow authenticated users to upload files
CREATE POLICY "Authenticated users can upload files"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'excel-files' AND auth.uid()::text = (storage.foldername(name))[1]);
-- Note: This assumes folder structure like {user_id}/{filename}
-- If we are storing in root, we might need a different check, or rely on the filename containing user_id
-- For now, let's allow authenticated uploads generally, but restrict SELECT

-- Allow users to view their own files
CREATE POLICY "Users can view own storage files"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'excel-files' AND owner = auth.uid());

-- Allow users to delete their own files
CREATE POLICY "Users can delete own storage files"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'excel-files' AND owner = auth.uid());

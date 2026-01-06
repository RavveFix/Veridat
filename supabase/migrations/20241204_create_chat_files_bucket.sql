-- Create chat-files bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-files', 'chat-files', true)
ON CONFLICT (id) DO NOTHING;

-- Policy to allow authenticated users to upload files
CREATE POLICY "Authenticated users can upload chat files"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'chat-files');

-- Policy to allow authenticated users to view files
CREATE POLICY "Authenticated users can view chat files"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'chat-files');

-- Policy to allow public access (if needed for reading)
CREATE POLICY "Public can view chat files"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'chat-files');

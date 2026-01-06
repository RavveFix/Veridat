-- Idempotent migration to create chat-files bucket
DO $$
BEGIN
    -- Create bucket if not exists
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('chat-files', 'chat-files', true)
    ON CONFLICT (id) DO NOTHING;
END $$;

-- Create policies safely
DO $$
BEGIN
    -- Upload policy
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'objects' 
        AND policyname = 'Authenticated users can upload chat files'
    ) THEN
        CREATE POLICY "Authenticated users can upload chat files"
        ON storage.objects FOR INSERT
        TO authenticated
        WITH CHECK (bucket_id = 'chat-files');
    END IF;

    -- View policy
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'objects' 
        AND policyname = 'Authenticated users can view chat files'
    ) THEN
        CREATE POLICY "Authenticated users can view chat files"
        ON storage.objects FOR SELECT
        TO authenticated
        USING (bucket_id = 'chat-files');
    END IF;
    
    -- Public view policy (optional but good for debugging)
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'objects' 
        AND policyname = 'Public can view chat files'
    ) THEN
        CREATE POLICY "Public can view chat files"
        ON storage.objects FOR SELECT
        TO public
        USING (bucket_id = 'chat-files');
    END IF;
END $$;

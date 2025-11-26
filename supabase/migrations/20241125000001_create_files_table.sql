-- Create files table for storing Excel file metadata
CREATE TABLE IF NOT EXISTS files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filename TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    file_size BIGINT NOT NULL,
    mime_type TEXT NOT NULL,
    uploaded_at TIMESTAMPTZ DEFAULT NOW(),
    user_id TEXT DEFAULT 'anonymous',
    company_id TEXT,
    CONSTRAINT files_filename_check CHECK (char_length(filename) > 0),
    CONSTRAINT files_storage_path_check CHECK (char_length(storage_path) > 0)
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_files_user_id ON files(user_id);
CREATE INDEX IF NOT EXISTS idx_files_company_id ON files(company_id);
CREATE INDEX IF NOT EXISTS idx_files_uploaded_at ON files(uploaded_at DESC);

-- Enable Row Level Security
ALTER TABLE files ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Allow all operations for now (can be restricted later based on auth)
CREATE POLICY "Allow all access to files for now"
    ON files
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- Create storage bucket for Excel files
INSERT INTO storage.buckets (id, name, public)
VALUES ('excel-files', 'excel-files', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: Allow public read, authenticated/anonymous upload
CREATE POLICY "Public read access to excel-files"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'excel-files');

CREATE POLICY "Allow file uploads to excel-files"
    ON storage.objects FOR INSERT
    WITH CHECK (bucket_id = 'excel-files');

CREATE POLICY "Allow file deletions from excel-files"
    ON storage.objects FOR DELETE
    USING (bucket_id = 'excel-files');

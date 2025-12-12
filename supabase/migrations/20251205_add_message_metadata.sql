-- Add metadata column to messages table for storing VAT reports and other structured data
-- This allows Excel analysis results to persist across page refreshes

ALTER TABLE public.messages 
ADD COLUMN IF NOT EXISTS metadata JSONB;

-- Add comment for documentation
COMMENT ON COLUMN public.messages.metadata IS 'Optional metadata like VAT reports, file analysis results, etc.';

-- Create an index for efficient querying of messages with metadata
CREATE INDEX IF NOT EXISTS idx_messages_metadata_type 
ON public.messages ((metadata->>'type')) 
WHERE metadata IS NOT NULL;

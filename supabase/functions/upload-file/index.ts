// Supabase Edge Function for File Upload
/// <reference path="../../types/deno.d.ts" />

// @ts-expect-error - Deno npm: specifier
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-user-id",
};

interface UploadRequest {
    filename: string;
    fileData: string; // base64 encoded file
    mimeType: string;
    userId?: string;
    companyId?: string;
}

Deno.serve(async (req: Request) => {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const { filename, fileData, mimeType, userId, companyId }: UploadRequest = await req.json();

        if (!filename || !fileData || !mimeType) {
            return new Response(
                JSON.stringify({ error: "filename, fileData, and mimeType are required" }),
                {
                    status: 400,
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                }
            );
        }

        // Initialize Supabase client with user's token
        const authHeader = req.headers.get('Authorization')!;
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

        // Create client with the user's token to respect RLS
        const supabase = createClient(supabaseUrl, supabaseAnonKey, {
            global: { headers: { Authorization: authHeader } },
        });

        // Get user from auth to ensure valid token
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError || !user) {
            return new Response(
                JSON.stringify({ error: "Unauthorized" }),
                { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Decode base64 file data
        const base64Data = fileData.split(',')[1] || fileData;
        const fileBuffer = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));

        // Generate unique file path
        const timestamp = Date.now();
        const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
        const storagePath = `${timestamp}_${sanitizedFilename}`;

        // Upload file to Supabase Storage
        const { data: uploadData, error: uploadError } = await supabase.storage
            .from('excel-files')
            .upload(storagePath, fileBuffer, {
                contentType: mimeType,
                upsert: false
            });

        if (uploadError) {
            console.error('Storage upload error:', uploadError);
            return new Response(
                JSON.stringify({ error: `Failed to upload file: ${uploadError.message}` }),
                {
                    status: 500,
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                }
            );
        }

        // Get public URL
        const { data: urlData } = supabase.storage
            .from('excel-files')
            .getPublicUrl(storagePath);

        // Insert file metadata into database
        const { data: fileRecord, error: dbError } = await supabase
            .from('files')
            .insert({
                filename: filename,
                storage_path: storagePath,
                file_size: fileBuffer.length,
                mime_type: mimeType,
                user_id: user.id,
                company_id: companyId || null
            })
            .select()
            .single();

        if (dbError) {
            console.error('Database insert error:', dbError);
            // Try to clean up uploaded file
            await supabase.storage.from('excel-files').remove([storagePath]);

            return new Response(
                JSON.stringify({ error: `Failed to save file metadata: ${dbError.message}` }),
                {
                    status: 500,
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                }
            );
        }

        // Return success with file metadata
        return new Response(
            JSON.stringify({
                success: true,
                file: {
                    id: fileRecord.id,
                    filename: fileRecord.filename,
                    url: urlData.publicUrl,
                    storagePath: fileRecord.storage_path,
                    fileSize: fileRecord.file_size,
                    mimeType: fileRecord.mime_type,
                    uploadedAt: fileRecord.uploaded_at
                }
            }),
            {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
        );

    } catch (error) {
        console.error("Upload function error:", error);
        return new Response(
            JSON.stringify({
                error: error instanceof Error ? error.message : "Internal server error"
            }),
            {
                status: 500,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
        );
    }
});

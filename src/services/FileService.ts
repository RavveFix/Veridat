/**
 * FileService - File handling for Britta
 *
 * Handles:
 * - File to base64 conversion
 * - File validation
 * - File type detection
 * - Upload to Supabase Storage
 */

import { supabase } from '../lib/supabase';
import { logger } from './LoggerService';

export type FileType = 'excel' | 'pdf' | 'image' | 'unknown';
export type AnalysisBackend = 'python' | 'gemini' | 'claude';

export interface FileValidationResult {
    valid: boolean;
    error?: string;
    fileType: FileType;
    suggestedBackend: AnalysisBackend;
}

export interface Base64Result {
    data: string;
    mimeType: string;
    originalLength: number;
    paddedLength: number;
}

// File size limits
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_EXCEL_SIZE = 5 * 1024 * 1024; // 5MB for Excel

// Supported MIME types
const MIME_TYPES = {
    excel: [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel'
    ],
    pdf: ['application/pdf'],
    image: ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
} as const;

class FileServiceClass {
    /**
     * Convert file to base64
     */
    async toBase64(file: File): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const result = reader.result as string;
                resolve(result);
            };
            reader.onerror = () => {
                reject(new Error('Failed to read file'));
            };
            reader.readAsDataURL(file);
        });
    }

    /**
     * Convert file to base64 with proper padding and metadata
     */
    async toBase64WithPadding(file: File): Promise<Base64Result> {
        const fullBase64 = await this.toBase64(file);

        if (!fullBase64 || !fullBase64.includes(',')) {
            throw new Error('Invalid file: could not convert to base64');
        }

        // Extract base64 data (remove data URL prefix)
        let base64Data = fullBase64.split(',')[1];
        const originalLength = base64Data.length;

        if (!base64Data || base64Data.length < 10) {
            throw new Error(`Invalid base64 data: too short (${base64Data?.length || 0} characters)`);
        }

        // Ensure proper base64 padding (must be multiple of 4)
        while (base64Data.length % 4 !== 0) {
            base64Data += '=';
        }

        logger.debug('Base64 conversion complete', {
            originalLength,
            paddedLength: base64Data.length,
            paddingAdded: base64Data.length - originalLength
        });

        return {
            data: base64Data,
            mimeType: file.type,
            originalLength,
            paddedLength: base64Data.length
        };
    }

    /**
     * Detect file type from file object
     */
    detectFileType(file: File): FileType {
        const extension = file.name.toLowerCase().split('.').pop() || '';
        const mimeType = file.type.toLowerCase();

        // Check by extension
        if (['xlsx', 'xls'].includes(extension)) {
            return 'excel';
        }
        if (extension === 'pdf') {
            return 'pdf';
        }
        if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(extension)) {
            return 'image';
        }

        // Check by MIME type
        if (MIME_TYPES.excel.some(m => mimeType.includes(m))) {
            return 'excel';
        }
        if (MIME_TYPES.pdf.some(m => mimeType.includes(m))) {
            return 'pdf';
        }
        if (MIME_TYPES.image.some(m => mimeType.includes(m))) {
            return 'image';
        }

        return 'unknown';
    }

    /**
     * Determine which backend should analyze this file
     */
    getSuggestedBackend(fileType: FileType): AnalysisBackend {
        switch (fileType) {
            case 'excel':
                return 'python'; // Python API for VAT calculations
            case 'pdf':
            case 'image':
                return 'gemini'; // Gemini for document analysis
            default:
                return 'gemini';
        }
    }

    /**
     * Validate a file before processing
     */
    validate(file: File): FileValidationResult {
        const fileType = this.detectFileType(file);
        const suggestedBackend = this.getSuggestedBackend(fileType);

        // Check file size
        const maxSize = fileType === 'excel' ? MAX_EXCEL_SIZE : MAX_FILE_SIZE;
        if (file.size > maxSize) {
            const actualSizeMB = (file.size / (1024 * 1024)).toFixed(1);
            const maxSizeMB = Math.round(maxSize / (1024 * 1024));
            return {
                valid: false,
                error: `Filen är för stor (${actualSizeMB}MB). Max storlek är ${maxSizeMB}MB. Försök med en mindre fil eller exportera bara de relevanta raderna.`,
                fileType,
                suggestedBackend
            };
        }

        // Check if file is empty
        if (file.size === 0) {
            return {
                valid: false,
                error: 'Filen är tom.',
                fileType,
                suggestedBackend
            };
        }

        // Check file type is supported
        if (fileType === 'unknown') {
            return {
                valid: false,
                error: 'Filtypen stöds inte. Använd Excel, PDF eller bilder.',
                fileType,
                suggestedBackend
            };
        }

        return {
            valid: true,
            fileType,
            suggestedBackend
        };
    }

    /**
     * Check if file is an Excel file
     */
    isExcel(file: File): boolean {
        return this.detectFileType(file) === 'excel';
    }

    /**
     * Check if file is a PDF
     */
    isPdf(file: File): boolean {
        return this.detectFileType(file) === 'pdf';
    }

    /**
     * Check if file is an image
     */
    isImage(file: File): boolean {
        return this.detectFileType(file) === 'image';
    }

    /**
     * Upload file to Supabase Storage
     */
    async uploadToStorage(file: File, bucket = 'chat-files'): Promise<string> {
        logger.startTimer('file-upload');

        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                throw new Error('Inte inloggad');
            }

            // Generate unique filename
            const timestamp = Date.now();
            const safeFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
            const filePath = `${session.user.id}/${timestamp}_${safeFileName}`;

            // Upload to Supabase Storage
            const { data, error } = await supabase.storage
                .from(bucket)
                .upload(filePath, file, {
                    cacheControl: '3600',
                    upsert: false
                });

            if (error) {
                throw error;
            }

            // Get public URL
            const { data: { publicUrl } } = supabase.storage
                .from(bucket)
                .getPublicUrl(data.path);

            logger.endTimer('file-upload');
            logger.info('File uploaded to storage', {
                path: data.path,
                size: file.size
            });

            return publicUrl;
        } catch (error) {
            logger.endTimer('file-upload');
            logger.error('File upload failed', error);
            throw error;
        }
    }

    /**
     * Get file size in human-readable format
     */
    formatFileSize(bytes: number): string {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    /**
     * Extract file extension
     */
    getExtension(filename: string): string {
        return filename.toLowerCase().split('.').pop() || '';
    }

    /**
     * Generate a unique filename
     */
    generateUniqueFilename(originalName: string): string {
        const extension = this.getExtension(originalName);
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 8);
        return `${timestamp}_${random}.${extension}`;
    }
}

// Singleton instance
export const fileService = new FileServiceClass();

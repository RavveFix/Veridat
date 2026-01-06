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
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { TextContent, TextItem } from 'pdfjs-dist/types/src/display/api';

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

export type Base64ResultWithPage = Base64Result & { pageNumber: number };

export interface PdfExtractionResult {
    documentText: string;
    pageImages: Base64ResultWithPage[];
    totalPages: number;
    extractedPages: number;
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
    private ensureBase64Padding(base64Data: string): { padded: string; originalLength: number; paddedLength: number } {
        const originalLength = base64Data.length;
        let padded = base64Data;
        while (padded.length % 4 !== 0) {
            padded += '=';
        }
        return {
            padded,
            originalLength,
            paddedLength: padded.length
        };
    }

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
        const rawBase64Data = fullBase64.split(',')[1];
        if (!rawBase64Data) {
            throw new Error('Invalid file: missing base64 payload');
        }

        if (rawBase64Data.length < 10) {
            throw new Error(`Invalid base64 data: too short (${rawBase64Data.length} characters)`);
        }

        const { padded: base64Data, originalLength, paddedLength } = this.ensureBase64Padding(rawBase64Data);

        logger.debug('Base64 conversion complete', {
            originalLength,
            paddedLength,
            paddingAdded: paddedLength - originalLength
        });

        return {
            data: base64Data,
            mimeType: file.type,
            originalLength,
            paddedLength
        };
    }

    /**
     * Extract text (and optionally page images) from a PDF for chat.
     *
     * - Extracts up to `maxPages` (default: 4) since users typically send 3–4 pages.
     * - Uses deterministic text extraction first (best for exact numbers).
     * - Renders images only for pages with little/no extractable text (scanned PDFs).
     */
    async extractPdfForChat(
        file: File,
        options: {
            maxPages?: number;
            maxWidth?: number;
            imageType?: 'image/jpeg' | 'image/png';
            jpegQuality?: number;
            minTextCharsPerPage?: number;
        } = {}
    ): Promise<PdfExtractionResult> {
        const maxPages = options.maxPages ?? 4;
        const maxWidth = options.maxWidth ?? 1200;
        const imageType = options.imageType ?? 'image/jpeg';
        const jpegQuality = options.jpegQuality ?? 0.85;
        const minTextCharsPerPage = options.minTextCharsPerPage ?? 40;

        const pdfjs = await import('pdfjs-dist');
        const workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
        pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

        const arrayBuffer = await file.arrayBuffer();
        const pdf: PDFDocumentProxy = await pdfjs.getDocument({ data: arrayBuffer }).promise;

        const totalPages = pdf.numPages;
        const extractedPages = Math.min(totalPages, maxPages);

        const pageTexts: string[] = [];
        const pagesNeedingImages: number[] = [];

        for (let pageNumber = 1; pageNumber <= extractedPages; pageNumber++) {
            const page = await pdf.getPage(pageNumber);
            const textContent: TextContent = await page.getTextContent();
            const pageText = textContent.items
                .map((item) => ('str' in item ? (item as TextItem).str : ''))
                .filter(Boolean)
                .join(' ')
                .replace(/\s+/g, ' ')
                .trim();

            pageTexts.push(`--- Sida ${pageNumber} ---\n${pageText}`);

            if (pageText.length < minTextCharsPerPage) {
                pagesNeedingImages.push(pageNumber);
            }
        }

        const documentText = pageTexts.join('\n\n').trim();

        const pageImages: Base64ResultWithPage[] = [];
        if (pagesNeedingImages.length > 0) {
            for (const pageNumber of pagesNeedingImages) {
                const page = await pdf.getPage(pageNumber);
                const initialViewport = page.getViewport({ scale: 1 });
                const scale = Math.min(2, maxWidth / initialViewport.width);
                const viewport = page.getViewport({ scale });

                const canvas = document.createElement('canvas');
                canvas.width = Math.floor(viewport.width);
                canvas.height = Math.floor(viewport.height);

                const ctx = canvas.getContext('2d', { alpha: false });
                if (!ctx) {
                    throw new Error('Kunde inte skapa canvas-kontekst för PDF-rendering');
                }

                await page.render({ canvasContext: ctx, viewport }).promise;

                const dataUrl = imageType === 'image/png'
                    ? canvas.toDataURL('image/png')
                    : canvas.toDataURL('image/jpeg', jpegQuality);

                const rawBase64 = dataUrl.split(',')[1] || '';
                const { padded, originalLength, paddedLength } = this.ensureBase64Padding(rawBase64);

                pageImages.push({
                    pageNumber,
                    data: padded,
                    mimeType: imageType,
                    originalLength,
                    paddedLength
                });
            }
        }

        return {
            documentText,
            pageImages,
            totalPages,
            extractedPages
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
     * @param file - The file to upload
     * @param bucket - Storage bucket name (default: 'chat-files')
     * @param companyId - Optional company ID to associate with the file
     */
    async uploadToStorage(file: File, bucket = 'chat-files', companyId?: string): Promise<string> {
        logger.startTimer('file-upload');

        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                throw new Error('Inte inloggad');
            }

            // Generate unique filename with company folder for organization
            const timestamp = Date.now();
            const safeFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
            const companyPath = companyId || 'default';
            const filePath = `${session.user.id}/${companyPath}/${timestamp}_${safeFileName}`;

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
                size: file.size,
                companyId: companyId || 'default'
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

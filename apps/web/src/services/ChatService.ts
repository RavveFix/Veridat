/**
 * ChatService - Chat and messaging for Britta
 *
 * Handles:
 * - Sending messages to Gemini AI
 * - Excel analysis routing (Python API / Claude fallback)
 * - Conversation management
 * - Message history
 */

import { supabase } from '../lib/supabase';
import { logger } from './LoggerService';
import { fileService } from './FileService';
import { companyManager } from './CompanyService';
import type { VATReportResponse } from '../types/vat';

type RateLimitEventDetail = {
    remaining: number;
    resetAt: string | null;
    message?: string | null;
};

function toNumberOrNull(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return null;
}

async function extractRateLimitDetail(response: Response): Promise<RateLimitEventDetail> {
    let remaining = toNumberOrNull(response.headers.get('X-RateLimit-Remaining')) ?? 0;
    let resetAt = response.headers.get('X-RateLimit-Reset');
    let message: string | null = null;

    try {
        const data = await response.clone().json() as Record<string, unknown>;
        remaining = toNumberOrNull(data.remaining) ?? remaining;
        resetAt = typeof data.resetAt === 'string' ? data.resetAt : resetAt;
        message = typeof data.message === 'string' ? data.message : message;
    } catch {
        // Ignore parse errors (non-JSON body, etc.)
    }

    return { remaining, resetAt, message };
}

export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    file_url?: string | null;
    file_name?: string | null;
    created_at?: string;
}

export interface GeminiResponse {
    type: 'text' | 'json';
    data: string | Record<string, unknown>;
    toolError?: {
        error: string;
        errorType: string;
        tool: string;
        userFriendlyMessage: string;
        actionSuggestion?: string;
    };
}

export interface AnalysisResult {
    success: boolean;
    response?: VATReportResponse;
    error?: string;
    backend: 'python' | 'claude' | 'ai' | 'edge';
}

export interface AIAnalysisProgress {
    step: 'parsing' | 'analyzing' | 'mapping' | 'normalizing' | 'calculating' | 'complete' | 'error';
    message: string;
    progress: number;
    details?: Record<string, unknown>;
    report?: VATReportResponse;
    error?: string;
}

export type ProgressCallback = (progress: AIAnalysisProgress) => void;

class ChatServiceClass {
    private supabaseUrl: string;

    constructor() {
        this.supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    }

    /**
     * Send a message to Gemini AI with streaming support
     */
    async sendToGemini(
        message: string,
        file: File | null = null,
        fileUrl: string | null = null,
        vatReportContext: Record<string, unknown> | null = null,
        onStreamingChunk?: (chunk: string) => void
    ): Promise<GeminiResponse> {
        logger.startTimer('gemini-chat');

        try {
            // Prepare file data if present
            let fileData: { data: string; mimeType: string } | null = null;
            let fileDataPages: Array<{ pageNumber?: number; data: string; mimeType: string }> | null = null;
            let documentText: string | null = null;

            if (file) {
                if (fileService.isPdf(file)) {
                    try {
                        const pdf = await fileService.extractPdfForChat(file);
                        documentText = pdf.documentText || null;

                        if (pdf.pageImages.length > 0) {
                            fileDataPages = pdf.pageImages.map((p) => ({
                                pageNumber: p.pageNumber,
                                data: p.data,
                                mimeType: p.mimeType
                            }));
                        }
                    } catch (pdfError) {
                        logger.warn('PDF extraction failed, falling back to raw upload payload', { error: pdfError });
                        const base64Result = await fileService.toBase64WithPadding(file);
                        fileData = {
                            data: base64Result.data,
                            mimeType: base64Result.mimeType
                        };
                    }
                } else {
                    const base64Result = await fileService.toBase64WithPadding(file);
                    fileData = {
                        data: base64Result.data,
                        mimeType: base64Result.mimeType
                    };
                }
            }

            // Get current company and conversation ID
            const company = companyManager.getCurrent();
            let conversationId = company.conversationId;

            if (!conversationId) {
                const newConversationId = await this.getOrCreateConversation(company.id);
                if (newConversationId) {
                    conversationId = newConversationId;
                    companyManager.setConversationId(conversationId);
                }
            }

            const history = conversationId
                ? await this.getRecentHistory(conversationId, 20)
                : [];

            const { data: { session } } = await supabase.auth.getSession();
            if (!session) throw new Error('Not authenticated');

            // Use direct fetch for streaming support
            const response = await fetch(`${this.supabaseUrl}/functions/v1/gemini-chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.access_token}`
                },
                body: JSON.stringify({
                    message,
                    fileData,
                    fileDataPages,
                    documentText,
                    history,
                    conversationId,
                    companyId: company.id,
                    fileUrl,
                    fileName: file?.name || null,
                    vatReportContext
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
                throw new Error(errorData.message || errorData.error || `HTTP ${response.status}`);
            }

            // Check if it's a streaming response
            const contentType = response.headers.get('Content-Type');
            const llmProvider = response.headers.get('X-LLM-Provider');
            console.log('🔍 [ChatService] Response received - Content-Type:', contentType);
            console.log('🔍 [ChatService] Response status:', response.status, 'ok:', response.ok);
            console.log('🔍 [ChatService] X-LLM-Provider header:', llmProvider);
            if (contentType?.includes('text/event-stream')) {
                console.log('✅ [ChatService] Starting SSE streaming...');
                const reader = response.body?.getReader();
                if (!reader) throw new Error('No response body');

                const decoder = new TextDecoder();
                let fullText = "";
                let toolCall: any = null;

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    const chunk = decoder.decode(value, { stream: true });
                    const lines = chunk.split('\n');

                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const dataStr = line.slice(6).trim();
                            if (dataStr === '[DONE]') continue;

                            try {
                                const data = JSON.parse(dataStr);
                                if (data.text) {
                                    fullText += data.text;
                                    console.log('📡 [ChatService] Streaming chunk:', data.text.substring(0, 50));
                                    if (onStreamingChunk) onStreamingChunk(data.text);
                                }
                                if (data.toolCall) {
                                    toolCall = data.toolCall;
                                }
                            } catch (e) {
                                logger.warn('Failed to parse SSE data', { dataStr });
                            }
                        }
                    }
                }

                // Dispatch refresh for historical context
                window.dispatchEvent(new CustomEvent('chat-refresh'));

                if (toolCall) {
                    return { type: 'json', data: toolCall.args, toolCall: { tool: toolCall.name, args: toolCall.args } } as any;
                }

                return {
                    type: 'text',
                    data: fullText
                } as GeminiResponse;
            }

            // Fallback for non-streaming response
            console.log('⚠️ [ChatService] Non-streaming fallback - Content-Type was:', contentType);
            const data = await response.json();
            console.log('📦 [ChatService] Received JSON response:', data?.type);
            window.dispatchEvent(new CustomEvent('chat-refresh'));
            return data as GeminiResponse;

        } catch (error) {
            logger.error('Gemini chat error', error);

            const maybeResponse = (error && typeof error === 'object' && 'context' in error)
                ? (error as { context?: unknown }).context
                : null;

            if (maybeResponse instanceof Response && maybeResponse.status === 429) {
                const detail = await extractRateLimitDetail(maybeResponse);
                window.dispatchEvent(new CustomEvent<RateLimitEventDetail>('chat-rate-limit', { detail }));
                throw error;
            }

            window.dispatchEvent(new CustomEvent('chat-error', {
                detail: { message: '⚠️ Tyvärr uppstod ett fel. Försök igen senare.' }
            }));

            throw error;
        } finally {
            logger.endTimer('gemini-chat');
        }
    }

    /**
     * Analyze Excel file with Edge Function (with Claude fallback)
     */
    async analyzeExcel(file: File): Promise<AnalysisResult> {
        logger.startTimer('excel-analysis');
        logger.info('Starting Excel analysis', { filename: file.name });

        // Try Edge Function first (deterministic analysis)
        try {
            const response = await this.analyzeExcelWithEdge(file);
            logger.endTimer('excel-analysis');
            logger.info('Excel analysis succeeded with Edge Function');

            return {
                success: true,
                response,
                backend: 'edge'
            };
        } catch (edgeError) {
            logger.warn('Edge Function failed, falling back to Claude', { error: edgeError });

            // Try Claude fallback
            try {
                const response = await this.analyzeExcelWithClaude(file);
                logger.endTimer('excel-analysis');
                logger.info('Excel analysis succeeded with Claude fallback');

                return {
                    success: true,
                    response,
                    backend: 'claude'
                };
            } catch (claudeError) {
                logger.endTimer('excel-analysis');
                logger.error('Both Edge and Claude failed', { claudeError });

                const errorMessage = claudeError instanceof Error
                    ? claudeError.message
                    : 'Okänt fel';

                return {
                    success: false,
                    error: errorMessage,
                    backend: 'claude'
                };
            }
        }
    }

    /**
     * AI-First Excel Analysis with streaming progress
     * Uses Edge Function for deterministic parsing of Excel files
     * All file sizes now handled by analyze-excel-ai Edge Function
     */
    async analyzeExcelWithAI(
        file: File,
        onProgress: ProgressCallback,
        conversationId?: string
    ): Promise<AnalysisResult> {
        logger.startTimer('excel-analysis-ai');
        logger.info('Starting AI Excel analysis', { filename: file.name, size: file.size });

        // All files now handled by Edge Function (5MB limit enforced server-side)
        const LARGE_FILE_THRESHOLD = 500 * 1024; // 500KB - show message for larger files
        if (file.size > LARGE_FILE_THRESHOLD) {
            logger.info('Large file detected', {
                size: file.size,
                threshold: LARGE_FILE_THRESHOLD
            });

            onProgress({ step: 'calculating', message: 'Stor fil - analyserar...', progress: 0.3 });

            try {
                const edgeResponse = await this.analyzeExcelWithEdge(file, conversationId);
                logger.endTimer('excel-analysis-ai');
                logger.info('Large file analysis succeeded via Edge Function');

                // Signal completion to UI
                onProgress({ step: 'complete', message: 'Analys klar!', progress: 1.0 });

                // Return in same format as Edge Function path
                return {
                    success: true,
                    response: edgeResponse,
                    backend: 'edge'
                };
            } catch (edgeError) {
                logger.endTimer('excel-analysis-ai');
                logger.error('Edge Function failed for large file', edgeError);

                return {
                    success: false,
                    error: edgeError instanceof Error ? edgeError.message : 'Edge Function fel',
                    backend: 'edge'
                };
            }
        }

        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                throw new Error('Inte inloggad');
            }

            // Convert file to base64
            const base64Result = await fileService.toBase64WithPadding(file);

            // Get company info
            const company = companyManager.getCurrent();

            const requestBody: Record<string, unknown> = {
                file_data: base64Result.data,
                filename: file.name,
                company_name: company.name,
                org_number: company.orgNumber,
                period: this.getCurrentPeriod()
            };

            if (conversationId) {
                requestBody.conversation_id = conversationId;
            }

            // Call streaming endpoint
            const response = await fetch(`${this.supabaseUrl}/functions/v1/analyze-excel-ai`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.access_token}`,
                    'x-user-id': session.user.id
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
                throw new Error(errorData.message || errorData.error || `HTTP ${response.status}`);
            }

            // Handle Server-Sent Events stream
            const reader = response.body?.getReader();
            if (!reader) {
                throw new Error('No response body');
            }

            const decoder = new TextDecoder();
            let buffer = '';
            let finalReport: VATReportResponse | undefined;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });

                // Process complete SSE messages
                const lines = buffer.split('\n');
                buffer = lines.pop() || ''; // Keep incomplete line in buffer

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6)) as AIAnalysisProgress;

                            // Call progress callback
                            onProgress(data);

                            // Check for completion or error
                            if (data.step === 'complete' && data.report) {
                                finalReport = data.report;
                            } else if (data.step === 'error') {
                                throw new Error(data.error || 'Analysis failed');
                            }
                        } catch (parseError) {
                            logger.warn('Failed to parse SSE message', { line, error: parseError });
                        }
                    }
                }
            }

            logger.endTimer('excel-analysis-ai');

            if (finalReport) {
                logger.info('AI Excel analysis succeeded');
                return {
                    success: true,
                    response: finalReport,
                    backend: 'ai'
                };
            } else {
                throw new Error('No report received');
            }

        } catch (error) {
            logger.endTimer('excel-analysis-ai');
            logger.error('AI Excel analysis failed', error);

            const errorMessage = error instanceof Error ? error.message : 'Okänt fel';
            return {
                success: false,
                error: errorMessage,
                backend: 'ai'
            };
        }
    }

    /**
     * Analyze Excel with Edge Function (deterministic)
     * Replaced python-proxy - now all Excel analysis goes through analyze-excel-ai
     */
    private async analyzeExcelWithEdge(file: File, conversationId?: string): Promise<VATReportResponse> {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
            throw new Error('Inte inloggad');
        }

        // Convert file to base64
        const base64Result = await fileService.toBase64WithPadding(file);

        logger.debug('Sending to Edge Function (analyze-excel-ai)', {
            filename: file.name,
            base64Length: base64Result.paddedLength
        });

        const response = await fetch(`${this.supabaseUrl}/functions/v1/analyze-excel-ai`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`,
                'x-user-id': session.user.id
            },
            body: JSON.stringify({
                file_data: base64Result.data,
                filename: file.name,
                company_name: companyManager.getCurrent().name,
                org_number: companyManager.getCurrent().orgNumber,
                period: this.getCurrentPeriod(),
                conversation_id: conversationId
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
            logger.error('Edge Function error response', {
                status: response.status,
                errorData
            });
            throw new Error(errorData.message || errorData.error || `HTTP ${response.status}`);
        }

        // Handle SSE streaming response
        const reader = response.body?.getReader();
        if (!reader) {
            throw new Error('Ingen response stream');
        }

        const decoder = new TextDecoder();
        let finalReport: VATReportResponse | null = null;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.slice(6));
                        if (data.step === 'complete' && data.report) {
                            finalReport = data.report;
                        } else if (data.step === 'error') {
                            throw new Error(data.error || 'Analys misslyckades');
                        }
                    } catch (parseError) {
                        // Ignore parse errors for partial chunks
                    }
                }
            }
        }

        if (!finalReport) {
            throw new Error('Ingen rapport returnerades');
        }

        logger.info('Edge Function response received', { type: finalReport.type });
        return finalReport;
    }

    /**
     * Analyze Excel with Claude (fallback)
     */
    private async analyzeExcelWithClaude(file: File): Promise<VATReportResponse> {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
            throw new Error('Inte inloggad');
        }

        // Import XLSX dynamically to avoid bundling issues
        const XLSX = await import('xlsx');

        // Parse Excel file to JSON
        const arrayBuffer = await file.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });

        const sheets: Record<string, unknown[][]> = {};
        workbook.SheetNames.forEach((sheetName: string) => {
            const worksheet = workbook.Sheets[sheetName];
            sheets[sheetName] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        });

        const response = await fetch(`${this.supabaseUrl}/functions/v1/claude-analyze`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`
            },
            body: JSON.stringify({
                filename: file.name,
                sheets
            })
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Analysis failed' }));
            throw new Error(error.error || 'Analysis failed');
        }

        return await response.json();
    }

    /**
     * Get or create a conversation for a company
     */
    async getOrCreateConversation(companyId: string): Promise<string | null> {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                logger.warn('No session for conversation creation');
                return null;
            }

            const { data, error } = await supabase.rpc('get_or_create_conversation', {
                p_user_id: session.user.id,
                p_company_id: companyId
            });

            if (error) {
                logger.error('Error creating conversation', { error });
                return null;
            }

            logger.info('Conversation created/retrieved', { conversationId: data });
            return data;
        } catch (error) {
            logger.error('Exception creating conversation', error);
            return null;
        }
    }

    /**
     * Get recent chat history for a conversation
     */
    async getRecentHistory(conversationId: string, limit = 20): Promise<ChatMessage[]> {
        try {
            const { data, error } = await supabase
                .from('messages')
                .select('role, content, file_url, file_name, created_at')
                .eq('conversation_id', conversationId)
                .order('created_at', { ascending: false })
                .limit(limit);

            if (error) {
                logger.error('Error fetching chat history', { error });
                return [];
            }

            // Return in chronological order
            return (data || []).reverse() as ChatMessage[];
        } catch (error) {
            logger.error('Exception fetching chat history', error);
            return [];
        }
    }

    /**
     * Dispatch optimistic message event for immediate UI feedback
     */
    dispatchOptimisticMessage(content: string, fileName?: string, fileUrl?: string): void {
        window.dispatchEvent(new CustomEvent('add-optimistic-message', {
            detail: {
                content,
                file_name: fileName,
                file_url: fileUrl
            }
        }));
    }

    /**
     * Dispatch chat refresh event
     */
    dispatchRefresh(): void {
        window.dispatchEvent(new CustomEvent('chat-refresh'));
    }

    /**
     * Dispatch chat error event
     */
    dispatchError(message: string): void {
        window.dispatchEvent(new CustomEvent('chat-error', {
            detail: { message }
        }));
    }

    /**
     * Get current period in YYYY-MM format
     */
    private getCurrentPeriod(): string {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        return `${year}-${month}`;
    }
}

// Singleton instance
export const chatService = new ChatServiceClass();

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
import { companyManager } from './CompanyManager';
import type { VATReportResponse } from '../types/vat';

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
    backend: 'python' | 'claude' | 'ai';
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
     * Send a message to Gemini AI
     */
    async sendToGemini(
        message: string,
        file: File | null = null,
        fileUrl: string | null = null,
        vatReportContext: Record<string, unknown> | null = null
    ): Promise<GeminiResponse> {
        logger.startTimer('gemini-chat');

        try {
            // Prepare file data if present
            let fileData = null;
            if (file) {
                const base64Result = await fileService.toBase64WithPadding(file);
                fileData = {
                    data: base64Result.data,
                    mimeType: base64Result.mimeType
                };
            }

            // Get current company and conversation ID
            const company = companyManager.getCurrent();
            let conversationId = company.conversationId;

            // If conversationId is missing, try to get/create it
            if (!conversationId) {
                const newConversationId = await this.getOrCreateConversation(company.id);
                if (newConversationId) {
                    conversationId = newConversationId;
                    companyManager.setConversationId(conversationId);
                }
            }

            // Get recent chat history
            const history = conversationId
                ? await this.getRecentHistory(conversationId, 20)
                : [];

            // Call Gemini Edge Function
            const { data, error } = await supabase.functions.invoke('gemini-chat', {
                body: {
                    message,
                    fileData,
                    history,
                    conversationId,
                    companyId: company.id,
                    fileUrl,
                    fileName: file?.name || null,
                    vatReportContext
                }
            });

            logger.endTimer('gemini-chat');

            if (error) {
                throw error;
            }

            logger.info('Gemini response received', {
                type: data?.type,
                hasVatContext: !!vatReportContext
            });

            // Dispatch refresh event for UI
            window.dispatchEvent(new CustomEvent('chat-refresh'));

            return data as GeminiResponse;
        } catch (error) {
            logger.endTimer('gemini-chat');
            logger.error('Gemini chat error', error);

            // Dispatch error event for UI
            window.dispatchEvent(new CustomEvent('chat-error', {
                detail: { message: '⚠️ Tyvärr uppstod ett fel. Försök igen senare.' }
            }));

            throw error;
        }
    }

    /**
     * Analyze Excel file with Python API (with Claude fallback)
     */
    async analyzeExcel(file: File): Promise<AnalysisResult> {
        logger.startTimer('excel-analysis');
        logger.info('Starting Excel analysis', { filename: file.name });

        // Try Python API first
        try {
            const response = await this.analyzeExcelWithPython(file);
            logger.endTimer('excel-analysis');
            logger.info('Excel analysis succeeded with Python API');

            return {
                success: true,
                response,
                backend: 'python'
            };
        } catch (pythonError) {
            logger.warn('Python API failed, falling back to Claude', { error: pythonError });

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
                logger.error('Both Python and Claude failed', { claudeError });

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
     * Uses Gemini to intelligently parse ANY Excel format
     */
    async analyzeExcelWithAI(
        file: File,
        onProgress: ProgressCallback
    ): Promise<AnalysisResult> {
        logger.startTimer('excel-analysis-ai');
        logger.info('Starting AI Excel analysis', { filename: file.name });

        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                throw new Error('Inte inloggad');
            }

            // Convert file to base64
            const base64Result = await fileService.toBase64WithPadding(file);

            // Get company info
            const company = companyManager.getCurrent();

            // Call streaming endpoint
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
                    company_name: company.name,
                    org_number: company.orgNumber,
                    period: this.getCurrentPeriod()
                })
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
     * Analyze Excel with Python API
     */
    private async analyzeExcelWithPython(file: File): Promise<VATReportResponse> {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
            throw new Error('Inte inloggad');
        }

        // Convert file to base64
        const base64Result = await fileService.toBase64WithPadding(file);

        logger.debug('Sending to Python API', {
            filename: file.name,
            base64Length: base64Result.paddedLength
        });

        const response = await fetch(`${this.supabaseUrl}/functions/v1/python-proxy`, {
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
                period: this.getCurrentPeriod()
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
            logger.error('Python API error response', {
                status: response.status,
                errorData
            });
            throw new Error(errorData.message || errorData.error || `HTTP ${response.status}`);
        }

        const result = await response.json();
        logger.info('Python API response received', { type: result.type });

        return result;
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

// Also export class for testing
export { ChatServiceClass };

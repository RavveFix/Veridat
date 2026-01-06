/**
 * ChatController - Handles chat form submission and file handling
 *
 * Extracted from main.ts (lines 849-1028)
 */

import { supabase } from '../lib/supabase';
import { ExcelWorkspace } from '../components/ExcelWorkspace';
import { companyManager } from '../services/CompanyService';
import { fileService } from '../services/FileService';
import { chatService, type AIAnalysisProgress } from '../services/ChatService';
import { uiController } from '../services/UIService';
import { logger } from '../services/LoggerService';
import { conversationController } from './ConversationController';
import { memoryService } from '../services/MemoryService';
import type { VATReportResponse, VATReportData } from '../types/vat';

export class ChatController {
    private currentFile: File | null = null;
    private excelWorkspace: ExcelWorkspace | null = null;
    private vatReportSaveInProgress: boolean = false;
    private rateLimitActive: boolean = false;
    private rateLimitResetAt: string | null = null;

    init(excelWorkspace: ExcelWorkspace): void {
        this.excelWorkspace = excelWorkspace;
        this.setupFormHandler();
        this.setupFileHandlers();
        this.setupVATReportHandler();
        this.setupExcelEventListeners();
        this.setupSuggestionHandlers();
        this.setupRateLimitHandlers();
        this.setupCompanyChangeHandler();
    }

    /**
     * Reset state when switching companies - prevents state leaking between companies
     */
    private setupCompanyChangeHandler(): void {
        window.addEventListener('company-changed', () => {
            this.resetStateOnCompanyChange();
        });
    }

    private resetStateOnCompanyChange(): void {
        logger.debug('Company changed, resetting chat state');

        // Clear attached file
        this.currentFile = null;

        // Clear rate limit (it's per-user, not per-company, but reset UI for fresh start)
        this.rateLimitActive = false;
        this.rateLimitResetAt = null;

        // Reset memory service (cancel any pending generation)
        memoryService.reset();

        // Clear file preview UI
        const filePreview = document.getElementById('file-preview');
        if (filePreview) {
            filePreview.classList.add('hidden');
        }

        // Reset input placeholder
        this.updateInputForRateLimit();

        // Clear input field
        uiController.clearInput();
    }

    private setupRateLimitHandlers(): void {
        // Listen for rate limit activation
        window.addEventListener('rate-limit-active', ((e: CustomEvent) => {
            this.rateLimitActive = true;
            this.rateLimitResetAt = e.detail?.resetAt || null;
            this.updateInputForRateLimit();
        }) as EventListener);

        // Listen for rate limit clearing
        window.addEventListener('rate-limit-cleared', () => {
            this.rateLimitActive = false;
            this.rateLimitResetAt = null;
            this.updateInputForRateLimit();
        });
    }

    private updateInputForRateLimit(): void {
        const { userInput } = uiController.elements;
        if (!userInput) return;

        if (this.rateLimitActive) {
            userInput.disabled = true;
            const resetTime = this.rateLimitResetAt
                ? new Date(this.rateLimitResetAt).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
                : 'snart';
            userInput.placeholder = `Gräns nådd – återställs kl ${resetTime}`;
            userInput.classList.add('rate-limited');
        } else {
            userInput.disabled = false;
            userInput.placeholder = 'Fråga mig vad som helst...';
            userInput.classList.remove('rate-limited');
        }
    }

    private setupSuggestionHandlers(): void {
        document.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const suggestionCard = target.closest('.suggestion-card, .suggestion-chip') as HTMLElement;

            if (suggestionCard) {
                const prompt = suggestionCard.dataset.prompt;
                if (prompt) {
                    this.handleSuggestionClick(prompt);
                }
            }
        });
    }

    private handleSuggestionClick(prompt: string): void {
        const { userInput, chatForm } = uiController.elements;
        if (userInput && chatForm) {
            userInput.value = prompt;
            userInput.focus();
            // Trigger submit programmatically
            chatForm.dispatchEvent(new Event('submit', { cancelable: true }));
        }
    }

    private setupFormHandler(): void {
        const { chatForm } = uiController.elements;

        if (chatForm) {
            chatForm.addEventListener('submit', (e) => this.handleFormSubmit(e));
        }
    }

    private setupFileHandlers(): void {
        const { fileInput, attachBtn, removeFileBtn } = uiController.elements;

        if (attachBtn && fileInput) {
            attachBtn.addEventListener('click', () => fileInput.click());

            fileInput.addEventListener('change', (e) => {
                const target = e.target as HTMLInputElement;
                if (target.files && target.files.length > 0) {
                    this.currentFile = target.files[0];
                    uiController.showFilePreview(this.currentFile.name);
                }
            });
        }

        if (removeFileBtn) {
            removeFileBtn.addEventListener('click', () => this.clearFile());
        }
    }

    private setupVATReportHandler(): void {
        window.addEventListener('vat-report-ready', async (e: Event) => {
            const customEvent = e as CustomEvent<{ data: VATReportData; fileUrl?: string }>;
            const { data, fileUrl } = customEvent.detail;

            if (this.vatReportSaveInProgress) {
                logger.debug('VAT report save already in progress, skipping');
                return;
            }

            this.vatReportSaveInProgress = true;

            try {
                const conversationId = companyManager.getConversationId();
                if (!conversationId) {
                    logger.warn('No conversation ID for VAT report save');
                    return;
                }

                logger.info('Saving VAT report to messages', { period: data.period });

                await supabase.from('messages').insert({
                    conversation_id: conversationId,
                    role: 'assistant',
                    content: `✅ **Momsredovisning skapad för ${data.period}**\n\nRapporten visas till höger. Du kan fortsätta ställa frågor samtidigt som du tittar på rapporten.`,
                    file_url: fileUrl || null,
                    metadata: JSON.parse(JSON.stringify({
                        type: 'vat_report',
                        data: data,
                        analyzed_at: new Date().toISOString()
                    }))
                });

                chatService.dispatchRefresh();
                logger.info('VAT report saved to messages');
            } catch (error) {
                logger.error('Failed to save VAT report to messages', error);
            } finally {
                setTimeout(() => {
                    this.vatReportSaveInProgress = false;
                }, 1000);
            }
        });
    }

    private setupExcelEventListeners(): void {
        // Listen for open-excel events from ChatHistory
        window.addEventListener('open-excel', (e: any) => {
            const { url, name } = e.detail;
            if (url && name && this.excelWorkspace) {
                this.excelWorkspace.openExcelFile(url, name);
            }
        });

        // Listen for open-vat-report events from ChatHistory
        window.addEventListener('open-vat-report', (e: Event) => {
            const customEvent = e as CustomEvent<{ data: VATReportData; fileUrl?: string }>;
            const { data, fileUrl } = customEvent.detail;
            if (data && this.excelWorkspace) {
                this.excelWorkspace.openVATReport(data, fileUrl, true);
            }
        });
    }

    private async handleFormSubmit(e: SubmitEvent): Promise<void> {
        e.preventDefault();
        let message = uiController.getInputValue().trim();

        if (!message && !this.currentFile) return;

        // If no message but file is attached, use a default message
        if (!message && this.currentFile) {
            message = "Analysera denna fil";
        }

        // Show loading state in send button
        const { chatForm } = uiController.elements;
        const sendButton = chatForm?.querySelector('button[type="submit"]') as HTMLButtonElement;
        const originalButtonContent = sendButton?.innerHTML;
        if (sendButton) {
            sendButton.disabled = true;
            sendButton.innerHTML = '<span class="btn-spinner"></span>';
        }

        const restoreButton = () => {
            if (sendButton && originalButtonContent) {
                sendButton.disabled = false;
                sendButton.innerHTML = originalButtonContent;
            }
        };

        const fileToSend = this.currentFile;
        let fileUrl: string | null = null;
        let vatReportResponse: VATReportResponse | null = null;
        let conversationId = companyManager.getConversationId();

        // Validate Excel early to avoid creating empty conversations on invalid files
        if (fileToSend && fileService.isExcel(fileToSend) && this.excelWorkspace) {
            const validation = fileService.validate(fileToSend);
            if (!validation.valid) {
                logger.error('Excel file validation failed', { error: validation.error });
                this.excelWorkspace.showAnalysisError(validation.error || 'Filen kunde inte valideras');
                restoreButton();
                return;
            }
        }

        // Ensure we have a conversation id before doing work that should be persisted (e.g. Excel analysis -> vat_reports)
        if (!conversationId) {
            const inputWrapper = document.querySelector('.chat-input-wrapper');
            if (inputWrapper) inputWrapper.classList.remove('pulse-input');

            logger.info('Creating conversation on first message');
            const newId = await conversationController.createInDB();
            conversationId = newId ?? undefined;

            if (conversationId) {
                conversationController.transitionFromWelcome();
                companyManager.setConversationId(conversationId);
                conversationController.mountChatHistory(conversationId);
                // Update URL back to /app to indicate active conversation
                window.history.pushState({}, '', '/app');
                chatService.dispatchRefresh();
            } else {
                restoreButton();
                uiController.showError('Kunde inte starta konversationen. Försök igen.');
                return;
            }
        }

        // Excel file handling with AI-first intelligent analysis
        if (fileToSend && fileService.isExcel(fileToSend) && this.excelWorkspace) {
            logger.info('Detected Excel file, routing to AI-first analysis');

            // Show streaming analysis UI immediately
            this.excelWorkspace.showStreamingAnalysis(fileToSend.name);

            const handleProgress = (progress: AIAnalysisProgress) => {
                logger.debug('Analysis progress', { step: progress.step, progress: progress.progress });
                this.excelWorkspace?.updateStreamingProgress(progress);
            };

            const result = await chatService.analyzeExcelWithAI(fileToSend, handleProgress, conversationId);

            if (result.success && result.response) {
                vatReportResponse = result.response;
                logger.info('Excel AI analysis succeeded', { backend: result.backend });
            } else {
                logger.error('Excel AI analysis failed', { error: result.error, backend: result.backend });
                this.excelWorkspace.showAnalysisError(result.error || 'Okänt fel vid analys');
            }

            // Upload file to storage after analysis
            try {
                const currentCompanyId = companyManager.getCurrentId();
                fileUrl = await fileService.uploadToStorage(fileToSend, 'chat-files', currentCompanyId);
                if (vatReportResponse) {
                    // Store VAT report per company to isolate data
                    localStorage.setItem(`latest_vat_report_${currentCompanyId}`, JSON.stringify({
                        ...vatReportResponse,
                        fileUrl,
                        filename: fileToSend.name,
                        analyzedAt: new Date().toISOString()
                    }));
                }
            } catch (uploadError) {
                logger.warn('File upload failed (non-critical)', uploadError);
            }
        }

        // Non-Excel files (PDF/images) should also be uploaded so they can be reopened later
        if (fileToSend && !fileService.isExcel(fileToSend)) {
            try {
                const currentCompanyId = companyManager.getCurrentId();
                fileUrl = await fileService.uploadToStorage(fileToSend, 'chat-files', currentCompanyId);
            } catch (uploadError) {
                logger.warn('File upload failed (non-critical)', uploadError);
            }
        }

        restoreButton();

        // Optimistic UI Update
        chatService.dispatchOptimisticMessage(message, fileToSend?.name, fileUrl ?? undefined);

        // Clear input and file
        uiController.clearInput();
        this.clearFile();

        // Show AI response based on file type
        if (vatReportResponse && vatReportResponse.type === 'vat_report' && this.excelWorkspace) {
            // We save the VAT report message below, so skipSave avoids duplicate inserts
            this.excelWorkspace.openVATReport(vatReportResponse.data, fileUrl || undefined, true);

            if (conversationId) {
                await supabase.from('messages').insert({
                    conversation_id: conversationId,
                    role: 'assistant',
                    content: `✅ **Momsredovisning skapad för ${vatReportResponse.data.period}**\n\nRapporten visas till höger. Du kan fortsätta ställa frågor samtidigt som du tittar på rapporten.`,
                    file_name: fileToSend?.name || null,
                    file_url: fileUrl || null,
                    metadata: JSON.parse(JSON.stringify({
                        type: 'vat_report',
                        data: vatReportResponse.data,
                        analyzed_at: new Date().toISOString()
                    }))
                });
                chatService.dispatchRefresh();

                // Schedule automatic memory generation after idle timeout
                memoryService.scheduleGeneration(conversationId);
            }
        } else {
            // Get VAT report context if available
            const currentContent = this.excelWorkspace?.getCurrentContent();
            const vatContext = currentContent?.type === 'vat_report'
                ? currentContent.data as unknown as Record<string, unknown>
                : null;

            // Don't send Excel files to Gemini
            const fileForGemini = fileToSend && !fileService.isExcel(fileToSend) ? fileToSend : null;

            try {
                let didStream = false;
                let isFirstChunk = true;
                const response = await chatService.sendToGemini(
                    message,
                    fileForGemini,
                    fileUrl,
                    vatContext,
                    (chunk) => {
                        didStream = true;
                        console.log('🎯 [ChatController] Dispatching chunk:', chunk.substring(0, 50));
                        // Mark first chunk so UI knows to reset streaming message
                        window.dispatchEvent(new CustomEvent('chat-streaming-chunk', {
                            detail: { chunk, isNewResponse: isFirstChunk }
                        }));
                        isFirstChunk = false;
                    }
                );

                if (!didStream) {
                    console.log('⚠️ [ChatController] No streaming occurred, using fallback');
                    if (response?.type === 'text' && typeof response.data === 'string' && response.data.trim()) {
                        console.log('📦 [ChatController] Fallback dispatch:', response.data.substring(0, 50));
                        window.dispatchEvent(new CustomEvent('chat-streaming-chunk', {
                            detail: { chunk: response.data, isNewResponse: true }
                        }));
                    } else if (response?.type === 'json') {
                        uiController.showError('Jag behöver lite mer information för att gå vidare. Försök igen.');
                    }
                }
                chatService.dispatchRefresh();

                // Schedule automatic memory generation after idle timeout
                if (conversationId) {
                    memoryService.scheduleGeneration(conversationId);
                }
            } catch (error) {
                const maybeResponse = (error && typeof error === 'object' && 'context' in error)
                    ? (error as { context?: unknown }).context
                    : null;

                if (maybeResponse instanceof Response && maybeResponse.status === 429) {
                    logger.warn('Rate limit reached (429)', { error });
                    return;
                }

                logger.error('Failed to send message to Gemini', error);
                uiController.showError('Kunde inte skicka meddelandet. Kontrollera din anslutning och försök igen.');
                restoreButton();
                conversationController.resetToWelcomeState();
            }
        }
    }

    clearFile(): void {
        this.currentFile = null;
        uiController.clearFilePreview();
    }
}

export const chatController = new ChatController();

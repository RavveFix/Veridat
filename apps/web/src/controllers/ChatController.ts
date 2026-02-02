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
import { mountPreactComponent } from '../components/preact-adapter';
import { TextAnimate } from '../registry/magicui/text-animate';
import type { VATReportResponse, VATReportData } from '../types/vat';

export class ChatController {
    private currentFile: File | null = null;
    private excelWorkspace: ExcelWorkspace | null = null;
    private vatReportSaveInProgress: boolean = false;
    private rateLimitActive: boolean = false;
    private rateLimitResetAt: string | null = null;
    private conversationLoading: boolean = false;
    private loadingConversationId: string | null = null;
    private conversationLoadingTimeout: number | null = null;
    private placeholderUnmount: (() => void) | null = null;

    init(excelWorkspace: ExcelWorkspace): void {
        this.excelWorkspace = excelWorkspace;
        this.setupFormHandler();
        this.setupFileHandlers();
        this.setupVATReportHandler();
        this.setupExcelEventListeners();
        this.setupSuggestionHandlers();
        this.setupRateLimitHandlers();
        this.setupCompanyChangeHandler();
        this.setupConversationLoadingHandler();
        this.setupAnimatedPlaceholder();
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
        this.togglePlaceholder();
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

    private setupConversationLoadingHandler(): void {
        // Listen for conversation loading start
        window.addEventListener('conversation-loading', ((e: CustomEvent<{ loading: boolean; conversationId?: string | null }>) => {
            this.conversationLoading = e.detail.loading;
            this.loadingConversationId = typeof e.detail?.conversationId === 'string'
                ? e.detail.conversationId
                : e.detail?.conversationId ?? null;

            if (this.conversationLoading) {
                if (this.conversationLoadingTimeout) {
                    clearTimeout(this.conversationLoadingTimeout);
                }
                this.conversationLoadingTimeout = window.setTimeout(() => {
                    if (!this.conversationLoading) return;
                    logger.warn('Conversation loading timed out', { conversationId: this.loadingConversationId });
                    this.conversationLoading = false;
                    this.loadingConversationId = null;
                    this.updateInputForConversationLoading();
                    uiController.showError('Laddningen tog för lång tid. Försök igen.');
                }, 20000);
            } else if (this.conversationLoadingTimeout) {
                clearTimeout(this.conversationLoadingTimeout);
                this.conversationLoadingTimeout = null;
            }

            this.updateInputForConversationLoading();
        }) as EventListener);

        // Listen for messages loaded to end loading state (ChatHistory dispatches this)
        window.addEventListener('chat-messages-loaded', ((event: Event) => {
            if (!this.conversationLoading) return;
            const customEvent = event as CustomEvent<{ conversationId?: string | null }>;
            const loadedConversationId = customEvent.detail?.conversationId ?? null;

            if (this.loadingConversationId) {
                if (!loadedConversationId) return;
                if (loadedConversationId !== this.loadingConversationId) return;
            }

            this.conversationLoading = false;
            this.loadingConversationId = null;
            if (this.conversationLoadingTimeout) {
                clearTimeout(this.conversationLoadingTimeout);
                this.conversationLoadingTimeout = null;
            }
            this.updateInputForConversationLoading();
        }) as EventListener);
    }

    private updateInputForConversationLoading(): void {
        const { userInput } = uiController.elements;
        const placeholderContainer = document.getElementById('animated-placeholder-container');
        if (!userInput) return;

        if (this.conversationLoading) {
            userInput.disabled = true;
            if (placeholderContainer) {
                placeholderContainer.classList.add('hidden');
            }
            userInput.placeholder = 'Laddar konversation...';
            userInput.classList.add('loading');
        } else if (!this.rateLimitActive) {
            // Only re-enable if not rate limited
            userInput.disabled = false;
            if (placeholderContainer && !userInput.value) {
                placeholderContainer.classList.remove('hidden');
            }
            userInput.placeholder = ''; // Clear static placeholder when animated is active
            userInput.classList.remove('loading');
            // Focus input after loading completes for better UX
            setTimeout(() => userInput.focus(), 50);
        }
    }

    private updateInputForRateLimit(): void {
        const { userInput } = uiController.elements;
        const placeholderContainer = document.getElementById('animated-placeholder-container');
        if (!userInput) return;

        if (this.rateLimitActive) {
            userInput.disabled = true;
            if (placeholderContainer) {
                placeholderContainer.classList.add('hidden');
            }
            const resetTime = this.rateLimitResetAt
                ? new Date(this.rateLimitResetAt).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
                : 'snart';
            userInput.placeholder = `Gräns nådd – återställs kl ${resetTime}`;
            userInput.classList.add('rate-limited');
        } else {
            userInput.disabled = false;
            if (placeholderContainer && !userInput.value) {
                placeholderContainer.classList.remove('hidden');
            }
            userInput.placeholder = ''; // Clear static placeholder when animated is active
            userInput.classList.remove('rate-limited');
        }
    }

    private setupAnimatedPlaceholder(): void {
        const placeholderContainer = document.getElementById('animated-placeholder-container');
        const { userInput } = uiController.elements;

        if (placeholderContainer && userInput) {
            // Initial mount
            this.mountPlaceholder();

            // Toggle visibility on input
            userInput.addEventListener('input', () => {
                if (userInput.value.length > 0) {
                    placeholderContainer.classList.add('hidden');
                } else if (!this.conversationLoading && !this.rateLimitActive) {
                    placeholderContainer.classList.remove('hidden');
                }
            });

            // Handle focus/blur if needed (optional, but good for UX)
            userInput.addEventListener('focus', () => {
                // We keep it visible until typing starts
            });
        }
    }

    private mountPlaceholder(): void {
        const placeholderContainer = document.getElementById('animated-placeholder-container');
        if (!placeholderContainer) return;

        // Cleanup previous if exists
        if (this.placeholderUnmount) {
            this.placeholderUnmount();
        }

        this.placeholderUnmount = mountPreactComponent(
            TextAnimate,
            {
               children: "Fråga mig vad som helst...",
               animation: "blurInUp",
               by: "character",
               once: false // Set to false to allow re-animation on remount/whileInView
            },
            placeholderContainer
        );
    }

    private togglePlaceholder(forceRemount: boolean = false): void {
        const placeholderContainer = document.getElementById('animated-placeholder-container');
        const { userInput } = uiController.elements;

        if (placeholderContainer && userInput) {
            if (userInput.value.length === 0 && !this.conversationLoading && !this.rateLimitActive) {
                if (forceRemount) {
                    this.mountPlaceholder();
                }
                placeholderContainer.classList.remove('hidden');
            } else {
                placeholderContainer.classList.add('hidden');
            }
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
                // Use the new Claude-inspired artifact UI
                this.excelWorkspace.openExcelArtifact(url, name, () => {
                    // TODO: Re-analyze the file if user clicks "Analysera moms"
                    console.log('Re-analysis requested for:', name);
                });
            }
        });

    }

    private async handleFormSubmit(e: SubmitEvent): Promise<void> {
        e.preventDefault();

        // Block submission while conversation is loading
        if (this.conversationLoading) {
            logger.debug('Form submission blocked - conversation still loading');
            return;
        }

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
                conversationController.mountConversationList();
                conversationController.mountChatHistory(conversationId);
                // Update URL to include conversation ID for bookmarking/sharing
                window.history.pushState({ conversationId }, '', `/app/chat/${conversationId}`);
                chatService.dispatchRefresh();
                window.dispatchEvent(new CustomEvent('refresh-conversation-list', { detail: { force: true } }));
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
        this.togglePlaceholder(true); // Force remount for re-animation

        // Show AI response based on file type
        if (vatReportResponse && vatReportResponse.type === 'vat_report' && this.excelWorkspace) {
            // Open VAT report in side panel automatically
            this.excelWorkspace.openVATReport(vatReportResponse.data, fileUrl || undefined, true);

            if (conversationId) {
                await supabase.from('messages').insert({
                    conversation_id: conversationId,
                    role: 'assistant',
                    content: `Momsredovisning klar för ${vatReportResponse.data.period}`,
                    file_name: fileToSend?.name || null,
                    file_url: fileUrl || null,
                    metadata: JSON.parse(JSON.stringify({
                        type: 'vat_report',
                        data: vatReportResponse.data,
                        file_url: fileUrl || null,
                        analyzed_at: new Date().toISOString()
                    }))
                });
                chatService.dispatchRefresh();

                // Schedule automatic memory generation after idle timeout
                memoryService.scheduleGeneration(conversationId);

                const titleBits: string[] = [];
                if (vatReportResponse.data.period) {
                    titleBits.push(`Momsrapport för ${vatReportResponse.data.period}`);
                }
                if (vatReportResponse.data.company?.name) {
                    titleBits.push(`Bolag: ${vatReportResponse.data.company.name}`);
                }
                if (fileToSend?.name) {
                    titleBits.push(`Fil: ${fileToSend.name}`);
                }
                const titleContext = titleBits.join('. ');
                void chatService.generateConversationTitle(conversationId, message, titleContext);
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

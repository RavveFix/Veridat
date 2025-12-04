import { supabase } from './lib/supabase';
import { mountPreactComponent } from './components/preact-adapter';
import { ChatHistory } from './components/Chat/ChatHistory';
import { ConversationList } from './components/Chat/ConversationList';
import { LegalConsentModal } from './components/LegalConsentModal';
import { SettingsModal } from './components/SettingsModal';
import { mountModal } from './utils/modalHelpers';
import './styles/main.css';
import './styles/components/vat-card.css';
import './styles/components/voice-input.css';
import type { VATReportResponse } from './types/vat';
import { ExcelWorkspace } from './components/ExcelWorkspace';
import { ThemeManager } from './lib/theme';

// Services
import { logger } from './services/LoggerService';
import { authService } from './services/AuthService';
import { companyManager } from './services/CompanyManager';
import { fileService } from './services/FileService';
import { chatService, type AIAnalysisProgress } from './services/ChatService';
import { uiController } from './services/UIController';
import { voiceInputController } from './services/VoiceInputController';

logger.debug('main.ts module loading...');

// Initialize company manager
companyManager.init();

let chatUnmount: (() => void) | null = null;

async function initApp() {
    // Initialize UI Controller (queries all DOM elements once)
    uiController.init();

    // Initialize Excel Workspace
    const excelWorkspace = new ExcelWorkspace({
        onClose: () => {
            console.log('Excel panel closed');
        },
        onSheetChange: (sheetName) => {
            console.log('Switched to sheet:', sheetName);
        },
        onError: (error) => {
            console.error('Excel workspace error:', error);
        }
    });

    // Check Authentication State
    const session = await authService.getSession();

    // Handle login page redirect if not authenticated
    if (!session && !authService.isLoginPage() && !authService.isLandingPage() && authService.isProtectedPage()) {
        authService.redirectToLogin();
        return;
    }

    // Check Legal Consent and Version
    if (session) {
        let hasAccepted = await authService.hasAcceptedTerms();

        if (!hasAccepted) {
            // Check for local consent (from login page)
            if (authService.hasLocalConsent()) {
                logger.info('Found local consent, syncing to DB...');

                // Sync to DB (non-blocking to allow user to proceed)
                authService.syncLocalConsentToDatabase();

                // Proceed as accepted
                hasAccepted = true;
            } else {
                logger.info('User has not accepted terms, showing modal');

                // Remove loader immediately so modal is visible
                uiController.removeLoaderImmediately();

                // Create a container for the modal if it doesn't exist
                let modalContainer = document.getElementById('legal-modal-container');
                if (!modalContainer) {
                    modalContainer = document.createElement('div');
                    modalContainer.id = 'legal-modal-container';
                    document.body.appendChild(modalContainer);
                }

                // Mount the modal
                mountPreactComponent(
                    LegalConsentModal,
                    {
                        mode: 'authenticated' as const,
                        onAccepted: (_fullName: string) => {
                            logger.info('Terms accepted, redirecting to app...');
                            authService.redirectToApp();
                        }
                    },
                    modalContainer
                );

                // Stop further initialization until accepted
                return;
            }
        }
    }

    // Listen for auth state changes
    supabase.auth.onAuthStateChange((event, session) => {
        logger.info('Auth state changed', { event, userId: session?.user?.id });

        if (event === 'SIGNED_IN' && session) {
            // Load conversation when user signs in
            const currentCompany = companyManager.getCurrent();
            logger.info('User signed in, loading conversation for company', { companyId: currentCompany.id });
            loadConversationFromDB(currentCompany.id).catch((error: unknown) => {
                logger.error('Failed to load conversation on sign in', error);
            });
        } else if (event === 'SIGNED_OUT') {
            // Clear chat on sign out
            if (chatContainer) chatContainer.innerHTML = '';
            window.location.href = '/';
        }
    });

    // Theme Toggle
    const themeToggle = document.getElementById('theme-toggle');
    const moonIcon = document.querySelector('.moon-icon') as HTMLElement;
    const sunIcon = document.querySelector('.sun-icon') as HTMLElement;

    // Initialize theme state (listeners, etc.)
    ThemeManager.init();
    updateThemeIcon(ThemeManager.getCurrentTheme());

    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            const newTheme = ThemeManager.toggle();
            updateThemeIcon(newTheme);
        });
    }

    function updateThemeIcon(theme: string) {
        if (!moonIcon || !sunIcon) return;
        if (theme === 'light') {
            moonIcon.style.display = 'none';
            sunIcon.style.display = 'block';
        } else {
            moonIcon.style.display = 'block';
            sunIcon.style.display = 'none';
        }
    }

    // Settings Button Logic
    const settingsBtn = document.getElementById('settings-btn');
    if (settingsBtn) {
        settingsBtn.addEventListener('click', async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            const closeSettings = mountModal({
                containerId: 'settings-modal-container',
                Component: SettingsModal,
                props: {
                    user,
                    onClose: () => closeSettings(),
                    onLogout: async () => {
                        await supabase.auth.signOut();
                        window.location.href = '/login';
                    }
                }
            });
        });
    }

    // Logout button logic (legacy support if button exists, though we replaced it)
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            await supabase.auth.signOut();
        });
    }

    // Company Management (handled by CompanyManager service)
    // Switch company helper
    async function switchCompany(companyId: string) {
        const company = companyManager.switchTo(companyId);
        if (company) {
            await loadConversationFromDB(company.id);
        }
    }

    // Load conversation from database
    async function loadConversationFromDB(companyId: string) {
        try {
            const session = await authService.getSession();
            if (!session) {
                logger.info('No session, clearing chat');
                if (chatContainer) chatContainer.innerHTML = '';
                return;
            }

            // Get or create conversation for this company
            const conversationId = await chatService.getOrCreateConversation(companyId);

            if (!conversationId) {
                logger.error('Failed to get conversation');
                return;
            }

            // Store conversationId in company data
            companyManager.setConversationId(conversationId);

            // Mount ChatHistory component
            if (chatContainer) {
                // Unmount previous instance if exists
                if (chatUnmount) chatUnmount();
                chatContainer.innerHTML = ''; // Clear container

                chatUnmount = mountPreactComponent(
                    ChatHistory,
                    { conversationId: conversationId },
                    chatContainer
                );
            }

        } catch (error) {
            logger.error('Error loading conversation from DB', error);
        }
    }

    // Listen for open-excel events from ChatHistory
    window.addEventListener('open-excel', (e: any) => {
        const { url, name } = e.detail;
        if (url && name) {
            excelWorkspace.openExcelFile(url, name);
        }
    });

    // Listen for conversation deletion
    window.addEventListener('conversation-deleted', (e: any) => {
        const { id } = e.detail;
        logger.info('Conversation deleted', { id });

        // If the deleted conversation was the current one, clear the chat
        const currentCompany = companyManager.getCurrent();
        if (currentCompany.conversationId === id) {
            companyManager.setConversationId('');

            if (chatContainer) {
                chatContainer.innerHTML = '';
                // Optionally show a "New Chat" or "Select Chat" empty state here
                // For now, we'll rely on ConversationList to select another or reload
            }
        }
    });

    // Listen for create new conversation request (e.g., after deleting active conversation)
    window.addEventListener('create-new-conversation', async () => {
        logger.info('Creating new conversation after deletion');
        await startNewChat();
    });




    // History Sidebar Logic
    const historyToggle = document.getElementById('history-toggle');
    const historySidebar = document.getElementById('history-sidebar');
    const closeHistoryBtn = document.getElementById('close-history-btn');
    const conversationListContainer = document.getElementById('conversation-list-container');
    let conversationListUnmount: (() => void) | null = null;

    function toggleHistorySidebar() {
        if (!historySidebar) return;
        const isHidden = historySidebar.classList.contains('hidden');

        if (isHidden) {
            historySidebar.classList.remove('hidden');
            // Mount list when opening
            if (conversationListContainer) {
                if (conversationListUnmount) conversationListUnmount();
                conversationListContainer.innerHTML = '';

                const currentCompany = companyManager.getCurrent();

                conversationListUnmount = mountPreactComponent(
                    ConversationList,
                    {
                        currentConversationId: currentCompany.conversationId || null,
                        onSelectConversation: async (id) => {
                            await loadConversation(id);
                            historySidebar.classList.add('hidden'); // Close on select
                        }
                    },
                    conversationListContainer
                );
            }
        } else {
            historySidebar.classList.add('hidden');
        }
    }

    if (historyToggle) {
        historyToggle.addEventListener('click', toggleHistorySidebar);
    }

    if (closeHistoryBtn) {
        closeHistoryBtn.addEventListener('click', () => {
            historySidebar?.classList.add('hidden');
        });
    }

    // Close sidebar when clicking outside
    document.addEventListener('click', (e) => {
        if (historySidebar &&
            !historySidebar.classList.contains('hidden') &&
            !historySidebar.contains(e.target as Node) &&
            !historyToggle?.contains(e.target as Node)) {
            historySidebar.classList.add('hidden');
        }
    });

    async function loadConversation(conversationId: string) {
        logger.info('Loading conversation', { conversationId });

        // Update local state
        companyManager.setConversationId(conversationId);

        // Re-mount chat
        if (chatContainer) {
            if (chatUnmount) chatUnmount();
            chatContainer.innerHTML = '';

            chatUnmount = mountPreactComponent(
                ChatHistory,
                { conversationId: conversationId },
                chatContainer
            );
        }
    }

    // New Chat Logic
    const newChatBtn = document.getElementById('new-chat-btn');
    if (newChatBtn) {
        newChatBtn.addEventListener('click', async () => {
            // Use a custom modal or just proceed for now to avoid blocking automation
            // Ideally we'd show a nice UI modal here
            await startNewChat();
        });
    }

    async function startNewChat() {
        try {
            const session = await authService.getSession();
            if (!session) return;

            const currentCompany = companyManager.getCurrent();

            // Create a NEW conversation explicitly
            const { data: conversationId, error } = await supabase
                .from('conversations')
                .insert({
                    user_id: session.user.id,
                    company_id: currentCompany.id,
                    title: 'Ny konversation'
                })
                .select('id')
                .single();

            if (error) {
                logger.error('Error creating new chat', { error });
                alert('Kunde inte starta ny chatt.');
                return;
            }

            if (conversationId) {
                logger.info('Started new conversation', { conversationId: conversationId.id });

                // Update local state
                companyManager.setConversationId(conversationId.id);

                // Mount empty chat
                if (chatContainer) {
                    if (chatUnmount) chatUnmount();
                    chatContainer.innerHTML = '';

                    chatUnmount = mountPreactComponent(
                        ChatHistory,
                        { conversationId: conversationId.id },
                        chatContainer
                    );
                }

                // Add welcome message for new chat
                // We can optionally insert a system message here if we want it persisted
                // or just let the ChatHistory component handle the empty state
            }

        } catch (error) {
            logger.error('Error in startNewChat', error);
        }
    }

    // Get recent chat history is now handled by ChatService



    // Create new company
    function createNewCompany() {
        const modal = document.getElementById('company-modal');
        const form = document.getElementById('company-form') as HTMLFormElement;
        const modalTitle = document.getElementById('modal-title');
        const submitBtn = document.getElementById('submit-btn');
        const companyIdInput = document.getElementById('company-id') as HTMLInputElement;

        if (!modal || !form) return;

        // Set to create mode
        if (modalTitle) modalTitle.textContent = 'Lägg till nytt bolag';
        if (submitBtn) submitBtn.textContent = 'Skapa bolag';
        if (companyIdInput) companyIdInput.value = '';

        // Clear form
        form.reset();

        // Show modal
        modal.classList.remove('hidden');

        // Focus first field
        const nameInput = document.getElementById('company-name');
        if (nameInput) nameInput.focus();
    }

    // Edit existing company
    function editCompany() {
        const modal = document.getElementById('company-modal');
        const form = document.getElementById('company-form') as HTMLFormElement;
        const modalTitle = document.getElementById('modal-title');
        const submitBtn = document.getElementById('submit-btn');
        const companyIdInput = document.getElementById('company-id') as HTMLInputElement;

        if (!modal || !form) return;

        const company = companyManager.getCurrent();

        // Set to edit mode
        if (modalTitle) modalTitle.textContent = 'Redigera bolag';
        if (submitBtn) submitBtn.textContent = 'Spara ändringar';
        if (companyIdInput) companyIdInput.value = company.id;

        // Populate form with current company data
        (document.getElementById('company-name') as HTMLInputElement).value = company.name || '';
        (document.getElementById('org-number') as HTMLInputElement).value = company.orgNumber || '';
        (document.getElementById('company-address') as HTMLInputElement).value = company.address || '';
        (document.getElementById('company-phone') as HTMLInputElement).value = company.phone || '';

        // Show modal
        modal.classList.remove('hidden');

        // Focus first field
        const nameInput = document.getElementById('company-name');
        if (nameInput) nameInput.focus();
    }

    // Modal event listeners
    const companyModal = document.getElementById('company-modal');
    const companyForm = document.getElementById('company-form') as HTMLFormElement;
    const closeModalBtn = document.getElementById('close-modal-btn');
    const cancelModalBtn = document.getElementById('cancel-modal-btn');

    // Close modal handlers
    function closeModal() {
        if (companyModal) companyModal.classList.add('hidden');
        if (companyForm) companyForm.reset();
    }

    if (closeModalBtn) closeModalBtn.addEventListener('click', closeModal);
    if (cancelModalBtn) cancelModalBtn.addEventListener('click', closeModal);

    // Click outside modal to close
    if (companyModal) {
        companyModal.addEventListener('click', (e) => {
            if (e.target === companyModal) {
                closeModal();
            }
        });
    }

    // Handle form submission
    if (companyForm) {
        companyForm.addEventListener('submit', (e) => {
            e.preventDefault();

            const companyIdInput = document.getElementById('company-id') as HTMLInputElement;
            const companyName = (document.getElementById('company-name') as HTMLInputElement).value.trim();
            const orgNumber = (document.getElementById('org-number') as HTMLInputElement).value.trim();
            const address = (document.getElementById('company-address') as HTMLInputElement).value.trim();
            const phone = (document.getElementById('company-phone') as HTMLInputElement).value.trim();

            if (!companyName) {
                alert('Företagsnamn är obligatoriskt');
                return;
            }

            const companyId = companyIdInput?.value;

            if (companyId) {
                // Edit mode - update existing company
                companyManager.update(companyId, {
                    name: companyName,
                    orgNumber: orgNumber || '',
                    address: address || '',
                    phone: phone || ''
                });
                renderCompanySelector();
                closeModal();
            } else {
                // Create mode - add new company
                const newCompany = companyManager.create({
                    name: companyName,
                    orgNumber: orgNumber || '',
                    address: address || '',
                    phone: phone || ''
                });

                renderCompanySelector();
                switchCompany(newCompany.id);
                closeModal();
            }
        });
    }

    // Render company selector
    function renderCompanySelector() {
        const companySelect = document.getElementById('company-select') as HTMLSelectElement;
        if (!companySelect) return;

        companySelect.innerHTML = '';

        const companies = companyManager.getAll();
        const currentCompanyId = companyManager.getCurrentId();

        companies.forEach(company => {
            const option = document.createElement('option');
            option.value = company.id;
            option.textContent = company.name;
            option.selected = company.id === currentCompanyId;
            companySelect.appendChild(option);
        });
    }

    // Company selector event listeners
    const companySelect = document.getElementById('company-select') as HTMLSelectElement;
    const editCompanyBtn = document.getElementById('edit-company-btn');
    const addCompanyBtn = document.getElementById('add-company-btn');

    if (companySelect) {
        companySelect.addEventListener('change', (e) => {
            const target = e.target as HTMLSelectElement;
            switchCompany(target.value);
        });
    }

    if (editCompanyBtn) {
        editCompanyBtn.addEventListener('click', () => {
            editCompany();
        });
    }

    if (addCompanyBtn) {
        addCompanyBtn.addEventListener('click', () => {
            createNewCompany();
        });
    }

    // Mock Connect Fortnox Logic
    const connectBtn = document.getElementById('connect-fortnox-btn') as HTMLButtonElement;
    if (connectBtn) {
        connectBtn.addEventListener('click', () => {
            // Simulate connection flow
            connectBtn.innerHTML = '<span>Ansluter...</span>';
            connectBtn.style.opacity = '0.7';
            connectBtn.disabled = true;

            setTimeout(() => {
                alert('🔗 Du skickas nu till Fortnox för att godkänna kopplingen...\n\n(Detta är en simulation)');

                setTimeout(() => {
                    connectBtn.innerHTML = `
    < svg width = "18" height = "18" viewBox = "0 0 24 24" fill = "none" stroke = "currentColor" stroke - width="2" >
        <path d="M20 6L9 17l-5-5" > </path>
            </svg>
            < span > Kopplad </span>
                `;
                    connectBtn.classList.add('connected');
                    connectBtn.style.opacity = '1';
                    connectBtn.disabled = false;

                    connectBtn.classList.add('connected');
                    connectBtn.style.opacity = '1';
                    connectBtn.disabled = false;

                    // addMessage('✅ <strong>Fortnox kopplat!</strong><br>Jag har nu tillgång till dina kunder och artiklar.', 'ai');
                    alert('Fortnox kopplat! (Simulation)');
                }, 1000);
            }, 1000);
        });
    }

    // Initialize company selector
    renderCompanySelector();

    // Load conversation from database for current company
    const currentCompany = companyManager.getCurrent();
    loadConversationFromDB(currentCompany.id).catch((error: unknown) => {
        logger.error('Failed to load initial conversation', error);
    });

    // Chat initialization
    const { fileInput, attachBtn, chatContainer, chatForm } = uiController.elements;

    let currentFile: File | null = null;

    // Auto-focus input
    uiController.focusInput();

    // Hide Loader with smooth transition
    uiController.hideLoader();

    // File Attachment Logic
    if (attachBtn && fileInput) {
        attachBtn.addEventListener('click', () => {
            fileInput.click();
        });

        fileInput.addEventListener('change', (e) => {
            const target = e.target as HTMLInputElement;
            if (target.files && target.files.length > 0) {
                currentFile = target.files[0];
                uiController.showFilePreview(currentFile.name);
            }
        });
    }

    if (uiController.elements.removeFileBtn) {
        uiController.elements.removeFileBtn.addEventListener('click', () => {
            clearFile();
        });
    }

    function clearFile() {
        currentFile = null;
        uiController.clearFilePreview();
    }

    // Voice Logic - handled by VoiceInputController
    voiceInputController.init();



    if (chatForm) {
        chatForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            let message = uiController.getInputValue();

            if (!message && !currentFile) return;

            // If no message but file is attached, use a default message
            if (!message && currentFile) {
                message = "Analysera denna fil";
            }

            const fileToSend = currentFile;
            let fileUrl: string | null = null;
            let vatReportResponse: VATReportResponse | null = null;

            // Excel file handling with AI-first intelligent analysis
            if (fileToSend && fileService.isExcel(fileToSend)) {
                logger.info('Detected Excel file, routing to AI-first analysis');

                // Show streaming analysis UI immediately
                excelWorkspace.showStreamingAnalysis(fileToSend.name);

                // Progress handler for streaming updates
                const handleProgress = (progress: AIAnalysisProgress) => {
                    logger.debug('Analysis progress', { step: progress.step, progress: progress.progress });
                    excelWorkspace.updateStreamingProgress(progress);
                };

                // Use AI-first analysis with streaming progress
                const result = await chatService.analyzeExcelWithAI(fileToSend, handleProgress);

                if (result.success && result.response) {
                    vatReportResponse = result.response;
                    logger.info('Excel AI analysis succeeded', { backend: result.backend });
                } else {
                    logger.error('Excel AI analysis failed', { error: result.error, backend: result.backend });
                    excelWorkspace.showAnalysisError(result.error || 'Okänt fel vid analys');
                }

                // Upload file to storage (for download/reference) after analysis
                try {
                    fileUrl = await fileService.uploadToStorage(fileToSend);

                    // Store report in localStorage if analysis succeeded
                    if (vatReportResponse) {
                        localStorage.setItem('latest_vat_report', JSON.stringify({
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

            // 1. Get current conversation info
            const conversationId = companyManager.getConversationId();

            // 2. Optimistic UI Update (Backend saves the message)
            chatService.dispatchOptimisticMessage(message, fileToSend?.name, fileUrl || undefined);

            // 3. Refresh UI to show user message
            // window.dispatchEvent(new CustomEvent('chat-refresh')); // REMOVED: Premature refresh clears optimistic message

            // Clear input and file
            uiController.clearInput();
            clearFile();

            // Show AI response based on file type
            if (vatReportResponse && vatReportResponse.type === 'vat_report') {
                // Open VAT report in right panel (Claude artifacts style)
                excelWorkspace.openVATReport(vatReportResponse.data, fileUrl || undefined);

                // Insert system message about report
                if (conversationId) {
                    await supabase.from('messages').insert({
                        conversation_id: conversationId,
                        role: 'ai',
                        content: `✅ **Momsredovisning skapad för ${vatReportResponse.data.period}**\n\nRapporten visas till höger. Du kan fortsätta ställa frågor samtidigt som du tittar på rapporten.`
                    });
                    chatService.dispatchRefresh();
                }
            } else {
                // Get VAT report context if available
                const currentContent = excelWorkspace.getCurrentContent();
                const vatContext = currentContent?.type === 'vat_report'
                    ? currentContent.data as unknown as Record<string, unknown>
                    : null;

                // Don't send Excel files to Gemini - it can only handle PDF/images
                // If Excel analysis failed, send message without the file
                const fileForGemini = fileToSend && !fileService.isExcel(fileToSend) ? fileToSend : null;

                await chatService.sendToGemini(message, fileForGemini, fileUrl, vatContext);
                chatService.dispatchRefresh();
            }
        });
    }



    // Functions moved to services: uploadFileToSupabase → FileService, analyzeExcel* → ChatService, sendToGemini → ChatService
}

// Execute initialization
logger.debug('main.ts module loaded', { readyState: document.readyState });
try {
    if (document.readyState !== 'complete') {
        logger.debug('Waiting for window.onload');
        window.addEventListener('load', () => {
            logger.debug('window.onload fired, calling initApp');
            initApp();
        });
    } else {
        logger.debug('DOM already complete, calling initApp immediately');
        initApp();
    }
} catch (error) {
    logger.error('Error in main.ts initialization', error);
}

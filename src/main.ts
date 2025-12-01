
import { supabase } from './lib/supabase';
import { mountPreactComponent } from './components/preact-adapter';
import { ChatHistory } from './components/Chat/ChatHistory';
import { ConversationList } from './components/Chat/ConversationList';
import { LegalConsentModal } from './components/LegalConsentModal';
import { SettingsModal } from './components/SettingsModal';
import { CURRENT_TERMS_VERSION, isVersionOutdated } from './constants/termsVersion';
import { mountModal } from './utils/modalHelpers';
import * as XLSX from 'xlsx';
import './styles/main.css';
import './styles/components/vat-card.css';
import './styles/components/voice-input.css';
import type { VATReportResponse } from './types/vat';
import { ExcelWorkspace } from './components/ExcelWorkspace';
import { VoiceService } from './utils/VoiceService';
import { ThemeManager } from './lib/theme';

// Initialize Supabase client
// Initialize Supabase client
// const supabase = createClient<Database>(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);

console.log('main.ts module loading...');

// Define interfaces
interface Company {
    id: string;
    name: string;
    orgNumber: string;
    address: string;
    phone: string;
    history: any[];
    invoices: any[];
    documents: any[];
    verificationCounter: number;
    conversationId?: string; // Changed from chatHistory to conversationId
}

let chatUnmount: (() => void) | null = null;

async function initApp() {
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
    const { data: { session } } = await supabase.auth.getSession();

    // Handle login page redirect if not authenticated and not on login/landing page
    const isLoginPage = window.location.pathname.includes('login.html');
    const isLandingPage = window.location.pathname === '/' || window.location.pathname.endsWith('index.html');

    if (!session && !isLoginPage && !isLandingPage && (window.location.pathname.includes('/app/') || window.location.pathname === '/app')) {
        window.location.href = '/login';
        return;
    }

    // Check Legal Consent and Version
    if (session) {
        let hasAccepted = false;
        try {
            const { data: profile, error } = await supabase
                .from('profiles')
                .select('has_accepted_terms, terms_version')
                .eq('id', session.user.id)
                .single();

            if (error) {
                // If error (e.g. no profile found/406), treat as not accepted
                console.warn('Error fetching profile, assuming terms not accepted:', error);
                hasAccepted = false;
            } else {
                hasAccepted = !!profile?.has_accepted_terms;
                // Check if version is outdated (needs re-consent)
                if (hasAccepted && isVersionOutdated(profile?.terms_version)) {
                    console.log('Terms version outdated, user needs to re-consent');
                    hasAccepted = false; // Treat as not accepted to trigger modal
                }
            }
        } catch (e) {
            console.error('Exception checking terms:', e);
            hasAccepted = false;
        }

        if (!hasAccepted) {
            // Check for local consent (from login page)
            const localConsent = localStorage.getItem('has_accepted_terms_local');
            const localName = localStorage.getItem('user_full_name_local');
            const localTime = localStorage.getItem('terms_accepted_at_local');

            if (localConsent && localName) {
                console.log('Found local consent, syncing to DB...');

                // Get version from localStorage
                const localVersion = localStorage.getItem('terms_version_local');

                // Sync to DB
                supabase.from('profiles').upsert({
                    id: session.user.id,
                    has_accepted_terms: true,
                    terms_accepted_at: localTime || new Date().toISOString(),
                    terms_version: localVersion || CURRENT_TERMS_VERSION,
                    full_name: localName
                }).then(({ error }) => {
                    if (error) {
                        console.error('Error syncing local consent:', error);
                        // If sync fails, we might want to show the modal again or retry
                        // For now, we'll let it pass but log the error. 
                        // Ideally, we should block if sync fails to ensure legal compliance record.
                        // But since we have local record, we can treat it as accepted for this session.
                    } else {
                        console.log('Local consent synced successfully');
                        // Optional: Clear local storage to avoid re-syncing? 
                        // Or keep it as backup. Keeping it is fine.
                    }
                });

                // Proceed as accepted
                hasAccepted = true;
            } else {
                console.log('User has not accepted terms, showing modal');

                // Remove loader immediately so modal is visible
                const loader = document.getElementById('app-loader');
                if (loader) loader.remove();

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
                            console.log('Terms accepted, redirecting to app...');
                            // Redirect to clean /app URL to clear any potential error hashes
                            window.location.href = '/app';
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
        console.log('Auth state changed:', event, session?.user?.id);

        if (event === 'SIGNED_IN' && session) {
            // Load conversation when user signs in
            const currentCompany = getCurrentCompany();
            if (currentCompany) {
                console.log('User signed in, loading conversation for company:', currentCompany.id);
                loadConversationFromDB(currentCompany.id).catch((error: unknown) => {
                    console.error('Failed to load conversation on sign in:', error);
                });
            }
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

    // Company Management
    let companies: Company[] = JSON.parse(localStorage.getItem('companies') || '[]');
    let currentCompanyId = localStorage.getItem('currentCompanyId') || null;

    // Initialize companies if none exist
    if (companies.length === 0) {
        const defaultCompany: Company = {
            id: 'company-' + Date.now(),
            name: 'Mitt Företag AB',
            orgNumber: '',
            address: '',
            phone: '',
            history: [],
            invoices: [],
            documents: [],
            verificationCounter: 1
        };
        companies = [defaultCompany];
        currentCompanyId = defaultCompany.id;
        localStorage.setItem('companies', JSON.stringify(companies));
        localStorage.setItem('currentCompanyId', currentCompanyId!);
    }

    // Get current company
    function getCurrentCompany(): Company {
        return companies.find(c => c.id === currentCompanyId) || companies[0];
    }

    // Save companies to localStorage
    function saveCompanies() {
        localStorage.setItem('companies', JSON.stringify(companies));
    }

    // Switch company
    async function switchCompany(companyId: string) {
        currentCompanyId = companyId;
        localStorage.setItem('currentCompanyId', companyId);

        // Reload all data for new company
        const company = getCurrentCompany();

        // Refresh views
        // renderHistory();
        // renderInvoices();
        // renderDocuments();

        // Load chat history from database for new company
        await loadConversationFromDB(company.id);
    }

    // Load conversation from database
    async function loadConversationFromDB(companyId: string) {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                console.log('No session, clearing chat');
                if (chatContainer) chatContainer.innerHTML = '';
                return;
            }

            const currentCompany = getCurrentCompany();

            // Get or create conversation for this company
            const { data: conversationId, error: rpcError } = await supabase.rpc('get_or_create_conversation', {
                p_user_id: session.user.id,
                p_company_id: companyId
            });

            if (rpcError) {
                console.error('Error getting conversation:', rpcError);
                return;
            }

            // Store conversationId in company data
            currentCompany.conversationId = conversationId;
            saveCompanies();

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
            console.error('Error loading conversation from DB:', error);
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
        console.log('Conversation deleted:', id);

        // If the deleted conversation was the current one, clear the chat
        const currentCompany = getCurrentCompany();
        if (currentCompany.conversationId === id) {
            currentCompany.conversationId = undefined; // Clear ID
            saveCompanies();

            if (chatContainer) {
                chatContainer.innerHTML = '';
                // Optionally show a "New Chat" or "Select Chat" empty state here
                // For now, we'll rely on ConversationList to select another or reload
            }
        }
    });

    // Listen for create new conversation request (e.g., after deleting active conversation)
    window.addEventListener('create-new-conversation', async () => {
        console.log('Creating new conversation after deletion');
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

                const currentCompany = getCurrentCompany();

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
        console.log('Loading conversation:', conversationId);
        const currentCompany = getCurrentCompany();

        // Update local state
        currentCompany.conversationId = conversationId;
        saveCompanies();

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
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) return;

            const currentCompany = getCurrentCompany();

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
                console.error('Error creating new chat:', error);
                alert('Kunde inte starta ny chatt.');
                return;
            }

            if (conversationId) {
                console.log('Started new conversation:', conversationId.id);

                // Update local state
                currentCompany.conversationId = conversationId.id;
                saveCompanies();

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
            console.error('Error in startNewChat:', error);
        }
    }

    // Get recent chat history from database for API context (last N messages)
    async function getRecentChatHistory(conversationId: string, maxMessages: number = 20): Promise<Array<{ role: string, content: string }>> {
        try {
            // Query messages from database
            const { data: messages, error } = await supabase
                .from('messages')
                .select('role, content')
                .eq('conversation_id', conversationId)
                .order('created_at', { ascending: false })
                .limit(maxMessages);

            if (error) {
                console.error('Error fetching history for context:', error);
                return [];
            }

            // Reverse to get chronological order (oldest to newest)
            const chronologicalMessages = (messages || []).reverse();

            // Format for Gemini API
            return chronologicalMessages.map((msg: { role: string, content: string }) => ({
                role: msg.role === 'user' ? 'user' : 'model',
                content: msg.content
            }));
        } catch (error) {
            console.error('Error in getRecentChatHistory:', error);
            return [];
        }
    }



    // Create new company
    function createNewCompany() {
        const modal = document.getElementById('company-modal');
        const form = document.getElementById('company-form') as HTMLFormElement;

        if (!modal || !form) return;

        // Show modal
        modal.classList.remove('hidden');

        // Clear form
        form.reset();

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

            const companyName = (document.getElementById('company-name') as HTMLInputElement).value.trim();
            const orgNumber = (document.getElementById('org-number') as HTMLInputElement).value.trim();
            const address = (document.getElementById('company-address') as HTMLInputElement).value.trim();
            const phone = (document.getElementById('company-phone') as HTMLInputElement).value.trim();

            if (!companyName) {
                alert('Företagsnamn är obligatoriskt');
                return;
            }

            const newCompany: Company = {
                id: 'company-' + Date.now(),
                name: companyName,
                orgNumber: orgNumber || '',
                address: address || '',
                phone: phone || '',
                history: [],
                invoices: [],
                documents: [],
                verificationCounter: 1
            };

            companies.push(newCompany);
            saveCompanies();
            renderCompanySelector();
            switchCompany(newCompany.id);
            closeModal();
        });
    }

    // Render company selector
    function renderCompanySelector() {
        const companySelect = document.getElementById('company-select') as HTMLSelectElement;
        if (!companySelect) return;

        companySelect.innerHTML = '';

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
    const addCompanyBtn = document.getElementById('add-company-btn');

    if (companySelect) {
        companySelect.addEventListener('change', (e) => {
            const target = e.target as HTMLSelectElement;
            switchCompany(target.value);
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
    const currentCompany = getCurrentCompany();
    if (currentCompany) {
        loadConversationFromDB(currentCompany.id).catch((error: unknown) => {
            console.error('Failed to load initial conversation:', error);
        });
    }

    // Chat initialization
    const chatForm = document.getElementById('chat-form') as HTMLFormElement;
    const userInput = document.getElementById('user-input') as HTMLInputElement;
    const chatContainer = document.getElementById('chat-container');
    const fileInput = document.getElementById('file-input') as HTMLInputElement;
    const attachBtn = document.getElementById('attach-btn');
    const filePreview = document.getElementById('file-preview');
    const fileNameSpan = filePreview?.querySelector('.file-name');
    const removeFileBtn = filePreview?.querySelector('.remove-file');

    let currentFile: File | null = null;

    // Auto-focus input
    if (userInput) userInput.focus();

    // Hide Loader with minimum display time to prevent flicker
    const loader = document.getElementById('app-loader');
    if (loader) {
        // Ensure loader stays for at least 800ms total (including initial load time)
        const minLoadTime = 800;
        const loadTime = Date.now() - (window as any).performance.timing.navigationStart;
        const remainingTime = Math.max(0, minLoadTime - loadTime);

        setTimeout(() => {
            loader.style.opacity = '0';
            setTimeout(() => {
                loader.remove();
            }, 600); // Match CSS transition duration
        }, remainingTime);
    }

    // File Attachment Logic
    if (attachBtn && fileInput) {
        attachBtn.addEventListener('click', () => {
            fileInput.click();
        });

        fileInput.addEventListener('change', (e) => {
            const target = e.target as HTMLInputElement;
            if (target.files && target.files.length > 0) {
                currentFile = target.files[0];
                showFilePreview(currentFile.name);
            }
        });
    }

    if (removeFileBtn) {
        removeFileBtn.addEventListener('click', () => {
            clearFile();
        });
    }

    function showFilePreview(name: string) {
        if (fileNameSpan) fileNameSpan.textContent = name;
        if (filePreview) filePreview.classList.remove('hidden');
        if (userInput) userInput.focus();
    }

    function clearFile() {
        currentFile = null;
        if (fileInput) fileInput.value = '';
        if (filePreview) filePreview.classList.add('hidden');
        if (userInput) userInput.focus();
    }

    // Voice Logic
    const micBtn = document.getElementById('mic-btn');
    const voiceRecordingUI = document.getElementById('voice-recording-ui');
    const textInputContainer = document.querySelector('.text-input-container');
    const voiceCancelBtn = document.getElementById('voice-cancel-btn');
    const voiceConfirmBtn = document.getElementById('voice-confirm-btn');
    const waveformBars = document.querySelectorAll('.waveform-bar');

    if (micBtn) {
        const voiceService = new VoiceService();

        if (voiceService.isSupported()) {
            micBtn.addEventListener('click', () => {
                voiceService.toggle();
            });


            voiceService.onStateChange((isListening) => {
                if (isListening) {
                    // Show waveform UI
                    if (voiceRecordingUI) voiceRecordingUI.classList.remove('hidden');
                    if (textInputContainer) textInputContainer.classList.add('recording');
                    micBtn.classList.add('listening');
                    micBtn.style.display = 'none'; // Hide mic button during recording
                } else {
                    // Hide waveform UI
                    if (voiceRecordingUI) voiceRecordingUI.classList.add('hidden');
                    if (textInputContainer) textInputContainer.classList.remove('recording');
                    micBtn.classList.remove('listening');
                    micBtn.style.display = ''; // Show mic button again

                    // Reset bars to minimum height
                    waveformBars.forEach((bar) => {
                        (bar as HTMLElement).style.height = '8px';
                    });
                }
            });

            // Animate waveform bars based on audio level
            voiceService.onAudioLevel((level) => {
                waveformBars.forEach((bar) => {
                    const minHeight = 8;
                    const maxHeight = 32;

                    // Add some randomness for more natural look
                    const randomFactor = 0.7 + Math.random() * 0.6;
                    const height = minHeight + (level * randomFactor * (maxHeight - minHeight));

                    (bar as HTMLElement).style.height = `${height} px`;
                });
            });

            voiceService.onResult((text) => {
                if (userInput) {
                    userInput.value = text;
                }
            });

            // Cancel button - discard recording
            if (voiceCancelBtn) {
                voiceCancelBtn.addEventListener('click', () => {
                    voiceService.cancel();
                    if (userInput) {
                        userInput.value = '';
                        userInput.focus();
                    }
                });
            }

            // Confirm button - stop recording and keep text
            if (voiceConfirmBtn) {
                voiceConfirmBtn.addEventListener('click', () => {
                    voiceService.stop();
                    // Focus input so user can review and manually send
                    if (userInput) {
                        userInput.focus();
                    }
                });
            }
        } else {
            micBtn.style.display = 'none';
        }
    }



    if (chatForm) {
        chatForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            let message = userInput.value.trim();

            if (!message && !currentFile) return;

            // If no message but file is attached, use a default message
            if (!message && currentFile) {
                message = "Analysera denna fil";
            }

            const fileToSend = currentFile;
            let fileUrl: string | null = null;
            let vatReportResponse: VATReportResponse | null = null;

            // Upload Excel files to Supabase Storage
            // Excel file handling with intelligent routing
            if (fileToSend && (fileToSend.name.endsWith('.xlsx') || fileToSend.name.endsWith('.xls'))) {
                console.log('[Router] Detected Excel file, routing to Python API');

                try {
                    // PRIMARY: Try Python API for precise calculations
                    vatReportResponse = await analyzeExcelWithPython(fileToSend);
                    console.log('[Router] Python API succeeded');

                } catch (pythonError) {
                    // FALLBACK: If Python fails, try Claude
                    console.warn('[Router] Python API failed, falling back to Claude:', pythonError);

                    try {
                        vatReportResponse = await analyzeExcelWithClaude(fileToSend);
                        console.log('[Router] Claude fallback succeeded');

                    } catch (claudeError) {
                        // Both failed - show error to user
                        console.error('[Router] Both Python and Claude failed:', claudeError);
                        // Both failed - show error to user
                        console.error('[Router] Both Python and Claude failed:', claudeError);
                        const errorMessage = claudeError instanceof Error ? claudeError.message : 'Okänt fel';
                        // addMessage(`❌ Kunde inte analysera Excel - filen.Försök igen eller kontakta support.\n\nFelmeddelande: ${ errorMessage } `, 'ai');
                        alert(`Kunde inte analysera Excel - filen: ${errorMessage} `);
                    }
                }

                // Upload file to storage (for download/reference) after analysis
                try {
                    fileUrl = await uploadFileToSupabase(fileToSend);

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
                    console.warn('[Router] File upload failed (non-critical):', uploadError);
                }
            }

            // 1. Get history for AI context BEFORE inserting new message
            const currentCompany = getCurrentCompany();
            const conversationId = currentCompany.conversationId;
            // Note: getRecentChatHistory handles fetching from DB. 
            // Since we haven't inserted the new message yet, it won't be included, which is correct for "history".

            // 2. Optimistic UI Update (Backend saves the message)
            // Dispatch event for ChatHistory to show message immediately
            window.dispatchEvent(new CustomEvent('add-optimistic-message', {
                detail: {
                    content: message,
                    file_name: fileToSend?.name,
                    file_url: fileUrl
                }
            }));

            // 3. Refresh UI to show user message
            // window.dispatchEvent(new CustomEvent('chat-refresh')); // REMOVED: Premature refresh clears optimistic message

            // Clear input and file
            userInput.value = '';
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
                        content: `✅ ** Momsredovisning skapad för ${vatReportResponse.data.period}**\n\nRapporten visas till höger.Du kan fortsätta ställa frågor samtidigt som du tittar på rapporten.`
                    });
                    window.dispatchEvent(new CustomEvent('chat-refresh'));
                }
            } else {
                await sendToGemini(message, fileToSend, fileUrl);
                // Refresh again after AI response (sendToGemini should handle saving AI response to DB? We need to verify this)
                // Assuming sendToGemini triggers the edge function which saves the response.
                // We should trigger a refresh after it returns.
                window.dispatchEvent(new CustomEvent('chat-refresh'));
            }
        });
    }



    // Removed addMessage function - replaced by ChatHistory component



    async function uploadFileToSupabase(file: File): Promise<string> {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) throw new Error('User not authenticated');

            const reader = new FileReader();
            const base64Data = await new Promise<string>((resolve, reject) => {
                reader.onload = () => resolve(reader.result as string);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });

            const company = getCurrentCompany();

            const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-file`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.access_token} `
                },
                body: JSON.stringify({
                    filename: file.name,
                    fileData: base64Data,
                    mimeType: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    userId: session.user.id,
                    companyId: company ? company.id : null
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Upload failed');
            }

            const result = await response.json();
            return result.file.url;
        } catch (error) {
            console.error('File upload error:', error);
            throw error;
        }
    }

    /**
     * Analyze Excel file with Python API for precise VAT calculations.
     * Falls back to Claude if Python API fails.
     */
    async function analyzeExcelWithPython(file: File): Promise<VATReportResponse> {
        try {
            console.log('[Python API] Analyzing Excel file:', file.name);

            // Convert file to base64
            const base64 = await fileToBase64(file);
            const base64Data = base64.split(',')[1]; // Remove data URL prefix

            // Get current company info
            const company = getCurrentCompany();
            const period = new Date().toISOString().slice(0, 7); // YYYY-MM

            // Call python-proxy Edge Function
            const { data, error } = await supabase.functions.invoke('python-proxy', {
                body: {
                    file_data: base64Data,
                    filename: file.name,
                    company_name: company?.name || '',
                    org_number: company?.orgNumber || '',
                    period: period
                }
            });

            if (error) {
                console.warn('[Python API] Error:', error.message);
                throw new Error(error.message || 'Python API error');
            }

            console.log('[Python API] Success:', data);
            return data as VATReportResponse;

        } catch (error) {
            console.error('[Python API] Failed:', error);
            throw error; // Re-throw to trigger fallback
        }
    }

    async function analyzeExcelWithClaude(file: File): Promise<VATReportResponse> {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) throw new Error('User not authenticated');

            // addMessage('Jag analyserar din Excel-fil... Detta kan ta några sekunder. ⏳', 'ai');

            const arrayBuffer = await file.arrayBuffer();
            const workbook = XLSX.read(arrayBuffer);

            const sheets: Record<string, any[]> = {};
            workbook.SheetNames.forEach(sheetName => {
                const worksheet = workbook.Sheets[sheetName];
                sheets[sheetName] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
            });

            const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/claude-analyze`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.access_token} `
                },
                body: JSON.stringify({
                    filename: file.name,
                    sheets: sheets
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Analysis failed');
            }

            const result = await response.json();
            return result;  // Returns { type: 'vat_report', data: {...} }
        } catch (error) {
            console.error('Excel analysis error:', error);
            throw error;
        }
    }

    async function sendToGemini(message: string, file: File | null, fileUrl: string | null = null) {
        try {
            // Prepare file data if present
            let fileData = null;
            if (file) {
                const base64 = await fileToBase64(file);
                // Remove data URL prefix (e.g., "data:image/png;base64,")
                const base64Data = base64.split(',')[1];
                fileData = {
                    data: base64Data,
                    mimeType: file.type
                };
            }

            // Get current company conversation ID
            const currentCompany = getCurrentCompany();
            let conversationId = currentCompany.conversationId;

            // If conversationId is missing, try to get/create it
            if (!conversationId) {
                console.log('Conversation ID missing, fetching...');
                const { data: { session } } = await supabase.auth.getSession();
                if (session) {
                    const { data, error } = await supabase.rpc('get_or_create_conversation', {
                        p_user_id: session.user.id,
                        p_company_id: currentCompany.id
                    });

                    if (data) {
                        conversationId = data;
                        currentCompany.conversationId = conversationId;
                        saveCompanies(); // Save to localStorage
                        console.log('Fetched new conversation ID:', conversationId);
                    } else if (error) {
                        console.error('Error fetching conversation ID:', error);
                    }
                }
            }

            // Get recent chat history from database (excluding the current message we just added)
            const history = conversationId ? await getRecentChatHistory(conversationId, 20) : [];

            const { data, error } = await supabase.functions.invoke('gemini-chat', {
                body: {
                    message,
                    fileData,
                    history,
                    conversationId,
                    companyId: currentCompany.id,
                    fileUrl: fileUrl || null,
                    fileName: file?.name || null
                }
            });

            if (error) throw error;

            if (data && conversationId) {
                let aiContent = '';
                if (data.type === 'text') {
                    aiContent = data.data;
                } else if (data.type === 'json') {
                    // Handle tool output (e.g. create_invoice)
                    aiContent = `Jag har förberett en åtgärd: \n\`\`\`json\n${JSON.stringify(data.data, null, 2)}\n\`\`\``;
                }

                if (aiContent) {
                    await supabase.from('messages').insert({
                        conversation_id: conversationId,
                        role: 'ai',
                        content: aiContent
                    });
                    window.dispatchEvent(new CustomEvent('chat-refresh'));
                }
            }

        } catch (error) {
            console.error('Gemini error:', error);

            // Log error to chat
            const currentCompany = getCurrentCompany();
            if (currentCompany?.conversationId) {
                await supabase.from('messages').insert({
                    conversation_id: currentCompany.conversationId,
                    role: 'ai',
                    content: '⚠️ Tyvärr uppstod ett fel vid kontakten med Britta. Försök igen senare.'
                });
                window.dispatchEvent(new CustomEvent('chat-refresh'));
            }
        }
    }

    function fileToBase64(file: File): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }
}

// Execute initialization
console.log('main.ts module loaded, readyState:', document.readyState);
try {
    if (document.readyState !== 'complete') {
        console.log('Waiting for window.onload (readyState not complete)');
        window.addEventListener('load', () => {
            console.log('window.on load fired, calling initApp');
            initApp();
        });
    } else { // complete
        console.log('DOM already complete, calling initApp immediately');
        initApp();
    }
} catch (error) {
    console.error('Error in main.ts initialization:', error);
}

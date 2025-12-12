/**
 * AppController - Main application orchestration
 *
 * Coordinates all controllers and handles app initialization.
 * This is the only class that main.ts needs to interact with.
 */

import { supabase } from '../lib/supabase';
import { mountPreactComponent } from '../components/preact-adapter';
import { LegalConsentModal } from '../components/LegalConsentModal';
import { SettingsModal } from '../components/SettingsModal';
import { ConversationList } from '../components/Chat/ConversationList';
import { ExcelWorkspace } from '../components/ExcelWorkspace';
import { mountModal } from '../utils/modalHelpers';
import { initKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';

// Services
import { logger } from '../services/LoggerService';
import { authService } from '../services/AuthService';
import { companyManager } from '../services/CompanyService';
import { uiController } from '../services/UIService';
import { voiceInputController } from '../services/VoiceInputService';

// Controllers
import { themeController } from './ThemeController';
import { companyModalController } from './CompanyModalController';
import { conversationController } from './ConversationController';
import { chatController } from './ChatController';

export class AppController {
    private excelWorkspace: ExcelWorkspace | null = null;

    async init(): Promise<void> {
        logger.debug('AppController.init() starting...');

        // Initialize UI Controller (queries all DOM elements once)
        uiController.init();

        // Initialize Excel Workspace
        this.excelWorkspace = new ExcelWorkspace({
            onClose: () => logger.debug('Excel panel closed'),
            onSheetChange: (sheetName) => logger.debug('Switched to sheet:', { sheetName }),
            onError: (error) => logger.error('Excel workspace error:', error)
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
            const hasAccepted = await this.handleLegalConsent();
            if (!hasAccepted) return;
        }

        // Setup auth state change listener
        this.setupAuthListener();

        // Initialize all controllers
        this.initializeControllers();

        // Initialize keyboard shortcuts
        initKeyboardShortcuts();

        // Setup settings button
        this.setupSettingsButton();

        // Setup new chat button
        this.setupNewChatButton();

        // Initialize voice input
        voiceInputController.init();

        // Load conversation from database for current company
        const currentCompany = companyManager.getCurrent();

        // Check for new chat route
        if (window.location.pathname === '/app/newchat') {
            await conversationController.startNewChat();
        } else {
            await conversationController.loadFromDB(currentCompany.id).catch((error: unknown) => {
                logger.error('Failed to load initial conversation', error);
            });
        }

        // Auto-focus input
        uiController.focusInput();

        // Hide Loader with smooth transition
        uiController.hideLoader();

        logger.debug('AppController.init() complete');
    }

    private async handleLegalConsent(): Promise<boolean> {
        let hasAccepted = await authService.hasAcceptedTerms();

        if (!hasAccepted) {
            // Check for local consent (from login page)
            if (authService.hasLocalConsent()) {
                logger.info('Found local consent, syncing to DB...');
                authService.syncLocalConsentToDatabase();
                return true;
            }

            logger.info('User has not accepted terms, showing modal');
            uiController.removeLoaderImmediately();

            // Create container for modal
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

            return false;
        }

        return true;
    }

    private setupAuthListener(): void {
        supabase.auth.onAuthStateChange((event, session) => {
            logger.info('Auth state changed', { event, userId: session?.user?.id });

            if (event === 'SIGNED_IN' && session) {
                const currentCompany = companyManager.getCurrent();
                logger.info('User signed in, loading conversation for company', { companyId: currentCompany.id });
                conversationController.loadFromDB(currentCompany.id).catch((error: unknown) => {
                    logger.error('Failed to load conversation on sign in', error);
                });
            } else if (event === 'SIGNED_OUT') {
                const chatContainer = conversationController.getChatContainer();
                if (chatContainer) chatContainer.innerHTML = '';
                window.location.href = '/';
            }
        });
    }

    private initializeControllers(): void {
        // Theme controller
        themeController.init();

        // Mount ConversationList in sidebar
        const conversationListContainer = document.getElementById('conversation-list-container');
        if (conversationListContainer) {
            const currentCompany = companyManager.getCurrent();
            mountPreactComponent(
                ConversationList,
                {
                    currentConversationId: currentCompany.conversationId || null,
                    onSelectConversation: async (id: string) => {
                        await conversationController.loadConversation(id);
                    }
                },
                conversationListContainer
            );
        }

        // Company modal controller
        companyModalController.init(async (companyId) => {
            const company = companyManager.switchTo(companyId);
            if (company) {
                await conversationController.loadFromDB(company.id);
            }
        });

        // Conversation controller
        const { chatContainer } = uiController.elements;
        if (chatContainer) {
            conversationController.init(chatContainer);
        }

        // Chat controller
        if (this.excelWorkspace) {
            chatController.init(this.excelWorkspace);
        }
    }

    private setupSettingsButton(): void {
        const settingsBtn = document.getElementById('settings-btn');

        if (settingsBtn) {
            settingsBtn.addEventListener('click', () => {
                // Check if modal is stuck
                const container = document.getElementById('settings-modal-container');
                if (container && container.childElementCount > 0) {
                    logger.warn('Cleaning up debris in settings modal container before opening');
                    container.innerHTML = '';
                }

                const closeSettings = mountModal({
                    containerId: 'settings-modal-container',
                    Component: SettingsModal,
                    props: {
                        onClose: () => closeSettings(),
                        onLogout: async () => {
                            await supabase.auth.signOut();
                            window.location.href = '/login';
                        }
                    }
                });
            });
        }
    }

    private setupNewChatButton(): void {
        const newChatBtn = document.getElementById('new-chat-btn');
        if (newChatBtn) {
            newChatBtn.addEventListener('click', async () => {
                await conversationController.startNewChat();
            });
        }
    }
}

export const appController = new AppController();

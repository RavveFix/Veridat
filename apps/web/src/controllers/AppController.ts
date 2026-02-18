/**
 * AppController - Main application orchestration
 *
 * Coordinates all controllers and handles app initialization.
 * This is the only class that main.ts needs to interact with.
 */

import { supabase } from '../lib/supabase';
import { mountPreactComponent } from '../components/preact-adapter';
import { mountModal } from '../utils/modalHelpers';
import { LegalConsentModal } from '../components/LegalConsentModal';
import { SettingsModal } from '../components/SettingsModal';
import { IntegrationsModal } from '../components/IntegrationsModal';
import { AgentDashboardModal } from '../components/AgentDashboardModal';
import { ConversationList } from '../components/Chat/ConversationList';
import { ExcelWorkspace } from '../components/ExcelWorkspace';
import { MemoryIndicator } from '../components/MemoryIndicator';
import { SearchModalWrapper } from '../components/SearchModal';
import { initKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { FortnoxSidebar } from '../components/FortnoxSidebar';

// Services
import { logger } from '../services/LoggerService';
import { fortnoxContextService, type FortnoxConnectionStatus } from '../services/FortnoxContextService';
import { copilotService } from '../services/CopilotService';
import { authService, type ConsentSyncContext } from '../services/AuthService';
import { companyManager } from '../services/CompanyService';
import { uiController } from '../services/UIService';
import { voiceInputController } from '../services/VoiceInputService';
import { getRequiredDocsForUser } from '../constants/consentPolicy';

// Controllers
import { themeController } from './ThemeController';
import { sidebarController } from './SidebarController';
import { companyModalController } from './CompanyModalController';
import { conversationController } from './ConversationController';
import { chatController } from './ChatController';
import { modelSelectorController } from './ModelSelectorController';

export class AppController {
    private excelWorkspace: ExcelWorkspace | null = null;
    private fortnoxSidebar: FortnoxSidebar | null = null;
    private settingsCleanup: (() => void) | null = null;
    private integrationsCleanup: (() => void) | null = null;
    private agentDashboardCleanup: (() => void) | null = null;
    private settingsListenerAttached = false;
    private integrationsListenerAttached = false;
    private agentDashboardListenerAttached = false;
    private boundCopilotToolListener: EventListener | null = null;
    private lastActiveAt = Date.now();
    private resumeInProgress = false;

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

        if (session) {
            await companyManager.syncWithDatabase(session.user.id);
            const hasAccepted = await this.handleLegalConsent(session.user.created_at ?? null);
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

        // Setup integrations button
        this.setupIntegrationsButton();

        // Setup agent dashboard button
        this.setupAgentDashboardButton();

        // Setup copilot tool event listener
        this.setupCopilotToolListener();

        // Setup new chat button
        this.setupNewChatButton();

        // Setup contact button
        this.setupContactButton();

        // Initialize voice input
        voiceInputController.init();

        // Setup app lifecycle handlers (resume from idle)
        this.setupLifecycleHandlers();

        // Load conversation based on URL route
        const path = window.location.pathname;
        const chatMatch = path.match(/^\/app\/chat\/([a-f0-9-]{36})$/i);

        if (chatMatch) {
            // Direct link to specific conversation
            const conversationId = chatMatch[1];
            logger.info('Loading conversation from URL', { conversationId });
            const loaded = await conversationController.loadConversationFromUrl(conversationId);
            if (!loaded) {
                // loadConversationFromUrl handles redirect on failure
                logger.warn('Failed to load conversation from URL, redirecting to new chat');
            }
        } else if (path === '/app/newchat') {
            // New chat route
            await conversationController.startNewChat();
        } else if (path === '/app' || path === '/app/') {
            // Default /app route - redirect to new chat for fresh start
            await conversationController.startNewChat();
        } else {
            // Unknown /app/* route - fallback to new chat
            logger.warn('Unknown app route, starting new chat', { path });
            await conversationController.startNewChat();
        }

        // Handle Fortnox OAuth callback params (redirect from Fortnox)
        this.handleFortnoxOAuthCallback();

        // Auto-focus input
        uiController.focusInput();

        // Hide Loader with smooth transition
        uiController.hideLoader();

        logger.debug('AppController.init() complete');
    }

    /**
     * Checks for Fortnox OAuth redirect query params and shows feedback.
     * Called after route handling so the user sees the result of their OAuth flow.
     */
    private handleFortnoxOAuthCallback(): void {
        const params = new URLSearchParams(window.location.search);
        const connected = params.get('fortnox_connected');
        const error = params.get('fortnox_error');

        if (!connected && !error) return;

        if (connected === 'true') {
            this.showToast('Fortnox ansluten!', 'success');
            // Refresh connection status and preload data
            fortnoxContextService.checkConnection().then((status) => {
                if (status === 'connected') {
                    fortnoxContextService.preloadData();
                }
            });
        } else if (error) {
            const errorMessages: Record<string, string> = {
                'missing_params': 'OAuth-parametrar saknas',
                'state_expired': 'OAuth-sessionen har gått ut, försök igen',
                'invalid_state': 'Ogiltig säkerhetskod, försök igen',
                'state_secret_missing': 'Serverkonfigurationsfel',
                'token_exchange_failed': 'Kunde inte hämta token från Fortnox',
                'storage_failed': 'Kunde inte spara token i databasen',
                'company_not_found': 'Aktivt bolag hittades inte. Välj bolag och försök igen.',
                'company_org_required': 'Bolaget måste ha organisationsnummer innan Fortnox kan anslutas.',
                'org_number_mismatch': 'Fortnox-bolaget matchar inte organisationsnumret för aktivt bolag.',
                'callback_failed': 'OAuth-anslutning misslyckades',
            };
            const message = errorMessages[error] || decodeURIComponent(error);
            this.showToast(`Fortnox-fel: ${message}`, 'error');
        }

        // Clean URL to remove OAuth params
        window.history.replaceState({}, '', window.location.pathname);
    }

    private showToast(message: string, type: 'success' | 'error'): void {
        const existingToast = document.querySelector('.toast-inline');
        if (existingToast) existingToast.remove();

        const toast = document.createElement('div');
        toast.className = `toast-inline ${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 4000);
    }

    private getConsentSyncContext(): ConsentSyncContext | undefined {
        const currentCompany = companyManager.getCurrent();
        if (!currentCompany?.id) return undefined;

        return {
            companyId: currentCompany.id,
            companyOrgNumber: currentCompany.orgNumber?.trim() ? currentCompany.orgNumber.trim() : null
        };
    }

    private async handleLegalConsent(userCreatedAt: string | null): Promise<boolean> {
        const requiredDocs = getRequiredDocsForUser(userCreatedAt);
        const hasAccepted = await authService.hasAcceptedTerms();
        logger.debug('Evaluating legal consent requirements', { requiredDocs });

        if (!hasAccepted) {
            // First, check if this is a re-consent scenario (existing user with outdated version)
            // This takes priority over local consent from login page
            const needsReconsent = await this.checkNeedsReconsent();

            if (needsReconsent) {
                // Clear any local consent - existing users must re-accept via modal
                authService.clearLocalConsent();
                logger.info('User needs to re-consent to updated terms');
                return this.showReconsentModal();
            }

            // Not a re-consent scenario - check for local consent (new user from login page)
            if (authService.hasLocalConsent(userCreatedAt)) {
                logger.info('Found local consent from login (new user), syncing to DB...');
                const synced = await authService.syncLocalConsentToDatabase(this.getConsentSyncContext());

                if (synced) {
                    return true;
                }

                // Sync failed but we have local consent - allow access
                // Will retry sync on next load
                logger.warn('DB sync failed, but allowing access with local consent');
                return true;
            }

            // Authenticated user without consent (e.g. magic link opened on another device)
            // Show consent modal instead of redirecting to avoid login loops.
            logger.warn('No consent found for authenticated user, showing consent modal');
            return this.showReconsentModal();
        }

        return true;
    }

    private async checkNeedsReconsent(): Promise<boolean> {
        const session = await authService.getSession();
        if (!session) return false;

        try {
            const { data: profile } = await supabase
                .from('profiles')
                .select('has_accepted_terms, terms_version')
                .eq('id', session.user.id)
                .single();

            // If user has accepted previously, treat missing/outdated version as re-consent.
            return !!profile?.has_accepted_terms;
        } catch {
            return false;
        }
    }

    private showReconsentModal(): boolean {
        logger.info('Showing consent modal');
        uiController.removeLoaderImmediately();

        // Use mountModal helper (same pattern as SettingsModal)
        // LegalConsentModal now renders its own full-screen overlay
        mountModal({
            containerId: 'legal-consent-modal-container',
            Component: LegalConsentModal,
            props: {
                mode: 'authenticated' as const,
                onAccepted: (_fullName: string) => {
                    logger.info('Terms re-accepted, reloading app...');
                    window.location.reload();
                }
            }
        });

        logger.debug('LegalConsentModal mounted');

        return false;
    }

    private setupAuthListener(): void {
        supabase.auth.onAuthStateChange(async (event, session) => {
            logger.info('Auth state changed', { event, userId: session?.user?.id });

            if (event === 'SIGNED_IN' && session) {
                await companyManager.syncWithDatabase(session.user.id);
                const currentCompany = companyManager.getCurrent();
                logger.info('User signed in, loading conversation for company', { companyId: currentCompany.id });
                conversationController.loadFromDB(currentCompany.id).catch((error: unknown) => {
                    logger.error('Failed to load conversation on sign in', error);
                });
            } else if (event === 'SIGNED_OUT') {
                companyManager.clearLocalCache();
                const chatContainer = conversationController.getChatContainer();
                if (chatContainer) chatContainer.innerHTML = '';
                window.location.href = '/';
            }
        });
    }

    private setupLifecycleHandlers(): void {
        const markActive = () => {
            this.lastActiveAt = Date.now();
        };

        window.addEventListener('focus', () => {
            void this.handleAppResume('focus');
        });

        window.addEventListener('online', () => {
            void this.handleAppResume('online');
        });

        window.addEventListener('blur', markActive);

        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                markActive();
                if (typeof supabase.auth.stopAutoRefresh === 'function') {
                    supabase.auth.stopAutoRefresh();
                }
                return;
            }
            void this.handleAppResume('visibility');
        });
    }

    private async handleAppResume(source: 'focus' | 'visibility' | 'online'): Promise<void> {
        const now = Date.now();
        const idleMs = now - this.lastActiveAt;
        this.lastActiveAt = now;

        // Avoid noisy refreshes unless we were idle for a bit
        if (idleMs < 60_000 && source !== 'online') {
            return;
        }

        if (this.resumeInProgress) return;
        this.resumeInProgress = true;

        try {
            if (typeof supabase.auth.startAutoRefresh === 'function') {
                supabase.auth.startAutoRefresh();
            }

            const { data: { session } } = await supabase.auth.getSession();

            if (!session) {
                if (authService.isProtectedPage()) {
                    authService.redirectToLogin();
                }
                return;
            }

            const expiresAtMs = (session.expires_at ?? 0) * 1000;
            const shouldRefresh = expiresAtMs > 0 && Date.now() > (expiresAtMs - 2 * 60 * 1000);

            if (shouldRefresh) {
                const { data, error } = await supabase.auth.refreshSession();
                if (error) {
                    logger.warn('Session refresh failed on resume', { error, source });
                } else if (data?.session?.access_token && typeof supabase.realtime?.setAuth === 'function') {
                    supabase.realtime.setAuth(data.session.access_token);
                }
            } else if (session.access_token && typeof supabase.realtime?.setAuth === 'function') {
                supabase.realtime.setAuth(session.access_token);
            }

            if (typeof supabase.realtime?.connect === 'function') {
                supabase.realtime.connect();
            }

            // Force refresh of chat + conversation list after idle
            window.dispatchEvent(new CustomEvent('refresh-conversation-list', { detail: { force: true } }));
            window.dispatchEvent(new CustomEvent('chat-refresh'));
        } catch (error) {
            logger.warn('Failed to recover app after idle', { error, source });
        } finally {
            this.resumeInProgress = false;
        }
    }

    private initializeControllers(): void {
        // Theme controller
        themeController.init();

        // Sidebar controller (responsive toggle)
        sidebarController.init();

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
                    },
                    companyId: currentCompany?.id || null
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

        // Model selector controller
        modelSelectorController.init();

        this.mountMemoryComponents();

        // Initialize Fortnox Sidebar
        this.initFortnoxSidebar();
    }

    private mountMemoryComponents(): void {
        const memoryRoot = document.getElementById('memory-indicator-root');
        if (memoryRoot) {
            mountPreactComponent(MemoryIndicator, {}, memoryRoot);
        }

        // Mount global search modal
        this.mountSearchModal();

        // Setup search trigger click handlers (topbar + sidebar)
        const searchTriggers = Array.from(document.querySelectorAll<HTMLElement>('[data-search-trigger]'));
        for (const trigger of searchTriggers) {
            trigger.addEventListener('click', () => {
                window.dispatchEvent(new CustomEvent('open-search-modal'));
            });
        }
    }

    private mountSearchModal(): void {
        const container = document.getElementById('search-modal-container');
        if (!container) return;

        mountPreactComponent(SearchModalWrapper, {}, container);
    }

    private setupSettingsButton(): void {
        const settingsBtn = document.getElementById('settings-btn');

        if (settingsBtn && !this.settingsListenerAttached) {
            settingsBtn.addEventListener('click', () => {
                // Clean up previous instance if exists
                if (this.settingsCleanup) {
                    logger.debug('Cleaning up previous settings modal instance');
                    this.settingsCleanup();
                    this.settingsCleanup = null;
                }

                // Mount new instance and store cleanup function
                this.settingsCleanup = mountModal({
                    containerId: 'settings-modal-container',
                    Component: SettingsModal,
                    props: {
                        onClose: () => {
                            if (this.settingsCleanup) {
                                this.settingsCleanup();
                                this.settingsCleanup = null;
                            }
                        },
                        onLogout: async () => {
                            await supabase.auth.signOut();
                            window.location.href = '/login';
                        }
                    }
                });
            });
            this.settingsListenerAttached = true;
            logger.debug('Settings button listener attached');
        }
    }

    private setupIntegrationsButton(): void {
        const integrationsBtn = document.getElementById('integrations-btn');

        if (integrationsBtn && !this.integrationsListenerAttached) {
            integrationsBtn.addEventListener('click', () => {
                // Clean up previous instance if exists
                if (this.integrationsCleanup) {
                    logger.debug('Cleaning up previous integrations modal instance');
                    this.integrationsCleanup();
                    this.integrationsCleanup = null;
                }

                // Mount new instance and store cleanup function
                this.integrationsCleanup = mountModal({
                    containerId: 'integrations-modal-container',
                    Component: IntegrationsModal,
                    props: {
                        onClose: () => {
                            if (this.integrationsCleanup) {
                                this.integrationsCleanup();
                                this.integrationsCleanup = null;
                            }
                        }
                    }
                });
            });
            this.integrationsListenerAttached = true;
            logger.debug('Integrations button listener attached');
        }
    }

    private setupAgentDashboardButton(): void {
        const btn = document.getElementById('agent-dashboard-btn');

        if (btn && !this.agentDashboardListenerAttached) {
            btn.addEventListener('click', () => {
                if (this.agentDashboardCleanup) {
                    this.agentDashboardCleanup();
                    this.agentDashboardCleanup = null;
                }

                this.agentDashboardCleanup = mountModal({
                    containerId: 'agent-dashboard-modal-container',
                    Component: AgentDashboardModal,
                    props: {
                        onClose: () => {
                            if (this.agentDashboardCleanup) {
                                this.agentDashboardCleanup();
                                this.agentDashboardCleanup = null;
                            }
                        }
                    }
                });
            });
            this.agentDashboardListenerAttached = true;
        }
    }

    /**
     * Listens for copilot-open-tool events and opens IntegrationsModal with the requested tool.
     */
    private setupCopilotToolListener(): void {
        this.boundCopilotToolListener = ((e: CustomEvent<{ tool: string }>) => {
            const tool = e.detail?.tool;
            if (!tool) return;

            // Clean up previous instance if exists
            if (this.integrationsCleanup) {
                this.integrationsCleanup();
                this.integrationsCleanup = null;
            }

            this.integrationsCleanup = mountModal({
                containerId: 'integrations-modal-container',
                Component: IntegrationsModal,
                props: {
                    initialTool: tool,
                    onClose: () => {
                        if (this.integrationsCleanup) {
                            this.integrationsCleanup();
                            this.integrationsCleanup = null;
                        }
                    }
                }
            });
        }) as EventListener;
        window.addEventListener('copilot-open-tool', this.boundCopilotToolListener);
    }

    private setupNewChatButton(): void {
        const newChatBtn = document.getElementById('new-chat-btn');
        if (newChatBtn) {
            newChatBtn.addEventListener('click', async () => {
                await conversationController.startNewChat();
            });
        }
    }

    private setupContactButton(): void {
        const contactBtn = document.getElementById('contact-btn');
        if (contactBtn) {
            contactBtn.addEventListener('click', () => {
                window.location.href = 'mailto:hej@veridat.se?subject=Uppgradera%20till%20Pro&body=Hej%2C%0A%0AJag%20skulle%20vilja%20uppgradera%20till%20Pro%20(40%20förfrågningar%2Ftimme%2C%20200%2Fdag).%0A%0AMvh';
            });
        }
    }

    private initFortnoxSidebar(): void {
        this.fortnoxSidebar = new FortnoxSidebar();
        this.fortnoxSidebar.init('fortnox-sidebar');

        // Toggle button in header
        const toggleBtn = document.getElementById('fortnox-sidebar-toggle') as HTMLButtonElement;
        if (toggleBtn) {
            this.fortnoxSidebar.setToggleButton(toggleBtn);
            toggleBtn.addEventListener('click', () => {
                this.fortnoxSidebar?.toggle();
            });
        }

        // Check Fortnox connection and preload data
        fortnoxContextService.checkConnection().then((status: FortnoxConnectionStatus) => {
            if (status === 'connected') {
                fortnoxContextService.preloadData();
                copilotService.start();
            }
            // Hide toggle button if not connected
            if (toggleBtn && status === 'disconnected') {
                toggleBtn.style.display = 'none';
            }
        });

        // Show toggle when Fortnox becomes connected
        fortnoxContextService.addEventListener('connection-changed', ((e: Event) => {
            const status = (e as CustomEvent).detail;
            if (toggleBtn) {
                toggleBtn.style.display = status === 'connected' ? '' : 'none';
            }
            // Start/stop copilot based on connection
            if (status === 'connected') {
                copilotService.start();
            } else {
                copilotService.stop();
            }
        }) as EventListener);
    }
}

export const appController = new AppController();

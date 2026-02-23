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
import { ExcelWorkspace } from '../components/ExcelWorkspace';
import { MemoryIndicator } from '../components/MemoryIndicator';
import { SearchModalWrapper } from '../components/SearchModal';
import { initKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { FortnoxSidebar } from '../components/FortnoxSidebar';
import { AppSidebar, type AppPage } from '../components/AppSidebar';
import { InvoicesPage } from '../components/pages/InvoicesPage';
import { BankPage } from '../components/pages/BankPage';
import { ReportsPage } from '../components/pages/ReportsPage';
import { DashboardPanel } from '../components/DashboardPanel';

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

// =============================================================================
// PAGE IDs for DOM containers
// =============================================================================

const PAGE_CONTAINER_IDS: Record<AppPage, string> = {
    overview: 'page-overview',
    chat: 'page-chat',
    invoices: 'page-invoices',
    bank: 'page-bank',
    reports: 'page-reports',
};

const PAGE_URL_MAP: Record<AppPage, string> = {
    overview: '/app/overview',
    chat: '/app',
    invoices: '/app/invoices',
    bank: '/app/bank',
    reports: '/app/reports',
};

// Maps copilot tool names to pages
const TOOL_TO_PAGE: Record<string, AppPage> = {
    'fortnox-panel': 'invoices',
    'invoice-inbox': 'invoices',
    'bank-import': 'bank',
    'bank-reconciliation': 'bank',
    'reconciliation': 'bank',
    'vat-report': 'reports',
    'financial-statements': 'reports',
    'dashboard': 'overview',
    'bookkeeping-rules': 'invoices',
    'agency': 'overview',
};

export class AppController {
    private excelWorkspace: ExcelWorkspace | null = null;
    private fortnoxSidebar: FortnoxSidebar | null = null;
    private settingsCleanup: (() => void) | null = null;
    private integrationsCleanup: (() => void) | null = null;
    private appSidebarCleanup: (() => void) | null = null;
    private boundCopilotToolListener: EventListener | null = null;
    private lastActiveAt = Date.now();
    private resumeInProgress = false;

    // Page navigation state
    private activePage: AppPage = 'overview';
    private mountedPages = new Set<AppPage>();

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

        // Setup copilot tool event listener
        this.setupCopilotToolListener();

        // Listen for open-integrations-modal events (from FortnoxPanel etc.)
        window.addEventListener('open-integrations-modal', () => {
            this.openIntegrationsModal();
        });

        // Initialize voice input
        voiceInputController.init();

        // Setup app lifecycle handlers (resume from idle)
        this.setupLifecycleHandlers();

        // Route to initial page based on URL
        const initialPage = this.getPageFromUrl();
        const path = window.location.pathname;
        const chatMatch = path.match(/^\/app\/chat\/([a-f0-9-]{36})$/i);

        if (chatMatch) {
            // Direct link to specific conversation
            const conversationId = chatMatch[1];
            logger.info('Loading conversation from URL', { conversationId });
            this.navigateToPage('chat', false);
            const loaded = await conversationController.loadConversationFromUrl(conversationId);
            if (!loaded) {
                logger.warn('Failed to load conversation from URL, redirecting to new chat');
            }
        } else if (initialPage === 'chat' || path === '/app/newchat') {
            this.navigateToPage('chat', false);
            await conversationController.startNewChat();
        } else {
            this.navigateToPage(initialPage, false);
            // Also prepare a new chat in the background so it's ready
            await conversationController.startNewChat();
        }

        // Handle Fortnox OAuth callback params (redirect from Fortnox)
        this.handleFortnoxOAuthCallback();

        // Auto-focus input (only when on chat page)
        if (this.activePage === 'chat') {
            uiController.focusInput();
        }

        // Hide Loader with smooth transition
        uiController.hideLoader();

        logger.debug('AppController.init() complete');
    }

    // =========================================================================
    // PAGE NAVIGATION
    // =========================================================================

    /**
     * Navigate to a page. Hides all other pages, shows the target.
     * Mounts Preact page component lazily on first visit.
     */
    navigateToPage(page: AppPage, pushState = true): void {
        if (this.activePage === page && this.mountedPages.has(page)) return;

        // Hide all page containers
        for (const [pageName, containerId] of Object.entries(PAGE_CONTAINER_IDS)) {
            const el = document.getElementById(containerId);
            if (!el) continue;
            el.style.display = pageName === page ? '' : 'none';
        }

        this.activePage = page;

        // Lazy-mount Preact components for pages (skip chat - it's always present)
        if (page !== 'chat' && !this.mountedPages.has(page)) {
            this.mountPage(page);
        }

        this.mountedPages.add(page);

        // Update URL
        if (pushState) {
            const url = PAGE_URL_MAP[page] || '/app';
            window.history.pushState({ page }, '', url);
        }

        // Re-mount AppSidebar to update activePage prop
        this.mountAppSidebar();

        // Focus chat input when navigating to chat
        if (page === 'chat') {
            uiController.focusInput();
        }
    }

    private mountPage(page: AppPage): void {
        const containerId = PAGE_CONTAINER_IDS[page];
        const container = document.getElementById(containerId);
        if (!container) return;

        switch (page) {
            case 'overview':
                mountPreactComponent(DashboardPanel, {
                    onNavigate: (tool: string) => {
                        const targetPage = TOOL_TO_PAGE[tool];
                        if (targetPage) {
                            this.navigateToPage(targetPage);
                        } else {
                            logger.warn('Unknown tool in DashboardPanel onNavigate', { tool });
                        }
                    },
                    isAdmin: false,
                }, container);
                break;
            case 'invoices':
                mountPreactComponent(InvoicesPage, {}, container);
                break;
            case 'bank':
                mountPreactComponent(BankPage, {}, container);
                break;
            case 'reports':
                mountPreactComponent(ReportsPage, {}, container);
                break;
        }
    }

    private getPageFromUrl(): AppPage {
        const path = window.location.pathname;
        if (path.startsWith('/app/invoices')) return 'invoices';
        if (path.startsWith('/app/bank')) return 'bank';
        if (path.startsWith('/app/reports')) return 'reports';
        if (path.startsWith('/app/overview')) return 'overview';
        if (path.startsWith('/app/chat')) return 'chat';
        if (path === '/app/newchat') return 'chat';
        // Default: overview as start page
        return 'overview';
    }

    // =========================================================================
    // SIDEBAR
    // =========================================================================

    private mountAppSidebar(): void {
        const mount = document.getElementById('app-sidebar-mount');
        if (!mount) return;

        const currentCompany = companyManager.getCurrent();

        if (this.appSidebarCleanup) {
            this.appSidebarCleanup();
        }

        this.appSidebarCleanup = mountPreactComponent(AppSidebar, {
            activePage: this.activePage,
            onNavigate: (page: AppPage) => {
                this.navigateToPage(page);
            },
            onNewChat: async () => {
                this.navigateToPage('chat');
                await conversationController.startNewChat();
            },
            onSelectConversation: async (id: string) => {
                await conversationController.loadConversation(id);
            },
            onOpenSettings: () => this.openSettings(),
            onOpenSearch: () => {
                window.dispatchEvent(new CustomEvent('open-search-modal'));
            },
            onOpenIntegrations: () => {
                this.openIntegrationsModal();
            },
            onToggleTheme: () => themeController.toggle(),
            currentConversationId: currentCompany.conversationId || null,
            companyId: currentCompany?.id || null,
        }, mount);
    }

    // =========================================================================
    // FORTNOX OAUTH CALLBACK
    // =========================================================================

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
            // Refresh connection status, preload data, then open FortnoxPanel
            fortnoxContextService.checkConnection().then((status) => {
                if (status === 'connected') {
                    fortnoxContextService.preloadData();
                    this.navigateToPage('invoices');
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

    // =========================================================================
    // LEGAL CONSENT
    // =========================================================================

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
            const needsReconsent = await this.checkNeedsReconsent();

            if (needsReconsent) {
                authService.clearLocalConsent();
                logger.info('User needs to re-consent to updated terms');
                return this.showReconsentModal();
            }

            if (authService.hasLocalConsent(userCreatedAt)) {
                logger.info('Found local consent from login (new user), syncing to DB...');
                const synced = await authService.syncLocalConsentToDatabase(this.getConsentSyncContext());

                if (synced) {
                    return true;
                }

                logger.warn('DB sync failed, but allowing access with local consent');
                return true;
            }

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

            return !!profile?.has_accepted_terms;
        } catch {
            return false;
        }
    }

    private showReconsentModal(): boolean {
        logger.info('Showing consent modal');
        uiController.removeLoaderImmediately();

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

    // =========================================================================
    // AUTH & LIFECYCLE
    // =========================================================================

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

        // Handle browser back/forward navigation
        window.addEventListener('popstate', (e) => {
            const page = (e.state?.page as AppPage) || this.getPageFromUrl();
            this.navigateToPage(page, false);
        });
    }

    private async handleAppResume(source: 'focus' | 'visibility' | 'online'): Promise<void> {
        const now = Date.now();
        const idleMs = now - this.lastActiveAt;
        this.lastActiveAt = now;

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

            window.dispatchEvent(new CustomEvent('refresh-conversation-list', { detail: { force: true } }));
            window.dispatchEvent(new CustomEvent('chat-refresh'));
        } catch (error) {
            logger.warn('Failed to recover app after idle', { error, source });
        } finally {
            this.resumeInProgress = false;
        }
    }

    // =========================================================================
    // INITIALIZE CONTROLLERS
    // =========================================================================

    private initializeControllers(): void {
        // Theme controller
        themeController.init();

        // Sidebar controller (responsive toggle)
        sidebarController.init();

        // Mount AppSidebar (replaces old ConversationList + footer buttons)
        this.mountAppSidebar();

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

        // Setup search trigger click handlers (topbar)
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

    // =========================================================================
    // MODALS (Settings, Integrations, Agent Dashboard)
    // =========================================================================

    private openSettings(): void {
        if (this.settingsCleanup) {
            this.settingsCleanup();
            this.settingsCleanup = null;
        }

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
    }

    private openIntegrationsModal(): void {
        if (this.integrationsCleanup) {
            logger.debug('Cleaning up previous integrations modal instance');
            this.integrationsCleanup();
            this.integrationsCleanup = null;
        }
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
    }

    /**
     * Listens for copilot-open-tool events and routes to the appropriate page.
     */
    private setupCopilotToolListener(): void {
        this.boundCopilotToolListener = ((e: CustomEvent<{ tool: string }>) => {
            const tool = e.detail?.tool;
            if (!tool) return;

            const targetPage = TOOL_TO_PAGE[tool];
            if (targetPage) {
                this.navigateToPage(targetPage);
            } else {
                logger.warn('Unknown copilot tool, no page mapping', { tool });
            }
        }) as EventListener;
        window.addEventListener('copilot-open-tool', this.boundCopilotToolListener);
    }

    // =========================================================================
    // FORTNOX SIDEBAR
    // =========================================================================

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
            if (status === 'connected') {
                copilotService.start();
            } else {
                copilotService.stop();
            }
        }) as EventListener);
    }
}

export const appController = new AppController();

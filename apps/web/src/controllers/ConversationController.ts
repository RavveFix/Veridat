/**
 * ConversationController - Manages conversation loading and creation
 *
 * Extracted from main.ts (lines 200-295, 356-527)
 * Enhanced with URL-based conversation routing for bookmarks and direct navigation
 */

import { supabase } from '../lib/supabase';
import { mountPreactComponent } from '../components/preact-adapter';
import { ChatHistory } from '../components/Chat/ChatHistory';
import { ConversationList } from '../components/Chat/ConversationList';
import { WelcomeHeader } from '../components/WelcomeHeader';
import { companyManager } from '../services/CompanyService';
import { authService } from '../services/AuthService';
import { uiController } from '../services/UIService';
import { logger } from '../services/LoggerService';

// UUID v4 regex pattern
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


export class ConversationController {
    private chatContainer: HTMLElement | null = null;
    private chatUnmount: (() => void) | null = null;
    private isWelcomeTransitioning: boolean = false;

    // Loading synchronization state
    private isLoadingConversation: boolean = false;
    private loadRequestId: number = 0;
    private loadDebounceTimer: ReturnType<typeof setTimeout> | null = null;

    init(chatContainer: HTMLElement): void {
        this.chatContainer = chatContainer;
        this.setupEventListeners();
        this.setupPopstateHandler();
        this.mountConversationList();
        this.mountWelcomeHeader();
    }

    // ============================================
    // URL Routing Methods
    // ============================================

    /**
     * Parse conversation UUID from current URL
     * Returns null if URL doesn't match /app/chat/{uuid} pattern
     */
    getConversationIdFromUrl(): string | null {
        const path = window.location.pathname;
        const match = path.match(/^\/app\/chat\/([a-f0-9-]{36})$/i);
        return match ? match[1] : null;
    }

    /**
     * Validate UUID format
     */
    isValidUUID(id: string): boolean {
        return UUID_REGEX.test(id);
    }

    /**
     * Update browser URL to reflect current conversation
     * Uses pushState to enable back/forward navigation
     */
    updateUrlForConversation(conversationId: string | null, replace: boolean = false): void {
        const newPath = conversationId ? `/app/chat/${conversationId}` : '/app/newchat';
        const currentPath = window.location.pathname;

        if (currentPath === newPath) return;

        const state = { conversationId };
        if (replace) {
            window.history.replaceState(state, '', newPath);
        } else {
            window.history.pushState(state, '', newPath);
        }
        logger.debug('URL updated', { newPath, replace });
    }

    /**
     * Load conversation from URL (for direct navigation/bookmarks)
     * Validates the conversation exists and user has access
     */
    async loadConversationFromUrl(conversationId: string): Promise<boolean> {
        logger.info('Loading conversation from URL', { conversationId });

        // Validate UUID format
        if (!this.isValidUUID(conversationId)) {
            logger.warn('Invalid UUID in URL', { conversationId });
            this.showUrlErrorAndRedirect('Ogiltig konversations-ID');
            return false;
        }

        try {
            // Verify conversation exists and user has access (RLS will enforce ownership)
            const { data: conversation, error } = await supabase
                .from('conversations')
                .select('id, company_id')
                .eq('id', conversationId)
                .single();

            if (error || !conversation) {
                logger.warn('Conversation not found or access denied', { conversationId, error });
                this.showUrlErrorAndRedirect('Konversationen kunde inte hittas');
                return false;
            }

            // Check if conversation belongs to current company
            const currentCompany = companyManager.getCurrent();
            if (conversation.company_id && conversation.company_id !== currentCompany.id) {
                // Try to switch to the conversation's company
                const switched = companyManager.switchTo(conversation.company_id);
                if (!switched) {
                    logger.warn('Cannot switch to conversation company', {
                        conversationCompanyId: conversation.company_id,
                        currentCompanyId: currentCompany.id
                    });
                    this.showUrlErrorAndRedirect('Du har inte åtkomst till denna konversation');
                    return false;
                }
                logger.info('Switched company for conversation', { companyId: conversation.company_id });
            }

            // Load the conversation
            await this.loadConversation(conversationId);
            return true;
        } catch (error) {
            logger.error('Error loading conversation from URL', error);
            this.showUrlErrorAndRedirect('Ett fel uppstod vid inläsning av konversationen');
            return false;
        }
    }

    /**
     * Show error toast and redirect to new chat
     */
    private showUrlErrorAndRedirect(message: string): void {
        uiController.showError(message);
        // Use replaceState to avoid polluting browser history with bad URL
        window.history.replaceState({}, '', '/app/newchat');
        this.startNewChat();
    }

    /**
     * Setup popstate handler for browser back/forward navigation
     */
    private setupPopstateHandler(): void {
        window.addEventListener('popstate', async (event) => {
            logger.debug('Popstate event', { state: event.state, path: window.location.pathname });

            const path = window.location.pathname;
            const conversationId = this.getConversationIdFromUrl();

            if (conversationId) {
                // Navigate to specific conversation
                await this.loadConversationFromUrl(conversationId);
            } else if (path === '/app/newchat' || path === '/app' || path === '/app/') {
                // Navigate to new chat
                await this.startNewChat();
            }
        });
    }

    private mountWelcomeHeader(): void {
        const mountPoint = document.getElementById('welcome-header-mount');
        if (mountPoint) {
            mountPreactComponent(
                WelcomeHeader,
                {
                    title: "Hej där 👋",
                    subtitle: "Berätta vad du behöver, så sköter vi resten."
                },
                mountPoint
            );
        }
    }

    mountConversationList(): void {
        const listContainer = document.getElementById('conversation-list-container');
        if (!listContainer) return;

        // Re-render in place to keep highlight + list in sync without flashing loaders

        const currentId = companyManager.getConversationId();
        const currentCompany = companyManager.getCurrent();

        mountPreactComponent(
            ConversationList,
            {
                currentConversationId: currentId || null,
                onSelectConversation: (id) => this.loadConversation(id),
                companyId: currentCompany?.id || null
            },
            listContainer
        );
    }

    async loadConversation(conversationId: string): Promise<void> {
        // Clear any pending debounce timer
        if (this.loadDebounceTimer) {
            clearTimeout(this.loadDebounceTimer);
            this.loadDebounceTimer = null;
        }

        // Debounce rapid clicks (50ms)
        return new Promise((resolve) => {
            this.loadDebounceTimer = setTimeout(() => {
                this.loadDebounceTimer = null;
                this.doLoadConversation(conversationId).then(resolve);
            }, 50);
        });
    }

    private async doLoadConversation(conversationId: string): Promise<void> {
        // SKIP if same conversation is already loaded (prevents multiple calls)
        const currentConversationId = companyManager.getConversationId();
        if (conversationId === currentConversationId) {
            logger.debug('Conversation already loaded, skipping', { conversationId });
            return;
        }

        // Skip if already loading a conversation
        if (this.isLoadingConversation) {
            logger.debug('Already loading a conversation, queueing', { conversationId });
        }

        // Increment request ID to invalidate previous loads
        const requestId = ++this.loadRequestId;
        this.isLoadingConversation = true;

        // Dispatch loading event to coordinate input state
        window.dispatchEvent(new CustomEvent('conversation-loading', { detail: { loading: true, conversationId } }));

        logger.info('Loading conversation', { conversationId, requestId });

        // Update local state
        companyManager.setConversationId(conversationId);

        // Verify request is still valid
        if (requestId !== this.loadRequestId) {
            logger.debug('Request superseded, aborting', { requestId, current: this.loadRequestId });
            return;
        }

        // Update list highlight
        this.mountConversationList();

        // Hide welcome state and show chat
        this.setWelcomeState(false);

        // Update URL to reflect current conversation
        this.updateUrlForConversation(conversationId);

        // Re-mount chat
        if (this.chatContainer) {
            if (this.chatUnmount) this.chatUnmount();
            this.chatContainer.innerHTML = '';

            // Final validity check before mounting
            if (requestId !== this.loadRequestId) {
                logger.debug('Request superseded before mount, aborting', { requestId });
                return;
            }

            this.chatUnmount = mountPreactComponent(
                ChatHistory,
                { conversationId: conversationId },
                this.chatContainer
            );
        }

        uiController.clearInput();
        uiController.focusInput();

        // NOTE: Don't dispatch loading: false here - ChatController listens for
        // 'chat-messages-loaded' event from ChatHistory to clear loading state
        // This ensures input stays disabled until messages are actually loaded
        this.isLoadingConversation = false;
    }

    async startNewChat(): Promise<void> {
        logger.info('Resetting UI for new chat (lazy creation)');

        // Cancel any pending conversation load to avoid race conditions
        if (this.loadDebounceTimer) {
            clearTimeout(this.loadDebounceTimer);
            this.loadDebounceTimer = null;
        }
        // Invalidate in-flight load requests and clear loading state
        this.loadRequestId += 1;
        if (this.isLoadingConversation) {
            this.isLoadingConversation = false;
        }
        window.dispatchEvent(new CustomEvent('conversation-loading', { detail: { loading: false, conversationId: null } }));

        companyManager.setConversationId(null);

        // Update list highlight
        this.mountConversationList();

        // Update URL
        if (window.location.pathname !== '/app/newchat') {
            window.history.pushState({}, '', '/app/newchat');
        }

        // Show welcome state
        this.setWelcomeState(true);

        // Re-mount chat with null ID to show Welcome screen
        if (this.chatContainer) {
            if (this.chatUnmount) {
                this.chatUnmount();
                this.chatUnmount = null;
            }
            this.chatContainer.innerHTML = '';
            this.chatUnmount = mountPreactComponent(
                ChatHistory,
                { conversationId: null },
                this.chatContainer
            );
        }

        // Add premium pulse animation to input wrapper
        const inputWrapper = document.querySelector('.chat-input-wrapper');
        if (inputWrapper) {
            inputWrapper.classList.add('pulse-input');

            const removePulse = () => {
                inputWrapper.classList.remove('pulse-input');
                inputWrapper.removeEventListener('click', removePulse);
                inputWrapper.removeEventListener('keydown', removePulse);
            };
            inputWrapper.addEventListener('click', removePulse);
            inputWrapper.addEventListener('keydown', removePulse);
        }

        uiController.clearInput();
        uiController.focusInput();
    }


    private setupEventListeners(): void {
        // Listen for messages loaded event from ChatHistory
        window.addEventListener('chat-messages-loaded', (e: Event) => {
            if (this.isWelcomeTransitioning) return;
            const customEvent = e as CustomEvent<{ count: number; conversationId?: string | null }>;
            const hasMessages = customEvent.detail.count > 0;
            const activeConversationId = customEvent.detail.conversationId ?? companyManager.getConversationId();
            const shouldShowWelcome = !activeConversationId && !hasMessages;
            this.setWelcomeState(shouldShowWelcome);
        });

        // Listen for conversation deletion
        window.addEventListener('conversation-deleted', ((e: Event) => {
            const { id } = (e as CustomEvent<{ id: string }>).detail ?? {};
            logger.info('Conversation deleted', { id });

            const currentCompany = companyManager.getCurrent();
            if (currentCompany.conversationId === id) {
                companyManager.setConversationId('');
                if (this.chatContainer) {
                    this.chatContainer.innerHTML = '';
                }
            }
        }) as EventListener);

        // Listen for create new conversation request
        window.addEventListener('create-new-conversation', async () => {
            logger.info('Creating new conversation after deletion');
            await this.startNewChat();
        });

        // Listen for global new chat event
        window.addEventListener('create-new-chat', () => this.startNewChat());
    }

    async loadFromDB(companyId: string): Promise<void> {
        try {
            logger.info('Loading conversations for company', { companyId });

            // Clean up existing chat first - ensures fresh state on company switch
            if (this.chatUnmount) {
                this.chatUnmount();
                this.chatUnmount = null;
            }
            if (this.chatContainer) {
                this.chatContainer.innerHTML = '';
            }

            const session = await authService.getSession();
            if (!session) {
                logger.info('No session, clearing chat');
                return;
            }

            // Try to find the most recent conversation for THIS company
            const { data: conversations } = await supabase
                .from('conversations')
                .select('id')
                .eq('company_id', companyId)
                .order('created_at', { ascending: false })
                .limit(1);

            const conversationId = conversations && conversations.length > 0 ? conversations[0].id : null;

            if (!conversationId) {
                logger.info('No recent conversation found, initializing new chat UI');
                await this.startNewChat();
                return;
            }

            // Store conversationId in company data
            companyManager.setConversationId(conversationId);

            // Update list highlight
            this.mountConversationList();

            // Hide welcome state and show chat
            this.setWelcomeState(false);

            // Keep URL in sync on company switch
            this.updateUrlForConversation(conversationId, true);

            // Mount ChatHistory component with new conversation
            if (this.chatContainer) {
                this.chatUnmount = mountPreactComponent(
                    ChatHistory,
                    { conversationId: conversationId },
                    this.chatContainer
                );
            }

            uiController.clearInput();
            uiController.focusInput();
        } catch (error) {
            logger.error('Error loading conversation from DB', error);
            await this.startNewChat();
        }
    }

    async createInDB(): Promise<string | null> {
        try {
            const session = await authService.getSession();
            if (!session) return null;
            const currentCompany = companyManager.getCurrent();

            const { data, error } = await supabase
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
                return null;
            }
            return data.id;
        } catch (error) {
            logger.error('Exception creating conversation', error);
            return null;
        }
    }

    setWelcomeState(isWelcome: boolean): void {
        if (this.isWelcomeTransitioning) return;

        const chatSection = document.querySelector('.chat-section');
        const welcomeHero = document.querySelector('.welcome-hero');
        const chatView = document.getElementById('chat-view');

        if (isWelcome) {
            if (chatSection) {
                chatSection.classList.add('welcome-state');
                chatSection.classList.remove('welcome-exiting');
            }
            if (welcomeHero) welcomeHero.classList.remove('hidden');
            if (chatView) chatView.classList.add('hidden');
        } else {
            if (chatSection) {
                chatSection.classList.remove('welcome-state');
                chatSection.classList.remove('welcome-exiting');
            }
            if (welcomeHero) welcomeHero.classList.add('hidden');
            if (chatView) chatView.classList.remove('hidden');
        }
    }

    transitionFromWelcome(): void {
        const chatSection = document.querySelector('.chat-section');
        const welcomeHero = document.querySelector('.welcome-hero');
        const heroOrb = welcomeHero?.querySelector('.chat-orb') as HTMLElement;
        const chatView = document.getElementById('chat-view');

        if (!chatSection || this.isWelcomeTransitioning) {
            // If just switching views without animation, ensure state is correct
            if (welcomeHero) welcomeHero.classList.add('hidden');
            if (chatView) chatView.classList.remove('hidden');
            return;
        }

        this.isWelcomeTransitioning = true;

        // 1. Prepare Chat View (make it exist but invisible/underneath)
        if (chatView) {
            chatView.classList.remove('hidden');
            chatView.style.opacity = '0';
        }

        // 2. Fly Orb
        if (heroOrb) {
            const rect = heroOrb.getBoundingClientRect();

            // Create a clone to fly
            const flyingOrb = heroOrb.cloneNode(true) as HTMLElement;
            flyingOrb.style.position = 'fixed';
            flyingOrb.style.left = `${rect.left}px`;
            flyingOrb.style.top = `${rect.top}px`;
            flyingOrb.style.width = `${rect.width}px`;
            flyingOrb.style.height = `${rect.height}px`;
            flyingOrb.style.margin = '0';
            flyingOrb.classList.add('flying-to-sidebar');

            document.body.appendChild(flyingOrb);

            setTimeout(() => {
                flyingOrb.remove();
            }, 800);

            heroOrb.style.opacity = '0';
        }

        // 3. Trigger Exit CSS (Animating input down, hero up/out)
        chatSection.classList.add('welcome-exiting');

        // 4. Cleanup after animation (0.6s match CSS)
        setTimeout(() => {
            chatSection.classList.remove('welcome-state', 'welcome-exiting');

            if (chatView) {
                // Fade chat view in or just set opacity 1
                chatView.style.opacity = '1';
                chatView.style.transition = 'opacity 0.3s ease';
            }

            if (welcomeHero) {
                welcomeHero.classList.add('hidden');
                // Reset hero styles for next time
                if (heroOrb) heroOrb.style.opacity = '';
            }

            this.isWelcomeTransitioning = false;
        }, 600);
    }

    resetToWelcomeState(): void {
        const chatSection = document.querySelector('.chat-section');
        const welcomeHero = document.querySelector('.welcome-hero');
        const chatView = document.getElementById('chat-view');

        if (welcomeHero) welcomeHero.classList.remove('hidden');
        if (chatView) chatView.classList.add('hidden');

        if (!chatSection) return;

        // Animate back smoothly
        chatSection.classList.add('welcome-entering');
        chatSection.classList.remove('welcome-exiting');

        setTimeout(() => {
            chatSection.classList.remove('welcome-entering');
            chatSection.classList.add('welcome-state');
            this.isWelcomeTransitioning = false;
        }, 300);
    }

    mountChatHistory(conversationId: string | null): void {
        if (this.chatContainer) {
            this.chatUnmount = mountPreactComponent(
                ChatHistory,
                { conversationId },
                this.chatContainer
            );
        }
    }

    getChatContainer(): HTMLElement | null {
        return this.chatContainer;
    }
}

export const conversationController = new ConversationController();

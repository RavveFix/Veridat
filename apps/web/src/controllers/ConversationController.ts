/**
 * ConversationController - Manages conversation loading and creation
 *
 * Extracted from main.ts (lines 200-295, 356-527)
 */

import { supabase } from '../lib/supabase';
import { mountPreactComponent } from '../components/preact-adapter';
import { ChatHistory } from '../components/Chat/ChatHistory';
import { ConversationList } from '../components/Chat/ConversationList';
import { companyManager } from '../services/CompanyService';
import { authService } from '../services/AuthService';
import { uiController } from '../services/UIService';
import { logger } from '../services/LoggerService';


export class ConversationController {
    private chatContainer: HTMLElement | null = null;
    private chatUnmount: (() => void) | null = null;
    private listUnmount: (() => void) | null = null;
    private isWelcomeTransitioning: boolean = false;

    init(chatContainer: HTMLElement): void {
        this.chatContainer = chatContainer;
        this.setupEventListeners();
        this.mountConversationList();
    }

    private mountConversationList(): void {
        const listContainer = document.getElementById('conversation-list-container');
        if (!listContainer) return;

        // Re-mount to keep highlight + list in sync
        if (this.listUnmount) {
            this.listUnmount();
            this.listUnmount = null;
            listContainer.innerHTML = '';
        }

        const currentId = companyManager.getConversationId();

        this.listUnmount = mountPreactComponent(
            ConversationList,
            {
                currentConversationId: currentId || null,
                onSelectConversation: (id) => this.loadConversation(id)
            },
            listContainer
        );
    }

    async loadConversation(conversationId: string): Promise<void> {
        logger.info('Loading conversation', { conversationId });

        // Update local state
        companyManager.setConversationId(conversationId);

        // Update list highlight
        this.mountConversationList();

        // Hide welcome state and show chat
        this.setWelcomeState(false);

        // Re-mount chat
        if (this.chatContainer) {
            if (this.chatUnmount) this.chatUnmount();
            this.chatContainer.innerHTML = '';

            this.chatUnmount = mountPreactComponent(
                ChatHistory,
                { conversationId: conversationId },
                this.chatContainer
            );
        }
    }

    async startNewChat(): Promise<void> {
        logger.info('Resetting UI for new chat (lazy creation)');
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
            const customEvent = e as CustomEvent<{ count: number }>;
            const hasMessages = customEvent.detail.count > 0;
            this.setWelcomeState(!hasMessages);
        });

        // Listen for conversation deletion
        window.addEventListener('conversation-deleted', (e: any) => {
            const { id } = e.detail;
            logger.info('Conversation deleted', { id });

            const currentCompany = companyManager.getCurrent();
            if (currentCompany.conversationId === id) {
                companyManager.setConversationId('');
                if (this.chatContainer) {
                    this.chatContainer.innerHTML = '';
                }
            }
        });

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
            const session = await authService.getSession();
            if (!session) {
                logger.info('No session, clearing chat');
                if (this.chatContainer) this.chatContainer.innerHTML = '';
                return;
            }

            // Try to find the most recent conversation
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

            // Mount ChatHistory component
            if (this.chatContainer) {
                this.chatUnmount = mountPreactComponent(
                    ChatHistory,
                    { conversationId: conversationId },
                    this.chatContainer
                );
            }
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
        const heroOrb = welcomeHero?.querySelector('.britta-orb') as HTMLElement;
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

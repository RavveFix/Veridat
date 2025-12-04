/**
 * UIController - Centralized DOM management for the main application
 * 
 * This service handles:
 * - DOM element references (queried once at init)
 * - UI state management (loader, modals, sidebars)
 * - Common UI operations
 */

import { logger } from './LoggerService';

export interface UIElements {
    // Chat elements
    chatForm: HTMLFormElement | null;
    userInput: HTMLInputElement | null;
    chatContainer: HTMLElement | null;

    // File elements
    fileInput: HTMLInputElement | null;
    attachBtn: HTMLElement | null;
    filePreview: HTMLElement | null;
    fileNameSpan: Element | null;
    removeFileBtn: Element | null;

    // Voice elements
    micBtn: HTMLElement | null;
    voiceRecordingUI: HTMLElement | null;
    textInputContainer: Element | null;
    voiceCancelBtn: HTMLElement | null;
    voiceConfirmBtn: HTMLElement | null;
    waveformBars: NodeListOf<Element>;

    // Navigation/sidebar
    historyToggle: HTMLElement | null;
    historySidebar: HTMLElement | null;
    closeHistoryBtn: HTMLElement | null;
    historyList: HTMLElement | null;
    newChatBtn: HTMLElement | null;

    // Company
    companySelector: HTMLElement | null;
    addCompanyBtn: HTMLElement | null;
    editCompanyBtn: HTMLElement | null;
    companyModal: HTMLElement | null;

    // Header/settings
    settingsBtn: HTMLElement | null;
    themeToggle: HTMLElement | null;
    logoutBtn: HTMLElement | null;

    // Loader
    appLoader: HTMLElement | null;
}

class UIControllerService {
    private _elements: UIElements | null = null;
    private _initialized = false;

    /**
     * Initialize UI controller - queries all DOM elements once
     * Should be called after DOMContentLoaded
     */
    init(): void {
        if (this._initialized) {
            logger.warn('UIController already initialized');
            return;
        }

        this._elements = {
            // Chat elements
            chatForm: document.getElementById('chat-form') as HTMLFormElement,
            userInput: document.getElementById('user-input') as HTMLInputElement,
            chatContainer: document.getElementById('chat-container'),

            // File elements
            fileInput: document.getElementById('file-input') as HTMLInputElement,
            attachBtn: document.getElementById('attach-btn'),
            filePreview: document.getElementById('file-preview'),
            fileNameSpan: document.querySelector('#file-preview .file-name'),
            removeFileBtn: document.querySelector('#file-preview .remove-file'),

            // Voice elements
            micBtn: document.getElementById('mic-btn'),
            voiceRecordingUI: document.getElementById('voice-recording-ui'),
            textInputContainer: document.querySelector('.text-input-container'),
            voiceCancelBtn: document.getElementById('voice-cancel-btn'),
            voiceConfirmBtn: document.getElementById('voice-confirm-btn'),
            waveformBars: document.querySelectorAll('.waveform-bar'),

            // Navigation/sidebar
            historyToggle: document.getElementById('history-toggle'),
            historySidebar: document.getElementById('history-sidebar'),
            closeHistoryBtn: document.getElementById('close-history-btn'),
            historyList: document.getElementById('history-list'),
            newChatBtn: document.getElementById('new-chat-btn'),

            // Company
            companySelector: document.getElementById('company-selector'),
            addCompanyBtn: document.getElementById('add-company-btn'),
            editCompanyBtn: document.getElementById('edit-company-btn'),
            companyModal: document.getElementById('company-modal'),

            // Header/settings
            settingsBtn: document.getElementById('settings-btn'),
            themeToggle: document.getElementById('theme-toggle'),
            logoutBtn: document.getElementById('logout-btn'),

            // Loader
            appLoader: document.getElementById('app-loader'),
        };

        this._initialized = true;
        logger.debug('UIController initialized', {
            elementsFound: Object.entries(this._elements).filter(([_, v]) => v !== null).length
        });
    }

    /**
     * Get all UI elements (throws if not initialized)
     */
    get elements(): UIElements {
        if (!this._elements) {
            throw new Error('UIController not initialized. Call init() first.');
        }
        return this._elements;
    }

    /**
     * Check if controller is initialized
     */
    get isInitialized(): boolean {
        return this._initialized;
    }

    // ========== Loader Methods ==========

    /**
     * Hide the app loader with smooth fade
     */
    hideLoader(): void {
        const loader = this.elements.appLoader;
        if (!loader) return;

        // Ensure loader stays for at least 800ms total
        const minLoadTime = 800;
        const loadTime = Date.now() - (performance.timing?.navigationStart || Date.now());
        const remainingTime = Math.max(0, minLoadTime - loadTime);

        setTimeout(() => {
            loader.style.opacity = '0';
            setTimeout(() => {
                loader.remove();
            }, 600); // Match CSS transition
        }, remainingTime);
    }

    /**
     * Remove loader immediately (for modal display)
     */
    removeLoaderImmediately(): void {
        this.elements.appLoader?.remove();
    }

    // ========== File Preview Methods ==========

    /**
     * Show file preview with name
     */
    showFilePreview(fileName: string): void {
        const { filePreview, fileNameSpan, userInput } = this.elements;
        if (fileNameSpan) fileNameSpan.textContent = fileName;
        if (filePreview) filePreview.classList.remove('hidden');
        if (userInput) userInput.focus();
    }

    /**
     * Hide and clear file preview
     */
    clearFilePreview(): void {
        const { filePreview, fileInput, userInput } = this.elements;
        if (fileInput) fileInput.value = '';
        if (filePreview) filePreview.classList.add('hidden');
        if (userInput) userInput.focus();
    }

    // ========== History Sidebar Methods ==========

    /**
     * Toggle history sidebar visibility
     */
    toggleHistorySidebar(): void {
        this.elements.historySidebar?.classList.toggle('hidden');
    }

    /**
     * Show history sidebar
     */
    showHistorySidebar(): void {
        this.elements.historySidebar?.classList.remove('hidden');
    }

    /**
     * Hide history sidebar
     */
    hideHistorySidebar(): void {
        this.elements.historySidebar?.classList.add('hidden');
    }

    /**
     * Check if click is outside sidebar (for closing)
     */
    isClickOutsideSidebar(target: Node): boolean {
        const { historySidebar, historyToggle } = this.elements;
        if (!historySidebar) return false;

        return !historySidebar.classList.contains('hidden') &&
            !historySidebar.contains(target) &&
            !historyToggle?.contains(target);
    }

    // ========== Voice UI Methods ==========

    /**
     * Show voice recording UI
     */
    showVoiceRecordingUI(): void {
        const { voiceRecordingUI, textInputContainer, micBtn } = this.elements;
        if (voiceRecordingUI) voiceRecordingUI.classList.remove('hidden');
        if (textInputContainer) textInputContainer.classList.add('recording');
        if (micBtn) {
            micBtn.classList.add('listening');
            micBtn.style.display = 'none';
        }
    }

    /**
     * Hide voice recording UI
     */
    hideVoiceRecordingUI(): void {
        const { voiceRecordingUI, textInputContainer, micBtn, waveformBars } = this.elements;
        if (voiceRecordingUI) voiceRecordingUI.classList.add('hidden');
        if (textInputContainer) textInputContainer.classList.remove('recording');
        if (micBtn) {
            micBtn.classList.remove('listening');
            micBtn.style.display = '';
        }
        // Reset waveform bars
        waveformBars.forEach((bar) => {
            (bar as HTMLElement).style.height = '8px';
        });
    }

    /**
     * Update waveform bars based on audio level
     */
    updateWaveform(level: number): void {
        const { waveformBars } = this.elements;
        const minHeight = 8;
        const maxHeight = 32;

        waveformBars.forEach((bar) => {
            const randomFactor = 0.7 + Math.random() * 0.6;
            const height = minHeight + (level * randomFactor * (maxHeight - minHeight));
            (bar as HTMLElement).style.height = `${height}px`;
        });
    }

    // ========== Theme Methods ==========

    /**
     * Update theme icon based on current theme
     */
    updateThemeIcon(theme: string): void {
        const { themeToggle } = this.elements;
        if (!themeToggle) return;

        const sunIcon = themeToggle.querySelector('.sun-icon');
        const moonIcon = themeToggle.querySelector('.moon-icon');

        if (theme === 'light') {
            sunIcon?.classList.add('hidden');
            moonIcon?.classList.remove('hidden');
        } else {
            sunIcon?.classList.remove('hidden');
            moonIcon?.classList.add('hidden');
        }
    }

    // ========== Focus Methods ==========

    /**
     * Focus the chat input
     */
    focusInput(): void {
        this.elements.userInput?.focus();
    }

    /**
     * Get current input value
     */
    getInputValue(): string {
        return this.elements.userInput?.value.trim() || '';
    }

    /**
     * Set input value
     */
    setInputValue(value: string): void {
        if (this.elements.userInput) {
            this.elements.userInput.value = value;
        }
    }

    /**
     * Clear input
     */
    clearInput(): void {
        if (this.elements.userInput) {
            this.elements.userInput.value = '';
        }
    }
}

// Export singleton instance
export const uiController = new UIControllerService();

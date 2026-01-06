/**
 * VoiceInputService - Manages voice recording and transcription
 *
 * Extracted from main.ts to provide a clean, testable voice input module.
 * Integrates with UIService for UI updates and VoiceService for recording.
 */

import { VoiceService } from './VoiceService';
import { uiController } from './UIService';
import { logger } from './LoggerService';

type ResultCallback = (text: string) => void;

export class VoiceInputController {
    private voiceService: VoiceService;
    private resultCallback: ResultCallback | null = null;
    private isSupported: boolean = false;

    constructor() {
        this.voiceService = new VoiceService();
        this.isSupported = this.voiceService.isSupported();
    }

    /**
     * Initialize voice input with event listeners
     * Returns true if voice is supported
     */
    init(): boolean {
        const { micBtn, voiceCancelBtn, voiceConfirmBtn } = uiController.elements;

        if (!micBtn) {
            logger.debug('Mic button not found');
            return false;
        }

        if (!this.isSupported) {
            // Show mic button but with disabled state and feedback on click
            micBtn.style.opacity = '0.5';
            micBtn.title = 'Röststyrning stöds inte i denna webbläsare';
            micBtn.addEventListener('click', () => {
                // Show toast notification instead of doing nothing
                this.showToast('Röststyrning stöds inte i denna webbläsare. Prova Chrome eller Edge.', 'warning');
            });
            logger.debug('Voice input not supported, mic button shows warning on click');
            return false;
        }

        // Mic button click - toggle recording
        micBtn.addEventListener('click', () => {
            logger.debug('Mic button clicked, toggling voice');
            this.voiceService.toggle();
        });

        // State change handler - show/hide recording UI
        this.voiceService.onStateChange((isListening) => {
            if (isListening) {
                uiController.showVoiceRecordingUI();
            } else {
                uiController.hideVoiceRecordingUI();
            }
        });

        // Audio level handler - animate waveform
        this.voiceService.onAudioLevel((level) => {
            uiController.updateWaveform(level);
        });

        // Result handler - populate input
        this.voiceService.onResult((text) => {
            uiController.setInputValue(text);
            if (this.resultCallback) {
                this.resultCallback(text);
            }
        });

        // Cancel button - discard recording
        if (voiceCancelBtn) {
            voiceCancelBtn.addEventListener('click', () => {
                this.cancel();
            });
        }

        // Confirm button - stop recording and keep text
        if (voiceConfirmBtn) {
            voiceConfirmBtn.addEventListener('click', () => {
                this.confirm();
            });
        }

        logger.debug('VoiceInputController initialized');
        return true;
    }

    /**
     * Set callback for when transcription result is received
     */
    onResult(callback: ResultCallback): void {
        this.resultCallback = callback;
    }

    /**
     * Start voice recording
     */
    start(): void {
        if (this.isSupported) {
            this.voiceService.toggle();
        }
    }

    /**
     * Stop recording and keep transcribed text
     */
    confirm(): void {
        this.voiceService.stop();
        uiController.focusInput();
    }

    /**
     * Cancel recording and clear text
     */
    cancel(): void {
        this.voiceService.cancel();
        uiController.clearInput();
        uiController.focusInput();
    }

    /**
     * Check if voice input is supported
     */
    get supported(): boolean {
        return this.isSupported;
    }

    /**
     * Show a toast notification
     */
    private showToast(message: string, type: 'success' | 'warning' | 'error' = 'warning'): void {
        // Try to use the global showToast if available
        if (typeof (window as any).showToast === 'function') {
            (window as any).showToast(message, type);
            return;
        }

        // Fallback: create a simple toast notification
        const toast = document.createElement('div');
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            bottom: 100px;
            left: 50%;
            transform: translateX(-50%);
            background: ${type === 'error' ? '#ef4444' : type === 'warning' ? '#f59e0b' : '#10b981'};
            color: white;
            padding: 12px 24px;
            border-radius: 8px;
            font-family: 'Inter', sans-serif;
            font-size: 14px;
            z-index: 10000;
            animation: fadeInUp 0.3s ease-out;
        `;
        document.body.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.3s';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
}

// Export singleton instance
export const voiceInputController = new VoiceInputController();

/**
 * VoiceInputController - Manages voice recording and transcription
 * 
 * Extracted from main.ts to provide a clean, testable voice input module.
 * Integrates with UIController for UI updates and VoiceService for recording.
 */

import { VoiceService } from '../utils/VoiceService';
import { uiController } from './UIController';
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

        if (!micBtn || !this.isSupported) {
            // Hide mic button if not supported
            if (micBtn) micBtn.style.display = 'none';
            logger.debug('Voice input not supported or mic button not found');
            return false;
        }

        // Mic button click - toggle recording
        micBtn.addEventListener('click', () => {
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
}

// Export singleton instance
export const voiceInputController = new VoiceInputController();

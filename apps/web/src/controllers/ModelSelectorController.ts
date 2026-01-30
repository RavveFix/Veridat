/**
 * ModelSelectorController - Handles AI model selector UI
 * 
 * Controls the dropdown behavior and syncs with ModelService
 */

import { modelService, type ModelType } from '../services/ModelService';
import { logger } from '../services/LoggerService';

class ModelSelectorControllerClass {
    private selectorBtn: HTMLButtonElement | null = null;
    private dropdown: HTMLElement | null = null;
    private modelNameSpan: HTMLElement | null = null;
    private isOpen = false;
    private boundHandleOutsideClick: (e: MouseEvent) => void;

    constructor() {
        this.boundHandleOutsideClick = this.handleOutsideClick.bind(this);
    }

    /**
     * Check if user has Pro plan
     */
    private isProUser(): boolean {
        return localStorage.getItem('user_plan') === 'pro';
    }

    /**
     * Initialize the model selector
     */
    init(): void {
        this.selectorBtn = document.getElementById('model-selector-btn') as HTMLButtonElement;
        this.dropdown = document.getElementById('model-dropdown');
        this.modelNameSpan = document.getElementById('current-model-name');

        if (!this.selectorBtn || !this.dropdown) {
            logger.debug('Model selector elements not found, skipping initialization');
            return;
        }

        this.setupEventListeners();
        this.updateUI();
        
        // Listen for model changes from other sources
        modelService.onChange(() => this.updateUI());
        
        logger.info('Model selector initialized', { currentModel: modelService.getCurrentType() });
    }

    /**
     * Set up event listeners for the selector
     */
    private setupEventListeners(): void {
        // Toggle dropdown on button click
        this.selectorBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.toggle();
        });

        // Handle model option clicks
        const options = this.dropdown?.querySelectorAll('.model-option');
        options?.forEach(option => {
            option.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                const model = (option as HTMLElement).dataset.model as ModelType;

                // Check if clicking on locked Pro option
                if (model === 'pro' && !this.isProUser()) {
                    // Dispatch event to show upgrade modal
                    window.dispatchEvent(new CustomEvent('show-upgrade-modal', {
                        detail: { reason: 'pro_model' }
                    }));
                    this.close();
                    return;
                }

                if (model) {
                    this.selectModel(model);
                }
            });
        });

        // Handle keyboard navigation
        this.selectorBtn?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.toggle();
            } else if (e.key === 'Escape') {
                this.close();
            }
        });
    }

    /**
     * Toggle dropdown visibility
     */
    private toggle(): void {
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    }

    /**
     * Open the dropdown
     */
    private open(): void {
        this.isOpen = true;
        this.dropdown?.classList.remove('hidden');
        this.selectorBtn?.classList.add('active');
        
        // Add click outside listener
        setTimeout(() => {
            document.addEventListener('click', this.boundHandleOutsideClick);
        }, 0);
    }

    /**
     * Close the dropdown
     */
    private close(): void {
        this.isOpen = false;
        this.dropdown?.classList.add('hidden');
        this.selectorBtn?.classList.remove('active');
        document.removeEventListener('click', this.boundHandleOutsideClick);
    }

    /**
     * Handle clicks outside the dropdown
     */
    private handleOutsideClick(e: MouseEvent): void {
        const target = e.target as HTMLElement;
        const isInsideDropdown = this.dropdown?.contains(target);
        const isInsideButton = this.selectorBtn?.contains(target);
        
        if (!isInsideDropdown && !isInsideButton) {
            this.close();
        }
    }

    /**
     * Select a model and update UI
     */
    private selectModel(model: ModelType): void {
        modelService.setModel(model);
        this.updateUI();
        this.close();
    }

    /**
     * Update the UI to reflect current model selection
     */
    private updateUI(): void {
        const current = modelService.getCurrent();
        const isPro = this.isProUser();

        // Update button text
        if (this.modelNameSpan) {
            this.modelNameSpan.textContent = current.name;
        }

        // Update active state and locked state on options
        const options = this.dropdown?.querySelectorAll('.model-option');
        options?.forEach(option => {
            const optionModel = (option as HTMLElement).dataset.model;

            // Update active state
            if (optionModel === current.id) {
                option.classList.add('active');
            } else {
                option.classList.remove('active');
            }

            // Update locked state for Pro option
            if (optionModel === 'pro') {
                if (!isPro) {
                    option.classList.add('locked');
                    option.setAttribute('aria-disabled', 'true');
                } else {
                    option.classList.remove('locked');
                    option.removeAttribute('aria-disabled');
                }
            }
        });
    }

    /**
     * Cleanup event listeners
     */
    destroy(): void {
        document.removeEventListener('click', this.boundHandleOutsideClick);
    }
}

// Singleton instance
export const modelSelectorController = new ModelSelectorControllerClass();

/**
 * ModelService - Handles AI model selection
 * 
 * Manages which AI model (Flash/Pro) is currently selected,
 * persists preference to localStorage, and provides the model
 * identifier for API calls.
 */

import { logger } from './LoggerService';

export type ModelType = 'flash' | 'pro';

export interface ModelInfo {
    id: ModelType;
    name: string;
    displayName: string;
    description: string;
    apiModel: string;
}

const MODELS: Record<ModelType, ModelInfo> = {
    flash: {
        id: 'flash',
        name: 'Flash',
        displayName: 'Gemini 3 Flash',
        description: 'Snabb & effektiv',
        apiModel: 'gemini-3-flash-preview'
    },
    pro: {
        id: 'pro',
        name: 'Pro',
        displayName: 'Gemini 3 Pro',
        description: 'Djupare analys',
        apiModel: 'gemini-3-pro-preview'
    }
};

const STORAGE_KEY = 'veridat_selected_model';

class ModelServiceClass {
    private currentModel: ModelType = 'flash';
    private listeners: Array<(model: ModelType) => void> = [];

    constructor() {
        this.loadFromStorage();
    }

    /**
     * Load saved model preference from localStorage
     */
    private loadFromStorage(): void {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved && (saved === 'flash' || saved === 'pro')) {
                this.currentModel = saved;
                logger.debug('Loaded model preference', { model: saved });
            }
        } catch (error) {
            logger.warn('Failed to load model preference', { error });
        }
    }

    /**
     * Save current model preference to localStorage
     */
    private saveToStorage(): void {
        try {
            localStorage.setItem(STORAGE_KEY, this.currentModel);
        } catch (error) {
            logger.warn('Failed to save model preference', { error });
        }
    }

    /**
     * Get the current model type
     */
    getCurrentType(): ModelType {
        return this.currentModel;
    }

    /**
     * Get the current model info
     */
    getCurrent(): ModelInfo {
        return MODELS[this.currentModel];
    }

    /**
     * Get all available models
     */
    getAll(): ModelInfo[] {
        return Object.values(MODELS);
    }

    /**
     * Get model info by type
     */
    getModel(type: ModelType): ModelInfo {
        return MODELS[type];
    }

    /**
     * Get the API model identifier for the current selection
     */
    getApiModel(): string {
        return MODELS[this.currentModel].apiModel;
    }

    /**
     * Set the current model
     */
    setModel(type: ModelType): void {
        if (type !== this.currentModel) {
            this.currentModel = type;
            this.saveToStorage();
            logger.info('Model changed', { model: type });
            
            // Notify listeners
            this.listeners.forEach(listener => listener(type));
            
            // Dispatch custom event for UI updates
            window.dispatchEvent(new CustomEvent('model-changed', {
                detail: { model: type, modelInfo: MODELS[type] }
            }));
        }
    }

    /**
     * Subscribe to model changes
     */
    onChange(callback: (model: ModelType) => void): () => void {
        this.listeners.push(callback);
        return () => {
            this.listeners = this.listeners.filter(l => l !== callback);
        };
    }
}

// Singleton instance
export const modelService = new ModelServiceClass();

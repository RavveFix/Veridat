/**
 * MemoryService - Automated memory generation for Britta
 *
 * Inspired by Claude AI's memory system:
 * - Automatically extracts memories from conversations after idle timeout
 * - Dispatches events for UI updates
 *
 * @see https://simonwillison.net/2025/Sep/12/claude-memory/
 */

import { supabase } from '../lib/supabase';
import { logger } from './LoggerService';

const MEMORY_GENERATOR_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/memory-generator`;
const IDLE_TIMEOUT_MS = 30000; // 30 seconds

interface MemoryGenerationResult {
    success: boolean;
    summary_updated?: boolean;
    memories_added?: number;
    error?: string;
}

class MemoryServiceClass {
    private idleTimer: ReturnType<typeof setTimeout> | null = null;
    private lastProcessedConversation: string | null = null;
    private isGenerating: boolean = false;

    /**
     * Schedule memory generation after conversation becomes idle.
     * Resets the timer on each call (debounce behavior).
     */
    scheduleGeneration(conversationId: string): void {
        if (!conversationId) return;

        // Clear existing timer
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }

        // Don't re-process the same conversation immediately
        if (this.lastProcessedConversation === conversationId) {
            logger.debug('Skipping memory generation - already processed', { conversationId });
            return;
        }

        logger.debug('Scheduling memory generation', { conversationId, timeoutMs: IDLE_TIMEOUT_MS });

        this.idleTimer = setTimeout(() => {
            void this.generateMemories(conversationId);
        }, IDLE_TIMEOUT_MS);
    }

    /**
     * Cancel any scheduled memory generation.
     * Called when user starts typing or on company switch.
     */
    cancelScheduled(): void {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
            logger.debug('Memory generation cancelled');
        }
    }

    /**
     * Reset state (e.g., on company change).
     */
    reset(): void {
        this.cancelScheduled();
        this.lastProcessedConversation = null;
        this.isGenerating = false;
    }

    /**
     * Force memory generation for a conversation (bypasses idle timer).
     */
    async forceGeneration(conversationId: string): Promise<MemoryGenerationResult> {
        this.cancelScheduled();
        return this.generateMemories(conversationId);
    }

    /**
     * Generate memories from a conversation using the memory-generator Edge Function.
     */
    private async generateMemories(conversationId: string): Promise<MemoryGenerationResult> {
        if (this.isGenerating) {
            logger.debug('Memory generation already in progress');
            return { success: false, error: 'Already in progress' };
        }

        this.isGenerating = true;
        logger.info('Starting memory generation', { conversationId });

        // Dispatch start event for UI feedback
        window.dispatchEvent(new CustomEvent('memory-generation-start', {
            detail: { conversationId }
        }));

        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                logger.warn('No session for memory generation');
                return { success: false, error: 'Not authenticated' };
            }

            const response = await fetch(MEMORY_GENERATOR_URL, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${session.access_token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ conversation_id: conversationId })
            });

            const result = await response.json() as MemoryGenerationResult;

            if (!response.ok) {
                logger.error('Memory generation failed', { status: response.status, error: result.error });
                window.dispatchEvent(new CustomEvent('memory-generation-error', {
                    detail: { conversationId, error: result.error }
                }));
                return { success: false, error: result.error };
            }

            // Mark as processed to avoid re-processing
            this.lastProcessedConversation = conversationId;

            logger.info('Memory generation completed', {
                conversationId,
                summaryUpdated: result.summary_updated,
                memoriesAdded: result.memories_added
            });

            // Dispatch success event for UI updates
            window.dispatchEvent(new CustomEvent('memory-generated', {
                detail: {
                    conversationId,
                    summaryUpdated: result.summary_updated,
                    memoriesAdded: result.memories_added || 0
                }
            }));

            return {
                success: true,
                summary_updated: result.summary_updated,
                memories_added: result.memories_added
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            logger.error('Memory generation error', { conversationId, error: message });

            window.dispatchEvent(new CustomEvent('memory-generation-error', {
                detail: { conversationId, error: message }
            }));

            return { success: false, error: message };
        } finally {
            this.isGenerating = false;
            this.idleTimer = null;
        }
    }

    /**
     * Check if memory generation is currently in progress.
     */
    isInProgress(): boolean {
        return this.isGenerating;
    }

    /**
     * Check if a memory generation is scheduled.
     */
    isScheduled(): boolean {
        return this.idleTimer !== null;
    }
}

// Singleton export
export const memoryService = new MemoryServiceClass();

import { supabase } from '../lib/supabase';
import { logger } from './LoggerService';
import type { MemoryItem, MemoryItemInput, MemoryItemPatch, MemoryStatus, MemoryCategory } from '../types/memory';

interface MemoryItemsResponse {
    items?: MemoryItem[];
    item?: MemoryItem;
    success?: boolean;
    error?: string;
}

const MEMORY_ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/memory-service`;

class MemoryItemsServiceClass {
    private async request(body: Record<string, unknown>): Promise<MemoryItemsResponse> {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
            throw new Error('Not authenticated');
        }

        const response = await fetch(MEMORY_ENDPOINT, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${session.access_token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        const payload = await response.json().catch(() => ({})) as MemoryItemsResponse;

        if (!response.ok) {
            const message = payload.error || 'Memory service error';
            logger.warn('Memory items request failed', { message, body });
            throw new Error(message);
        }

        return payload;
    }

    async list(companyId: string, options?: { category?: MemoryCategory; status?: MemoryStatus }): Promise<MemoryItem[]> {
        const response = await this.request({
            action: 'get_memory_items',
            company_id: companyId,
            category: options?.category,
            status: options?.status
        });

        return response.items ?? [];
    }

    async add(companyId: string, item: MemoryItemInput): Promise<MemoryItem> {
        const response = await this.request({
            action: 'add_memory_item',
            company_id: companyId,
            memory: item
        });

        if (!response.item) {
            throw new Error('Memory item creation failed');
        }

        return response.item;
    }

    async update(memoryId: string, patch: MemoryItemPatch): Promise<MemoryItem> {
        const response = await this.request({
            action: 'update_memory_item',
            memory_id: memoryId,
            patch
        });

        if (!response.item) {
            throw new Error('Memory item update failed');
        }

        return response.item;
    }

    async remove(memoryId: string): Promise<void> {
        await this.request({
            action: 'remove_memory_item',
            memory_id: memoryId
        });
    }

    async logUsage(memoryId: string, context?: { conversationId?: string; skillRunId?: string }): Promise<void> {
        await this.request({
            action: 'log_memory_usage',
            memory_id: memoryId,
            conversation_id: context?.conversationId,
            skill_run_id: context?.skillRunId
        });
    }
}

export const memoryItemsService = new MemoryItemsServiceClass();

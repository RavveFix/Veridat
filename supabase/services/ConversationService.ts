// Conversation Service for Supabase Edge Functions
// Handles CRUD operations for conversations and messages

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface Conversation {
    id: string;
    user_id: string;
    company_id: string | null;
    title: string | null;
    created_at: string;
    updated_at: string;
}

export interface Message {
    id: string;
    conversation_id: string;
    role: 'user' | 'assistant';
    content: string;
    file_url: string | null;
    file_name: string | null;
    created_at: string;
}

export interface MessageForContext {
    role: string;
    content: string;
}

export class ConversationService {
    constructor(private supabase: SupabaseClient) { }

    /**
     * Get or create a conversation for a user/company combination
     */
    async getOrCreateConversation(
        userId: string,
        companyId: string | null = null
    ): Promise<string> {
        try {
            const { data, error } = await this.supabase.rpc('get_or_create_conversation', {
                p_user_id: userId,
                p_company_id: companyId
            });

            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Error getting/creating conversation:', error);
            throw error;
        }
    }

    /**
     * Get all conversations for a user, optionally filtered by company
     */
    async getConversationsByUser(
        userId: string,
        companyId?: string | null
    ): Promise<Conversation[]> {
        try {
            let query = this.supabase
                .from('conversations')
                .select('*')
                .eq('user_id', userId)
                .order('updated_at', { ascending: false });

            if (companyId !== undefined) {
                if (companyId === null) {
                    query = query.is('company_id', null);
                } else {
                    query = query.eq('company_id', companyId);
                }
            }

            const { data, error } = await query;

            if (error) throw error;
            return data || [];
        } catch (error) {
            console.error('Error fetching conversations:', error);
            throw error;
        }
    }

    /**
     * Delete a conversation and all its messages (cascade)
     */
    async deleteConversation(conversationId: string): Promise<void> {
        try {
            const { error } = await this.supabase
                .from('conversations')
                .delete()
                .eq('id', conversationId);

            if (error) throw error;
        } catch (error) {
            console.error('Error deleting conversation:', error);
            throw error;
        }
    }

    /**
     * Add a message to a conversation
     */
    async addMessage(
        conversationId: string,
        role: 'user' | 'assistant',
        content: string,
        fileUrl?: string | null,
        fileName?: string | null
    ): Promise<Message> {
        try {
            const { data, error } = await this.supabase
                .from('messages')
                .insert({
                    conversation_id: conversationId,
                    role,
                    content,
                    file_url: fileUrl || null,
                    file_name: fileName || null
                })
                .select()
                .single();

            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Error adding message:', error);
            throw error;
        }
    }

    /**
     * Get messages for a conversation
     */
    async getMessages(
        conversationId: string,
        limit?: number
    ): Promise<Message[]> {
        try {
            let query = this.supabase
                .from('messages')
                .select('*')
                .eq('conversation_id', conversationId)
                .order('created_at', { ascending: true });

            if (limit) {
                query = query.limit(limit);
            }

            const { data, error } = await query;

            if (error) throw error;
            return data || [];
        } catch (error) {
            console.error('Error fetching messages:', error);
            throw error;
        }
    }

    /**
     * Get recent messages formatted for Gemini API context
     */
    async getRecentMessagesForContext(
        conversationId: string,
        limit: number = 20
    ): Promise<MessageForContext[]> {
        try {
            const { data, error } = await this.supabase
                .from('messages')
                .select('role, content')
                .eq('conversation_id', conversationId)
                .order('created_at', { ascending: false })
                .limit(limit);

            if (error) throw error;

            // Reverse to get chronological order (oldest to newest)
            const messages = (data || []).reverse();

            // Format for Gemini API
            return messages.map((msg: { role: string, content: string }) => ({
                role: msg.role === 'user' ? 'user' : 'model',
                content: msg.content
            }));
        } catch (error) {
            console.error('Error fetching messages for context:', error);
            throw error;
        }
    }

    /**
     * Update conversation title (e.g., auto-generate from first message)
     */
    async updateConversationTitle(
        conversationId: string,
        title: string
    ): Promise<void> {
        try {
            const { error } = await this.supabase
                .from('conversations')
                .update({ title })
                .eq('id', conversationId);

            if (error) throw error;
        } catch (error) {
            console.error('Error updating conversation title:', error);
            throw error;
        }
    }

    /**
     * Auto-generate a title from the first user message
     */
    async autoGenerateTitle(conversationId: string): Promise<void> {
        try {
            // Get first user message
            const { data: messages } = await this.supabase
                .from('messages')
                .select('content')
                .eq('conversation_id', conversationId)
                .eq('role', 'user')
                .order('created_at', { ascending: true })
                .limit(1);

            if (messages && messages.length > 0) {
                const firstMessage = messages[0].content;
                // Take first 50 chars as title
                const title = firstMessage.substring(0, 50) + (firstMessage.length > 50 ? '...' : '');
                await this.updateConversationTitle(conversationId, title);
            }
        } catch (error) {
            console.error('Error auto-generating title:', error);
            // Don't throw - title generation is optional
        }
    }
}

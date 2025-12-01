import { FunctionComponent } from 'preact';
import { useEffect, useState, useRef } from 'preact/hooks';
import { supabase } from '../../lib/supabase';
import type { Database } from '../../types/supabase';

type Message = Database['public']['Tables']['messages']['Row'];

interface ChatHistoryProps {
    conversationId: string;
}

export const ChatHistory: FunctionComponent<ChatHistoryProps> = ({ conversationId }) => {
    const [messages, setMessages] = useState<Message[]>([]);
    const [loading, setLoading] = useState(true);
    const bottomRef = useRef<HTMLDivElement>(null);

    const fetchMessages = async () => {
        try {
            const { data, error } = await supabase
                .from('messages')
                .select('*')
                .eq('conversation_id', conversationId)
                .order('created_at', { ascending: true });

            if (error) throw error;
            setMessages(data || []);
        } catch (error) {
            console.error('Error fetching messages:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchMessages();

        // Real-time subscription could go here, but for now we'll rely on parent triggering updates
        // or simple polling if needed. For this step, we just load initial data.
        // To support "live" updates from main.ts sending messages, we might need an event listener or similar.
        // For now, let's expose a global function to refresh? Or just poll?
        // Let's use a custom event for now to keep it simple and decoupled.
        const handleRefresh = () => fetchMessages();
        window.addEventListener('chat-refresh', handleRefresh);

        return () => {
            window.removeEventListener('chat-refresh', handleRefresh);
        };
    }, [conversationId]);

    useEffect(() => {
        // Scroll to bottom on new messages
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const markdownToHtml = (text: string): string => {
        if (!text) return '';
        return text
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/__(.+?)__/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            .replace(/_(.+?)_/g, '<em>$1</em>')
            .replace(/`(.+?)`/g, '<code>$1</code>')
            .replace(/\n/g, '<br>');
    };

    if (loading) {
        return (
            <div class="chat-loading" style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 200px; gap: 1rem; color: var(--text-secondary);">
                <div class="spinner" style="width: 30px; height: 30px; border: 2px solid rgba(255,255,255,0.1); border-radius: 50%; border-top-color: var(--accent-primary); animation: spin 1s ease-in-out infinite;"></div>
                <span style="font-size: 0.9rem; animation: pulse 2s infinite;">Laddar historik...</span>
                <style>{`
                    @keyframes spin { to { transform: rotate(360deg); } }
                    @keyframes pulse { 0%, 100% { opacity: 0.6; } 50% { opacity: 1; } }
                `}</style>
            </div>
        );
    }

    const [optimisticMessages, setOptimisticMessages] = useState<Message[]>([]);
    const [isThinking, setIsThinking] = useState(false);

    useEffect(() => {
        const handleOptimistic = (e: CustomEvent) => {
            const { content, file_name, file_url } = e.detail;
            const tempMessage: Message = {
                id: 'temp-' + Date.now(),
                conversation_id: conversationId,
                role: 'user',
                content,
                file_name: file_name || null,
                file_url: file_url || null,
                created_at: new Date().toISOString()
            };
            setOptimisticMessages(prev => [...prev, tempMessage]);
            setIsThinking(true);
            // Scroll to bottom
            setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
        };

        window.addEventListener('add-optimistic-message', handleOptimistic as EventListener);
        return () => window.removeEventListener('add-optimistic-message', handleOptimistic as EventListener);
    }, [conversationId]);

    // Clear optimistic messages when real messages are fetched
    useEffect(() => {
        if (messages.length > 0) {
            setOptimisticMessages([]);
            setIsThinking(false);
        }
    }, [messages]);

    const allMessages = [...messages, ...optimisticMessages];

    return (
        <>
            {/* Welcome Message */}
            <div class="message ai-message welcome-message">
                <div class="avatar">B</div>
                <div class="bubble">
                    <p>Hej! Jag är <strong>Britta</strong>, din expert på svensk bokföring.</p>
                    <p>Jag kan hjälpa dig med kontering, momsregler, avdrag och bokslut. Vad funderar du på idag?</p>
                </div>
            </div>

            {allMessages.map((msg) => (
                <div key={msg.id} class={`message ${msg.role === 'user' ? 'user-message' : 'ai-message'} ${msg.id.startsWith('temp-') ? 'optimistic' : ''}`}>
                    <div class="avatar">{msg.role === 'user' ? 'Du' : 'B'}</div>
                    <div class="bubble">
                        {msg.file_name && (
                            <div class="file-attachment" style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px; background: rgba(255,255,255,0.1); padding: 8px; border-radius: 8px;">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                    <polyline points="14 2 14 8 20 8"></polyline>
                                </svg>
                                <span style="font-size: 0.9em;">{msg.file_name}</span>
                                {msg.file_url && msg.file_name.endsWith('.xlsx') && (
                                    <span
                                        style="margin-left: auto; font-size: 0.75em; color: var(--accent-primary); cursor: pointer;"
                                        onClick={() => {
                                            window.dispatchEvent(new CustomEvent('open-excel', {
                                                detail: { url: msg.file_url, name: msg.file_name }
                                            }));
                                        }}
                                    >
                                        Klicka för att öppna →
                                    </span>
                                )}
                            </div>
                        )}
                        <div dangerouslySetInnerHTML={{ __html: markdownToHtml(msg.content) }} />
                    </div>
                </div>
            ))}

            {isThinking && (
                <div class="message ai-message thinking-message">
                    <div class="avatar">B</div>
                    <div class="bubble thinking-bubble">
                        <div class="typing-indicator">
                            <span></span>
                            <span></span>
                            <span></span>
                        </div>
                    </div>
                </div>
            )}
            <div ref={bottomRef} />
        </>
    );
};

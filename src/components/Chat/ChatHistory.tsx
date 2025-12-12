import { FunctionComponent } from 'preact';
import { useEffect, useState, useRef } from 'preact/hooks';
import { supabase } from '../../lib/supabase';
import type { Database } from '../../types/supabase';
import { FetchErrorFallback } from '../ErrorBoundary';
import type { VATReportData } from '../../types/vat';
import DOMPurify from 'dompurify';

type Message = Database['public']['Tables']['messages']['Row'];

interface ChatHistoryProps {
    conversationId: string | null;
}

export const ChatHistory: FunctionComponent<ChatHistoryProps> = ({ conversationId }) => {
    // All hooks must be at the top, before any conditional returns
    const [messages, setMessages] = useState<Message[]>([]);
    const [loading, setLoading] = useState(true);
    const [fetchError, setFetchError] = useState<string | null>(null);
    const [optimisticMessages, setOptimisticMessages] = useState<Message[]>([]);
    const [isThinking, setIsThinking] = useState(false);
    const [thinkingTimeout, setThinkingTimeout] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [showScrollButton, setShowScrollButton] = useState(false);
    const bottomRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const currentChannelRef = useRef<any>(null);

    // Date formatting helper
    const formatDateSeparator = (dateStr: string): string => {
        const date = new Date(dateStr);
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        if (date.toDateString() === today.toDateString()) return 'Idag';
        if (date.toDateString() === yesterday.toDateString()) return 'Igår';
        return date.toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' });
    };

    // Check if we need date separator between messages
    const needsDateSeparator = (current: Message, previous: Message | null): boolean => {
        if (!previous) return true;
        const currentDate = new Date(current.created_at || new Date()).toDateString();
        const previousDate = new Date(previous.created_at || new Date()).toDateString();
        return currentDate !== previousDate;
    };
    const fetchMessages = async () => {
        if (!conversationId) {
            setMessages([]);
            setLoading(false);
            // Dispatch event for welcome state (no messages)
            window.dispatchEvent(new CustomEvent('chat-messages-loaded', { detail: { count: 0 } }));
            return;
        }

        setLoading(true);
        setFetchError(null);
        try {
            const { data, error } = await supabase
                .from('messages')
                .select('*')
                .eq('conversation_id', conversationId)
                .order('created_at', { ascending: true });

            if (error) throw error;
            setMessages(data || []);
            // Dispatch event for welcome state toggle
            window.dispatchEvent(new CustomEvent('chat-messages-loaded', { detail: { count: (data || []).length } }));
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Kunde inte ladda meddelanden';
            console.error('Error fetching messages:', error);
            setFetchError(errorMsg);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchMessages();

        // Keep chat-refresh for backwards compatibility (optimistic updates, etc.)
        const handleRefresh = () => fetchMessages();
        window.addEventListener('chat-refresh', handleRefresh);

        // If no conversation yet, we don't need to subscribe
        if (!conversationId) {
            return () => {
                window.removeEventListener('chat-refresh', handleRefresh);
            };
        }

        // Clean up any existing channel first to prevent duplicates
        if (currentChannelRef.current) {
            supabase.removeChannel(currentChannelRef.current);
            currentChannelRef.current = null;
        }

        // Subscribe to realtime message inserts for this conversation
        const channel = supabase
            .channel(`messages:${conversationId}`)
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'messages',
                filter: `conversation_id=eq.${conversationId}`
            }, (payload) => {
                // Add new message to state (avoid duplicates)
                setMessages(prev => {
                    const newMsg = payload.new as Message;
                    // Check if already exists (could be from optimistic update)
                    if (prev.some(m => m.id === newMsg.id)) return prev;
                    return [...prev, newMsg];
                });
                // Clear thinking state when AI responds
                setIsThinking(false);
                setOptimisticMessages([]);
            })
            .subscribe();

        // Store in ref for cleanup
        currentChannelRef.current = channel;

        return () => {
            window.removeEventListener('chat-refresh', handleRefresh);
            if (currentChannelRef.current) {
                supabase.removeChannel(currentChannelRef.current);
                currentChannelRef.current = null;
            }
        };
    }, [conversationId]);

    useEffect(() => {
        // Scroll to bottom on new messages
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // Handle optimistic messages (must be before conditional returns)
    useEffect(() => {
        const handleOptimistic = (e: CustomEvent) => {
            const { content, file_name, file_url } = e.detail;
            const tempMessage: Message = {
                id: 'temp-' + Date.now(),
                conversation_id: conversationId || '',
                role: 'user',
                content,
                file_name: file_name || null,
                file_url: file_url || null,
                metadata: null,
                created_at: new Date().toISOString()
            };
            setOptimisticMessages(prev => [...prev, tempMessage]);
            setIsThinking(true);
            setErrorMessage(null);
            setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
        };

        window.addEventListener('add-optimistic-message', handleOptimistic as EventListener);
        return () => window.removeEventListener('add-optimistic-message', handleOptimistic as EventListener);
    }, [conversationId]);

    // Handle chat errors (must be before conditional returns)
    useEffect(() => {
        const handleError = (e: CustomEvent) => {
            setIsThinking(false);
            setErrorMessage(e.detail?.message || 'Ett fel uppstod');
            setTimeout(() => setErrorMessage(null), 5000);
        };

        window.addEventListener('chat-error', handleError as EventListener);
        return () => window.removeEventListener('chat-error', handleError as EventListener);
    }, []);

    // Clear optimistic messages when real messages are fetched (must be before conditional returns)
    useEffect(() => {
        if (messages.length > 0) {
            setOptimisticMessages([]);
            setIsThinking(false);
            setThinkingTimeout(false);
        }
    }, [messages]);

    // Thinking timeout - show retry after 30 seconds (must be before conditional returns)
    useEffect(() => {
        if (isThinking) {
            setThinkingTimeout(false);
            const timer = setTimeout(() => {
                setThinkingTimeout(true);
            }, 30000);
            return () => clearTimeout(timer);
        } else {
            setThinkingTimeout(false);
        }
    }, [isThinking]);

    const markdownToHtml = (text: string): string => {
        if (!text) return '';
        const html = text
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/__(.+?)__/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            .replace(/_(.+?)_/g, '<em>$1</em>')
            .replace(/`(.+?)`/g, '<code>$1</code>')
            .replace(/\n/g, '<br>');

        // Sanitize to prevent XSS attacks
        return DOMPurify.sanitize(html, {
            ALLOWED_TAGS: ['strong', 'em', 'code', 'br'],
            ALLOWED_ATTR: []
        });
    };

    // Handle loading state - show skeleton
    if (loading) {
        return (
            <div class="chat-loading-skeleton">
                {/* Skeleton messages */}
                {[1, 2, 3].map((i) => (
                    <div key={i} class="skeleton-message" style={{ alignSelf: i % 2 === 0 ? 'flex-end' : 'flex-start' }}>
                        <div class="skeleton skeleton-avatar"></div>
                        <div class="skeleton-content">
                            <div class={`skeleton skeleton-line ${i === 1 ? 'long' : i === 2 ? 'medium' : 'short'}`}></div>
                            <div class={`skeleton skeleton-line ${i === 1 ? 'medium' : 'short'}`}></div>
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    // Handle error state
    if (fetchError) {
        return (
            <FetchErrorFallback
                error={fetchError}
                onRetry={fetchMessages}
                title="Kunde inte ladda chatthistorik"
            />
        );
    }

    // Handle retry - dispatch event to main.ts
    const handleRetry = () => {
        setIsThinking(false);
        setThinkingTimeout(false);
        setOptimisticMessages([]);
        window.dispatchEvent(new CustomEvent('chat-retry'));
    };

    const allMessages = [...messages, ...optimisticMessages];

    // Scroll handler for scroll-to-bottom button visibility
    const handleScroll = () => {
        if (!containerRef.current) return;
        const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
        const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
        setShowScrollButton(!isNearBottom);
    };

    const scrollToBottom = () => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    return (
        <div
            ref={containerRef}
            onScroll={handleScroll}
            class="chat-list"
        >
            {/* Welcome Message removed - handled by index.html welcome-hero */}

            {allMessages.map((msg, index) => {
                const previousMsg = index > 0 ? allMessages[index - 1] : null;
                const showDateSeparator = needsDateSeparator(msg, previousMsg);

                return (
                    <>
                        {showDateSeparator && (
                            <div class="date-separator">
                                {formatDateSeparator(msg.created_at || new Date().toISOString())}
                            </div>
                        )}
                        <div key={msg.id} class={`message ${msg.role === 'user' ? 'user-message' : 'ai-message'} ${msg.id.startsWith('temp-') ? 'optimistic' : ''}`}>
                            {msg.role === 'user' ? (
                                <div class="avatar">Du</div>
                            ) : (
                                <div class="britta-orb" style={{ width: '32px', height: '32px', margin: '4px' }}></div>
                            )}
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

                                {/* Show button to open VAT Report in side panel if metadata contains vat_report */}
                                {msg.metadata && typeof msg.metadata === 'object' && !Array.isArray(msg.metadata) &&
                                    (msg.metadata as unknown as { type?: string }).type === 'vat_report' &&
                                    (msg.metadata as unknown as { data?: VATReportData }).data && (
                                        <button
                                            class="vat-report-open-btn"
                                            style={{
                                                marginTop: '0.75rem',
                                                padding: '0.5rem 1rem',
                                                background: 'linear-gradient(135deg, rgba(0, 240, 255, 0.15), rgba(180, 120, 255, 0.15))',
                                                border: '1px solid rgba(0, 240, 255, 0.3)',
                                                borderRadius: '8px',
                                                color: 'var(--accent-primary)',
                                                cursor: 'pointer',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '0.5rem',
                                                fontSize: '0.9rem',
                                                fontWeight: 500,
                                                transition: 'all 0.2s ease'
                                            }}
                                            onClick={() => {
                                                const data = (msg.metadata as unknown as { data: VATReportData }).data;
                                                const fileUrl = (msg.metadata as unknown as { file_url?: string }).file_url;
                                                window.dispatchEvent(new CustomEvent('open-vat-report', {
                                                    detail: { data, fileUrl }
                                                }));
                                            }}
                                            onMouseEnter={(e) => {
                                                (e.target as HTMLButtonElement).style.background = 'linear-gradient(135deg, rgba(0, 240, 255, 0.25), rgba(180, 120, 255, 0.25))';
                                            }}
                                            onMouseLeave={(e) => {
                                                (e.target as HTMLButtonElement).style.background = 'linear-gradient(135deg, rgba(0, 240, 255, 0.15), rgba(180, 120, 255, 0.15))';
                                            }}
                                        >
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                                <polyline points="14 2 14 8 20 8"></polyline>
                                                <line x1="16" y1="13" x2="8" y2="13"></line>
                                                <line x1="16" y1="17" x2="8" y2="17"></line>
                                            </svg>
                                            Öppna momsredovisning →
                                        </button>
                                    )}
                            </div>
                        </div>
                    </>
                );
            })}

            {isThinking && (
                <div class="message ai-message thinking-message">
                    <div class="britta-orb" style={{ width: '32px', height: '32px', margin: '4px' }}></div>
                    <div class="bubble thinking-bubble">
                        {thinkingTimeout ? (
                            <div class="thinking-timeout">
                                <p>Det tar längre tid än vanligt...</p>
                                <button class="retry-btn" onClick={handleRetry}>Försök igen</button>
                            </div>
                        ) : (
                            <div class="typing-indicator">
                                <span class="typing-dot"></span>
                                <span class="typing-dot"></span>
                                <span class="typing-dot"></span>
                            </div>
                        )}
                    </div>
                </div>
            )}
            {errorMessage && (
                <div class="message ai-message error-message" style="animation: fadeIn 0.3s ease;">
                    <div class="avatar" style="background: var(--error-color, #ef4444);">!</div>
                    <div class="bubble" style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3);">
                        <p style="color: var(--error-color, #ef4444); margin: 0;">{errorMessage}</p>
                    </div>
                </div>
            )}
            <div ref={bottomRef} />

            {/* Scroll to bottom button */}
            <button
                class={`scroll-bottom-btn ${showScrollButton ? 'visible' : ''}`}
                onClick={scrollToBottom}
                aria-label="Scrolla till botten"
            >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
            </button>
        </div>
    );
};

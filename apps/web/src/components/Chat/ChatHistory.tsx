import { FunctionComponent } from 'preact';
import { useEffect, useState, useRef } from 'preact/hooks';
import { supabase } from '../../lib/supabase';
import type { Database } from '../../types/supabase';
import { FetchErrorFallback } from '../ErrorBoundary';
import type { VATReportData } from '../../types/vat';
import { AIResponseRenderer, UserMessageRenderer } from './AIResponseRenderer';
import { StreamingText } from './StreamingText';
import { UpgradeModal } from '../UpgradeModal';

type Message = Database['public']['Tables']['messages']['Row'];

// Animated thinking text with character cascade effect
const AnimatedThinkingText: FunctionComponent = () => {
    const text = 'Britta tänker';
    const dots = '...';

    return (
        <span class="thinking-label">
            {text.split('').map((char, i) => (
                <span
                    class="thinking-char"
                    style={{ animationDelay: `${i * 0.05}s` }}
                >
                    {char === ' ' ? '\u00A0' : char}
                </span>
            ))}
            <span class="thinking-dots">
                {dots.split('').map((dot, i) => (
                    <span
                        class="thinking-dot"
                        style={{ animationDelay: `${(text.length + i) * 0.05}s` }}
                    >
                        {dot}
                    </span>
                ))}
            </span>
        </span>
    );
};

interface ChatHistoryProps {
    conversationId: string | null;
}

type RateLimitInfo = {
    remaining: number;
    resetAt: string | null;
    message?: string | null;
};

export const ChatHistory: FunctionComponent<ChatHistoryProps> = ({ conversationId }) => {
    // All hooks must be at the top, before any conditional returns
    const [messages, setMessages] = useState<Message[]>([]);
    const [isInitialLoad, setIsInitialLoad] = useState(true);
    const [fetchError, setFetchError] = useState<string | null>(null);
    const [optimisticMessages, setOptimisticMessages] = useState<Message[]>([]);
    const [isThinking, setIsThinking] = useState(false);
    const [thinkingTimeout, setThinkingTimeout] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [rateLimitInfo, setRateLimitInfo] = useState<RateLimitInfo | null>(null);
    const [showUpgradeModal, setShowUpgradeModal] = useState(false);
    const [showScrollButton, setShowScrollButton] = useState(false);
    const [streamingMessage, setStreamingMessage] = useState<string | null>(null);
    const bottomRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const currentChannelRef = useRef<any>(null);
    // Streaming debounce refs
    const streamingBufferRef = useRef<string>('');
    const debounceTimerRef = useRef<number | null>(null);

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
            setIsInitialLoad(false);
            window.dispatchEvent(new CustomEvent('chat-messages-loaded', {
                detail: {
                    count: 0,
                    conversationId
                }
            }));
            return;
        }

        // Loading is tracked via isInitialLoad
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
            window.dispatchEvent(new CustomEvent('chat-messages-loaded', {
                detail: {
                    count: (data || []).length,
                    conversationId
                }
            }));
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Kunde inte ladda meddelanden';
            console.error('Error fetching messages:', error);
            setFetchError(errorMsg);
        } finally {
            setIsInitialLoad(false);
        }
    };

    useEffect(() => {
        fetchMessages();

        // Silent refresh to avoid skeleton flicker
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
                // Clear thinking/streaming state when AI responds
                const newMsg = payload.new as Message;
                if (newMsg.role === 'assistant') {
                    setIsThinking(false);
                    setStreamingMessage(null); // Clear streaming content now that DB message exists
                }
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

    // Unified scroll-to-bottom logic (Sticky Scroll) - optimized with RAF
    useEffect(() => {
        if (!containerRef.current) return;

        requestAnimationFrame(() => {
            if (!containerRef.current) return;
            const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
            const isAtBottom = scrollHeight - scrollTop - clientHeight < 150;

            // Auto-scroll if we are already at bottom or if it's a new user message
            if (isAtBottom || optimisticMessages.length > 0) {
                bottomRef.current?.scrollIntoView({ behavior: isInitialLoad ? 'auto' : 'smooth' });
            }
        });
    }, [messages, optimisticMessages, isInitialLoad]); // Removed streamingMessage - scroll handled separately

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
            // CRITICAL: Reset streaming state BEFORE adding new message
            // This prevents new AI responses from being appended to previous ones
            if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
                debounceTimerRef.current = null;
            }
            streamingBufferRef.current = '';
            setStreamingMessage(null);
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

    // Handle rate limit banner (429)
    useEffect(() => {
        const handleRateLimit = (e: CustomEvent<RateLimitInfo>) => {
            setIsThinking(false);
            setErrorMessage(null);
            setStreamingMessage(null);
            const rateLimitData = {
                remaining: typeof e.detail?.remaining === 'number' ? e.detail.remaining : 0,
                resetAt: typeof e.detail?.resetAt === 'string' ? e.detail.resetAt : null,
                message: typeof e.detail?.message === 'string' ? e.detail.message : null
            };
            setRateLimitInfo(rateLimitData);

            // Dispatch global event so ChatController can disable the input
            window.dispatchEvent(new CustomEvent('rate-limit-active', { detail: rateLimitData }));
        };

        const handleStreamingChunk = (e: CustomEvent<{ chunk: string; isNewResponse?: boolean }>) => {
            console.log('📥 [ChatHistory] Received chunk:', e.detail.chunk?.substring(0, 50));
            setIsThinking(false); // Hide typing indicator once text starts

            if (e.detail.isNewResponse) {
                // New response - reset buffer and update immediately
                streamingBufferRef.current = e.detail.chunk;
                setStreamingMessage(e.detail.chunk);
            } else {
                // Append to buffer
                streamingBufferRef.current += e.detail.chunk;

                // Debounce state updates (50ms) for smoother rendering
                if (debounceTimerRef.current) {
                    clearTimeout(debounceTimerRef.current);
                }
                debounceTimerRef.current = window.setTimeout(() => {
                    setStreamingMessage(streamingBufferRef.current);
                    debounceTimerRef.current = null;
                }, 50);
            }
        };

        window.addEventListener('chat-rate-limit', handleRateLimit as EventListener);
        window.addEventListener('chat-streaming-chunk', handleStreamingChunk as EventListener);
        return () => {
            window.removeEventListener('chat-rate-limit', handleRateLimit as EventListener);
            window.removeEventListener('chat-streaming-chunk', handleStreamingChunk as EventListener);
        };
    }, []);

    // Clear optimistic messages when real messages are fetched (must be before conditional returns)
    useEffect(() => {
        if (messages.length > 0) {
            setOptimisticMessages([]);
            setThinkingTimeout(false);
            // Note: rateLimitInfo is NOT cleared here - it should persist until user dismisses the banner

            // Only clear streaming when AI response is actually in the database
            // This prevents race condition where fetchMessages() returns old data
            const lastMsg = messages[messages.length - 1];
            if (lastMsg?.role === 'assistant') {
                setIsThinking(false);
                setStreamingMessage(null);
            }
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

    // Handle loading state - only show skeleton on initial load
    if (isInitialLoad) {
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
        // Clean up streaming state
        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
            debounceTimerRef.current = null;
        }
        streamingBufferRef.current = '';
        setStreamingMessage(null);
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

    const resetTime = (() => {
        if (!rateLimitInfo?.resetAt) return null;
        const date = new Date(rateLimitInfo.resetAt);
        if (Number.isNaN(date.getTime())) return null;
        return date.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
    })();

    return (
        <div
            ref={containerRef}
            onScroll={handleScroll}
            class="chat-list"
        >
            {/* Welcome Message removed - handled by index.html welcome-hero */}

            {rateLimitInfo && (
                <div class="rate-limit-banner" role="status" aria-live="polite">
                    <div class="rate-limit-banner__icon" aria-hidden="true">⚡</div>
                    <div class="rate-limit-banner__content">
                        <div class="rate-limit-banner__title">
                            Gräns nådd{resetTime ? ` – återställs kl ${resetTime}` : ''}
                        </div>
                        <div class="rate-limit-banner__subtitle">
                            Uppgradera till Pro för fler förfrågningar
                        </div>
                    </div>
                    <button
                        type="button"
                        class="rate-limit-banner__upgrade"
                        onClick={() => setShowUpgradeModal(true)}
                    >
                        Uppgradera
                    </button>
                    <button
                        type="button"
                        class="rate-limit-banner__close"
                        aria-label="Stäng"
                        onClick={() => {
                            setRateLimitInfo(null);
                            window.dispatchEvent(new CustomEvent('rate-limit-cleared'));
                        }}
                    >
                        ×
                    </button>
                </div>
            )}

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
                                <div class="chat-orb chat-avatar-orb"></div>
                            )}
                            <div class="bubble">
                                {msg.role === 'user' ? (
                                    <UserMessageRenderer
                                        content={msg.content}
                                        fileName={msg.file_name}
                                    />
                                ) : (
                                    <AIResponseRenderer
                                        content={msg.content}
                                        metadata={msg.metadata as { type?: string; data?: VATReportData; file_url?: string } | null}
                                        fileName={msg.file_name}
                                        fileUrl={msg.file_url}
                                    />
                                )}
                            </div>
                        </div>
                    </>
                );
            })}

            {(isThinking || streamingMessage) && (
                <div class="message ai-message thinking-message">
                    <div
                        class="chat-orb thinking chat-avatar-orb"
                    ></div>
                    {streamingMessage ? (
                        <div class="bubble thinking-bubble">
                            <StreamingText content={streamingMessage} />
                        </div>
                    ) : thinkingTimeout ? (
                        <div class="bubble thinking-bubble">
                            <div class="thinking-timeout">
                                <p>Det tar längre tid än vanligt...</p>
                                <button class="retry-btn" onClick={handleRetry}>Försök igen</button>
                            </div>
                        </div>
                    ) : (
                        <div class="thinking-status" role="status" aria-live="polite">
                            <AnimatedThinkingText />
                        </div>
                    )}
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

            {/* Upgrade Modal */}
            {showUpgradeModal && (
                <UpgradeModal
                    onClose={() => setShowUpgradeModal(false)}
                    resetTime={resetTime}
                />
            )}
        </div>
    );
};

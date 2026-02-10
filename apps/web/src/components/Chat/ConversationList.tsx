import { FunctionComponent } from 'preact';
import { useEffect, useState, useMemo } from 'preact/hooks';
import { supabase } from '../../lib/supabase';
import { logger } from '../../services/LoggerService';
import { FetchErrorFallback } from '../ErrorBoundary';

interface Conversation {
    id: string;
    title: string;
    created_at: string;
    updated_at: string;
    last_message_preview?: string;
}

interface ConversationListProps {
    currentConversationId: string | null;
    onSelectConversation: (id: string) => void;
    companyId: string | null;
}

// Module-level cache to persist across remounts
const conversationCache = new Map<string, Conversation[]>();

// Track pending deletions to prevent race conditions with Realtime
const pendingDeletions = new Set<string>();

// Track currently deleting conversation (module-level to survive remounts)
let currentlyDeleting: string | null = null;

export const ConversationList: FunctionComponent<ConversationListProps> = ({ currentConversationId, onSelectConversation, companyId }) => {
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [loading, setLoading] = useState(true);
    const [fetchError, setFetchError] = useState<string | null>(null);
    const [showConfirmModal, setShowConfirmModal] = useState<string | null>(null);
    const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);

    // Force re-render when deletion state changes (since currentlyDeleting is module-level)
    const [, setRenderKey] = useState(0);
    const triggerUpdate = () => {
        setRenderKey(k => k + 1);
    };

    // Track active company - updates live when company changes
    const [activeCompanyId, setActiveCompanyId] = useState<string | null>(companyId);

    // Listen for company-changed event for live updates
    useEffect(() => {
        const handleCompanyChange = (e: Event) => {
            const customEvent = e as CustomEvent<{ companyId: string }>;
            setActiveCompanyId(customEvent.detail.companyId);
        };

        window.addEventListener('company-changed', handleCompanyChange);
        return () => {
            window.removeEventListener('company-changed', handleCompanyChange);
        };
    }, []);

    useEffect(() => {
        fetchConversations(true);

        // Listen for new chat creation to refresh list (backwards compatibility)
        const handleRefresh = (event?: Event) => {
            const customEvent = event as CustomEvent<{ force?: boolean }> | undefined;
            const forceRefresh = customEvent?.detail?.force ?? true;
            fetchConversations(forceRefresh);
        };
        window.addEventListener('refresh-conversation-list', handleRefresh);
        window.addEventListener('chat-refresh', handleRefresh);

        // Subscribe to realtime conversation changes
        let channel: ReturnType<typeof supabase.channel> | null = null;

        const setupRealtime = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) return;

            channel = supabase
                .channel(`conversations:${session.user.id}:${activeCompanyId || 'all'}`)
                .on('postgres_changes', {
                    event: '*', // INSERT, UPDATE, DELETE
                    schema: 'public',
                    table: 'conversations',
                    filter: `user_id=eq.${session.user.id}`
                }, (payload) => {
                    // Filter by company_id in callback since Supabase only supports single filter
                    const newCompanyId = (payload.new as { company_id?: string })?.company_id;
                    const oldCompanyId = (payload.old as { company_id?: string })?.company_id;

                    // Ignore DELETE events for our own pending deletions to prevent race condition
                    if (payload.eventType === 'DELETE') {
                        const deletedId = (payload.old as { id?: string })?.id;
                        if (deletedId && pendingDeletions.has(deletedId)) {
                            return; // Skip - this is our own deletion, UI already updated
                        }
                    }

                    // Re-fetch if the change is for current company or if no company filter
                    if (!activeCompanyId || newCompanyId === activeCompanyId || oldCompanyId === activeCompanyId) {
                        fetchConversations(true);
                    }
                })
                .subscribe();
        };

        setupRealtime();

        return () => {
            window.removeEventListener('refresh-conversation-list', handleRefresh);
            window.removeEventListener('chat-refresh', handleRefresh);
            if (channel) supabase.removeChannel(channel);
        };
    }, [activeCompanyId]);

    const fetchConversations = async (forceRefresh = false) => {
        const cacheKey = activeCompanyId || 'all';

        if (forceRefresh) {
            conversationCache.delete(cacheKey);
        }

        // Check cache first - show cached data immediately
        if (!forceRefresh && conversationCache.has(cacheKey)) {
            const cached = conversationCache.get(cacheKey)!;
            setConversations(cached);
            setLoading(false);
            // Do background refresh without showing loading
            refreshInBackground(cacheKey);
            return;
        }

        setLoading(true);
        setFetchError(null);
        await doFetch(cacheKey);
    };

    const refreshInBackground = async (cacheKey: string) => {
        // Silent refresh - no loading state change
        await doFetch(cacheKey);
    };

    const doFetch = async (cacheKey: string) => {
        try {
            const { data: { session } } = await supabase.auth.getSession();

            if (!session) {
                setFetchError('Inte inloggad');
                setLoading(false);
                return;
            }

            // Build query with company filter - include last message for preview
            let query = supabase
                .from('conversations')
                .select(`
                    id,
                    title,
                    created_at,
                    updated_at,
                    messages (
                        content,
                        role,
                        created_at
                    )
                `)
                .eq('user_id', session.user.id);

            // Filter by company if provided
            if (activeCompanyId) {
                query = query.eq('company_id', activeCompanyId);
            }

            const { data, error } = await query
                .order('updated_at', { ascending: false })
                .order('created_at', { ascending: false, foreignTable: 'messages' })
                .limit(1, { foreignTable: 'messages' });

            if (error) throw error;

            // Map data to ensure types match (handling null titles and dates)
            // Extract last message preview from limited messages array
            const typedData: Conversation[] = (data || []).map(item => {
                const messages = Array.isArray(item.messages)
                    ? item.messages as Array<{ content: string; role: string; created_at: string }>
                    : [];
                const latestMessage = messages[0];
                const preview = latestMessage?.content?.slice(0, 60) || '';

                return {
                    id: item.id,
                    title: item.title || 'Ny konversation',
                    created_at: item.created_at || new Date().toISOString(),
                    updated_at: item.updated_at || new Date().toISOString(),
                    last_message_preview: preview
                };
            });

            // Store in cache
            conversationCache.set(cacheKey, typedData);
            setConversations(typedData);
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Kunde inte ladda konversationer';
            logger.error('Error fetching conversations:', error);
            setFetchError(errorMsg);
        } finally {
            setLoading(false);
        }
    };

    const groupLabels = ['Idag', 'Igår', 'Tidigare'] as const;
    type GroupLabel = typeof groupLabels[number];

    const getGroupLabel = (dateString: string): GroupLabel => {
        const date = new Date(dateString);
        if (Number.isNaN(date.getTime())) return 'Tidigare';

        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        const diffDays = Math.floor((startOfToday.getTime() - startOfDate.getTime()) / (1000 * 60 * 60 * 24));

        if (diffDays === 0) return 'Idag';
        if (diffDays === 1) return 'Igår';
        return 'Tidigare';
    };

    const groupedConversations = useMemo(() => conversations.reduce<Record<GroupLabel, Conversation[]>>((acc, conv) => {
        const group = getGroupLabel(conv.updated_at);
        acc[group].push(conv);
        return acc;
    }, { Idag: [], Igår: [], Tidigare: [] }), [conversations]);

    const showToast = (message: string, type: 'success' | 'error') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 3000);
    };

    const handleDeleteClick = (e: Event, id: string) => {
        e.stopPropagation();
        setShowConfirmModal(id);
    };

    const confirmDelete = async () => {
        if (!showConfirmModal) return;

        const id = showConfirmModal;

        // Double-click protection: check both UI state and pending set
        if (currentlyDeleting === id || pendingDeletions.has(id)) {
            return;
        }

        // Mark as pending BEFORE any async work
        pendingDeletions.add(id);
        currentlyDeleting = id;
        triggerUpdate();
        setShowConfirmModal(null); // Close modal immediately, show loading on item

        // Optimistic removal - update UI BEFORE API call for instant feedback
        const previousConversations = conversations;
        setConversations(prev => {
            const updated = prev.filter(c => c.id !== id);
            const cacheKey = activeCompanyId || 'all';
            conversationCache.set(cacheKey, updated);
            return updated;
        });

        // If deleted conversation was active, dispatch event and create new one immediately
        if (id === currentConversationId) {
            window.dispatchEvent(new CustomEvent('conversation-deleted', { detail: { id } }));
            window.dispatchEvent(new CustomEvent('create-new-conversation'));
        }

        try {
            const { error } = await supabase
                .from('conversations')
                .delete()
                .eq('id', id);

            if (error) throw error;

            showToast('Konversationen raderades', 'success');
            
            // Clear loading state IMMEDIATELY on success
            pendingDeletions.delete(id);
            currentlyDeleting = null;
            triggerUpdate();
        } catch (error) {
            logger.error('[DELETE] Error:', error);
            showToast('Kunde inte ta bort konversationen', 'error');

            // Rollback: restore previous state on error - reset ALL state immediately
            pendingDeletions.delete(id);
            currentlyDeleting = null;
            triggerUpdate();
            setConversations(previousConversations);
            const cacheKey = activeCompanyId || 'all';
            conversationCache.set(cacheKey, previousConversations);
            fetchConversations(true); // Force refresh to sync with server
        }
    };

    if (loading && conversations.length === 0) {
        return (
            <div style="padding: 1rem; text-align: center; color: var(--text-secondary);">
                <div class="spinner" style="width: 20px; height: 20px; border: 2px solid rgba(255,255,255,0.1); border-radius: 50%; border-top-color: var(--accent-primary); animation: spin 1s ease-in-out infinite; margin: 0 auto 0.5rem;"></div>
                <span style="font-size: 0.8rem;">Laddar...</span>
            </div>
        );
    }

    if (fetchError) {
        return (
            <div style="padding: 1rem;">
                <FetchErrorFallback
                    error={fetchError}
                    onRetry={fetchConversations}
                    title="Kunde inte ladda konversationer"
                />
            </div>
        );
    }

    if (conversations.length === 0) {
        return (
            <div class="empty-state">
                <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                </svg>
                <h3>Inga konversationer ännu</h3>
                <p>Starta en ny konversation för att börja chatta med Veridat.</p>
                <button
                    class="empty-state-btn"
                    onClick={() => window.dispatchEvent(new CustomEvent('create-new-chat'))}
                >
                    Ny konversation
                </button>
            </div>
        );
    }

    return (
        <>
            <div class="conversation-list">
                {groupLabels.map((label) => {
                    const items = groupedConversations[label];
                    if (items.length === 0) return null;

                    return (
                        <div class="conversation-group" key={label}>
                            <div class="conversation-group-title">{label}</div>
                            {items.map((conv) => {
                                const isActive = conv.id === currentConversationId;
                                // Check both module-level states to ensure button disabled state is always correct
                                const isDeleting = currentlyDeleting === conv.id || pendingDeletions.has(conv.id);
                                return (
                                    <div
                                        key={conv.id}
                                        onClick={() => onSelectConversation(conv.id)}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter' || event.key === ' ') {
                                                event.preventDefault();
                                                onSelectConversation(conv.id);
                                            }
                                        }}
                                        class={`conversation-item${isActive ? ' is-active' : ''}${isDeleting ? ' is-deleting' : ''}`}
                                        title={conv.title || 'Ny konversation'}
                                        role="button"
                                        tabIndex={0}
                                    >
                                        <div class="conversation-item-content">
                                            <div class="conversation-item-title">
                                                {conv.title || 'Ny konversation'}
                                            </div>
                                        </div>

                                        <button
                                            class={`conversation-delete${isDeleting ? ' is-loading' : ''}`}
                                            onClick={(e) => handleDeleteClick(e, conv.id)}
                                            disabled={isDeleting}
                                            title="Ta bort konversation"
                                            aria-label="Ta bort konversation"
                                        >
                                            {isDeleting ? (
                                                <div class="spinner" style="width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.2); border-radius: 50%; border-top-color: #ff4d4d; animation: spin 1s ease-in-out infinite;"></div>
                                            ) : (
                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                    <polyline points="3 6 5 6 21 6"></polyline>
                                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2v2"></path>
                                                </svg>
                                            )}
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    );
                })}
            </div>

            {/* Custom Confirmation Modal */}
            {showConfirmModal && (
                <div class="confirm-modal-overlay">
                    <div class="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-delete-title" aria-describedby="confirm-delete-body">
                        <h3 id="confirm-delete-title" class="confirm-modal-title">Ta bort konversation?</h3>
                        <p id="confirm-delete-body" class="confirm-modal-body">
                            Är du säker på att du vill ta bort denna konversation? Detta går inte att ångra.
                        </p>
                        <div class="confirm-modal-actions">
                            <button
                                onClick={() => setShowConfirmModal(null)}
                                class="confirm-modal-btn confirm-modal-btn-secondary"
                            >
                                Avbryt
                            </button>
                            <button
                                onClick={confirmDelete}
                                class="confirm-modal-btn confirm-modal-btn-danger"
                            >
                                Ta bort
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Toast Notification */}
            {toast && (
                <div class={`toast-inline ${toast.type}`}>
                    {toast.message}
                </div>
            )}
        </>
    );
};

import { FunctionComponent } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { supabase } from '../../lib/supabase';
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

export const ConversationList: FunctionComponent<ConversationListProps> = ({ currentConversationId, onSelectConversation, companyId }) => {
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [loading, setLoading] = useState(true);
    const [fetchError, setFetchError] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [showConfirmModal, setShowConfirmModal] = useState<string | null>(null);
    const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);

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
        fetchConversations();

        // Listen for new chat creation to refresh list (backwards compatibility)
        const handleRefresh = () => fetchConversations();
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

                    // Re-fetch if the change is for current company or if no company filter
                    if (!activeCompanyId || newCompanyId === activeCompanyId || oldCompanyId === activeCompanyId) {
                        fetchConversations();
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
                    *,
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

            const { data, error } = await query.order('updated_at', { ascending: false });

            if (error) throw error;

            // Map data to ensure types match (handling null titles and dates)
            // Extract last message preview from messages array
            const typedData: Conversation[] = (data || []).map(item => {
                // Get the last user message for preview (most recent by created_at)
                const messages = (item.messages as Array<{ content: string; role: string; created_at: string }>) || [];
                const sortedMessages = messages.sort((a, b) =>
                    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
                );
                const lastUserMessage = sortedMessages.find(m => m.role === 'user');
                const preview = lastUserMessage?.content?.slice(0, 60) || '';

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
            console.error('Error fetching conversations:', error);
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

    const formatMeta = (dateString: string, group: GroupLabel): string => {
        const date = new Date(dateString);
        if (Number.isNaN(date.getTime())) return '';

        if (group === 'Idag' || group === 'Igår') {
            return date.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
        }

        return date.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' });
    };

    const groupedConversations = conversations.reduce<Record<GroupLabel, Conversation[]>>((acc, conv) => {
        const group = getGroupLabel(conv.updated_at);
        acc[group].push(conv);
        return acc;
    }, { Idag: [], Igår: [], Tidigare: [] });

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
        setDeletingId(id);
        setShowConfirmModal(null); // Close modal immediately, show loading on item

        try {
            const { error } = await supabase
                .from('conversations')
                .delete()
                .eq('id', id);

            if (error) throw error;

            showToast('Konversationen raderades', 'success');

            // Update local state and cache
            setConversations(prev => {
                const updated = prev.filter(c => c.id !== id);
                // Also update cache
                const cacheKey = activeCompanyId || 'all';
                conversationCache.set(cacheKey, updated);
                return updated;
            });

            // If deleted conversation was active, dispatch event and create new one
            if (id === currentConversationId) {
                window.dispatchEvent(new CustomEvent('conversation-deleted', { detail: { id } }));
                // Trigger new conversation creation
                window.dispatchEvent(new CustomEvent('create-new-conversation'));
            }
        } catch (error) {
            console.error('Error deleting conversation:', error);
            showToast('Kunde inte ta bort konversationen', 'error');
        } finally {
            setDeletingId(null);
        }
    };

    if (loading) {
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
                <p>Starta en ny konversation för att börja chatta med Britta.</p>
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
                                const isDeleting = deletingId === conv.id;
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
                                            {conv.last_message_preview && (
                                                <div class="conversation-item-preview">
                                                    {conv.last_message_preview}
                                                </div>
                                            )}
                                            <div class="conversation-item-meta">
                                                {formatMeta(conv.updated_at, label)}
                                            </div>
                                        </div>

                                        <button
                                            class={`conversation-delete${isDeleting ? ' is-loading' : ''}`}
                                            onClick={(e) => handleDeleteClick(e, conv.id)}
                                            disabled={isDeleting}
                                            title="Ta bort konversation"
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

import { FunctionComponent } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { supabase } from '../../lib/supabase';

interface Conversation {
    id: string;
    title: string;
    created_at: string;
    updated_at: string;
}

interface ConversationListProps {
    currentConversationId: string | null;
    onSelectConversation: (id: string) => void;
}

export const ConversationList: FunctionComponent<ConversationListProps> = ({ currentConversationId, onSelectConversation }) => {
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchConversations();

        // Listen for new chat creation to refresh list
        const handleRefresh = () => fetchConversations();
        window.addEventListener('refresh-conversation-list', handleRefresh);
        return () => window.removeEventListener('refresh-conversation-list', handleRefresh);
    }, []);

    const fetchConversations = async () => {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) return;

            const { data, error } = await supabase
                .from('conversations')
                .select('*')
                .eq('user_id', session.user.id)
                .order('updated_at', { ascending: false });

            if (error) throw error;

            // Map data to ensure types match (handling null titles and dates)
            const typedData: Conversation[] = (data || []).map(item => ({
                ...item,
                title: item.title || 'Ny konversation',
                created_at: item.created_at || new Date().toISOString(),
                updated_at: item.updated_at || new Date().toISOString()
            }));

            setConversations(typedData);
        } catch (error) {
            console.error('Error fetching conversations:', error);
        } finally {
            setLoading(false);
        }
    };

    const formatDate = (dateString: string) => {
        const date = new Date(dateString);
        const now = new Date();
        const diff = now.getTime() - date.getTime();
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));

        if (days === 0) return 'Idag';
        if (days === 1) return 'Igår';
        if (days < 7) return `${days} dagar sedan`;
        return date.toLocaleDateString('sv-SE');
    };

    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [showConfirmModal, setShowConfirmModal] = useState<string | null>(null); // ID of conversation to delete
    const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);

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

            // Update local state
            setConversations(prev => prev.filter(c => c.id !== id));

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

    if (conversations.length === 0) {
        return (
            <div style="padding: 2rem; text-align: center; color: var(--text-secondary); font-style: italic; font-size: 0.9rem;">
                Inga tidigare konversationer.
            </div>
        );
    }

    return (
        <>
            <div class="conversation-list" style="display: flex; flex-direction: column; gap: 0.5rem; padding: 1rem;">
                {conversations.map((conv) => (
                    <div
                        key={conv.id}
                        onClick={() => onSelectConversation(conv.id)}
                        style={`
                            padding: 0.75rem 1rem;
                            border-radius: 12px;
                            cursor: pointer;
                            transition: all 0.2s;
                            border: 1px solid ${conv.id === currentConversationId ? 'var(--accent-primary)' : 'transparent'};
                            background: ${conv.id === currentConversationId ? 'rgba(0, 240, 255, 0.1)' : 'rgba(255, 255, 255, 0.03)'};
                            display: flex;
                            justify-content: space-between;
                            align-items: center;
                            group: hover; /* For showing delete button on hover */
                            position: relative;
                        `}
                        onMouseEnter={(e) => {
                            if (conv.id !== currentConversationId) {
                                e.currentTarget.style.background = 'var(--surface-hover)';
                            }
                            // Show delete button
                            const btn = e.currentTarget.querySelector('.delete-btn') as HTMLElement;
                            if (btn && deletingId !== conv.id) btn.style.opacity = '1';
                        }}
                        onMouseLeave={(e) => {
                            if (conv.id !== currentConversationId) {
                                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                            }
                            // Hide delete button
                            const btn = e.currentTarget.querySelector('.delete-btn') as HTMLElement;
                            if (btn && deletingId !== conv.id) btn.style.opacity = '0';
                        }}
                    >
                        <div style="flex: 1; min-width: 0; margin-right: 0.5rem;">
                            <div style="font-weight: 600; font-size: 0.9rem; color: var(--text-primary); margin-bottom: 0.25rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                                {conv.title || 'Ny konversation'}
                            </div>
                            <div style="font-size: 0.75rem; color: var(--text-secondary);">
                                {formatDate(conv.updated_at)}
                            </div>
                        </div>

                        <button
                            class="delete-btn"
                            onClick={(e) => handleDeleteClick(e, conv.id)}
                            disabled={deletingId === conv.id}
                            title="Ta bort konversation"
                            style={`
                                opacity: ${deletingId === conv.id ? '1' : '0'};
                                background: transparent;
                                border: none;
                                color: var(--text-secondary);
                                cursor: ${deletingId === conv.id ? 'wait' : 'pointer'};
                                padding: 4px;
                                border-radius: 4px;
                                transition: all 0.2s;
                                display: flex;
                                align-items: center;
                                justify-content: center;
                                z-index: 10;
                            `}
                            onMouseEnter={(e) => {
                                if (deletingId !== conv.id) {
                                    e.currentTarget.style.color = '#ff4d4d';
                                    e.currentTarget.style.background = 'rgba(255, 77, 77, 0.1)';
                                }
                            }}
                            onMouseLeave={(e) => {
                                if (deletingId !== conv.id) {
                                    e.currentTarget.style.color = 'var(--text-secondary)';
                                    e.currentTarget.style.background = 'transparent';
                                }
                            }}
                        >
                            {deletingId === conv.id ? (
                                <div class="spinner" style="width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.2); border-radius: 50%; border-top-color: #ff4d4d; animation: spin 1s ease-in-out infinite;"></div>
                            ) : (
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <polyline points="3 6 5 6 21 6"></polyline>
                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2v2"></path>
                                </svg>
                            )}
                        </button>
                    </div>
                ))}
            </div>

            {/* Custom Confirmation Modal */}
            {showConfirmModal && (
                <div style="position: fixed; inset: 0; z-index: 10000; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.5); backdrop-filter: blur(4px);">
                    <div style="background: #1a1a1a; border: 1px solid rgba(255,255,255,0.1); padding: 24px; border-radius: 16px; width: 320px; box-shadow: 0 20px 40px rgba(0,0,0,0.4);">
                        <h3 style="margin: 0 0 12px 0; font-size: 18px; color: white;">Ta bort konversation?</h3>
                        <p style="margin: 0 0 24px 0; color: #a0a0a0; font-size: 14px; line-height: 1.5;">
                            Är du säker på att du vill ta bort denna konversation? Detta går inte att ångra.
                        </p>
                        <div style="display: flex; gap: 12px; justify-content: flex-end;">
                            <button
                                onClick={() => setShowConfirmModal(null)}
                                style="padding: 8px 16px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); background: transparent; color: white; cursor: pointer; font-size: 14px;"
                            >
                                Avbryt
                            </button>
                            <button
                                onClick={confirmDelete}
                                style="padding: 8px 16px; border-radius: 8px; border: none; background: #ff4d4d; color: white; cursor: pointer; font-size: 14px; font-weight: 500;"
                            >
                                Ta bort
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Toast Notification */}
            {toast && (
                <div style={`
                    position: fixed; 
                    bottom: 24px; 
                    left: 50%; 
                    transform: translateX(-50%); 
                    background: ${toast.type === 'success' ? 'rgba(16, 185, 129, 0.9)' : 'rgba(239, 68, 68, 0.9)'}; 
                    color: white; 
                    padding: 12px 24px; 
                    border-radius: 50px; 
                    font-size: 14px; 
                    font-weight: 500; 
                    box-shadow: 0 10px 20px rgba(0,0,0,0.2); 
                    z-index: 10001;
                    animation: slideUp 0.3s ease-out;
                    backdrop-filter: blur(8px);
                `}>
                    {toast.message}
                </div>
            )}
            <style>{`
                @keyframes slideUp {
                    from { transform: translate(-50%, 20px); opacity: 0; }
                    to { transform: translate(-50%, 0); opacity: 1; }
                }
            `}</style>
        </>
    );
};

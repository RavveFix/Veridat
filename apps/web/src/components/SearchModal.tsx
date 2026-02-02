import { FunctionComponent } from 'preact';
import { useEffect, useRef, useState, useCallback } from 'preact/hooks';
import { supabase } from '../lib/supabase';
import { companyManager } from '../services/CompanyService';
import { conversationController } from '../controllers/ConversationController';
import { logger } from '../services/LoggerService';

type SearchResult = {
    conversation_id: string;
    conversation_title: string | null;
    snippet: string;
    created_at: string;
    match_type?: 'title' | 'message';
};

type SearchResponse = {
    results?: SearchResult[];
    error?: string;
};

const MEMORY_ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/memory-service`;

interface SearchModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export const SearchModal: FunctionComponent<SearchModalProps> = ({ isOpen, onClose }) => {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<SearchResult[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const resultsRef = useRef<HTMLDivElement>(null);

    // Focus input when modal opens
    useEffect(() => {
        if (isOpen) {
            setQuery('');
            setResults([]);
            setSelectedIndex(0);
            // Small delay to ensure modal is visible
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [isOpen]);

    // Search with debounce
    useEffect(() => {
        if (!query || query.trim().length < 2) {
            setResults([]);
            return;
        }

        const timer = window.setTimeout(() => {
            void searchConversations(query.trim());
        }, 200);

        return () => window.clearTimeout(timer);
    }, [query]);

    // Reset selection when results change
    useEffect(() => {
        setSelectedIndex(0);
    }, [results]);

    const searchConversations = async (searchQuery: string): Promise<void> => {
        if (!searchQuery) return;

        setIsLoading(true);
        setSearchError(null);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                setResults([]);
                return;
            }

            const response = await fetch(MEMORY_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${session.access_token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    action: 'search_conversations',
                    company_id: companyManager.getCurrentId(),
                    query: searchQuery,
                    limit: 8
                })
            });

            const data = await response.json() as SearchResponse;
            if (!response.ok) {
                throw new Error(data.error || 'Kunde inte söka');
            }

            setResults(Array.isArray(data.results) ? data.results : []);
        } catch (err) {
            logger.warn('Conversation search failed', err);
            setResults([]);
            setSearchError('Sökningen misslyckades. Försök igen.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleSelect = useCallback(async (conversationId: string): Promise<void> => {
        onClose();
        await conversationController.loadConversation(conversationId);
    }, [onClose]);

    const handleNewChat = useCallback(() => {
        onClose();
        void conversationController.startNewChat();
    }, [onClose]);

    // Calculate total selectable items (quick action + results)
    const totalItems = results.length + 1; // +1 for "Ny konversation" action

    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIndex(prev => Math.min(prev + 1, totalItems - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIndex(prev => Math.max(prev - 1, 0));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (selectedIndex === 0) {
                // First item is always "Ny konversation"
                handleNewChat();
            } else if (results.length > 0) {
                void handleSelect(results[selectedIndex - 1].conversation_id);
            }
        } else if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
            e.preventDefault();
            handleNewChat();
        }
    }, [results, selectedIndex, handleSelect, onClose, handleNewChat, totalItems]);

    // Scroll selected item into view
    useEffect(() => {
        if (resultsRef.current && results.length > 0) {
            const selectedElement = resultsRef.current.children[selectedIndex] as HTMLElement;
            selectedElement?.scrollIntoView({ block: 'nearest' });
        }
    }, [selectedIndex, results]);

    if (!isOpen) return null;

    return (
        <div class="search-modal-overlay" onClick={onClose}>
            <div class="search-modal" onClick={(e) => e.stopPropagation()}>
                <div class="search-modal__header">
                    <div class="search-modal__input-wrapper">
                        <svg class="search-modal__icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="11" cy="11" r="8" />
                            <path d="m21 21-4.35-4.35" />
                        </svg>
                        <input
                            ref={inputRef}
                            type="text"
                            class="search-modal__input"
                            placeholder="Sök i konversationer..."
                            value={query}
                            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
                            onKeyDown={handleKeyDown}
                        />
                        {isLoading && <div class="search-modal__spinner" />}
                        <kbd class="search-modal__shortcut">ESC</kbd>
                    </div>
                </div>

                {/* Quick Actions - always visible */}
                <div class="search-modal__quick-actions">
                    <button
                        type="button"
                        class={`search-modal__action ${selectedIndex === 0 ? 'selected' : ''}`}
                        onClick={handleNewChat}
                        onMouseEnter={() => setSelectedIndex(0)}
                    >
                        <div class="search-modal__action-icon">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M12 5v14M5 12h14" />
                            </svg>
                        </div>
                        <span class="search-modal__action-text">Ny konversation</span>
                        <kbd class="search-modal__action-shortcut">⌘N</kbd>
                    </button>
                </div>

                {searchError && (
                    <div class="search-modal__error" style={{
                        padding: '0.75rem 1rem',
                        margin: '0 0.5rem',
                        borderRadius: '8px',
                        background: 'rgba(239, 68, 68, 0.1)',
                        color: '#ef4444',
                        fontSize: '0.85rem',
                        border: '1px solid rgba(239, 68, 68, 0.2)'
                    }}>
                        {searchError}
                    </div>
                )}

                {!searchError && (results.length > 0 || (query.length >= 2 && !isLoading)) && (
                    <div class="search-modal__results" ref={resultsRef}>
                        {results.length > 0 ? (
                            <>
                                <div class="search-modal__results-header">
                                    Konversationer
                                </div>
                                {results.map((result, index) => (
                                    <button
                                        key={result.conversation_id}
                                        type="button"
                                        class={`search-modal__result ${index + 1 === selectedIndex ? 'selected' : ''}`}
                                        onClick={() => void handleSelect(result.conversation_id)}
                                        onMouseEnter={() => setSelectedIndex(index + 1)}
                                    >
                                        <div class="search-modal__result-icon">
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                                            </svg>
                                        </div>
                                        <div class="search-modal__result-content">
                                            <div class="search-modal__result-header">
                                                {result.match_type === 'title' && (
                                                    <span class="search-modal__match-badge">Titel</span>
                                                )}
                                                <span class="search-modal__result-title">
                                                    {result.conversation_title || 'Konversation'}
                                                </span>
                                            </div>
                                            <div class="search-modal__result-snippet">{result.snippet}</div>
                                        </div>
                                        <div class="search-modal__result-date">
                                            {new Date(result.created_at).toLocaleDateString('sv-SE', {
                                                day: 'numeric',
                                                month: 'short'
                                            })}
                                        </div>
                                    </button>
                                ))}
                            </>
                        ) : (
                            <div class="search-modal__empty">
                                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4">
                                    <circle cx="11" cy="11" r="8" />
                                    <path d="m21 21-4.35-4.35" />
                                </svg>
                                <span>Inga resultat för "{query}"</span>
                            </div>
                        )}
                    </div>
                )}

                {query.length === 0 && (
                    <div class="search-modal__tips">
                        <div class="search-modal__tip">
                            <kbd>↑</kbd><kbd>↓</kbd> för att navigera
                        </div>
                        <div class="search-modal__tip">
                            <kbd>↵</kbd> för att välja
                        </div>
                        <div class="search-modal__tip">
                            <kbd>ESC</kbd> för att stänga
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

// Hook for global keyboard shortcut
export function useSearchModal() {
    const [isOpen, setIsOpen] = useState(false);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Cmd+K or Ctrl+K to toggle search
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                setIsOpen(prev => !prev);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    // Also listen for custom event from search button
    useEffect(() => {
        const handleOpenSearch = () => setIsOpen(true);
        window.addEventListener('open-search-modal', handleOpenSearch);
        return () => window.removeEventListener('open-search-modal', handleOpenSearch);
    }, []);

    return {
        isOpen,
        open: () => setIsOpen(true),
        close: () => setIsOpen(false)
    };
}

// Wrapper component for global mounting (used by AppController)
export const SearchModalWrapper: FunctionComponent = () => {
    const searchModal = useSearchModal();
    return (
        <SearchModal
            isOpen={searchModal.isOpen}
            onClose={searchModal.close}
        />
    );
};

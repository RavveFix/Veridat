import { FunctionComponent } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { supabase } from '../lib/supabase';
import { companyManager } from '../services/CompanyService';
import { conversationController } from '../controllers/ConversationController';
import { logger } from '../services/LoggerService';

type SearchResult = {
    conversation_id: string;
    conversation_title: string | null;
    snippet: string;
    created_at: string;
};

type SearchResponse = {
    results?: SearchResult[];
    error?: string;
};

const MEMORY_ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/memory-service`;

export const ConversationSearch: FunctionComponent = () => {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<SearchResult[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [companyId, setCompanyId] = useState(companyManager.getCurrentId());
    const containerRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const handleCompanyChange = (event: Event) => {
            const detail = (event as CustomEvent<{ companyId: string }>).detail;
            if (detail?.companyId) {
                setCompanyId(detail.companyId);
            }
        };
        window.addEventListener('company-changed', handleCompanyChange);
        return () => window.removeEventListener('company-changed', handleCompanyChange);
    }, []);

    useEffect(() => {
        if (!query || query.trim().length < 2) {
            setResults([]);
            setIsOpen(false);
            return;
        }

        const timer = window.setTimeout(() => {
            void searchConversations(query.trim());
        }, 300);

        return () => window.clearTimeout(timer);
    }, [query, companyId]);

    useEffect(() => {
        const handleOutsideClick = (event: MouseEvent) => {
            if (!containerRef.current) return;
            if (!containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleOutsideClick);
        }

        return () => document.removeEventListener('mousedown', handleOutsideClick);
    }, [isOpen]);

    const searchConversations = async (searchQuery: string): Promise<void> => {
        if (!searchQuery) return;

        setIsLoading(true);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                setResults([]);
                setIsOpen(false);
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
                    company_id: companyId,
                    query: searchQuery,
                    limit: 6
                })
            });

            const data = await response.json() as SearchResponse;
            if (!response.ok) {
                throw new Error(data.error || 'Kunde inte söka');
            }

            setResults(Array.isArray(data.results) ? data.results : []);
            setIsOpen(true);
        } catch (searchError) {
            logger.warn('Conversation search failed', searchError);
            setResults([]);
            setIsOpen(false);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSelect = async (conversationId: string): Promise<void> => {
        setIsOpen(false);
        setQuery('');
        await conversationController.loadConversation(conversationId);
    };

    return (
        <div class="conversation-search" ref={containerRef}>
            <div class="search-input-wrapper">
                <svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.35-4.35" />
                </svg>
                <input
                    type="text"
                    class="search-input"
                    placeholder="Sök i tidigare konversationer..."
                    value={query}
                    onInput={(event) => setQuery((event.target as HTMLInputElement).value)}
                    onFocus={() => {
                        if (results.length > 0) {
                            setIsOpen(true);
                        }
                    }}
                    onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                            setIsOpen(false);
                        }
                    }}
                    aria-label="Sök i tidigare konversationer"
                />
                {isLoading && <span class="search-spinner" aria-hidden="true"></span>}
            </div>

            {isOpen && (
                <div class="search-results" role="listbox">
                    {results.length > 0 ? (
                        results.map((result) => (
                            <button
                                key={result.conversation_id}
                                type="button"
                                class="search-result"
                                onClick={() => void handleSelect(result.conversation_id)}
                            >
                                <div class="result-title">{result.conversation_title || 'Konversation'}</div>
                                <div class="result-snippet">{result.snippet}</div>
                                <div class="result-date">
                                    {new Date(result.created_at).toLocaleDateString('sv-SE')}
                                </div>
                            </button>
                        ))
                    ) : (
                        <div class="no-results">Inga resultat hittades</div>
                    )}
                </div>
            )}
        </div>
    );
};

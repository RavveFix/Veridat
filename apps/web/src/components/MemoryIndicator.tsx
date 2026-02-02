import { FunctionComponent } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { supabase } from '../lib/supabase';
import { companyManager } from '../services/CompanyService';
import { logger } from '../services/LoggerService';

type MemoryItem = {
    id: string;
    category: string;
    content: string;
    updated_at: string | null;
};

type MemoryResponse = {
    raw?: MemoryItem[];
    error?: string;
};

type MemoryGeneratedEvent = CustomEvent<{
    conversationId: string;
    summaryUpdated: boolean;
    memoriesAdded: number;
}>;

const MEMORY_ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/memory-service`;
const NEW_BADGE_TIMEOUT_MS = 5000; // Show "Ny!" badge for 5 seconds

const CATEGORY_LABELS: Record<string, string> = {
    work_context: '🏢 Företag',
    preferences: '⚙️ Preferens',
    history: '📜 Historik',
    top_of_mind: '🎯 Aktuellt',
    user_defined: '📝 Eget'
};

function formatRelativeTime(dateString: string | null): string {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just nu';
    if (diffMins < 60) return `${diffMins} min sedan`;
    if (diffHours < 24) return `${diffHours} tim sedan`;
    if (diffDays < 7) return `${diffDays} dagar sedan`;
    return date.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' });
}

export const MemoryIndicator: FunctionComponent = () => {
    const [memories, setMemories] = useState<MemoryItem[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [companyId, setCompanyId] = useState(companyManager.getCurrentId());
    const [isAdding, setIsAdding] = useState(false);
    const [newMemory, setNewMemory] = useState('');
    const [hasNewMemories, setHasNewMemories] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const inputRef = useRef<HTMLTextAreaElement | null>(null);
    const newBadgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const memoryCount = useMemo(() => memories.length, [memories]);

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
        void loadMemories(companyId);
    }, [companyId]);

    useEffect(() => {
        if (isAdding) {
            inputRef.current?.focus();
        }
    }, [isAdding]);

    useEffect(() => {
        if (!isOpen) return;
        const handleOutsideClick = (event: MouseEvent) => {
            if (!containerRef.current) return;
            if (!containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
                setIsAdding(false);
                setNewMemory('');
            }
        };
        document.addEventListener('mousedown', handleOutsideClick);
        return () => document.removeEventListener('mousedown', handleOutsideClick);
    }, [isOpen]);

    // Listen for automatic memory generation events
    useEffect(() => {
        const handleGenerationStart = () => {
            setIsGenerating(true);
        };

        const handleMemoryGenerated = (event: Event) => {
            const customEvent = event as MemoryGeneratedEvent;
            const { memoriesAdded } = customEvent.detail;

            setIsGenerating(false);

            if (memoriesAdded > 0) {
                logger.info('New memories generated, refreshing list', { memoriesAdded });

                // Show "Ny!" badge
                setHasNewMemories(true);

                // Clear any existing timer
                if (newBadgeTimerRef.current) {
                    clearTimeout(newBadgeTimerRef.current);
                }

                // Hide badge after timeout
                newBadgeTimerRef.current = setTimeout(() => {
                    setHasNewMemories(false);
                }, NEW_BADGE_TIMEOUT_MS);

                // Refresh the memory list
                void loadMemories(companyId);
            }
        };

        const handleGenerationError = () => {
            setIsGenerating(false);
        };

        window.addEventListener('memory-generation-start', handleGenerationStart);
        window.addEventListener('memory-generated', handleMemoryGenerated);
        window.addEventListener('memory-generation-error', handleGenerationError);

        return () => {
            window.removeEventListener('memory-generation-start', handleGenerationStart);
            window.removeEventListener('memory-generated', handleMemoryGenerated);
            window.removeEventListener('memory-generation-error', handleGenerationError);

            if (newBadgeTimerRef.current) {
                clearTimeout(newBadgeTimerRef.current);
            }
        };
    }, [companyId]);

    const loadMemories = async (targetCompanyId: string): Promise<void> => {
        if (!targetCompanyId) {
            setMemories([]);
            return;
        }

        setIsLoading(true);
        setError(null);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                setMemories([]);
                return;
            }

            const response = await fetch(MEMORY_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${session.access_token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    action: 'get_memories',
                    company_id: targetCompanyId
                })
            });

            const data = await response.json() as MemoryResponse;
            if (!response.ok) {
                throw new Error(data.error || 'Kunde inte hämta minnen');
            }

            setMemories(Array.isArray(data.raw) ? data.raw : []);
        } catch (loadError) {
            const message = loadError instanceof Error ? loadError.message : 'Kunde inte hämta minnen';
            setError(message);
            logger.warn('Failed to load memories', loadError);
        } finally {
            setIsLoading(false);
        }
    };

    const handleAddMemory = async (): Promise<void> => {
        const content = newMemory.trim();
        if (!content || !companyId) return;

        setIsLoading(true);
        setError(null);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                throw new Error('Inte inloggad');
            }

            const response = await fetch(MEMORY_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${session.access_token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    action: 'add_memory',
                    company_id: companyId,
                    query: content
                })
            });

            const data = await response.json() as MemoryResponse;
            if (!response.ok) {
                throw new Error(data.error || 'Kunde inte spara minnet');
            }

            setNewMemory('');
            setIsAdding(false);
            await loadMemories(companyId);
        } catch (addError) {
            const message = addError instanceof Error ? addError.message : 'Kunde inte spara minnet';
            setError(message);
            logger.warn('Failed to add memory', addError);
        } finally {
            setIsLoading(false);
        }
    };

    const handleDeleteMemory = async (id: string): Promise<void> => {
        if (!id) return;

        setIsLoading(true);
        setError(null);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                throw new Error('Inte inloggad');
            }

            const response = await fetch(MEMORY_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${session.access_token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    action: 'remove_memory',
                    query: id
                })
            });

            const data = await response.json() as MemoryResponse;
            if (!response.ok) {
                throw new Error(data.error || 'Kunde inte ta bort minnet');
            }

            await loadMemories(companyId);
        } catch (deleteError) {
            const message = deleteError instanceof Error ? deleteError.message : 'Kunde inte ta bort minnet';
            setError(message);
            logger.warn('Failed to delete memory', deleteError);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div class="memory-indicator" ref={containerRef}>
            <button
                type="button"
                class={`memory-button ${isGenerating ? 'memory-generating' : ''}`}
                onClick={() => setIsOpen((prev) => !prev)}
                aria-expanded={isOpen}
                aria-haspopup="dialog"
            >
                {isGenerating ? (
                    <span class="memory-spinner" aria-hidden="true" />
                ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                    </svg>
                )}
                <span class="memory-button-label">Minne</span>
                {memoryCount > 0 && <span class="memory-count">{memoryCount}</span>}
                {hasNewMemories && <span class="memory-new-badge">Ny!</span>}
            </button>

            {isOpen && (
                <div class="memory-panel" role="dialog" aria-label="Veridat kommer ihåg">
                    <div class="memory-panel-header">
                        <div>
                            <div class="memory-panel-title">Veridat kommer ihåg</div>
                            <div class="memory-panel-subtitle">Minnen kopplade till detta bolag</div>
                        </div>
                        <button
                            type="button"
                            class="memory-close"
                            onClick={() => {
                                setIsOpen(false);
                                setIsAdding(false);
                                setNewMemory('');
                            }}
                            aria-label="Stäng minnepanelen"
                        >
                            ×
                        </button>
                    </div>

                    {error && <div class="memory-error">{error}</div>}

                    <div class="memory-list">
                        {isLoading && memories.length === 0 && (
                            <div class="memory-loading">Laddar minnen...</div>
                        )}
                        {!isLoading && memories.length === 0 && (
                            <div class="memory-empty">Inga minnen ännu. Lägg till något Veridat ska komma ihåg.</div>
                        )}
                        {memories.map((memory) => (
                            <div key={memory.id} class="memory-item">
                                <div class="memory-item-header">
                                    <span class="memory-category">
                                        {CATEGORY_LABELS[memory.category] || memory.category}
                                    </span>
                                    <button
                                        type="button"
                                        class="memory-delete"
                                        onClick={() => handleDeleteMemory(memory.id)}
                                        aria-label="Ta bort minne"
                                        disabled={isLoading}
                                    >
                                        ×
                                    </button>
                                </div>
                                <p>{memory.content}</p>
                                {memory.updated_at && (
                                    <div class="memory-item-footer">
                                        <span class="memory-timestamp">
                                            Senast använd: {formatRelativeTime(memory.updated_at)}
                                        </span>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>

                    {isAdding ? (
                        <div class="memory-add-form">
                            <textarea
                                ref={inputRef}
                                class="memory-add-input"
                                rows={3}
                                value={newMemory}
                                placeholder="Skriv ett minne du vill att Veridat ska använda..."
                                onInput={(event) => setNewMemory((event.target as HTMLTextAreaElement).value)}
                            />
                            <div class="memory-add-actions">
                                <button
                                    type="button"
                                    class="memory-add-cancel"
                                    onClick={() => {
                                        setIsAdding(false);
                                        setNewMemory('');
                                    }}
                                    disabled={isLoading}
                                >
                                    Avbryt
                                </button>
                                <button
                                    type="button"
                                    class="memory-add-save"
                                    onClick={() => void handleAddMemory()}
                                    disabled={isLoading || newMemory.trim().length === 0}
                                >
                                    Spara minne
                                </button>
                            </div>
                        </div>
                    ) : (
                        <button
                            type="button"
                            class="memory-add-button"
                            onClick={() => setIsAdding(true)}
                        >
                            + Lägg till minne
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};

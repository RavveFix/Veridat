import { FunctionComponent } from 'preact';
import { useState } from 'preact/hooks';

export interface UsedMemory {
    id: string;
    category: string;
    preview: string;
}

interface MemoryUsageNoticeProps {
    memories: UsedMemory[];
}

/**
 * Translates memory category keys to Swedish labels
 */
function getCategoryLabel(category: string): string {
    const labels: Record<string, string> = {
        work_context: 'Arbetskontext',
        preferences: 'Preferenser',
        history: 'Historik',
        top_of_mind: 'Aktuellt',
        user_defined: 'Eget'
    };
    return labels[category] || category;
}

/**
 * MemoryUsageNotice - Transparency indicator for memory usage
 *
 * Shows when Britta used stored memories to answer.
 * Follows Claude AI's transparency principle - users should know
 * when their data is being used.
 */
export const MemoryUsageNotice: FunctionComponent<MemoryUsageNoticeProps> = ({
    memories
}) => {
    const [isExpanded, setIsExpanded] = useState(false);

    if (!memories || memories.length === 0) {
        return null;
    }

    const count = memories.length;
    const memoryWord = count === 1 ? 'minne' : 'minnen';

    return (
        <div class="memory-usage-notice">
            <div class="memory-usage-header">
                <span class="memory-usage-icon">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 2a9 9 0 0 1 9 9c0 3.1-1.6 5.8-4 7.3V21h-4v-1h-2v1H7v-2.7A9 9 0 0 1 12 2z" />
                        <path d="M9 10h.01M15 10h.01" />
                        <path d="M9.5 15a3.5 3.5 0 0 0 5 0" />
                    </svg>
                </span>
                <span class="memory-usage-text">
                    Britta använde {count} {memoryWord}
                </span>
                <button
                    class="memory-usage-expand"
                    onClick={() => setIsExpanded(!isExpanded)}
                    aria-expanded={isExpanded}
                >
                    {isExpanded ? 'Dölj' : 'Visa'}
                </button>
            </div>

            {isExpanded && (
                <div class="memory-usage-details">
                    {memories.map((memory) => (
                        <div key={memory.id} class="memory-usage-item">
                            <span class="memory-usage-category">
                                {getCategoryLabel(memory.category)}
                            </span>
                            <span class="memory-usage-preview">
                                {memory.preview}
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

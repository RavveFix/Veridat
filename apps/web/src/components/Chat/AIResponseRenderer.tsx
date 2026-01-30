import { FunctionComponent } from 'preact';
import { memo } from 'preact/compat';
import { useMemo, useState } from 'preact/hooks';
import { parseAIResponse, markdownToHtml, containsCodeBlock, containsMarkdownTable, parseMarkdownTable } from '../../utils/markdownParser';
import { ArtifactCard, CodeArtifact } from './ArtifactCard';
import { VATSummaryCard } from './VATSummaryCard';
import { MemoryUsageNotice, type UsedMemory } from './MemoryUsageNotice';
import type { VATReportData } from '../../types/vat';

interface AIResponseRendererProps {
    content: string;
    metadata?: {
        type?: string;
        data?: VATReportData;
        file_url?: string;
    } | null;
    fileName?: string | null;
    fileUrl?: string | null;
    /** Memories used by Britta to generate this response - for transparency */
    usedMemories?: UsedMemory[];
}

/**
 * AIResponseRenderer - Intelligently renders AI responses
 *
 * Detects structured content (code, tables, file analysis) and renders
 * them as distinct artifact cards while keeping conversational text
 * in a clean text format.
 *
 * Memoized to prevent re-parsing on every render during streaming.
 */
const AIResponseRendererInner: FunctionComponent<AIResponseRendererProps> = ({
    content,
    metadata,
    fileName,
    fileUrl,
    usedMemories,
}) => {
    // Memoize expensive parsing operations
    const hasStructuredContent = useMemo(
        () => containsCodeBlock(content) || containsMarkdownTable(content),
        [content]
    );

    const parsedBlocks = useMemo(
        () => hasStructuredContent ? parseAIResponse(content) : null,
        [content, hasStructuredContent]
    );

    const htmlContent = useMemo(
        () => !hasStructuredContent && !metadata?.type ? markdownToHtml(content) : null,
        [content, hasStructuredContent, metadata?.type]
    );
    // Check if this is a VAT report response - show compact inline card
    // Full report is displayed in the side panel
    if (metadata?.type === 'vat_report' && metadata.data) {
        const vatData = metadata.data;
        return (
            <div class="ai-response">
                {/* Memory usage transparency notice */}
                {usedMemories && usedMemories.length > 0 && (
                    <MemoryUsageNotice memories={usedMemories} />
                )}
                {/* Compact inline summary card - full report opens in side panel */}
                <VATSummaryCard
                    period={vatData.period || 'Period okänd'}
                    netVat={vatData.vat?.net ?? 0}
                    totalIncome={vatData.summary?.total_income}
                    fullData={vatData}
                    fileUrl={metadata.file_url}
                />
            </div>
        );
    }

    // Check for structured content (code blocks or tables)
    if (hasStructuredContent && parsedBlocks) {
        return (
            <div class="ai-response">
                {/* Memory usage transparency notice */}
                {usedMemories && usedMemories.length > 0 && (
                    <MemoryUsageNotice memories={usedMemories} />
                )}
                {parsedBlocks.map((block, index) => {
                    if (block.type === 'code') {
                        return (
                            <CodeArtifact
                                key={index}
                                language={block.language || 'text'}
                                code={block.content}
                            />
                        );
                    }

                    if (block.type === 'table') {
                        const tableHtml = parseMarkdownTable(block.content);
                        if (tableHtml) {
                            return (
                                <ArtifactCard
                                    key={index}
                                    type="table"
                                    title="Datatabell"
                                    defaultExpanded={true}
                                    actions={[
                                        {
                                            label: 'Kopiera tabell',
                                            icon: '📋',
                                            onClick: () => {
                                                // Simple text copy for table
                                                navigator.clipboard.writeText(block.content);
                                            }
                                        }
                                    ]}
                                >
                                    <div dangerouslySetInnerHTML={{ __html: tableHtml }} />
                                </ArtifactCard>
                            );
                        }
                    }

                    return (
                        <div
                            key={index}
                            class="response-text"
                            dangerouslySetInnerHTML={{ __html: markdownToHtml(block.content) }}
                        />
                    );
                })}
            </div>
        );
    }

    // Check if there's an attached file (Excel)
    if (fileName && fileUrl && fileName.endsWith('.xlsx')) {
        return (
            <div class="ai-response">
                {/* Memory usage transparency notice */}
                {usedMemories && usedMemories.length > 0 && (
                    <MemoryUsageNotice memories={usedMemories} />
                )}
                <div
                    class="response-text"
                    dangerouslySetInnerHTML={{ __html: markdownToHtml(content) }}
                />

                <ArtifactCard
                    type="excel"
                    title={fileName}
                    subtitle="Excel-fil bifogad"
                    status="success"
                    defaultExpanded={false}
                    actions={[
                        {
                            label: 'Öppna fil',
                            icon: '→',
                            primary: true,
                            onClick: () => {
                                window.dispatchEvent(new CustomEvent('open-excel', {
                                    detail: { url: fileUrl, name: fileName }
                                }));
                            },
                        },
                    ]}
                />
            </div>
        );
    }

    // Default: render as enhanced markdown (use memoized HTML)
    const [startCopy, setStartCopy] = useState(false); // Using strict boolean to trigger re-render if needed, but actually we need local state for feedback

    return (
        <div class="ai-response-container" style={{ position: 'relative' }}>
            {/* Memory usage transparency notice */}
            {usedMemories && usedMemories.length > 0 && (
                <MemoryUsageNotice memories={usedMemories} />
            )}
            <div
                class="ai-response response-text"
                dangerouslySetInnerHTML={{ __html: htmlContent || markdownToHtml(content) }}
            />
            <div class="message-actions">
                <button 
                    class={`copy-action-btn ${startCopy ? 'copied' : ''}`}
                    onClick={(e) => {
                        e.stopPropagation();
                        navigator.clipboard.writeText(content);
                        setStartCopy(true);
                        setTimeout(() => setStartCopy(false), 2000);
                    }}
                    title="Kopiera hela svaret"
                >
                    {startCopy ? (
                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem' }}>
                            ✓ Kopierat
                        </span>
                    ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                             <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                             <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                    )}
                </button>
            </div>
        </div>
    );
};

// Export memoized component to prevent unnecessary re-renders during streaming
export const AIResponseRenderer = memo(AIResponseRendererInner);

/**
 * UserMessageRenderer - Simple renderer for user messages
 * Handles file attachments nicely
 */
interface UserMessageRendererProps {
    content: string;
    fileName?: string | null;
}

export const UserMessageRenderer: FunctionComponent<UserMessageRendererProps> = ({
    content,
    fileName,
}) => {
    return (
        <div class="user-response">
            {fileName && (
                <div class="user-file-attachment">
                    <span class="file-icon">
                        {fileName.endsWith('.xlsx') ? '📊' :
                            fileName.endsWith('.pdf') ? '📄' : '📁'}
                    </span>
                    <span class="file-name">{fileName}</span>
                </div>
            )}
            {content && (
                <div class="response-text">
                    {content}
                </div>
            )}
        </div>
    );
};

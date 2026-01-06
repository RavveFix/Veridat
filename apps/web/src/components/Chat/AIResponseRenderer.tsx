import { FunctionComponent } from 'preact';
import { memo } from 'preact/compat';
import { useMemo } from 'preact/hooks';
import { parseAIResponse, markdownToHtml, containsCodeBlock, containsMarkdownTable, parseMarkdownTable } from '../../utils/markdownParser';
import { ArtifactCard, VATArtifact, CodeArtifact } from './ArtifactCard';
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
    // Check if this is a VAT report response
    if (metadata?.type === 'vat_report' && metadata.data) {
        const vatData = metadata.data;
        return (
            <div class="ai-response">
                {/* Render any leading text before the artifact */}
                {content && !content.includes('Momsredovisning skapad') && (
                    <div
                        class="response-text"
                        dangerouslySetInnerHTML={{ __html: markdownToHtml(content) }}
                    />
                )}

                <VATArtifact
                    period={vatData.period || ''}
                    companyName={vatData.company?.name}
                    totalIncome={vatData.summary?.total_income}
                    totalVat={vatData.vat?.net}
                    onOpen={() => {
                        window.dispatchEvent(new CustomEvent('open-vat-report', {
                            detail: { data: vatData, fileUrl: metadata.file_url }
                        }));
                    }}
                    onCopy={() => {
                        const summary = `Momsredovisning ${vatData.period}\n` +
                            `Företag: ${vatData.company?.name || 'N/A'}\n` +
                            `Försäljning: ${vatData.summary?.total_income?.toLocaleString('sv-SE')} SEK\n` +
                            `Moms att betala: ${vatData.vat?.net?.toLocaleString('sv-SE')} SEK`;
                        navigator.clipboard.writeText(summary);
                    }}
                />
            </div>
        );
    }

    // Check for structured content (code blocks or tables)
    if (hasStructuredContent && parsedBlocks) {
        return (
            <div class="ai-response">
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
    return (
        <div
            class="ai-response response-text"
            dangerouslySetInnerHTML={{ __html: htmlContent || markdownToHtml(content) }}
        />
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

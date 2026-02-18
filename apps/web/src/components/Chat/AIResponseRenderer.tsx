import { FunctionComponent } from 'preact';
import { memo } from 'preact/compat';
import { useMemo, useState } from 'preact/hooks';
import { parseAIResponse, markdownToHtml, containsCodeBlock, containsMarkdownTable, parseMarkdownTable } from '../../utils/markdownParser';
import { ArtifactCard, CodeArtifact } from './ArtifactCard';
import { VATSummaryCard } from './VATSummaryCard';
import { JournalEntryCard, type JournalEntry, type JournalValidation, type JournalTransaction } from './JournalEntryCard';
import type { VATReportData } from '../../types/vat';
import type { SkillDraft } from '../../types/skills';
import { skillService } from '../../services/SkillService';
import { companyManager } from '../../services/CompanyService';

interface AIResponseRendererProps {
    content: string;
    metadata?: {
        type?: string;
        data?: VATReportData;
        file_url?: string;
        file_path?: string;
        file_bucket?: string;
        skillDraft?: SkillDraft;
        // Journal entry metadata
        verification_id?: string;
        entries?: JournalEntry[];
        validation?: JournalValidation;
        transaction?: JournalTransaction;
    } | null;
    fileName?: string | null;
    fileUrl?: string | null;
}

const AI_RESPONSE_CONTAINER_STYLE = {
    position: 'relative',
};

const AI_RESPONSE_COPY_LABEL_STYLE = {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    fontSize: '0.75rem',
};

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
    const [creatingSkill, setCreatingSkill] = useState(false);
    const [skillCreated, setSkillCreated] = useState(false);
    const [skillError, setSkillError] = useState<string | null>(null);
    const skillDraft = metadata?.skillDraft;
    const canCreateSkill = Boolean(skillDraft?.name && skillDraft?.description);

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

    const buildSkillDescription = (draft: SkillDraft): string => {
        const parts: string[] = [];
        if (draft.description) {
            parts.push(draft.description.trim());
        }
        if (draft.schedule) {
            parts.push(`Körs: ${draft.schedule}.`);
        }
        if (draft.data_needed && draft.data_needed.length > 0) {
            parts.push(`Behöver: ${draft.data_needed.join(', ')}.`);
        }
        return parts.join(' ').trim() || 'Automation skapad via Skill-hjälp.';
    };

    const handleCreateSkill = async () => {
        if (!skillDraft || creatingSkill) return;
        setCreatingSkill(true);
        setSkillError(null);
        try {
            const companyId = companyManager.getCurrentId();
            const description = buildSkillDescription(skillDraft);
            await skillService.createSkill(companyId, {
                name: skillDraft.name || 'Ny automation',
                description,
                kind: 'automation',
                requires_approval: skillDraft.requires_approval ?? true
            });
            setSkillCreated(true);
        } catch (error) {
            setSkillError('Kunde inte skapa automationen.');
        } finally {
            setCreatingSkill(false);
        }
    };
    // Check if this is a VAT report response - show compact inline card
    // Full report is displayed in the side panel
    const effectiveFileUrl = fileUrl || metadata?.file_url || null;

    if (metadata?.type === 'vat_report' && metadata.data) {
        const vatData = metadata.data;
        return (
            <div class="ai-response">
                {/* Compact inline summary card - full report opens in side panel */}
                <VATSummaryCard
                    period={vatData.period || 'Period okänd'}
                    netVat={vatData.vat?.net ?? 0}
                    totalIncome={vatData.summary?.total_income}
                    fullData={vatData}
                    fileUrl={effectiveFileUrl || undefined}
                    filePath={metadata.file_path}
                    fileBucket={metadata.file_bucket}
                />
            </div>
        );
    }

    // Check if this is a journal entry response - show formatted verifikat
    if (metadata?.type === 'journal_entry' && metadata.entries && metadata.validation && metadata.transaction) {
        return (
            <div class="ai-response">
                <JournalEntryCard
                    verificationId={metadata.verification_id || 'N/A'}
                    entries={metadata.entries}
                    validation={metadata.validation}
                    transaction={metadata.transaction}
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
    if (fileName && fileName.endsWith('.xlsx') && (effectiveFileUrl || metadata?.file_path)) {
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
                                    detail: {
                                        url: effectiveFileUrl || undefined,
                                        name: fileName,
                                        path: metadata?.file_path,
                                        bucket: metadata?.file_bucket
                                    }
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
        <div class="ai-response-container" style={AI_RESPONSE_CONTAINER_STYLE}>
            <div
                class="ai-response response-text"
                dangerouslySetInnerHTML={{ __html: htmlContent || markdownToHtml(content) }}
            />
            {skillDraft && canCreateSkill && (
                <div class="skill-draft-actions">
                    <div class="skill-draft-info">
                        <strong>Förslag redo</strong>
                        <span>Skapa automationen i listan.</span>
                    </div>
                    <button
                        class="skill-draft-create"
                        type="button"
                        onClick={handleCreateSkill}
                        disabled={creatingSkill || skillCreated}
                    >
                        {skillCreated ? 'Automation skapad' : creatingSkill ? 'Skapar...' : 'Skapa automation'}
                    </button>
                    {skillError && <div class="skill-draft-error">{skillError}</div>}
                </div>
            )}
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
                        <span style={AI_RESPONSE_COPY_LABEL_STYLE}>
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

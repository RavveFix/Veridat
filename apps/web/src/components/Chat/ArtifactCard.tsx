import { FunctionComponent } from 'preact';
import { useState } from 'preact/hooks';

export type ArtifactType = 'excel' | 'vat' | 'pdf' | 'code' | 'table' | 'generic';

interface ArtifactCardProps {
    type: ArtifactType;
    title: string;
    subtitle?: string;
    status?: 'success' | 'pending' | 'error';
    statusText?: string;
    defaultExpanded?: boolean;
    children?: preact.ComponentChildren;
    actions?: Array<{
        label: string;
        icon?: string;
        primary?: boolean;
        onClick: () => void;
    }>;
    onToggle?: (expanded: boolean) => void;
}

const typeIcons: Record<ArtifactType, string> = {
    excel: '📊',
    vat: '📋',
    pdf: '📄',
    code: '💻',
    table: '📋',
    generic: '📁',
};

/**
 * ArtifactCard - Displays structured AI outputs in a clean, expandable card
 * 
 * Used for Excel analysis, VAT reports, code blocks, tables, and other structured content
 * that needs visual distinction from regular chat messages.
 */
export const ArtifactCard: FunctionComponent<ArtifactCardProps> = ({
    type,
    title,
    subtitle,
    status,
    statusText,
    defaultExpanded = false,
    children,
    actions,
    onToggle,
}) => {
    const [expanded, setExpanded] = useState(defaultExpanded);
    const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

    const handleToggle = () => {
        const newState = !expanded;
        setExpanded(newState);
        onToggle?.(newState);
    };

    const handleActionClick = (action: NonNullable<ArtifactCardProps['actions']>[number], index: number) => {
        action.onClick();

        // Show copy feedback for copy-type actions
        if (action.label.toLowerCase().includes('kopier')) {
            setCopyFeedback(`action-${index}`);
            setTimeout(() => setCopyFeedback(null), 2000);
        }
    };

    return (
        <div class={`artifact-card artifact-${type} ${expanded ? 'expanded' : ''} new`}>
            {/* Header - Always visible */}
            <div class="artifact-header" onClick={handleToggle}>
                <div class="artifact-header-left">
                    <div class="artifact-icon">
                        {typeIcons[type]}
                    </div>
                    <div class="artifact-title-group">
                        <span class="artifact-title">{title}</span>
                        {subtitle && <span class="artifact-subtitle">{subtitle}</span>}
                    </div>
                </div>
                <div class="artifact-header-right">
                    {status && (
                        <span class={`artifact-status ${status}`}>
                            {status === 'success' && '✓'}
                            {status === 'pending' && '○'}
                            {status === 'error' && '!'}
                            <span>{statusText || (status === 'success' ? 'Klar' : status === 'pending' ? 'Bearbetar' : 'Fel')}</span>
                        </span>
                    )}
                    <svg class="artifact-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                </div>
            </div>

            {/* Body - Expandable */}
            <div class="artifact-body">
                {children && (
                    <div class="artifact-content">
                        {children}
                    </div>
                )}

                {/* Actions */}
                {actions && actions.length > 0 && (
                    <div class="artifact-actions">
                        {actions.map((action, index) => (
                            <button
                                key={index}
                                class={`artifact-btn ${action.primary ? 'artifact-btn-primary' : 'artifact-btn-secondary'} ${copyFeedback === `action-${index}` ? 'copied' : ''}`}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleActionClick(action, index);
                                }}
                            >
                                {copyFeedback === `action-${index}` ? (
                                    <>✓ Kopierat</>
                                ) : (
                                    <>
                                        {action.icon && <span>{action.icon}</span>}
                                        {action.label}
                                    </>
                                )}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

/**
 * Pre-configured artifact card for VAT reports
 */
interface VATArtifactProps {
    period: string;
    companyName?: string;
    totalIncome?: number;
    totalVat?: number;
    onOpen: () => void;
    onCopy?: () => void;
}

export const VATArtifact: FunctionComponent<VATArtifactProps> = ({
    period,
    companyName,
    totalIncome,
    totalVat,
    onOpen,
    onCopy,
}) => {
    const actions = [
        {
            label: 'Öppna momsredovisning',
            icon: '→',
            primary: true,
            onClick: onOpen,
        },
    ];

    if (onCopy) {
        actions.push({
            label: 'Kopiera',
            icon: '📋',
            primary: false,
            onClick: onCopy,
        });
    }

    return (
        <ArtifactCard
            type="vat"
            title={`Momsredovisning ${period}`}
            subtitle={companyName}
            status="success"
            statusText="Skapad"
            defaultExpanded={true}
            actions={actions}
        >
            {(totalIncome !== undefined || totalVat !== undefined) && (
                <div class="artifact-summary">
                    {totalIncome !== undefined && (
                        <div class="summary-stat">
                            <div class="summary-stat-value">{totalIncome.toLocaleString('sv-SE')} SEK</div>
                            <div class="summary-stat-label">Försäljning</div>
                        </div>
                    )}
                    {totalVat !== undefined && (
                        <div class="summary-stat">
                            <div class="summary-stat-value">{totalVat.toLocaleString('sv-SE')} SEK</div>
                            <div class="summary-stat-label">Moms att betala</div>
                        </div>
                    )}
                </div>
            )}
        </ArtifactCard>
    );
};

/**
 * Pre-configured artifact card for Excel analysis
 */
interface ExcelArtifactProps {
    filename: string;
    rowCount?: number;
    period?: string;
    onOpen: () => void;
    onAnalyze?: () => void;
}

export const ExcelArtifact: FunctionComponent<ExcelArtifactProps> = ({
    filename,
    rowCount,
    period,
    onOpen,
    onAnalyze,
}) => {
    const actions = [
        {
            label: 'Öppna fil',
            icon: '→',
            primary: true,
            onClick: onOpen,
        },
    ];

    if (onAnalyze) {
        actions.push({
            label: 'Analysera',
            icon: '🔍',
            primary: false,
            onClick: onAnalyze,
        });
    }

    return (
        <ArtifactCard
            type="excel"
            title={filename}
            subtitle="Excel-fil"
            status="success"
            actions={actions}
        >
            {(rowCount !== undefined || period) && (
                <div class="artifact-summary">
                    {rowCount !== undefined && (
                        <div class="summary-stat">
                            <div class="summary-stat-value">{rowCount.toLocaleString('sv-SE')}</div>
                            <div class="summary-stat-label">Rader</div>
                        </div>
                    )}
                    {period && (
                        <div class="summary-stat">
                            <div class="summary-stat-value">{period}</div>
                            <div class="summary-stat-label">Period</div>
                        </div>
                    )}
                </div>
            )}
        </ArtifactCard>
    );
};

/**
 * Pre-configured artifact card for code blocks
 */
interface CodeArtifactProps {
    language: string;
    code: string;
    filename?: string;
}

export const CodeArtifact: FunctionComponent<CodeArtifactProps> = ({
    language,
    code,
    filename,
}) => {
    const handleCopy = () => {
        navigator.clipboard.writeText(code);
    };

    return (
        <ArtifactCard
            type="code"
            title={filename || language}
            subtitle={filename ? language : undefined}
            defaultExpanded={true}
            actions={[
                {
                    label: 'Kopiera kod',
                    icon: '📋',
                    primary: false,
                    onClick: handleCopy,
                },
            ]}
        >
            <pre><code>{code}</code></pre>
        </ArtifactCard>
    );
};

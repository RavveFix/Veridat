import { FunctionComponent } from 'preact';
import { useState } from 'preact/hooks';
import type { VATReportData } from '../../types/vat';
import { generateExcelFile, copyReportToClipboard } from '../../utils/excelExport';

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
 * Pre-configured artifact card for VAT reports - Inline expandable version
 * Shows full VAT report directly in the chat without needing a side panel
 */
interface VATArtifactProps {
    period: string;
    companyName?: string;
    totalIncome?: number;
    totalCosts?: number;
    totalVat?: number;
    /** Full VAT report data for inline display */
    fullData?: VATReportData;
    /** Legacy: opens side panel (optional - kept for backwards compat) */
    onOpen?: () => void;
    onCopy?: () => void;
}

type VATTab = 'overview' | 'sales' | 'costs' | 'journal';

export const VATArtifact: FunctionComponent<VATArtifactProps> = ({
    period,
    companyName,
    totalIncome,
    totalCosts,
    totalVat,
    fullData,
    onOpen,
    onCopy,
}) => {
    const [activeTab, setActiveTab] = useState<VATTab>('overview');
    const [downloadLoading, setDownloadLoading] = useState(false);
    const [downloadSuccess, setDownloadSuccess] = useState(false);
    const [copySuccess, setCopySuccess] = useState(false);

    // Determine VAT label based on positive/negative value
    const vatLabel = totalVat !== undefined && totalVat < 0 ? 'Moms att återfå' : 'Moms att betala';
    const vatDisplayValue = totalVat !== undefined ? Math.abs(totalVat) : undefined;

    const handleDownload = async () => {
        if (!fullData || downloadLoading) return;
        setDownloadLoading(true);
        try {
            await generateExcelFile(fullData);
            setDownloadSuccess(true);
            setTimeout(() => {
                setDownloadLoading(false);
                setDownloadSuccess(false);
            }, 2000);
        } catch (error) {
            console.error('Excel generation failed:', error);
            setDownloadLoading(false);
        }
    };

    const handleCopy = () => {
        if (fullData) {
            copyReportToClipboard(fullData);
        } else if (onCopy) {
            onCopy();
        }
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 2000);
    };

    // Build actions based on available features
    const actions: Array<{ label: string; icon?: string; primary?: boolean; onClick: () => void }> = [];

    if (fullData) {
        actions.push({
            label: downloadLoading ? 'Laddar...' : downloadSuccess ? '✓ Nedladdad!' : 'Ladda ner Excel',
            icon: '📥',
            primary: true,
            onClick: handleDownload,
        });
    } else if (onOpen) {
        // Legacy: open side panel if no full data
        actions.push({
            label: 'Öppna momsredovisning',
            icon: '→',
            primary: true,
            onClick: onOpen,
        });
    }

    actions.push({
        label: copySuccess ? '✓ Kopierat!' : 'Kopiera',
        icon: '📋',
        primary: false,
        onClick: handleCopy,
    });

    return (
        <div class="vat-artifact-inline">
            <ArtifactCard
                type="vat"
                title={`Momsredovisning ${period}`}
                subtitle={companyName}
                status="success"
                statusText="Validerad"
                defaultExpanded={true}
                actions={actions}
            >
                {/* Summary Cards - Always visible */}
                {(totalIncome !== undefined || totalCosts !== undefined || totalVat !== undefined) && (
                    <div class="artifact-summary three-col">
                        {totalIncome !== undefined && (
                            <div class="summary-stat income">
                                <div class="summary-stat-value">{totalIncome.toLocaleString('sv-SE')} SEK</div>
                                <div class="summary-stat-label">Försäljning</div>
                            </div>
                        )}
                        {totalCosts !== undefined && (
                            <div class="summary-stat costs">
                                <div class="summary-stat-value">{totalCosts.toLocaleString('sv-SE')} SEK</div>
                                <div class="summary-stat-label">Kostnader</div>
                            </div>
                        )}
                        {vatDisplayValue !== undefined && (
                            <div class={`summary-stat vat ${totalVat && totalVat < 0 ? 'refund' : 'pay'}`}>
                                <div class="summary-stat-value">{vatDisplayValue.toLocaleString('sv-SE')} SEK</div>
                                <div class="summary-stat-label">{vatLabel}</div>
                            </div>
                        )}
                    </div>
                )}

                {/* Inline Details - Only if fullData is provided */}
                {fullData && (
                    <div class="vat-inline-details">
                        {/* Tabs Navigation */}
                        <div class="vat-tabs">
                            <button
                                class={`vat-tab ${activeTab === 'overview' ? 'active' : ''}`}
                                onClick={() => setActiveTab('overview')}
                            >
                                Moms
                            </button>
                            <button
                                class={`vat-tab ${activeTab === 'sales' ? 'active' : ''}`}
                                onClick={() => setActiveTab('sales')}
                            >
                                Försäljning ({fullData.sales?.length || 0})
                            </button>
                            <button
                                class={`vat-tab ${activeTab === 'costs' ? 'active' : ''}`}
                                onClick={() => setActiveTab('costs')}
                            >
                                Kostnader ({fullData.costs?.length || 0})
                            </button>
                            <button
                                class={`vat-tab ${activeTab === 'journal' ? 'active' : ''}`}
                                onClick={() => setActiveTab('journal')}
                            >
                                Bokföring ({fullData.journal_entries?.length || 0})
                            </button>
                        </div>

                        {/* Tab Content */}
                        <div class="vat-tab-content">
                            {activeTab === 'overview' && (
                                <VATOverviewTab vat={fullData.vat} validation={fullData.validation} />
                            )}
                            {activeTab === 'sales' && (
                                <TransactionsTab
                                    transactions={fullData.sales}
                                    type="sales"
                                />
                            )}
                            {activeTab === 'costs' && (
                                <TransactionsTab
                                    transactions={fullData.costs}
                                    type="costs"
                                />
                            )}
                            {activeTab === 'journal' && (
                                <JournalTab entries={fullData.journal_entries} />
                            )}
                        </div>
                    </div>
                )}
            </ArtifactCard>
        </div>
    );
};

/**
 * VAT Overview Tab - Shows VAT breakdown
 */
const VATOverviewTab: FunctionComponent<{
    vat: VATReportData['vat'];
    validation?: VATReportData['validation'];
}> = ({ vat, validation }) => {
    if (!vat) return null;

    const netVat = vat.net ?? 0;
    const isRefund = netVat < 0;

    return (
        <div class="vat-overview-tab">
            <div class="vat-breakdown">
                <div class="vat-row">
                    <span>Utgående moms 25%:</span>
                    <span class="vat-amount">{(vat.outgoing_25 ?? 0).toFixed(2)} SEK</span>
                </div>
                {(vat.outgoing_12 ?? 0) > 0 && (
                    <div class="vat-row">
                        <span>Utgående moms 12%:</span>
                        <span class="vat-amount">{vat.outgoing_12!.toFixed(2)} SEK</span>
                    </div>
                )}
                {(vat.outgoing_6 ?? 0) > 0 && (
                    <div class="vat-row">
                        <span>Utgående moms 6%:</span>
                        <span class="vat-amount">{vat.outgoing_6!.toFixed(2)} SEK</span>
                    </div>
                )}
                <div class="vat-row">
                    <span>Ingående moms:</span>
                    <span class="vat-amount negative">{(vat.incoming ?? 0).toFixed(2)} SEK</span>
                </div>
                <div class={`vat-row total ${isRefund ? 'refund' : 'pay'}`}>
                    <span>{isRefund ? 'Att återfå:' : 'Att betala:'}</span>
                    <span class="vat-amount">{Math.abs(netVat).toFixed(2)} SEK</span>
                </div>
            </div>

            {/* Validation warnings */}
            {validation && (validation.warnings?.length > 0 || validation.errors?.length > 0) && (
                <div class="vat-validation">
                    {validation.errors?.map((error, i) => (
                        <div key={i} class="validation-item error">
                            <span class="validation-icon">⚠️</span>
                            <span>{error}</span>
                        </div>
                    ))}
                    {validation.warnings?.map((warning, i) => (
                        <div key={i} class="validation-item warning">
                            <span class="validation-icon">⚡</span>
                            <span>{warning}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

/**
 * Transactions Tab - Shows sales or costs
 */
const TransactionsTab: FunctionComponent<{
    transactions?: Array<{ description: string; net: number; vat: number; rate: number }>;
    type: 'sales' | 'costs';
}> = ({ transactions, type }) => {
    if (!transactions || transactions.length === 0) {
        return (
            <div class="empty-tab">
                Inga {type === 'sales' ? 'försäljningstransaktioner' : 'kostnader'} hittades.
            </div>
        );
    }

    return (
        <div class="transactions-tab">
            <table class="transactions-table">
                <thead>
                    <tr>
                        <th>Beskrivning</th>
                        <th class="num">Netto</th>
                        <th class="num">Moms</th>
                        <th class="num">%</th>
                    </tr>
                </thead>
                <tbody>
                    {transactions.map((tx, i) => (
                        <tr key={i}>
                            <td>{tx.description}</td>
                            <td class="num">{tx.net.toLocaleString('sv-SE', { minimumFractionDigits: 2 })}</td>
                            <td class="num">{tx.vat.toLocaleString('sv-SE', { minimumFractionDigits: 2 })}</td>
                            <td class="num">{tx.rate}%</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

/**
 * Journal Tab - Shows accounting entries
 */
const JournalTab: FunctionComponent<{
    entries?: Array<{ account: string; name: string; debit: number; credit: number }>;
}> = ({ entries }) => {
    if (!entries || entries.length === 0) {
        return <div class="empty-tab">Inga bokföringsposter genererade.</div>;
    }

    return (
        <div class="journal-tab">
            <table class="journal-table">
                <thead>
                    <tr>
                        <th>Konto</th>
                        <th>Benämning</th>
                        <th class="num">Debet</th>
                        <th class="num">Kredit</th>
                    </tr>
                </thead>
                <tbody>
                    {entries.map((entry, i) => (
                        <tr key={i}>
                            <td class="account">{entry.account}</td>
                            <td>{entry.name}</td>
                            <td class="num debit">{entry.debit > 0 ? entry.debit.toLocaleString('sv-SE', { minimumFractionDigits: 2 }) : ''}</td>
                            <td class="num credit">{entry.credit > 0 ? entry.credit.toLocaleString('sv-SE', { minimumFractionDigits: 2 }) : ''}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
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

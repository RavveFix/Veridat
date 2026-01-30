import { FunctionComponent } from 'preact';
import type { VATReportData, ValidationResult, VATSummary, SalesTransaction, CostTransaction, ZeroVATWarning, JournalEntry } from '../types/vat';
import { BAS_ACCOUNT_INFO } from '../types/vat';
import { generateExcelFile, copyReportToClipboard } from '../utils/excelExport';
import { useState, useEffect } from 'preact/hooks';
import { supabase } from '../lib/supabase';
import { BorderBeam } from '@/registry/magicui/border-beam';

// Fortnox sync status types
interface FortnoxSyncStatus {
    status: 'not_synced' | 'pending' | 'in_progress' | 'success' | 'failed' | null;
    fortnoxDocumentNumber: string | null;
    fortnoxVoucherSeries: string | null;
    syncedAt: string | null;
    errorMessage?: string;
}

type TabId = 'summary' | 'transactions' | 'journal';

interface VATReportCardProps {
    data: VATReportData;
    reportId?: string;
    onFortnoxExport?: (reportId: string) => Promise<void>;
    initialTab?: TabId;
}

/**
 * Preact version of VATReportCard component
 * Migrated from vanilla TS for better maintainability and reusability
 * Extended with Fortnox export status for BFL compliance
 */
export const VATReportCard: FunctionComponent<VATReportCardProps> = ({ data, reportId, onFortnoxExport, initialTab = 'summary' }) => {
    const [downloadLoading, setDownloadLoading] = useState(false);
    const [downloadSuccess, setDownloadSuccess] = useState(false);
    const [downloadError, setDownloadError] = useState(false);
    const [copySuccess, setCopySuccess] = useState(false);
    const [activeTab, setActiveTab] = useState<TabId>(initialTab);

    // Fortnox sync state
    const [fortnoxStatus, setFortnoxStatus] = useState<FortnoxSyncStatus>({
        status: null,
        fortnoxDocumentNumber: null,
        fortnoxVoucherSeries: null,
        syncedAt: null,
    });
    const [fortnoxLoading, setFortnoxLoading] = useState(false);
    const [fortnoxError, setFortnoxError] = useState<string | null>(null);

    // Listen for tab change events from ExcelWorkspace
    useEffect(() => {
        const handleTabChange = (e: Event) => {
            const event = e as CustomEvent<{ tab: TabId }>;
            if (event.detail?.tab) {
                setActiveTab(event.detail.tab);
            }
        };

        window.addEventListener('panel-tab-change', handleTabChange);
        return () => window.removeEventListener('panel-tab-change', handleTabChange);
    }, []);

    // Fetch Fortnox sync status on mount
    useEffect(() => {
        if (reportId) {
            fetchFortnoxSyncStatus(reportId);
        }
    }, [reportId]);

    const fetchFortnoxSyncStatus = async (vatReportId: string) => {
        try {
            const { data: session } = await supabase.auth.getSession();
            if (!session?.session?.access_token) return;

            const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fortnox`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.session.access_token}`,
                },
                body: JSON.stringify({
                    action: 'getVATReportSyncStatus',
                    payload: { vatReportId },
                }),
            });

            if (response.ok) {
                const result = await response.json();
                setFortnoxStatus({
                    status: result.status || 'not_synced',
                    fortnoxDocumentNumber: result.fortnoxDocumentNumber,
                    fortnoxVoucherSeries: result.fortnoxVoucherSeries,
                    syncedAt: result.syncedAt,
                });
            }
        } catch (error) {
            console.error('Failed to fetch Fortnox sync status:', error);
        }
    };

    const handleFortnoxExport = async () => {
        if (!reportId || fortnoxLoading) return;

        setFortnoxLoading(true);
        setFortnoxError(null);

        try {
            if (onFortnoxExport) {
                await onFortnoxExport(reportId);
            } else {
                // Default export implementation
                const { data: session } = await supabase.auth.getSession();
                if (!session?.session?.access_token) {
                    throw new Error('Inte inloggad');
                }

                // Build voucher data from journal entries
                const voucherRows = data.journal_entries.map(entry => ({
                    Account: parseInt(entry.account),
                    Debit: entry.debit > 0 ? entry.debit : undefined,
                    Credit: entry.credit > 0 ? entry.credit : undefined,
                    Description: entry.name,
                }));

                const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fortnox`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${session.session.access_token}`,
                    },
                    body: JSON.stringify({
                        action: 'exportVoucher',
                        companyId: data.company?.org_number || 'unknown',
                        payload: {
                            vatReportId: reportId,
                            voucher: {
                                Description: `Momsredovisning ${data.period}`,
                                TransactionDate: new Date().toISOString().split('T')[0],
                                VoucherSeries: 'A',
                                VoucherRows: voucherRows,
                            },
                        },
                    }),
                });

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(errorData.error || 'Export till Fortnox misslyckades');
                }

                const result = await response.json();
                setFortnoxStatus({
                    status: 'success',
                    fortnoxDocumentNumber: String(result.Voucher?.VoucherNumber || ''),
                    fortnoxVoucherSeries: result.Voucher?.VoucherSeries || 'A',
                    syncedAt: new Date().toISOString(),
                });
            }

            // Refresh status after export
            await fetchFortnoxSyncStatus(reportId);
        } catch (error) {
            console.error('Fortnox export failed:', error);
            setFortnoxError(error instanceof Error ? error.message : 'Export misslyckades');
            setFortnoxStatus(prev => ({ ...prev, status: 'failed' }));
        } finally {
            setFortnoxLoading(false);
        }
    };

    const handleDownload = async () => {
        if (downloadLoading) return;

        setDownloadLoading(true);
        setDownloadSuccess(false);
        setDownloadError(false);

        try {
            await generateExcelFile(data);
            setDownloadSuccess(true);
            setTimeout(() => {
                setDownloadLoading(false);
                setDownloadSuccess(false);
            }, 2000);
        } catch (error) {
            console.error('Excel generation failed:', error);
            setDownloadError(true);
            setTimeout(() => {
                setDownloadLoading(false);
                setDownloadError(false);
            }, 2000);
        }
    };

    const handleCopy = () => {
        copyReportToClipboard(data);
        setCopySuccess(true);
        setTimeout(() => {
            setCopySuccess(false);
        }, 2000);
    };

    return (
        <div class="vat-report-card">
            <BorderBeam 
                size={200} 
                duration={10} 
                delay={0}
                colorFrom="var(--accent-primary)"
                colorTo="var(--accent-secondary)"
            />
            {/* Header */}
            <div class="card-header">
                <div class="header-left">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                        <polyline points="14 2 14 8 20 8"></polyline>
                        <line x1="16" y1="13" x2="8" y2="13"></line>
                        <line x1="16" y1="17" x2="8" y2="17"></line>
                    </svg>
                    <h3>Momsredovisning {data.period}</h3>
                </div>
                <ValidationBadges validation={data.validation} />
            </div>

            {/* Summary Tab Content */}
            <div class={`tab-content ${activeTab === 'summary' ? 'active' : ''}`}>
                {/* Company Info */}
                <div class="company-info">
                    <div class="company-name">{data.company?.name || 'N/A'}</div>
                    <div class="org-number">Org.nr: {data.company?.org_number || 'N/A'}</div>
                </div>

                {/* Summary Grid */}
                <div class="summary-grid">
                    <div class="summary-card income">
                        <div class="summary-label">Försäljning</div>
                        <div class="summary-amount positive">{data.summary.total_income.toFixed(2)} SEK</div>
                    </div>
                    <div class="summary-card costs">
                        <div class="summary-label">Kostnader</div>
                        <div class="summary-amount negative">{data.summary.total_costs.toFixed(2)} SEK</div>
                    </div>
                    <div class="summary-card result">
                        <div class="summary-label">Resultat</div>
                        <div class={`summary-amount ${data.summary.result >= 0 ? 'positive' : 'negative'}`}>
                            {data.summary.result.toFixed(2)} SEK
                        </div>
                    </div>
                </div>

                {/* VAT Panel */}
                <div class="vat-panel">
                    <h4>Momsredovisning</h4>
                    <VATDetails vat={data.vat} />
                </div>

                {/* Warnings Panel */}
                <WarningsPanel validation={data.validation} />

                {/* Fortnox Export Status */}
                {reportId && (
                    <FortnoxSyncStatusPanel
                        status={fortnoxStatus}
                        loading={fortnoxLoading}
                        error={fortnoxError}
                        onExport={handleFortnoxExport}
                    />
                )}
            </div>

            {/* Transactions Tab Content */}
            <div class={`tab-content ${activeTab === 'transactions' ? 'active' : ''}`}>
                {/* Sales Transactions */}
                <details class="transactions-section" open>
                    <summary>Försäljning ({data.sales.length} transaktioner)</summary>
                    <div class="transactions-list">
                        <TransactionsList transactions={data.sales} />
                    </div>
                </details>

                {/* Cost Transactions */}
                <details class="transactions-section" open>
                    <summary>Kostnader ({data.costs.length} transaktioner)</summary>
                    <div class="transactions-list">
                        <TransactionsList transactions={data.costs} />
                    </div>
                </details>
            </div>

            {/* Journal Tab Content */}
            <div class={`tab-content ${activeTab === 'journal' ? 'active' : ''}`}>
                {/* Journal Entries with BAS tooltips */}
                <div class="journal-section">
                    <h4>Bokföringsförslag ({data.journal_entries.length} poster)</h4>
                    <div class="journal-entries-list">
                        <JournalEntriesList entries={data.journal_entries} />
                    </div>
                </div>
            </div>

            {/* Action Buttons - Always visible */}
            <div class="action-buttons">
                <button
                    class={`btn-primary ${downloadSuccess ? 'success' : ''} ${downloadError ? 'error' : ''}`}
                    onClick={handleDownload}
                    disabled={downloadLoading}
                >
                    {downloadLoading ? (
                        <span>Genererar Excel...</span>
                    ) : downloadSuccess ? (
                        '✓ Nedladdad!'
                    ) : downloadError ? (
                        'Fel vid nedladdning'
                    ) : (
                        <>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                <polyline points="7 10 12 15 17 10"></polyline>
                                <line x1="12" y1="15" x2="12" y2="3"></line>
                            </svg>
                            Ladda ner Excel
                        </>
                    )}
                </button>
                <button class="btn-secondary" onClick={handleCopy}>
                    {copySuccess ? '✓ Kopierat!' : 'Kopiera sammanfattning'}
                </button>
            </div>
        </div>
    );
};

/**
 * Validation badges component
 */
const ValidationBadges: FunctionComponent<{ validation: ValidationResult }> = ({ validation }) => {
    if (!validation) return <div class="validation-badges"></div>;

    return (
        <div class="validation-badges">
            {validation.is_valid && <span class="badge success">✓ Validerad</span>}
            {validation.errors && validation.errors.length > 0 && (
                <span class="badge error">{validation.errors.length} fel</span>
            )}
            {validation.warnings && validation.warnings.length > 0 && (
                <span class="badge warning">{validation.warnings.length} varningar</span>
            )}
        </div>
    );
};

/**
 * VAT details component
 */
const VATDetails: FunctionComponent<{ vat: VATSummary }> = ({ vat }) => {
    return (
        <div class="vat-details">
            <div class="vat-row">
                <span>Utgående moms 25%:</span>
                <span>{(vat.outgoing_25 ?? 0).toFixed(2)} SEK</span>
            </div>
            {(vat.outgoing_12 ?? 0) > 0 && (
                <div class="vat-row">
                    <span>Utgående moms 12%:</span>
                    <span>{vat.outgoing_12!.toFixed(2)} SEK</span>
                </div>
            )}
            {(vat.outgoing_6 ?? 0) > 0 && (
                <div class="vat-row">
                    <span>Utgående moms 6%:</span>
                    <span>{vat.outgoing_6!.toFixed(2)} SEK</span>
                </div>
            )}
            <div class="vat-row">
                <span>Ingående moms:</span>
                <span>{(vat.incoming ?? 0).toFixed(2)} SEK</span>
            </div>
            <div class="vat-row vat-total">
                <span>Att {vat.net >= 0 ? 'betala' : 'återfå'}:</span>
                <span class="vat-net-amount">{Math.abs(vat.net).toFixed(2)} SEK</span>
            </div>
        </div>
    );
};

/**
 * Transactions list component
 */
const TransactionsList: FunctionComponent<{
    transactions: SalesTransaction[] | CostTransaction[]
}> = ({ transactions }) => {
    if (!transactions || transactions.length === 0) {
        return <div class="no-transactions">Inga transaktioner</div>;
    }

    return (
        <>
            {transactions.map((t, index) => (
                <div key={index} class="transaction-row">
                    <span class="transaction-desc">{t.description}</span>
                    <span class="transaction-amount">
                        {t.net.toFixed(2)} SEK ({t.rate}% moms)
                    </span>
                </div>
            ))}
        </>
    );
};

/**
 * Journal entries list with BAS account tooltips
 */
const JournalEntriesList: FunctionComponent<{
    entries: JournalEntry[]
}> = ({ entries }) => {
    if (!entries || entries.length === 0) {
        return <div class="no-transactions">Inga bokföringsförslag</div>;
    }

    return (
        <div class="journal-entries">
            <div class="journal-header">
                <span>Konto</span>
                <span>Namn</span>
                <span>Debet</span>
                <span>Kredit</span>
            </div>
            {entries.map((entry, index) => (
                <div key={index} class="journal-row">
                    <span
                        class="account-with-tooltip"
                        title={BAS_ACCOUNT_INFO[entry.account] || entry.name}
                    >
                        {entry.account}
                        {BAS_ACCOUNT_INFO[entry.account] && <span class="tooltip-icon">i</span>}
                    </span>
                    <span class="journal-name">{entry.name}</span>
                    <span class="journal-debit">
                        {entry.debit > 0 ? entry.debit.toFixed(2) : '-'}
                    </span>
                    <span class="journal-credit">
                        {entry.credit > 0 ? entry.credit.toFixed(2) : '-'}
                    </span>
                </div>
            ))}
        </div>
    );
};

/**
 * Warnings panel component
 */
const WarningsPanel: FunctionComponent<{ validation: ValidationResult }> = ({ validation }) => {
    const zeroVatWarnings = validation?.zero_vat_warnings || [];
    const hasWarnings = (validation?.warnings?.length || 0) > 0 || zeroVatWarnings.length > 0;
    const hasErrors = (validation?.errors?.length || 0) > 0;

    if (!hasWarnings && !hasErrors) return null;

    // Group zero VAT warnings by level
    const grouped = {
        error: zeroVatWarnings.filter(w => w.level === 'error'),
        warning: zeroVatWarnings.filter(w => w.level === 'warning'),
        info: zeroVatWarnings.filter(w => w.level === 'info')
    };

    return (
        <div class="warnings-panel">
            <h4>Granskningsresultat</h4>

            {/* Validation errors */}
            {hasErrors && (
                <div class="warning-section error">
                    <h5>Fel ({validation.errors.length})</h5>
                    {validation.errors.map((err, i) => (
                        <div key={i} class="warning-item error">
                            <p>{typeof err === 'string' ? err : JSON.stringify(err)}</p>
                        </div>
                    ))}
                </div>
            )}

            {/* Zero VAT warnings */}
            {grouped.warning.length > 0 && (
                <div class="warning-section warning">
                    <h5>Varningar ({grouped.warning.length})</h5>
                    {grouped.warning.map((w, i) => (
                        <WarningItem key={i} warning={w} />
                    ))}
                </div>
            )}

            {/* Zero VAT info */}
            {grouped.info.length > 0 && (
                <div class="warning-section info">
                    <h5>Information ({grouped.info.length})</h5>
                    {grouped.info.map((w, i) => (
                        <WarningItem key={i} warning={w} />
                    ))}
                </div>
            )}

            {/* General warnings */}
            {(validation?.warnings?.length || 0) > 0 && (
                <div class="warning-section warning">
                    <h5>Beräkningsvarningar ({validation.warnings.length})</h5>
                    {validation.warnings.map((warn, i) => (
                        <div key={i} class="warning-item warning">
                            <p>{typeof warn === 'string' ? warn : JSON.stringify(warn)}</p>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

/**
 * Individual warning item component
 */
const WarningItem: FunctionComponent<{ warning: ZeroVATWarning }> = ({ warning }) => (
    <div class={`warning-item ${warning.level}`}>
        <span class="warning-code">{warning.code}</span>
        <p>{warning.message}</p>
        {warning.suggestion && (
            <p class="suggestion">{warning.suggestion}</p>
        )}
        {warning.transaction_id && (
            <span class="transaction-ref">ID: {warning.transaction_id}</span>
        )}
    </div>
);

/**
 * Fortnox sync status panel component
 * Shows export status and provides export button
 */
const FortnoxSyncStatusPanel: FunctionComponent<{
    status: FortnoxSyncStatus;
    loading: boolean;
    error: string | null;
    onExport: () => void;
}> = ({ status, loading, error, onExport }) => {
    const formatDate = (dateStr: string | null) => {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        return date.toLocaleDateString('sv-SE', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    const getStatusIcon = () => {
        switch (status.status) {
            case 'success':
                return (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                        <polyline points="22 4 12 14.01 9 11.01"></polyline>
                    </svg>
                );
            case 'failed':
                return (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="15" y1="9" x2="9" y2="15"></line>
                        <line x1="9" y1="9" x2="15" y2="15"></line>
                    </svg>
                );
            case 'pending':
            case 'in_progress':
                return (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" class="spin">
                        <circle cx="12" cy="12" r="10"></circle>
                        <polyline points="12 6 12 12 16 14"></polyline>
                    </svg>
                );
            default:
                return (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="2">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="8" x2="12" y2="12"></line>
                        <line x1="12" y1="16" x2="12.01" y2="16"></line>
                    </svg>
                );
        }
    };

    const getStatusText = () => {
        switch (status.status) {
            case 'success':
                return `Exporterad som ${status.fortnoxVoucherSeries}-${status.fortnoxDocumentNumber}`;
            case 'failed':
                return 'Export misslyckades';
            case 'pending':
                return 'Väntar på export...';
            case 'in_progress':
                return 'Exporterar...';
            default:
                return 'Ej exporterad till Fortnox';
        }
    };

    return (
        <div class={`fortnox-sync-panel ${status.status || 'not_synced'}`}>
            <div class="fortnox-header">
                <div class="fortnox-logo">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                        <rect width="24" height="24" rx="4" fill="#1B365D"/>
                        <text x="12" y="16" text-anchor="middle" fill="white" font-size="10" font-weight="bold">FX</text>
                    </svg>
                    <span>Fortnox Integration</span>
                </div>
                <div class="fortnox-status">
                    {getStatusIcon()}
                    <span class="status-text">{getStatusText()}</span>
                </div>
            </div>

            {status.status === 'success' && status.syncedAt && (
                <div class="fortnox-details">
                    <span class="sync-date">Exporterad {formatDate(status.syncedAt)}</span>
                    <a
                        href={`https://apps.fortnox.se/vouchers/${status.fortnoxVoucherSeries}/${status.fortnoxDocumentNumber}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="fortnox-link"
                    >
                        Öppna i Fortnox →
                    </a>
                </div>
            )}

            {error && (
                <div class="fortnox-error">
                    <span>{error}</span>
                </div>
            )}

            {(status.status === null || status.status === 'not_synced' || status.status === 'failed') && (
                <button
                    class="btn-fortnox"
                    onClick={onExport}
                    disabled={loading}
                >
                    {loading ? (
                        <>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin">
                                <circle cx="12" cy="12" r="10"></circle>
                                <path d="M12 2a10 10 0 0 1 10 10"></path>
                            </svg>
                            Exporterar...
                        </>
                    ) : (
                        <>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                <polyline points="17 8 12 3 7 8"></polyline>
                                <line x1="12" y1="3" x2="12" y2="15"></line>
                            </svg>
                            {status.status === 'failed' ? 'Försök igen' : 'Exportera till Fortnox'}
                        </>
                    )}
                </button>
            )}
        </div>
    );
};

import { FunctionComponent } from 'preact';
import type { VATReportData } from '../types/vat';
import { generateExcelFile, copyReportToClipboard } from '../utils/excelExport';
import { useState, useEffect } from 'preact/hooks';
import { supabase } from '../lib/supabase';
import { logger } from '../services/LoggerService';
import { BorderBeam } from '@/registry/magicui/border-beam';
import { ValidationBadges } from './vat/ValidationBadges';
import { VATDetails } from './vat/VATDetails';
import { TransactionsList } from './vat/TransactionsList';
import { JournalEntriesList } from './vat/JournalEntriesList';
import { WarningsPanel } from './vat/WarningsPanel';
import { FortnoxSyncStatusPanel, type FortnoxSyncStatus } from './vat/FortnoxSyncStatusPanel';
import { getFortnoxErrorMessage } from '../utils/fortnoxErrors';

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
    const [fortnoxStatusLoading, setFortnoxStatusLoading] = useState(false);
    const [voucherSeries, setVoucherSeries] = useState('A');

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
        setFortnoxStatusLoading(true);
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
            logger.error('Failed to fetch Fortnox sync status:', error);
            setFortnoxError('Kunde inte hämta Fortnox-status');
        } finally {
            setFortnoxStatusLoading(false);
        }
    };

    const handleFortnoxExport = async () => {
        if (!reportId || fortnoxLoading) return;

        // Duplicate prevention: confirm if already exported
        if (fortnoxStatus.status === 'success' && fortnoxStatus.fortnoxDocumentNumber) {
            const ok = window.confirm(
                `Denna rapport är redan exporterad till Fortnox ` +
                `(Verifikat ${fortnoxStatus.fortnoxVoucherSeries || 'A'}-${fortnoxStatus.fortnoxDocumentNumber}). ` +
                `Vill du exportera igen?`
            );
            if (!ok) return;
        }

        // Disclaimer: user must confirm before export
        const confirmed = window.confirm(
            'Kontrollera att uppgifterna stämmer innan du exporterar.\n\n' +
            'Veridat är en AI-assistent — alla bokföringsförslag bör granskas.\n' +
            'Du som företagare ansvarar för att bokföringen är korrekt.\n\n' +
            'Vill du exportera till Fortnox?'
        );
        if (!confirmed) return;

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

                // Check Fortnox token exists
                const { data: tokenData } = await supabase
                    .from('fortnox_tokens')
                    .select('expires_at')
                    .maybeSingle();

                if (!tokenData) {
                    throw new Error('Fortnox är inte anslutet. Gå till Integrationer för att ansluta.');
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
                            idempotencyKey: `vat_export:${reportId}:${data.period}:${voucherSeries}`,
                            sourceContext: 'vat-report-card',
                            vatReportId: reportId,
                            voucher: {
                                Description: `Momsredovisning ${data.period}`,
                                TransactionDate: new Date().toISOString().split('T')[0],
                                VoucherSeries: voucherSeries,
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
                    fortnoxVoucherSeries: result.Voucher?.VoucherSeries || voucherSeries,
                    syncedAt: new Date().toISOString(),
                });
            }

            // Refresh status after export
            await fetchFortnoxSyncStatus(reportId);
        } catch (error) {
            logger.error('Fortnox export failed:', error);
            setFortnoxError(getFortnoxErrorMessage(error));
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
            logger.error('Excel generation failed:', error);
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

    const formatAmount = (value: number) =>
        value.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
            <div class="card-divider" aria-hidden="true"></div>

            {/* Summary Tab Content */}
            <div class={`tab-content ${activeTab === 'summary' ? 'active' : ''}`}>
                {/* Company Info */}
                <div class="company-info report-section">
                    <div class="company-name">{data.company?.name || 'N/A'}</div>
                    <div class="org-number">Org.nr: {data.company?.org_number || 'N/A'}</div>
                </div>

                {/* Summary Grid */}
                <div class="summary-grid report-section">
                    <div class="summary-card income card-surface">
                        <div class="summary-label">Försäljning</div>
                        <div class="summary-amount positive">{formatAmount(data.summary.total_income)} SEK</div>
                    </div>
                    <div class="summary-card costs card-surface">
                        <div class="summary-label">Kostnader</div>
                        <div class="summary-amount negative">{formatAmount(data.summary.total_costs)} SEK</div>
                    </div>
                    <div class="summary-card result card-surface">
                        <div class="summary-label">Resultat</div>
                        <div class={`summary-amount ${data.summary.result >= 0 ? 'positive' : 'negative'}`}>
                            {formatAmount(data.summary.result)} SEK
                        </div>
                    </div>
                </div>

                {data.analysis_summary && (
                    <div class="analysis-summary card-surface report-section">
                        <div class="analysis-header">
                            <h4>Analysöversikt</h4>
                            <span>{data.analysis_summary.total_transactions} transaktioner</span>
                        </div>
                        <div class="analysis-stats-grid">
                            <div class="analysis-stat card-surface">
                                <div class="analysis-stat-label">0% moms</div>
                                <div class="analysis-stat-value">{formatAmount(data.analysis_summary.zero_vat_amount)} SEK</div>
                                <div class="analysis-stat-meta">{data.analysis_summary.zero_vat_count} rader</div>
                            </div>
                            <div class="analysis-stat card-surface">
                                <div class="analysis-stat-label">Försäljning</div>
                                <div class="analysis-stat-value">{data.analysis_summary.revenue_transactions}</div>
                                <div class="analysis-stat-meta">rader</div>
                            </div>
                            <div class="analysis-stat card-surface">
                                <div class="analysis-stat-label">Kostnader</div>
                                <div class="analysis-stat-value">{data.analysis_summary.cost_transactions}</div>
                                <div class="analysis-stat-meta">rader</div>
                            </div>
                        </div>
                        <div class="analysis-lists">
                            <div class="analysis-list card-surface">
                                <div class="analysis-list-title">Största kostnader</div>
                                {data.analysis_summary.top_costs.length === 0 ? (
                                    <div class="analysis-empty">Inga kostnader hittades</div>
                                ) : data.analysis_summary.top_costs.map(item => (
                                    <div class="analysis-list-item" key={`cost-${item.label}-${item.amount}-${item.count}`}>
                                        <span>{item.label}</span>
                                        <span>{formatAmount(item.amount)} SEK</span>
                                    </div>
                                ))}
                            </div>
                            <div class="analysis-list card-surface">
                                <div class="analysis-list-title">Största intäkter</div>
                                {data.analysis_summary.top_revenues.length === 0 ? (
                                    <div class="analysis-empty">Inga intäkter hittades</div>
                                ) : data.analysis_summary.top_revenues.map(item => (
                                    <div class="analysis-list-item" key={`rev-${item.label}-${item.amount}-${item.count}`}>
                                        <span>{item.label}</span>
                                        <span>{formatAmount(item.amount)} SEK</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {data.analysis_summary?.monta && (
                    <div class="analysis-summary monta-summary card-surface report-section">
                        <div class="analysis-header">
                            <h4>Monta-sammanfattning</h4>
                            <span>Avgifter och roaming</span>
                        </div>
                        <div class="analysis-stats-grid">
                            <div class="analysis-stat card-surface">
                                <div class="analysis-stat-label">Transaktionsavgifter</div>
                                <div class="analysis-stat-value">{formatAmount(data.analysis_summary.monta.platform_fee)} SEK</div>
                            </div>
                            <div class="analysis-stat card-surface">
                                <div class="analysis-stat-label">Laddningsavgift (%)</div>
                                <div class="analysis-stat-value">{formatAmount(data.analysis_summary.monta.operator_fee)} SEK</div>
                            </div>
                            <div class="analysis-stat card-surface">
                                <div class="analysis-stat-label">Abonnemang</div>
                                <div class="analysis-stat-value">{formatAmount(data.analysis_summary.monta.subscription)} SEK</div>
                            </div>
                            <div class="analysis-stat card-surface">
                                <div class="analysis-stat-label">Roaming (0% moms)</div>
                                <div class="analysis-stat-value">{formatAmount(data.analysis_summary.monta.roaming_revenue)} SEK</div>
                            </div>
                        </div>
                    </div>
                )}

                {/* VAT Panel */}
                <div class="vat-panel card-surface report-section">
                    <h4>Momsredovisning</h4>
                    <VATDetails vat={data.vat} />
                </div>

                {/* Warnings Panel */}
                <div class="report-section">
                    <WarningsPanel validation={data.validation} />
                </div>

                {/* Fortnox Export Status */}
                {reportId && (
                    <div class="report-section">
                        {fortnoxStatusLoading ? (
                            <div class="fortnox-sync-panel not_synced" style={{ textAlign: 'center', padding: '1rem' }}>
                                <div class="modal-spinner" style={{ margin: '0 auto 0.5rem', width: '20px', height: '20px' }} role="status" aria-label="Laddar Fortnox-status" />
                                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Hämtar Fortnox-status...</span>
                            </div>
                        ) : (
                            <>
                                {fortnoxStatus.status !== 'success' && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                        <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                                            Verifikationsserie:
                                        </label>
                                        <select
                                            value={voucherSeries}
                                            onChange={(e) => setVoucherSeries((e.target as HTMLSelectElement).value)}
                                            style={{
                                                padding: '0.35rem 0.5rem',
                                                borderRadius: '6px',
                                                border: '1px solid var(--glass-border)',
                                                background: 'var(--surface-primary)',
                                                color: 'var(--text-primary)',
                                                fontSize: '0.85rem',
                                            }}
                                        >
                                            {['A', 'B', 'C', 'D', 'E'].map(s => (
                                                <option key={s} value={s}>{s}</option>
                                            ))}
                                        </select>
                                    </div>
                                )}
                                <FortnoxSyncStatusPanel
                                    status={fortnoxStatus}
                                    loading={fortnoxLoading}
                                    error={fortnoxError}
                                    onExport={handleFortnoxExport}
                                />
                            </>
                        )}
                    </div>
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

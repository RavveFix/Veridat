import { FunctionComponent } from 'preact';
import type { VATReportData, ValidationResult, VATSummary, SalesTransaction, CostTransaction, ZeroVATWarning, JournalEntry } from '../types/vat';
import { BAS_ACCOUNT_INFO } from '../types/vat';
import { generateExcelFile, copyReportToClipboard } from '../utils/excelExport';
import { useState } from 'preact/hooks';

interface VATReportCardProps {
    data: VATReportData;
}

/**
 * Preact version of VATReportCard component
 * Migrated from vanilla TS for better maintainability and reusability
 */
export const VATReportCard: FunctionComponent<VATReportCardProps> = ({ data }) => {
    const [downloadLoading, setDownloadLoading] = useState(false);
    const [downloadSuccess, setDownloadSuccess] = useState(false);
    const [downloadError, setDownloadError] = useState(false);
    const [copySuccess, setCopySuccess] = useState(false);

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

            {/* Sales Transactions */}
            <details class="transactions-section">
                <summary>Försäljning ({data.sales.length} transaktioner)</summary>
                <div class="transactions-list">
                    <TransactionsList transactions={data.sales} />
                </div>
            </details>

            {/* Cost Transactions */}
            <details class="transactions-section">
                <summary>Kostnader ({data.costs.length} transaktioner)</summary>
                <div class="transactions-list">
                    <TransactionsList transactions={data.costs} />
                </div>
            </details>

            {/* Journal Entries with BAS tooltips */}
            <details class="transactions-section">
                <summary>Bokföringsförslag ({data.journal_entries.length} poster)</summary>
                <div class="journal-entries-list">
                    <JournalEntriesList entries={data.journal_entries} />
                </div>
            </details>

            {/* Warnings Panel */}
            <WarningsPanel validation={data.validation} />

            {/* Action Buttons */}
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

import { FunctionComponent } from 'preact';
import type { VATReportData, ValidationResult, VATSummary, SalesTransaction, CostTransaction } from '../types/vat';
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

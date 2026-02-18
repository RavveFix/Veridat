import { getCheckBadges, getHighestIssueSeverity, type InvoicePostingTrace, type InvoicePostingRow, type PostingIssue, type PostingSeverity } from '../services/InvoicePostingReviewService';

interface InvoicePostingReviewDrawerProps {
    open: boolean;
    loading: boolean;
    error: string | null;
    trace: InvoicePostingTrace | null;
    onClose: () => void;
}

const OVERLAY_STYLE = {
    position: 'fixed',
    inset: 0,
    background: 'var(--overlay-bg)',
    zIndex: 2200,
    display: 'flex',
    justifyContent: 'flex-end',
} as const;

const PANEL_STYLE = {
    width: 'min(780px, 100vw)',
    height: '100%',
    background: 'var(--main-bg)',
    borderLeft: '1px solid var(--surface-border)',
    boxShadow: 'var(--surface-shadow-strong)',
    display: 'flex',
    flexDirection: 'column',
} as const;

const HEADER_STYLE = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '1rem',
    padding: '1rem 1.25rem',
    borderBottom: '1px solid var(--surface-border)',
} as const;

const TITLE_WRAP_STYLE = {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.2rem',
} as const;

const TITLE_STYLE = {
    margin: 0,
    fontSize: '1.1rem',
    color: 'var(--text-primary)',
} as const;

const SUBTITLE_STYLE = {
    margin: 0,
    fontSize: '0.82rem',
    color: 'var(--text-secondary)',
} as const;

const CLOSE_BUTTON_STYLE = {
    height: '34px',
    padding: '0 0.9rem',
    borderRadius: '10px',
    border: '1px solid var(--surface-border)',
    background: 'transparent',
    color: 'var(--text-secondary)',
    fontSize: '0.8rem',
    fontWeight: 600,
    cursor: 'pointer',
} as const;

const BODY_STYLE = {
    flex: 1,
    overflowY: 'auto',
    padding: '1rem 1.25rem 1.5rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
} as const;

const CARD_STYLE = {
    border: '1px solid var(--surface-border)',
    borderRadius: '12px',
    background: 'var(--surface-1)',
    padding: '0.85rem 0.95rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.7rem',
} as const;

const SECTION_TITLE_STYLE = {
    margin: 0,
    fontSize: '0.88rem',
    fontWeight: 700,
    color: 'var(--text-primary)',
} as const;

const INFO_GRID_STYLE = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: '0.6rem',
    fontSize: '0.78rem',
} as const;

const INFO_ROW_STYLE = {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.15rem',
} as const;

const INFO_LABEL_STYLE = {
    color: 'var(--text-secondary)',
    fontWeight: 600,
} as const;

const INFO_VALUE_STYLE = {
    color: 'var(--text-primary)',
} as const;

const TABLE_WRAP_STYLE = { overflowX: 'auto' } as const;

const TABLE_STYLE = {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '0.8rem',
} as const;

const TABLE_HEAD_CELL_STYLE = {
    textAlign: 'left',
    padding: '0.5rem 0.55rem',
    color: 'var(--text-secondary)',
    borderBottom: '1px solid var(--surface-border)',
} as const;

const TABLE_BODY_CELL_STYLE = {
    padding: '0.5rem 0.55rem',
    color: 'var(--text-primary)',
    borderBottom: '1px solid var(--surface-border)',
} as const;

const TABLE_AMOUNT_CELL_STYLE = {
    ...TABLE_BODY_CELL_STYLE,
    textAlign: 'right',
    whiteSpace: 'nowrap',
} as const;

const BADGE_ROW_STYLE = {
    display: 'flex',
    gap: '0.5rem',
    flexWrap: 'wrap',
} as const;

const BADGE_STYLE = {
    padding: '0.26rem 0.62rem',
    borderRadius: '999px',
    fontSize: '0.72rem',
    fontWeight: 700,
    border: '1px solid transparent',
} as const;

const MESSAGE_STYLE = {
    fontSize: '0.83rem',
    color: 'var(--text-secondary)',
} as const;

const ISSUE_LIST_STYLE = {
    display: 'grid',
    gap: '0.55rem',
} as const;

const ISSUE_TITLE_STYLE = {
    margin: 0,
    fontSize: '0.8rem',
    color: 'var(--text-primary)',
} as const;

const SUMMARY_BADGE_STYLE = {
    ...BADGE_STYLE,
    fontSize: '0.75rem',
    padding: '0.3rem 0.68rem',
} as const;

const ISSUE_MESSAGE_STYLE = {
    margin: '0.2rem 0 0',
    fontSize: '0.8rem',
    color: 'var(--text-secondary)',
    lineHeight: 1.45,
} as const;

const ISSUE_DEBUG_DETAILS_STYLE = {
    marginTop: '0.45rem',
} as const;

const ISSUE_DEBUG_SUMMARY_STYLE = {
    cursor: 'pointer',
    fontSize: '0.72rem',
    color: 'var(--text-secondary)',
} as const;

const ISSUE_DEBUG_CODE_STYLE = {
    margin: '0.35rem 0 0',
    fontSize: '0.72rem',
    color: 'var(--text-secondary)',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
} as const;

function formatAmount(value: number): string {
    return Number(value || 0).toLocaleString('sv-SE', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}

function getSeverityLabel(severity: PostingSeverity): string {
    if (severity === 'critical') return 'Kritisk';
    if (severity === 'warning') return 'Varning';
    return 'Info';
}

function getSeverityStyle(severity: PostingSeverity) {
    if (severity === 'critical') {
        return {
            borderColor: 'rgba(239, 68, 68, 0.4)',
            background: 'rgba(239, 68, 68, 0.12)',
            color: '#ef4444',
        } as const;
    }
    if (severity === 'warning') {
        return {
            borderColor: 'rgba(245, 158, 11, 0.45)',
            background: 'rgba(245, 158, 11, 0.14)',
            color: '#f59e0b',
        } as const;
    }
    return {
        borderColor: 'rgba(59, 130, 246, 0.4)',
        background: 'rgba(59, 130, 246, 0.14)',
        color: '#3b82f6',
    } as const;
}

function getSeverityBadgeStyle(severity: PostingSeverity) {
    return {
        ...SUMMARY_BADGE_STYLE,
        ...getSeverityStyle(severity),
    } as const;
}

function getIssueCardStyle(severity: PostingSeverity) {
    return {
        ...CARD_STYLE,
        ...getSeverityStyle(severity),
    } as const;
}

function getWarningCardStyle() {
    return {
        ...CARD_STYLE,
        ...getSeverityStyle('warning'),
    } as const;
}

function getPostingStatusLabel(
    status: 'booked' | 'unbooked' | 'unknown',
    source: 'explicit' | 'heuristic' | 'none'
): string {
    if (status === 'booked' && source === 'none') return 'Bokförd, verifikation ej hittad automatiskt';
    if (status === 'booked') return 'Bokförd';
    if (status === 'unbooked') return 'Obokförd';
    return 'Okänd';
}

function getMatchPathLabel(trace: InvoicePostingTrace): string {
    const path = trace.posting.matchPath;
    if (path === 'explicit_vouchers') return 'Explicit (Vouchers[])';
    if (path === 'explicit_single') return 'Explicit (VoucherSeries/Number/Year)';
    if (path === 'reference') return 'Referensmatch';
    if (path === 'heuristic') return 'Heuristik';
    if (trace.posting.source === 'explicit') return 'Explicit';
    if (trace.posting.source === 'heuristic') return 'Heuristik';
    return '—';
}

function formatVoucherRef(voucherRef: { series: string; number: number; year?: number } | null): string {
    if (!voucherRef) return '—';
    if (voucherRef.year) {
        return `${voucherRef.series}/${voucherRef.number}/${voucherRef.year}`;
    }
    return `${voucherRef.series}/${voucherRef.number}`;
}

function getIssueCodeLabel(code: string): string {
    const byCode: Record<string, string> = {
        ACTUAL_POSTING_UNAVAILABLE: 'Faktisk kontering saknas',
        VOUCHER_LINK_MISSING: 'Verifikationskoppling saknas',
        HEURISTIC_MATCH_UNCERTAIN: 'Osäker verifikationsmatchning',
        UNBALANCED_POSTING: 'Obalanserad kontering',
        TOTAL_MISMATCH: 'Belopp stämmer inte',
        VAT_MISMATCH: 'Moms stämmer inte',
        CONTROL_ACCOUNT_MISSING: 'Kontrollkonto saknas',
        ROW_ACCOUNT_CONSISTENCY: 'Kontokonsistens avviker',
    };
    return byCode[code] || code.replace(/_/g, ' ');
}

function getCheckBadgeStyle(status: 'ok' | 'warning' | 'critical') {
    if (status === 'critical') {
        return {
            ...BADGE_STYLE,
            borderColor: 'rgba(239, 68, 68, 0.5)',
            background: 'rgba(239, 68, 68, 0.14)',
            color: '#ef4444',
        } as const;
    }
    if (status === 'warning') {
        return {
            ...BADGE_STYLE,
            borderColor: 'rgba(245, 158, 11, 0.55)',
            background: 'rgba(245, 158, 11, 0.15)',
            color: '#f59e0b',
        } as const;
    }
    return {
        ...BADGE_STYLE,
        borderColor: 'rgba(16, 185, 129, 0.5)',
        background: 'rgba(16, 185, 129, 0.15)',
        color: '#10b981',
    } as const;
}

function PostingTable({ rows }: { rows: InvoicePostingRow[] }) {
    if (rows.length === 0) {
        return <div style={MESSAGE_STYLE}>Inga rader att visa.</div>;
    }

    return (
        <div style={TABLE_WRAP_STYLE}>
            <table style={TABLE_STYLE}>
                <thead>
                    <tr>
                        <th style={TABLE_HEAD_CELL_STYLE}>Konto</th>
                        <th style={TABLE_HEAD_CELL_STYLE}>Debet</th>
                        <th style={TABLE_HEAD_CELL_STYLE}>Kredit</th>
                        <th style={TABLE_HEAD_CELL_STYLE}>Kommentar</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, index) => (
                        <tr key={`${row.account}-${index}`}>
                            <td style={TABLE_BODY_CELL_STYLE}>{row.account}</td>
                            <td style={TABLE_AMOUNT_CELL_STYLE}>{row.debit > 0 ? formatAmount(row.debit) : '-'}</td>
                            <td style={TABLE_AMOUNT_CELL_STYLE}>{row.credit > 0 ? formatAmount(row.credit) : '-'}</td>
                            <td style={TABLE_BODY_CELL_STYLE}>{row.description || '—'}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function getActualPostingMessage(trace: InvoicePostingTrace): string {
    if (trace.posting.rows.length > 0) return '';
    if (trace.posting.status === 'booked' && trace.posting.source === 'none') {
        return 'Bokförd i Fortnox men verifikation kunde inte kopplas automatiskt.';
    }
    if (trace.posting.status === 'unbooked') {
        return 'Fakturan är inte bokförd ännu.';
    }
    return 'Faktisk kontering är inte tillgänglig än.';
}

function getConfidenceLabel(trace: InvoicePostingTrace): string {
    if (trace.posting.source === 'none') {
        return '—';
    }
    return `${Math.round((trace.posting.confidence || 0) * 100)}%`;
}

function hasIssue(trace: InvoicePostingTrace, code: string): boolean {
    return trace.issues.some((issue) => issue.code === code);
}

function isPermissionErrorMessage(error: string): boolean {
    const normalized = error.toLowerCase();
    return normalized.includes('403')
        || normalized.includes('fortnoxpermissionerror')
        || normalized.includes('behörighet')
        || normalized.includes('åtkomst nekad');
}

function IssueCard({ issue }: { issue: PostingIssue }) {
    return (
        <div style={getIssueCardStyle(issue.severity)}>
            <h4 style={ISSUE_TITLE_STYLE}>{getSeverityLabel(issue.severity)}: {getIssueCodeLabel(issue.code)}</h4>
            <p style={ISSUE_MESSAGE_STYLE}>{issue.message}</p>
            <p style={ISSUE_MESSAGE_STYLE}>Åtgärd: {issue.suggestion}</p>
            <details style={ISSUE_DEBUG_DETAILS_STYLE} data-testid={`invoice-posting-issue-debug-${issue.code}`}>
                <summary style={ISSUE_DEBUG_SUMMARY_STYLE}>Visa teknisk kod</summary>
                <pre style={ISSUE_DEBUG_CODE_STYLE} data-testid={`invoice-posting-issue-code-${issue.code}`}>{issue.code}</pre>
            </details>
        </div>
    );
}

export function InvoicePostingReviewDrawer({
    open,
    loading,
    error,
    trace,
    onClose,
}: InvoicePostingReviewDrawerProps) {
    if (!open) return null;

    const badges = trace ? getCheckBadges(trace.checks) : [];
    const highestSeverity = trace ? getHighestIssueSeverity(trace.issues) : 'info';

    return (
        <div
            style={OVERLAY_STYLE}
            onClick={onClose}
            data-testid="invoice-posting-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Konteringskontroll"
        >
            <aside style={PANEL_STYLE} onClick={(event) => event.stopPropagation()}>
                <div style={HEADER_STYLE}>
                    <div style={TITLE_WRAP_STYLE}>
                        <h3 style={TITLE_STYLE}>Konteringskontroll</h3>
                        <p style={SUBTITLE_STYLE}>
                            Faktisk och förväntad debet/kredit med kontrollregler.
                        </p>
                    </div>
                    <button type="button" style={CLOSE_BUTTON_STYLE} onClick={onClose} data-testid="invoice-posting-drawer-close">
                        Stäng
                    </button>
                </div>

                <div style={BODY_STYLE}>
                    {loading && (
                        <div style={CARD_STYLE}>Laddar kontering...</div>
                    )}

                    {!loading && error && (
                        <div style={getWarningCardStyle()}>
                            {isPermissionErrorMessage(error)
                                ? 'Fortnox-behörighet saknas för att läsa faktisk kontering. Kontrollera rättigheter för Bokföring/Verifikationer och koppla om integrationen.'
                                : error}
                        </div>
                    )}

                    {!loading && !error && trace && (
                        <>
                            <section style={CARD_STYLE}>
                                <h4 style={SECTION_TITLE_STYLE}>Faktura</h4>
                                <div style={INFO_GRID_STYLE}>
                                    <div style={INFO_ROW_STYLE}>
                                        <span style={INFO_LABEL_STYLE}>Fakturanummer</span>
                                        <span style={INFO_VALUE_STYLE}>{trace.invoice.invoiceNumber}</span>
                                    </div>
                                    <div style={INFO_ROW_STYLE}>
                                        <span style={INFO_LABEL_STYLE}>Motpart</span>
                                        <span style={INFO_VALUE_STYLE}>{trace.invoice.counterpartyName || trace.invoice.counterpartyNumber || '—'}</span>
                                    </div>
                                    <div style={INFO_ROW_STYLE}>
                                        <span style={INFO_LABEL_STYLE}>Status</span>
                                        <span style={INFO_VALUE_STYLE} data-testid="invoice-posting-status-value">
                                            {getPostingStatusLabel(trace.posting.status, trace.posting.source)}
                                        </span>
                                    </div>
                                    <div style={INFO_ROW_STYLE}>
                                        <span style={INFO_LABEL_STYLE}>Matchad via</span>
                                        <span style={INFO_VALUE_STYLE} data-testid="invoice-posting-match-path-value">
                                            {getMatchPathLabel(trace)}
                                        </span>
                                    </div>
                                    <div style={INFO_ROW_STYLE}>
                                        <span style={INFO_LABEL_STYLE}>Träffsäkerhet</span>
                                        <span style={INFO_VALUE_STYLE}>{getConfidenceLabel(trace)}</span>
                                    </div>
                                    <div style={INFO_ROW_STYLE}>
                                        <span style={INFO_LABEL_STYLE}>Verifikation</span>
                                        <span style={INFO_VALUE_STYLE}>{formatVoucherRef(trace.posting.voucherRef)}</span>
                                    </div>
                                    <div style={INFO_ROW_STYLE}>
                                        <span style={INFO_LABEL_STYLE}>Total</span>
                                        <span style={INFO_VALUE_STYLE}>{formatAmount(trace.invoice.total)} {trace.invoice.currency}</span>
                                    </div>
                                    <div style={INFO_ROW_STYLE}>
                                        <span style={INFO_LABEL_STYLE}>Moms</span>
                                        <span style={INFO_VALUE_STYLE}>{formatAmount(trace.invoice.vat)} {trace.invoice.currency}</span>
                                    </div>
                                </div>
                                <div style={BADGE_ROW_STYLE}>
                                    <span style={getSeverityBadgeStyle(highestSeverity)}>Risknivå: {getSeverityLabel(highestSeverity)}</span>
                                    {trace.posting.voucherRef && (
                                        <span style={getCheckBadgeStyle('ok')}>
                                            Verifikation {formatVoucherRef(trace.posting.voucherRef)}
                                        </span>
                                    )}
                                </div>
                            </section>

                            <section style={CARD_STYLE}>
                                <h4 style={SECTION_TITLE_STYLE}>Faktisk kontering</h4>
                                {trace.posting.rows.length === 0 && (
                                    <div style={MESSAGE_STYLE} data-testid="invoice-posting-actual-message">
                                        {getActualPostingMessage(trace)}
                                    </div>
                                )}
                                <PostingTable rows={trace.posting.rows} />
                            </section>

                            <section style={CARD_STYLE}>
                                <h4 style={SECTION_TITLE_STYLE}>Förväntad kontering</h4>
                                <PostingTable rows={trace.expectedPosting.rows} />
                            </section>

                            <section style={CARD_STYLE}>
                                <h4 style={SECTION_TITLE_STYLE}>Kontroller</h4>
                                {trace.posting.rows.length === 0 && (
                                    <div style={MESSAGE_STYLE}>
                                        Kontroller baseras på förväntad kontering när faktisk kontering saknas.
                                    </div>
                                )}
                                <div style={BADGE_ROW_STYLE}>
                                    {badges.map((badge) => (
                                        <span key={badge.key} style={getCheckBadgeStyle(badge.status)}>
                                            {badge.label}: {badge.status === 'ok' ? 'OK' : badge.status === 'critical' ? 'Kritisk' : 'Varning'}
                                        </span>
                                    ))}
                                </div>
                            </section>

                            <section style={CARD_STYLE}>
                                <h4 style={SECTION_TITLE_STYLE}>Avvikelser och förslag</h4>
                                {hasIssue(trace, 'VOUCHER_LINK_MISSING') && (
                                    <div style={getWarningCardStyle()}>
                                        Vanlig orsak: saknad Fortnox-behörighet för Bokföring/Verifikationer.
                                        Om felet återkommer, koppla om Fortnox-integrationen med ett konto som har dessa rättigheter.
                                    </div>
                                )}
                                {trace.issues.length === 0 ? (
                                    <div style={MESSAGE_STYLE}>Inga avvikelser hittades.</div>
                                ) : (
                                    <div style={ISSUE_LIST_STYLE}>
                                        {trace.issues.map((issue) => (
                                            <IssueCard key={`${issue.code}-${issue.message}`} issue={issue} />
                                        ))}
                                    </div>
                                )}
                            </section>
                        </>
                    )}
                </div>
            </aside>
        </div>
    );
}

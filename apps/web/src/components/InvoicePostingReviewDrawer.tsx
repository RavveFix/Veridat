import { useEffect, useState } from 'preact/hooks';
import {
    getCheckBadges,
    getHighestIssueSeverity,
    type InvoicePostingTrace,
    type InvoicePostingRow,
    type PostingCorrectionResult,
    type PostingIssue,
    type PostingSeverity,
} from '../services/InvoicePostingReviewService';

type InvoicePostingPresentation = 'drawer' | 'fullscreen';

interface InvoicePostingReviewDrawerProps {
    open: boolean;
    loading: boolean;
    error: string | null;
    trace: InvoicePostingTrace | null;
    presentation?: InvoicePostingPresentation;
    onClose: () => void;
    onCreateCorrection?: (payload: {
        invoiceType: 'customer';
        invoiceId: number;
        correction: {
            side: 'debit' | 'credit';
            fromAccount: number;
            toAccount: number;
            amount: number;
            voucherSeries: string;
            transactionDate: string;
            reason: string;
        };
    }) => Promise<PostingCorrectionResult>;
}

const DRAWER_OVERLAY_STYLE = {
    position: 'fixed',
    inset: 0,
    background: 'var(--overlay-bg)',
    zIndex: 2200,
    display: 'flex',
    justifyContent: 'flex-end',
} as const;

const FULLSCREEN_OVERLAY_STYLE = {
    ...DRAWER_OVERLAY_STYLE,
    justifyContent: 'flex-start',
    alignItems: 'stretch',
} as const;

const DRAWER_PANEL_STYLE = {
    width: 'min(780px, 100vw)',
    height: '100%',
    background: 'var(--main-bg)',
    borderLeft: '1px solid var(--surface-border)',
    boxShadow: 'var(--surface-shadow-strong)',
    display: 'flex',
    flexDirection: 'column',
    paddingRight: 'env(safe-area-inset-right, 0)',
} as const;

const FULLSCREEN_PANEL_STYLE = {
    ...DRAWER_PANEL_STYLE,
    width: '100vw',
    height: '100dvh',
    borderLeft: 'none',
    paddingLeft: 'env(safe-area-inset-left, 0)',
    paddingRight: 'env(safe-area-inset-right, 0)',
    paddingBottom: 'env(safe-area-inset-bottom, 0)',
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

const FULLSCREEN_BODY_STYLE = {
    ...BODY_STYLE,
    padding: '1rem 1.5rem 1.75rem',
} as const;

function getOverlayStyle(presentation: InvoicePostingPresentation) {
    if (presentation === 'fullscreen') return FULLSCREEN_OVERLAY_STYLE;
    return DRAWER_OVERLAY_STYLE;
}

function getPanelStyle(presentation: InvoicePostingPresentation) {
    if (presentation === 'fullscreen') return FULLSCREEN_PANEL_STYLE;
    return DRAWER_PANEL_STYLE;
}

function getBodyStyle(presentation: InvoicePostingPresentation) {
    if (presentation === 'fullscreen') return FULLSCREEN_BODY_STYLE;
    return BODY_STYLE;
}

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

const ACTION_BAR_STYLE = {
    position: 'sticky',
    top: 0,
    zIndex: 2,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.55rem',
    flexWrap: 'wrap',
    padding: '0.7rem',
    border: '1px solid var(--surface-border)',
    borderRadius: '12px',
    background: 'var(--main-bg)',
} as const;

const ACTION_BUTTON_STYLE = {
    height: '36px',
    padding: '0 1rem',
    borderRadius: '10px',
    border: '1px solid rgba(37, 99, 235, 0.45)',
    background: 'linear-gradient(135deg, #2563eb, #0284c7)',
    color: '#e0f2fe',
    fontSize: '0.78rem',
    fontWeight: 700,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
} as const;

const ACTION_SECONDARY_BUTTON_STYLE = {
    ...ACTION_BUTTON_STYLE,
    background: 'rgba(148, 163, 184, 0.14)',
    border: '1px solid var(--surface-border)',
    color: 'var(--text-primary)',
} as const;

const ACTION_HINT_STYLE = {
    fontSize: '0.76rem',
    color: 'var(--text-secondary)',
    lineHeight: 1.4,
} as const;

const ACTION_BUTTONS_WRAP_STYLE = {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '0.55rem',
    flexWrap: 'wrap',
    marginLeft: 'auto',
} as const;

const CORRECTION_MODAL_OVERLAY_STYLE = {
    position: 'fixed',
    inset: 0,
    zIndex: 2300,
    background: 'rgba(2, 6, 23, 0.68)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 'max(1rem, env(safe-area-inset-top, 1rem)) max(1rem, env(safe-area-inset-right, 1rem)) max(1rem, env(safe-area-inset-bottom, 1rem)) max(1rem, env(safe-area-inset-left, 1rem))',
} as const;

const CORRECTION_MODAL_STYLE = {
    width: 'min(640px, 90vw)',
    maxHeight: '92vh',
    overflowY: 'auto',
    borderRadius: '14px',
    border: '1px solid var(--surface-border)',
    background: 'var(--surface-1)',
    boxShadow: 'var(--surface-shadow-strong)',
    padding: '1rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.9rem',
} as const;

const CORRECTION_MODAL_HEADER_STYLE = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '1rem',
} as const;

const CORRECTION_MODAL_TITLE_STYLE = {
    margin: 0,
    fontSize: '0.95rem',
    color: 'var(--text-primary)',
} as const;

const CORRECTION_HELP_STYLE = {
    margin: 0,
    fontSize: '0.78rem',
    color: 'var(--text-secondary)',
    lineHeight: 1.45,
} as const;

const CORRECTION_FORM_GRID_STYLE = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
    gap: '0.7rem',
} as const;

const CORRECTION_FIELD_STYLE = {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.35rem',
} as const;

const CORRECTION_LABEL_STYLE = {
    fontSize: '0.72rem',
    color: 'var(--text-secondary)',
    fontWeight: 600,
} as const;

const CORRECTION_INPUT_STYLE = {
    height: '34px',
    borderRadius: '8px',
    border: '1px solid var(--surface-border)',
    background: 'rgba(15, 23, 42, 0.35)',
    color: 'var(--text-primary)',
    fontSize: '0.78rem',
    padding: '0 0.55rem',
} as const;

const CORRECTION_TEXTAREA_STYLE = {
    minHeight: '74px',
    borderRadius: '8px',
    border: '1px solid var(--surface-border)',
    background: 'rgba(15, 23, 42, 0.35)',
    color: 'var(--text-primary)',
    fontSize: '0.78rem',
    padding: '0.5rem 0.55rem',
    resize: 'vertical',
    fontFamily: 'inherit',
} as const;

const CORRECTION_MODAL_ACTIONS_STYLE = {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '0.55rem',
    flexWrap: 'wrap',
} as const;

const CORRECTION_SUCCESS_BOX_STYLE = {
    border: '1px solid rgba(16, 185, 129, 0.45)',
    borderRadius: '10px',
    background: 'rgba(16, 185, 129, 0.11)',
    color: '#10b981',
    fontSize: '0.8rem',
    padding: '0.65rem 0.75rem',
    lineHeight: 1.4,
} as const;

const PENDING_CHAT_PROMPT_KEY = 'veridat_pending_chat_prompt';
const CORRECTION_SUPPORTED_ISSUE_CODES = new Set(['ROW_ACCOUNT_CONSISTENCY', 'CONTROL_ACCOUNT_MISSING', 'UNBALANCED_POSTING']);
const CORRECTION_BLOCKING_ISSUE_CODES = new Set(['TOTAL_MISMATCH', 'VAT_MISMATCH']);
const CONTROL_ACCOUNTS = new Set([1510, 1930]);

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

function resolveChatInputElement(): HTMLInputElement | HTMLTextAreaElement | null {
    const input = document.getElementById('user-input');
    if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
        return input;
    }
    const legacyInput = document.getElementById('message-input');
    if (legacyInput instanceof HTMLInputElement || legacyInput instanceof HTMLTextAreaElement) {
        return legacyInput;
    }
    return null;
}

function resolveChatFormElement(): HTMLFormElement | null {
    const form = document.getElementById('chat-form');
    return form instanceof HTMLFormElement ? form : null;
}

function trySubmitPromptToChat(prompt: string): boolean {
    const input = resolveChatInputElement();
    const form = resolveChatFormElement();
    if (!input || !form) return false;

    input.value = prompt;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    return true;
}

function sendPromptToAiChat(prompt: string): void {
    if (trySubmitPromptToChat(prompt)) {
        sessionStorage.removeItem(PENDING_CHAT_PROMPT_KEY);
        return;
    }

    sessionStorage.setItem(PENDING_CHAT_PROMPT_KEY, prompt);
    window.dispatchEvent(new CustomEvent('create-new-chat'));

    let attempts = 0;
    const retryInject = () => {
        attempts += 1;
        const pending = sessionStorage.getItem(PENDING_CHAT_PROMPT_KEY);
        if (!pending) return;
        if (trySubmitPromptToChat(pending)) {
            sessionStorage.removeItem(PENDING_CHAT_PROMPT_KEY);
            return;
        }
        if (attempts < 10) {
            window.setTimeout(retryInject, 200);
        }
    };

    window.setTimeout(retryInject, 200);
}

function formatRowsForPrompt(rows: InvoicePostingRow[]): string {
    if (rows.length === 0) return '- Inga rader';
    return rows.map((row) => (
        `- Konto ${row.account}: Debet ${formatAmount(row.debit)}, Kredit ${formatAmount(row.credit)}, Kommentar ${row.description || '—'}`
    )).join('\n');
}

function formatIssuesForPrompt(issues: PostingIssue[]): string {
    if (issues.length === 0) return '- Inga avvikelser';
    return issues.map((issue) => `- ${issue.code}: ${issue.message}`).join('\n');
}

function buildAiEconomistPrompt(trace: InvoicePostingTrace): string {
    const status = getPostingStatusLabel(trace.posting.status, trace.posting.source);
    const matchPath = getMatchPathLabel(trace);
    const voucherRef = formatVoucherRef(trace.posting.voucherRef);
    const expectedRows = formatRowsForPrompt(trace.expectedPosting.rows);
    const actualRows = formatRowsForPrompt(trace.posting.rows);
    const issues = formatIssuesForPrompt(trace.issues);

    return `Du är min AI-ekonom. Hjälp mig bedöma denna faktura och kontering i Fortnox.

Mål:
1) Förklara varför avvikelsen uppstod.
2) Säg om detta ser ut som faktisk bokföringsavvikelse eller matchnings/dataproblem.
3) Ge konkret nästa steg i Fortnox.
4) Föreslå korrigeringsverifikation (debet/kredit) om det behövs.

Faktura:
- Typ: ${trace.invoice.type}
- Fakturanummer: ${trace.invoice.invoiceNumber}
- Motpart: ${trace.invoice.counterpartyName || trace.invoice.counterpartyNumber || '—'}
- Total: ${formatAmount(trace.invoice.total)} ${trace.invoice.currency}
- Moms: ${formatAmount(trace.invoice.vat)} ${trace.invoice.currency}
- Status: ${status}
- Matchad via: ${matchPath}
- Verifikation: ${voucherRef}

Faktisk kontering:
${actualRows}

Förväntad kontering:
${expectedRows}

Avvikelser:
${issues}

Svara kort och konkret på svenska.`;
}

interface CorrectionFormState {
    invoiceType: 'customer';
    invoiceId: number;
    side: 'debit' | 'credit';
    fromAccount: string;
    toAccount: string;
    amount: string;
    voucherSeries: string;
    transactionDate: string;
    reason: string;
}

function getTodayIsoDate(): string {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function hasAnyIssueCode(trace: InvoicePostingTrace, codes: Set<string>): boolean {
    return trace.issues.some((issue) => codes.has(issue.code));
}

function isCorrectionScopeEligible(trace: InvoicePostingTrace): boolean {
    if (trace.invoice.type !== 'customer') return false;
    if (trace.posting.rows.length === 0) return false;
    if (hasAnyIssueCode(trace, CORRECTION_BLOCKING_ISSUE_CODES)) return false;
    return hasAnyIssueCode(trace, CORRECTION_SUPPORTED_ISSUE_CODES);
}

function pickDefaultCorrectionRow(trace: InvoicePostingTrace): InvoicePostingRow | null {
    if (trace.posting.rows.length === 0) return null;

    const expectedAccounts = new Set(
        trace.expectedPosting.rows
            .map((row) => row.account)
            .filter((account) => !CONTROL_ACCOUNTS.has(account))
    );

    const explicitMismatch = trace.posting.rows.find((row) => (
        !CONTROL_ACCOUNTS.has(row.account)
        && !expectedAccounts.has(row.account)
        && (row.debit > 0 || row.credit > 0)
    ));
    if (explicitMismatch) return explicitMismatch;

    const firstNonControl = trace.posting.rows.find((row) => !CONTROL_ACCOUNTS.has(row.account));
    return firstNonControl || trace.posting.rows[0];
}

function buildInitialCorrectionForm(trace: InvoicePostingTrace): CorrectionFormState | null {
    if (!isCorrectionScopeEligible(trace)) return null;

    const row = pickDefaultCorrectionRow(trace);
    if (!row) return null;
    const invoiceIdFromTrace = Number(trace.invoice.id);
    const invoiceIdFallback = Number(trace.invoice.invoiceNumber);
    const invoiceId = Number.isFinite(invoiceIdFromTrace) && invoiceIdFromTrace > 0
        ? Math.round(invoiceIdFromTrace)
        : Number.isFinite(invoiceIdFallback) && invoiceIdFallback > 0
            ? Math.round(invoiceIdFallback)
            : null;
    if (invoiceId === null) return null;

    const side = row.debit >= row.credit ? 'debit' : 'credit';
    const amount = side === 'debit'
        ? (row.debit > 0 ? row.debit : Math.max(row.debit, row.credit))
        : (row.credit > 0 ? row.credit : Math.max(row.debit, row.credit));
    const amountText = Number(amount || 0).toFixed(2);

    return {
        invoiceType: 'customer',
        invoiceId,
        side,
        fromAccount: String(row.account),
        toAccount: '',
        amount: amountText,
        voucherSeries: trace.posting.voucherRef?.series || 'A',
        transactionDate: trace.invoice.invoiceDate || getTodayIsoDate(),
        reason: `Korrigering avvikelse kundfaktura ${trace.invoice.invoiceNumber}`,
    };
}

function parsePositiveAccount(value: string): number | null {
    const parsed = Number(value.trim());
    if (!Number.isFinite(parsed)) return null;
    const rounded = Math.round(parsed);
    if (rounded < 1000 || rounded > 9999) return null;
    return rounded;
}

function parsePositiveAmount(value: string): number | null {
    const parsed = Number(value.replace(',', '.').trim());
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return Math.round((parsed + Number.EPSILON) * 100) / 100;
}

function validateCorrectionForm(state: CorrectionFormState): {
    invoiceType: 'customer';
    invoiceId: number;
    correction: {
        side: 'debit' | 'credit';
        fromAccount: number;
        toAccount: number;
        amount: number;
        voucherSeries: string;
        transactionDate: string;
        reason: string;
    };
} {
    const fromAccount = parsePositiveAccount(state.fromAccount);
    if (fromAccount === null) {
        throw new Error('Felkonto måste vara ett giltigt 4-siffrigt BAS-konto.');
    }
    const toAccount = parsePositiveAccount(state.toAccount);
    if (toAccount === null) {
        throw new Error('Nytt konto måste vara ett giltigt 4-siffrigt BAS-konto.');
    }
    if (fromAccount === toAccount) {
        throw new Error('Nytt konto måste skilja sig från felkonto.');
    }
    const amount = parsePositiveAmount(state.amount);
    if (amount === null) {
        throw new Error('Belopp måste vara större än 0.');
    }
    const voucherSeries = state.voucherSeries.trim().toUpperCase();
    if (!/^[A-Z0-9]{1,6}$/.test(voucherSeries)) {
        throw new Error('Serie måste vara 1-6 tecken (A-Z, 0-9).');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(state.transactionDate.trim())) {
        throw new Error('Datum måste vara i format YYYY-MM-DD.');
    }
    const reason = state.reason.trim();
    if (!reason) {
        throw new Error('Ange en kort kommentar för korrigeringen.');
    }

    return {
        invoiceType: state.invoiceType,
        invoiceId: state.invoiceId,
        correction: {
            side: state.side,
            fromAccount,
            toAccount,
            amount,
            voucherSeries,
            transactionDate: state.transactionDate.trim(),
            reason,
        },
    };
}

function getVoucherLink(voucher: PostingCorrectionResult['Voucher']): string | null {
    if (!voucher) return null;
    return `https://apps.fortnox.se/vouchers/${voucher.VoucherSeries}/${voucher.VoucherNumber}`;
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
    presentation = 'drawer',
    onClose,
    onCreateCorrection,
}: InvoicePostingReviewDrawerProps) {
    const [correctionOpen, setCorrectionOpen] = useState(false);
    const [correctionForm, setCorrectionForm] = useState<CorrectionFormState | null>(null);
    const [correctionSubmitting, setCorrectionSubmitting] = useState(false);
    const [correctionError, setCorrectionError] = useState<string | null>(null);
    const [correctionResult, setCorrectionResult] = useState<PostingCorrectionResult | null>(null);

    useEffect(() => {
        if (!open) {
            setCorrectionOpen(false);
            setCorrectionForm(null);
            setCorrectionSubmitting(false);
            setCorrectionError(null);
            setCorrectionResult(null);
        }
    }, [open]);

    useEffect(() => {
        setCorrectionOpen(false);
        setCorrectionForm(null);
        setCorrectionSubmitting(false);
        setCorrectionError(null);
        setCorrectionResult(null);
    }, [trace?.invoice.id]);

    if (!open) return null;

    const badges = trace ? getCheckBadges(trace.checks) : [];
    const highestSeverity = trace ? getHighestIssueSeverity(trace.issues) : 'info';
    const canShowCorrection = Boolean(trace && onCreateCorrection && isCorrectionScopeEligible(trace));

    const openCorrectionModal = () => {
        if (!trace) return;
        const initial = buildInitialCorrectionForm(trace);
        if (!initial) {
            setCorrectionError('Kunde inte skapa förhandsgranskning för korrigering.');
            return;
        }
        setCorrectionForm(initial);
        setCorrectionResult(null);
        setCorrectionError(null);
        setCorrectionOpen(true);
    };

    const submitCorrection = async () => {
        if (!correctionForm) return;
        if (!onCreateCorrection) {
            setCorrectionError('Korrigeringsflödet är inte tillgängligt i denna vy.');
            return;
        }
        try {
            const payload = validateCorrectionForm(correctionForm);
            setCorrectionSubmitting(true);
            setCorrectionError(null);
            const result = await onCreateCorrection(payload);
            setCorrectionResult(result);
        } catch (submitError) {
            setCorrectionError(submitError instanceof Error ? submitError.message : 'Kunde inte skapa korrigeringsverifikation.');
        } finally {
            setCorrectionSubmitting(false);
        }
    };

    return (
        <div
            style={getOverlayStyle(presentation)}
            onClick={onClose}
            data-testid="invoice-posting-drawer"
            data-presentation={presentation}
            role="dialog"
            aria-modal="true"
            aria-label="Konteringskontroll"
        >
            <aside style={getPanelStyle(presentation)} onClick={(event) => event.stopPropagation()}>
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

                <div style={getBodyStyle(presentation)}>
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
                            <section style={ACTION_BAR_STYLE}>
                                <span style={ACTION_HINT_STYLE}>
                                    Ett klick skickar underlaget och öppnar chatten direkt.
                                </span>
                                <div style={ACTION_BUTTONS_WRAP_STYLE}>
                                    {canShowCorrection && (
                                        <button
                                            type="button"
                                            style={ACTION_SECONDARY_BUTTON_STYLE}
                                            data-testid="invoice-posting-correct-issue-button"
                                            onClick={openCorrectionModal}
                                        >
                                            Ändra avvikelse
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        style={ACTION_BUTTON_STYLE}
                                        data-testid="invoice-posting-send-ai-button"
                                        onClick={() => {
                                            sendPromptToAiChat(buildAiEconomistPrompt(trace));
                                            onClose();
                                        }}
                                    >
                                        Skicka till AI och öppna chatten
                                    </button>
                                </div>
                            </section>

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

            {correctionOpen && correctionForm && (
                <div
                    style={CORRECTION_MODAL_OVERLAY_STYLE}
                    onClick={() => {
                        if (!correctionSubmitting) {
                            setCorrectionOpen(false);
                        }
                    }}
                    data-testid="invoice-posting-correction-modal"
                >
                    <section
                        style={CORRECTION_MODAL_STYLE}
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div style={CORRECTION_MODAL_HEADER_STYLE}>
                            <h4 style={CORRECTION_MODAL_TITLE_STYLE}>Förhandsgranska korrigering</h4>
                            <button
                                type="button"
                                style={CLOSE_BUTTON_STYLE}
                                disabled={correctionSubmitting}
                                onClick={() => setCorrectionOpen(false)}
                            >
                                Stäng
                            </button>
                        </div>

                        <p style={CORRECTION_HELP_STYLE}>
                            Kontrollera konto, sida och belopp innan export. Detta skapar en ny korrigeringsverifikation i Fortnox.
                        </p>

                        {trace && (
                            <div style={CARD_STYLE}>
                                <div style={INFO_GRID_STYLE}>
                                    <div style={INFO_ROW_STYLE}>
                                        <span style={INFO_LABEL_STYLE}>Faktura</span>
                                        <span style={INFO_VALUE_STYLE}>{trace.invoice.invoiceNumber}</span>
                                    </div>
                                    <div style={INFO_ROW_STYLE}>
                                        <span style={INFO_LABEL_STYLE}>Matchad via</span>
                                        <span style={INFO_VALUE_STYLE}>{getMatchPathLabel(trace)}</span>
                                    </div>
                                    <div style={INFO_ROW_STYLE}>
                                        <span style={INFO_LABEL_STYLE}>Verifikation</span>
                                        <span style={INFO_VALUE_STYLE}>{formatVoucherRef(trace.posting.voucherRef)}</span>
                                    </div>
                                </div>
                            </div>
                        )}

                        {correctionResult?.Voucher && (
                            <div style={CORRECTION_SUCCESS_BOX_STYLE} data-testid="invoice-posting-correction-success">
                                Korrigeringsverifikation skapad: {correctionResult.Voucher.VoucherSeries}/{correctionResult.Voucher.VoucherNumber}
                                {correctionResult.Voucher.Year ? `/${correctionResult.Voucher.Year}` : ''}.
                                {' '}Konteringsspåret har uppdaterats.
                                {getVoucherLink(correctionResult.Voucher) && (
                                    <>
                                        {' '}<a
                                            href={getVoucherLink(correctionResult.Voucher) as string}
                                            target="_blank"
                                            rel="noreferrer"
                                            style={{ color: '#bbf7d0', textDecoration: 'underline' }}
                                        >
                                            Öppna i Fortnox
                                        </a>
                                    </>
                                )}
                            </div>
                        )}

                        {!correctionResult && (
                            <div style={CORRECTION_FORM_GRID_STYLE}>
                                <div style={CORRECTION_FIELD_STYLE}>
                                    <label style={CORRECTION_LABEL_STYLE} htmlFor="posting-correction-from-account">Felkonto</label>
                                    <input
                                        id="posting-correction-from-account"
                                        style={CORRECTION_INPUT_STYLE}
                                        value={correctionForm.fromAccount}
                                        onInput={(event) => {
                                            const value = (event.currentTarget as HTMLInputElement).value;
                                            setCorrectionForm((prev) => prev ? { ...prev, fromAccount: value } : prev);
                                        }}
                                    />
                                </div>
                                <div style={CORRECTION_FIELD_STYLE}>
                                    <label style={CORRECTION_LABEL_STYLE} htmlFor="posting-correction-to-account">Nytt konto</label>
                                    <input
                                        id="posting-correction-to-account"
                                        style={CORRECTION_INPUT_STYLE}
                                        value={correctionForm.toAccount}
                                        onInput={(event) => {
                                            const value = (event.currentTarget as HTMLInputElement).value;
                                            setCorrectionForm((prev) => prev ? { ...prev, toAccount: value } : prev);
                                        }}
                                        placeholder="t.ex. 3041"
                                    />
                                </div>
                                <div style={CORRECTION_FIELD_STYLE}>
                                    <label style={CORRECTION_LABEL_STYLE} htmlFor="posting-correction-side">Sida</label>
                                    <select
                                        id="posting-correction-side"
                                        style={CORRECTION_INPUT_STYLE}
                                        value={correctionForm.side}
                                        onChange={(event) => {
                                            const value = (event.currentTarget as HTMLSelectElement).value as 'debit' | 'credit';
                                            setCorrectionForm((prev) => prev ? { ...prev, side: value } : prev);
                                        }}
                                    >
                                        <option value="debit">Debet</option>
                                        <option value="credit">Kredit</option>
                                    </select>
                                </div>
                                <div style={CORRECTION_FIELD_STYLE}>
                                    <label style={CORRECTION_LABEL_STYLE} htmlFor="posting-correction-amount">Belopp</label>
                                    <input
                                        id="posting-correction-amount"
                                        style={CORRECTION_INPUT_STYLE}
                                        value={correctionForm.amount}
                                        onInput={(event) => {
                                            const value = (event.currentTarget as HTMLInputElement).value;
                                            setCorrectionForm((prev) => prev ? { ...prev, amount: value } : prev);
                                        }}
                                    />
                                </div>
                                <div style={CORRECTION_FIELD_STYLE}>
                                    <label style={CORRECTION_LABEL_STYLE} htmlFor="posting-correction-series">Serie</label>
                                    <input
                                        id="posting-correction-series"
                                        style={CORRECTION_INPUT_STYLE}
                                        value={correctionForm.voucherSeries}
                                        onInput={(event) => {
                                            const value = (event.currentTarget as HTMLInputElement).value;
                                            setCorrectionForm((prev) => prev ? { ...prev, voucherSeries: value } : prev);
                                        }}
                                    />
                                </div>
                                <div style={CORRECTION_FIELD_STYLE}>
                                    <label style={CORRECTION_LABEL_STYLE} htmlFor="posting-correction-date">Datum</label>
                                    <input
                                        id="posting-correction-date"
                                        type="date"
                                        style={CORRECTION_INPUT_STYLE}
                                        value={correctionForm.transactionDate}
                                        onInput={(event) => {
                                            const value = (event.currentTarget as HTMLInputElement).value;
                                            setCorrectionForm((prev) => prev ? { ...prev, transactionDate: value } : prev);
                                        }}
                                    />
                                </div>
                                <div style={{ ...CORRECTION_FIELD_STYLE, gridColumn: '1 / -1' }}>
                                    <label style={CORRECTION_LABEL_STYLE} htmlFor="posting-correction-reason">Kommentar</label>
                                    <textarea
                                        id="posting-correction-reason"
                                        style={CORRECTION_TEXTAREA_STYLE}
                                        value={correctionForm.reason}
                                        onInput={(event) => {
                                            const value = (event.currentTarget as HTMLTextAreaElement).value;
                                            setCorrectionForm((prev) => prev ? { ...prev, reason: value } : prev);
                                        }}
                                    />
                                </div>
                            </div>
                        )}

                        {correctionError && (
                            <div style={getWarningCardStyle()} data-testid="invoice-posting-correction-error">
                                {isPermissionErrorMessage(correctionError)
                                    ? 'Fortnox-behörighet saknas för att skapa korrigeringsverifikation. Kontrollera rättigheter för Bokföring/Verifikationer.'
                                    : correctionError}
                            </div>
                        )}

                        <div style={CORRECTION_MODAL_ACTIONS_STYLE}>
                            <button
                                type="button"
                                style={ACTION_SECONDARY_BUTTON_STYLE}
                                disabled={correctionSubmitting}
                                onClick={() => setCorrectionOpen(false)}
                            >
                                Avbryt
                            </button>
                            {!correctionResult && (
                                <button
                                    type="button"
                                    style={ACTION_BUTTON_STYLE}
                                    data-testid="invoice-posting-correction-confirm-button"
                                    disabled={correctionSubmitting}
                                    onClick={() => void submitCorrection()}
                                >
                                    {correctionSubmitting ? 'Skapar...' : 'Bekräfta & skapa verifikation'}
                                </button>
                            )}
                        </div>
                    </section>
                </div>
            )}
        </div>
    );
}

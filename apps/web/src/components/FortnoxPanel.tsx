import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { supabase } from '../lib/supabase';
import { fortnoxContextService, type FortnoxConnectionStatus } from '../services/FortnoxContextService';
import { logger } from '../services/LoggerService';
import { companyService } from '../services/CompanyService';
import { CopilotPanel } from './CopilotPanel';
import { getFortnoxList } from '../utils/fortnoxResponse';
import { InvoicePostingReviewDrawer } from './InvoicePostingReviewDrawer';
import {
    getInvoicePostingReviewEnabled,
    invoicePostingReviewService,
    type InvoicePostingTrace,
    type InvoicePostingType,
    type PostingCorrectionResult,
} from '../services/InvoicePostingReviewService';

interface FortnoxPanelProps {
    onBack: () => void;
}

interface SupplierInvoiceSummary {
    GivenNumber: number | string;
    SupplierNumber: string;
    InvoiceNumber: string;
    DueDate: string;
    Total: number | string;
    Balance: number | string;
    Booked: boolean;
    PaymentPending?: boolean;
}

interface CustomerInvoiceSummary {
    InvoiceNumber?: number | string;
    DocumentNumber?: number | string;
    CustomerNumber: string;
    DueDate?: string;
    Total?: number;
    Balance?: number;
    Booked?: boolean;
    Cancelled?: boolean;
}

type InvoiceView = 'supplier' | 'customer';
type SupplierFilterMode = 'all' | 'unbooked' | 'overdue' | 'authorizepending';
type CustomerFilterMode = 'all' | 'unpaid' | 'overdue';
type TableAlign = 'left' | 'right';
type PermissionState = 'ok' | 'missing' | 'unknown';

interface TableColumn {
    key: string;
    label: string;
    align?: TableAlign;
}

interface TableCell {
    key: string;
    content: string | number;
    align?: TableAlign;
    nowrap?: boolean;
}

interface InvoiceSummaryData {
    overdue: number;
    unbooked: number;
    total: number;
    unbookedLabel: string;
}

interface OptionItem<T extends string> {
    id: T;
    label: string;
}

function todayString(): string {
    return new Date().toISOString().split('T')[0];
}

function buildIdempotencyKey(action: 'bookkeep' | 'payment', givenNumber: number): string {
    return `fortnox_panel:approve_supplier_invoice:${action}:${givenNumber}`;
}

function toNumber(value: number | string | null | undefined): number {
    if (typeof value === 'number') return value;
    if (value === null || value === undefined) return 0;
    const normalized = String(value).replace(/\s+/g, '').replace(',', '.');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
}

function hasOutstandingBalance(value: number | string | null | undefined): boolean {
    return toNumber(value) > 0;
}

function isInvoiceOverdue(
    dueDate: string | undefined,
    balance: number | string | null | undefined,
    today = todayString()
): boolean {
    const normalizedDueDate = dueDate ?? '';
    if (!normalizedDueDate) return false;
    return hasOutstandingBalance(balance) && normalizedDueDate < today;
}

function formatAmount(value: number): string {
    const numeric = toNumber(value);
    return numeric.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(value?: string): string {
    if (!value) return '—';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleDateString('sv-SE');
}

function getStatus(invoice: SupplierInvoiceSummary, mode?: SupplierFilterMode): string {
    if (mode === 'authorizepending') {
        return 'Attest väntar';
    }
    if (isInvoiceOverdue(invoice.DueDate, invoice.Balance)) {
        return 'Förfallen';
    }
    if (!invoice.Booked) return 'Obokförd';
    return 'Bokförd';
}

function getCustomerStatus(invoice: CustomerInvoiceSummary): string {
    if (invoice.Cancelled) return 'Makulerad';
    if (isInvoiceOverdue(invoice.DueDate, invoice.Balance)) {
        return 'Förfallen';
    }
    if (hasOutstandingBalance(invoice.Balance)) return 'Obetald';
    if (invoice.Booked) return 'Bokförd';
    return 'Skapad';
}

function toTraceInvoiceId(value: unknown): number | null {
    const numeric = typeof value === 'number'
        ? value
        : typeof value === 'string'
            ? Number(value.trim())
            : NaN;
    if (!Number.isFinite(numeric) || numeric < 1) {
        return null;
    }
    return Math.round(numeric);
}

function resolveCustomerTraceInvoiceId(invoice: CustomerInvoiceSummary): number | null {
    return toTraceInvoiceId(invoice.InvoiceNumber) ?? toTraceInvoiceId(invoice.DocumentNumber);
}

function getCustomerInvoiceDisplayNumber(invoice: CustomerInvoiceSummary): string {
    const resolved = resolveCustomerTraceInvoiceId(invoice);
    return resolved === null ? '—' : String(resolved);
}

function summarizeSupplierInvoices(
    source: SupplierInvoiceSummary[],
    today = todayString()
): InvoiceSummaryData {
    let overdue = 0;
    let unbooked = 0;

    for (const invoice of source) {
        if (isInvoiceOverdue(invoice.DueDate, invoice.Balance, today)) {
            overdue += 1;
        }
        if (!invoice.Booked && hasOutstandingBalance(invoice.Balance)) {
            unbooked += 1;
        }
    }

    return {
        overdue,
        unbooked,
        total: source.length,
        unbookedLabel: 'Obokförda',
    };
}

function summarizeCustomerInvoices(
    source: CustomerInvoiceSummary[],
    today = todayString()
): InvoiceSummaryData {
    let overdue = 0;
    let unpaid = 0;

    for (const invoice of source) {
        if (isInvoiceOverdue(invoice.DueDate, invoice.Balance, today)) {
            overdue += 1;
        }
        if (hasOutstandingBalance(invoice.Balance)) {
            unpaid += 1;
        }
    }

    return {
        overdue,
        unbooked: unpaid,
        total: source.length,
        unbookedLabel: 'Obetalda',
    };
}

const INVOICE_TABLE_STYLE = { width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' } as const;
const TABLE_HEADER_LEFT_STYLE = { textAlign: 'left', padding: '0.4rem 0.5rem', color: 'var(--text-secondary)' } as const;
const TABLE_HEADER_RIGHT_STYLE = { textAlign: 'right', padding: '0.4rem 0.5rem', color: 'var(--text-secondary)' } as const;
const TABLE_CELL_STYLE = { padding: '0.35rem 0.5rem' } as const;
const TABLE_CELL_NOWRAP_STYLE = { padding: '0.35rem 0.5rem', whiteSpace: 'nowrap' } as const;
const TABLE_CELL_RIGHT_STYLE = { padding: '0.35rem 0.5rem', textAlign: 'right' } as const;
const TABLE_EMPTY_CELL_STYLE = { padding: '0.8rem', color: 'var(--text-secondary)' } as const;
const TABLE_ACTIONS_WRAP_STYLE = { display: 'flex', gap: '0.4rem', justifyContent: 'flex-end', flexWrap: 'wrap' } as const;
const TOOLBAR_BUTTON_BASE_STYLE = {
    height: '34px',
    padding: '0 0.8rem',
    borderRadius: '10px',
    border: '1px solid var(--glass-border)',
    fontSize: '0.78rem',
    fontWeight: 600,
    display: 'inline-flex',
    alignItems: 'center'
} as const;
const FORTNOX_PANEL_ROOT_STYLE = { display: 'flex', flexDirection: 'column', gap: '1.2rem' } as const;
const FORTNOX_HEADER_STYLE = { display: 'flex', alignItems: 'center', gap: '0.75rem' } as const;
const FORTNOX_BACK_BUTTON_STYLE = {
    background: 'transparent',
    border: '1px solid var(--glass-border)',
    borderRadius: '8px',
    color: 'var(--text-secondary)',
    padding: '0.4rem 0.75rem',
    fontSize: '0.8rem',
    cursor: 'pointer'
} as const;
const FORTNOX_HEADER_HINT_STYLE = { fontSize: '0.85rem', color: 'var(--text-secondary)' } as const;
const FORTNOX_SUMMARY_GRID_STYLE = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: '0.75rem'
} as const;
const FORTNOX_SUMMARY_UPDATED_STYLE = { fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)' } as const;
const FORTNOX_PERMISSION_CARD_STYLE = { display: 'flex', flexDirection: 'column', gap: '0.6rem' } as const;
const FORTNOX_PERMISSION_ROW_STYLE = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' } as const;
const FORTNOX_PERMISSION_TEXT_STYLE = { display: 'flex', flexDirection: 'column', gap: '0.2rem' } as const;
const FORTNOX_PERMISSION_MESSAGE_STYLE = { fontSize: '0.85rem', color: 'var(--text-primary)' } as const;
const FORTNOX_MAIN_GRID_STYLE = {
    display: 'grid',
    gap: '1rem',
    alignItems: 'stretch'
} as const;
const FORTNOX_TABLE_CARD_STYLE = {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
    minHeight: 0,
    height: '100%'
} as const;
const FORTNOX_TABLE_HEADER_STYLE = { display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' } as const;
const FORTNOX_TABLE_TITLE_WRAP_STYLE = { display: 'flex', flexDirection: 'column', gap: '0.35rem' } as const;
const FORTNOX_SECTION_TITLE_STYLE = { margin: 0 } as const;
const FORTNOX_TABLE_SUBTEXT_STYLE = { fontSize: '0.8rem', color: 'var(--text-secondary)' } as const;
const FORTNOX_TOOLBAR_GROUP_STYLE = { display: 'flex', gap: '0.5rem', flexWrap: 'wrap' } as const;
const FORTNOX_ERROR_BOX_STYLE = {
    padding: '0.6rem 0.8rem',
    borderRadius: '8px',
    background: 'rgba(239, 68, 68, 0.12)',
    color: '#ef4444',
    fontSize: '0.8rem',
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
} as const;
const FORTNOX_RETRY_BUTTON_STYLE = {
    marginLeft: 'auto',
    flexShrink: 0,
    padding: '0.2rem 0.6rem',
    borderRadius: '8px',
    border: '1px solid rgba(239,68,68,0.4)',
    background: 'transparent',
    color: '#ef4444',
    fontSize: '0.75rem',
    cursor: 'pointer',
} as const;
const CONFIRM_OVERLAY_STYLE = {
    position: 'fixed' as const,
    inset: 0,
    zIndex: 3000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0,0,0,0.45)',
    backdropFilter: 'blur(4px)',
};
const CONFIRM_DIALOG_STYLE = {
    background: 'var(--surface-2, #1e293b)',
    borderRadius: '12px',
    padding: '1.5rem',
    maxWidth: '420px',
    width: '90vw',
    boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
    border: '1px solid var(--border-subtle, rgba(255,255,255,0.08))',
};
const CONFIRM_MESSAGE_STYLE = {
    margin: '0 0 1.25rem',
    fontSize: '0.9rem',
    color: 'var(--text-primary)',
    lineHeight: 1.6,
    whiteSpace: 'pre-line' as const,
};
const CONFIRM_ACTIONS_STYLE = {
    display: 'flex',
    gap: '0.75rem',
    justifyContent: 'flex-end',
};
const CONFIRM_CANCEL_STYLE = {
    padding: '0.5rem 1rem',
    borderRadius: '8px',
    border: '1px solid var(--border-subtle, rgba(255,255,255,0.12))',
    background: 'transparent',
    color: 'var(--text-secondary)',
    fontSize: '0.875rem',
    cursor: 'pointer',
};
const CONFIRM_OK_STYLE = {
    padding: '0.5rem 1rem',
    borderRadius: '8px',
    border: 'none',
    background: 'var(--accent, #3b82f6)',
    color: '#fff',
    fontSize: '0.875rem',
    cursor: 'pointer',
    fontWeight: 500,
};
const TOAST_STYLE = {
    position: 'fixed' as const,
    bottom: '1.5rem',
    right: '1.5rem',
    zIndex: 4000,
    padding: '0.7rem 1.1rem',
    borderRadius: '10px',
    background: 'var(--surface-2, #1e293b)',
    border: '1px solid rgba(16,185,129,0.4)',
    color: '#10b981',
    fontSize: '0.875rem',
    fontWeight: 500,
    boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
    pointerEvents: 'none' as const,
};
const FORTNOX_TABLE_SCROLL_STYLE = {
    overflowX: 'auto',
    overflowY: 'auto',
    flex: 1,
    minHeight: '360px'
} as const;
const FORTNOX_COPILOT_CARD_STYLE = {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
    minHeight: 0,
    height: '100%'
} as const;
const FORTNOX_COPILOT_SUBTEXT_STYLE = { fontSize: '0.8rem', color: 'var(--text-secondary)' } as const;
const INVOICE_VIEW_OPTIONS: OptionItem<InvoiceView>[] = [
    { id: 'supplier', label: 'Leverantörer' },
    { id: 'customer', label: 'Kunder' },
];
const SUPPLIER_FILTER_OPTIONS: OptionItem<SupplierFilterMode>[] = [
    { id: 'all', label: 'Alla' },
    { id: 'unbooked', label: 'Obokförda' },
    { id: 'overdue', label: 'Förfallna' },
    { id: 'authorizepending', label: 'Under attest' },
];
const CUSTOMER_FILTER_OPTIONS: OptionItem<CustomerFilterMode>[] = [
    { id: 'all', label: 'Alla' },
    { id: 'unpaid', label: 'Obetalda' },
    { id: 'overdue', label: 'Förfallna' },
];
const SUPPLIER_BASE_COLUMNS: TableColumn[] = [
    { key: 'invoice', label: 'Faktura' },
    { key: 'supplier', label: 'Lev.nr' },
    { key: 'dueDate', label: 'Förfallo' },
    { key: 'total', label: 'Belopp', align: 'right' },
    { key: 'balance', label: 'Rest', align: 'right' },
    { key: 'status', label: 'Status' }
];
const TRACE_ACTION_COLUMN: TableColumn = { key: 'trace', label: 'Kontering', align: 'right' };
const SUPPLIER_ACTION_COLUMN: TableColumn = { key: 'action', label: 'Åtgärd', align: 'right' };
const CUSTOMER_COLUMNS: TableColumn[] = [
    { key: 'invoice', label: 'Faktura' },
    { key: 'customer', label: 'Kund.nr' },
    { key: 'dueDate', label: 'Förfallo' },
    { key: 'total', label: 'Belopp', align: 'right' },
    { key: 'balance', label: 'Rest', align: 'right' },
    { key: 'status', label: 'Status' }
];
const CUSTOMER_COLUMNS_WITH_TRACE: TableColumn[] = [...CUSTOMER_COLUMNS, TRACE_ACTION_COLUMN];
const CUSTOMER_TRACE_ID_MISSING_MESSAGE = 'Kundfakturan saknar läsbart Fortnox-ID (InvoiceNumber/DocumentNumber).';

function getHeaderCellStyle(align: TableAlign = 'left') {
    return align === 'right' ? TABLE_HEADER_RIGHT_STYLE : TABLE_HEADER_LEFT_STYLE;
}

function getDataCellStyle(align: TableAlign = 'left', nowrap = false) {
    if (nowrap) return TABLE_CELL_NOWRAP_STYLE;
    return align === 'right' ? TABLE_CELL_RIGHT_STYLE : TABLE_CELL_STYLE;
}

function renderTableHeader(columns: TableColumn[]) {
    return (
        <thead>
            <tr>
                {columns.map((column) => (
                    <th key={column.key} style={getHeaderCellStyle(column.align)}>
                        {column.label}
                    </th>
                ))}
            </tr>
        </thead>
    );
}

function renderTableCells(cells: TableCell[]) {
    return cells.map((cell) => (
        <td key={cell.key} style={getDataCellStyle(cell.align, cell.nowrap)}>
            {cell.content}
        </td>
    ));
}

function getApprovalButtonStyle(action: 'bookkeep' | 'payment', isLoading: boolean) {
    const palette = action === 'bookkeep'
        ? { background: 'rgba(16, 185, 129, 0.15)', color: '#10b981' }
        : { background: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6' };
    return {
        height: '30px',
        padding: '0 0.7rem',
        borderRadius: '8px',
        border: '1px solid var(--glass-border)',
        background: palette.background,
        color: palette.color,
        fontSize: '0.72rem',
        fontWeight: 600,
        cursor: isLoading ? 'wait' : 'pointer'
    } as const;
}

function getSelectorButtonStyle(isActive: boolean, activeBackground: string, activeColor: string) {
    return {
        ...TOOLBAR_BUTTON_BASE_STYLE,
        background: isActive ? activeBackground : 'transparent',
        color: isActive ? activeColor : 'var(--text-secondary)',
        cursor: 'pointer'
    } as const;
}

function getRefreshButtonStyle(isLoading: boolean) {
    return {
        ...TOOLBAR_BUTTON_BASE_STYLE,
        background: 'transparent',
        color: 'var(--text-secondary)',
        cursor: isLoading ? 'wait' : 'pointer'
    } as const;
}

function getTraceButtonStyle(isLoading: boolean, disabled = false) {
    return {
        ...TOOLBAR_BUTTON_BASE_STYLE,
        height: '30px',
        background: 'rgba(148, 163, 184, 0.16)',
        color: 'var(--text-primary)',
        fontSize: '0.72rem',
        borderRadius: '8px',
        cursor: isLoading ? 'wait' : disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.62 : 1,
    } as const;
}

function getPermissionBadgeStyle(status: PermissionState) {
    return {
        padding: '0.25rem 0.75rem',
        borderRadius: '999px',
        fontSize: '0.75rem',
        fontWeight: 600,
        background: status === 'ok'
            ? 'rgba(16, 185, 129, 0.15)'
            : status === 'missing'
                ? 'rgba(239, 68, 68, 0.15)'
                : 'rgba(255, 255, 255, 0.08)',
        color: status === 'ok'
            ? '#10b981'
            : status === 'missing'
                ? '#ef4444'
                : 'var(--text-secondary)'
    } as const;
}

function getPermissionBadgeLabel(status: PermissionState): string {
    if (status === 'ok') return 'OK';
    if (status === 'missing') return 'Saknas';
    return 'Okänt';
}

function getInvoiceSectionTitle(isSupplierView: boolean): string {
    return isSupplierView ? 'Leverantörsfakturor' : 'Kundfakturor';
}

function getInvoiceSectionDescription(isSupplierView: boolean): string {
    return isSupplierView
        ? 'Filtrera och följ upp leverantörsfakturor i Fortnox.'
        : 'Filtrera och följ upp kundfakturor i Fortnox.';
}

function isSupplierActionLoading(actionLoadingId: string | null, givenNumber: number | string): boolean {
    return actionLoadingId === String(givenNumber);
}

function buildSupplierTableCells(invoice: SupplierInvoiceSummary, mode: SupplierFilterMode): TableCell[] {
    return [
        { key: 'invoice', content: String(invoice.InvoiceNumber || invoice.GivenNumber), nowrap: true },
        { key: 'supplier', content: invoice.SupplierNumber },
        { key: 'dueDate', content: formatDate(invoice.DueDate) },
        { key: 'total', content: formatAmount(toNumber(invoice.Total)), align: 'right' },
        { key: 'balance', content: formatAmount(toNumber(invoice.Balance)), align: 'right' },
        { key: 'status', content: getStatus(invoice, mode) },
    ];
}

function buildCustomerTableCells(invoice: CustomerInvoiceSummary): TableCell[] {
    return [
        { key: 'invoice', content: getCustomerInvoiceDisplayNumber(invoice), nowrap: true },
        { key: 'customer', content: invoice.CustomerNumber },
        { key: 'dueDate', content: formatDate(invoice.DueDate) },
        { key: 'total', content: formatAmount(toNumber(invoice.Total)), align: 'right' },
        { key: 'balance', content: formatAmount(toNumber(invoice.Balance)), align: 'right' },
        { key: 'status', content: getCustomerStatus(invoice) },
    ];
}

function PermissionStatusRow({
    title,
    message,
    status,
    messageTestId,
    badgeTestId,
}: {
    title: string;
    message: string;
    status: PermissionState;
    messageTestId: string;
    badgeTestId: string;
}) {
    return (
        <div style={FORTNOX_PERMISSION_ROW_STYLE}>
            <div style={FORTNOX_PERMISSION_TEXT_STYLE}>
                <div className="panel-label">{title}</div>
                <div data-testid={messageTestId} style={FORTNOX_PERMISSION_MESSAGE_STYLE}>
                    {message}
                </div>
            </div>
            <span data-testid={badgeTestId} style={getPermissionBadgeStyle(status)}>
                {getPermissionBadgeLabel(status)}
            </span>
        </div>
    );
}

function SummaryStatCard({ label, value }: { label: string; value: number }) {
    return (
        <div className="panel-card panel-card--no-hover">
            <div className="panel-label">{label}</div>
            <div className="panel-stat panel-stat--neutral">{value}</div>
        </div>
    );
}

function renderEmptyInvoiceTableRow(columnCount: number) {
    return (
        <tr>
            <td colSpan={columnCount} style={TABLE_EMPTY_CELL_STYLE}>
                Inga fakturor att visa.
            </td>
        </tr>
    );
}

const SKELETON_WIDTHS = ['60%', '80%', '45%', '70%', '55%'];

function renderSkeletonRows(columnCount: number, rowCount = 4) {
    return Array.from({ length: rowCount }, (_, rowIdx) => (
        <tr key={`skel-${rowIdx}`} aria-hidden="true">
            {Array.from({ length: columnCount }, (__, colIdx) => (
                <td key={colIdx} style={{ padding: '10px 12px' }}>
                    <div
                        className="skeleton skeleton-line"
                        style={{ width: SKELETON_WIDTHS[(rowIdx + colIdx) % SKELETON_WIDTHS.length], height: '0.85rem' }}
                    />
                </td>
            ))}
        </tr>
    ));
}

export function FortnoxPanel({ onBack }: FortnoxPanelProps) {
    const fortnoxEndpoint = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fortnox`;
    const [connectionStatus, setConnectionStatus] = useState<FortnoxConnectionStatus>(
        fortnoxContextService.getConnectionStatus()
    );
    const [loadingSupplier, setLoadingSupplier] = useState(false);
    const [loadingCustomer, setLoadingCustomer] = useState(false);
    const [supplierError, setSupplierError] = useState<string | null>(null);
    const [customerError, setCustomerError] = useState<string | null>(null);
    const [invoices, setInvoices] = useState<SupplierInvoiceSummary[]>([]);
    const [pendingInvoices, setPendingInvoices] = useState<SupplierInvoiceSummary[] | null>(null);
    const [customerInvoices, setCustomerInvoices] = useState<CustomerInvoiceSummary[] | null>(null);
    const [invoiceView, setInvoiceView] = useState<InvoiceView>('supplier');
    const [supplierFilter, setSupplierFilter] = useState<SupplierFilterMode>('all');
    const [customerFilter, setCustomerFilter] = useState<CustomerFilterMode>('all');
    const [lastUpdated, setLastUpdated] = useState<string | null>(null);
    const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
    const [scopeStatus, setScopeStatus] = useState<PermissionState>('unknown');
    const [scopeMessage, setScopeMessage] = useState<string>('Ej kontrollerad');
    const [attestStatus, setAttestStatus] = useState<PermissionState>('unknown');
    const [attestMessage, setAttestMessage] = useState<string>('Ej kontrollerad');
    const [postingDrawerOpen, setPostingDrawerOpen] = useState(false);
    const [postingTraceLoading, setPostingTraceLoading] = useState(false);
    const [postingTraceError, setPostingTraceError] = useState<string | null>(null);
    const [postingTrace, setPostingTrace] = useState<InvoicePostingTrace | null>(null);
    const invoicePostingReviewEnabled = getInvoicePostingReviewEnabled();
    const [confirmState, setConfirmState] = useState<{ message: string; onConfirm: () => void } | null>(null);
    const [toast, setToast] = useState<string | null>(null);
    const [tableScrollEdge, setTableScrollEdge] = useState<'none' | 'right' | 'both' | 'left'>('none');
    const tableScrollRef = useRef<HTMLDivElement>(null);

    const handleTableScroll = useCallback(() => {
        const el = tableScrollRef.current;
        if (!el) return;
        const canScroll = el.scrollWidth > el.clientWidth + 4;
        if (!canScroll) { setTableScrollEdge('none'); return; }
        const atStart = el.scrollLeft <= 2;
        const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
        setTableScrollEdge(atStart ? 'right' : atEnd ? 'left' : 'both');
    }, []);

    useEffect(() => {
        handleTableScroll();
    }, [loadingSupplier, loadingCustomer, handleTableScroll]);

    const showToast = (msg: string) => {
        setToast(msg);
        setTimeout(() => setToast(null), 3000);
    };

    const updateScopeStatus = (message?: string, ok = false) => {
        if (ok) {
            setScopeStatus('ok');
            setScopeMessage('Behörigheter OK');
            return;
        }

        if (!message) {
            setScopeStatus('unknown');
            setScopeMessage('Kunde inte verifiera behörigheter');
            return;
        }

        const text = message.toLowerCase();

        // Match on Fortnox error codes first (most reliable)
        const scopeErrors: Record<string, string> = {
            '2003275': 'Saknar behörighet för Leverantörsregister. Kontrollera modul i Fortnox och koppla om.',
            '2000663': 'Saknar behörighet för Leverantör/Leverantörsfaktura. Uppdatera scopes och koppla om.',
            '2000664': 'Saknar behörighet för Leverantörsfaktura. Uppdatera scopes och koppla om.',
        };

        for (const [code, msg] of Object.entries(scopeErrors)) {
            if (text.includes(code)) {
                setScopeStatus('missing');
                setScopeMessage(msg);
                return;
            }
        }

        // Keyword fallback — less reliable but catches edge cases
        const hasAuthKeyword = text.includes('behörighet') || text.includes('scope')
            || text.includes('permission') || text.includes('forbidden');
        const hasNegation = text.includes('saknar') || text.includes('missing')
            || text.includes('denied') || text.includes('403');

        if (hasAuthKeyword && hasNegation) {
            setScopeStatus('missing');
            setScopeMessage('Saknar nödvändiga behörigheter i Fortnox. Kontrollera scopes och koppla om.');
            return;
        }

        if (text.includes('401') || text.includes('unauthorized')) {
            setScopeStatus('missing');
            setScopeMessage('Fortnox-sessionen har gått ut. Koppla om i Integrationer.');
            return;
        }

        setScopeStatus('unknown');
        setScopeMessage('Kunde inte verifiera behörigheter');
    };

    const updateAttestStatus = (message?: string, ok = false) => {
        if (ok) {
            setAttestStatus('ok');
            setAttestMessage('Attestbehörighet OK');
            return;
        }

        const text = (message || '').toLowerCase();
        const hasPermissionText = text.includes('saknar behörighet');
        const isAttest = text.includes('attest') || text.includes('approval');
        const isSupplierInvoice = text.includes('leverantörsfaktura');

        if (hasPermissionText && (isAttest || isSupplierInvoice)) {
            setAttestStatus('missing');
            setAttestMessage('Saknar behörighet för Leverantörsfakturaattest i Fortnox. Aktivera rättighet och koppla om.');
            return;
        }

        setAttestStatus('unknown');
        setAttestMessage('Kunde inte verifiera attestbehörighet');
    };

    const getSessionAccessToken = async (): Promise<string | null> => {
        const { data: session } = await supabase.auth.getSession();
        return session?.session?.access_token ?? null;
    };

    const buildAuthHeaders = (accessToken: string): Record<string, string> => ({
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
    });

    async function callFortnox<T>(
        action: string,
        options: {
            payload?: Record<string, unknown>;
            fallbackErrorMessage: string;
            missingAuthMessage: string;
        }
    ): Promise<{ ok: true; data: T } | { ok: false; message: string; authMissing: boolean }> {
        const accessToken = await getSessionAccessToken();
        if (!accessToken) {
            return { ok: false, message: options.missingAuthMessage, authMissing: true };
        }

        const body: Record<string, unknown> = { action };
        body.companyId = companyService.getCurrentId();
        if (options.payload !== undefined) {
            body.payload = options.payload;
        }

        const response = await fetch(fortnoxEndpoint, {
            method: 'POST',
            headers: buildAuthHeaders(accessToken),
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorData = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
            const message = errorData.message || errorData.error || options.fallbackErrorMessage;
            return { ok: false, message, authMissing: false };
        }

        const data = await response.json() as T;
        return { ok: true, data };
    }

    const loadSupplierInvoices = async (options?: { filter?: string; target?: 'all' | 'pending' }) => {
        const target = options?.target ?? 'all';
        setLoadingSupplier(true);
        setSupplierError(null);
        try {
            const result = await callFortnox<{ [key: string]: unknown }>('getSupplierInvoices', {
                payload: options?.filter ? { filter: options.filter } : {},
                fallbackErrorMessage: 'Kunde inte hämta leverantörsfakturor.',
                missingAuthMessage: 'Du måste vara inloggad för att hämta Fortnox-data.'
            });

            if (!result.ok) {
                setSupplierError(result.message);
                updateScopeStatus(result.authMissing ? 'missing' : result.message);
                if (target === 'pending') setPendingInvoices((prev) => prev ?? []);
                return;
            }

            const items = getFortnoxList<SupplierInvoiceSummary>(result.data, 'SupplierInvoices');
            if (target === 'pending') {
                setPendingInvoices(items);
            } else {
                setInvoices(items);
            }
            setLastUpdated(new Date().toISOString());
            updateScopeStatus(undefined, true);
        } catch (err) {
            logger.error('Failed to load Fortnox invoices', err);
            setSupplierError('Ett fel uppstod vid hämtning av Fortnox-data.');
            updateScopeStatus('unknown');
            if (target === 'pending') setPendingInvoices((prev) => prev ?? []);
        } finally {
            setLoadingSupplier(false);
        }
    };

    // Sync connection status from service
    useEffect(() => {
        const handler = (e: Event) => {
            setConnectionStatus((e as CustomEvent<FortnoxConnectionStatus>).detail);
        };
        fortnoxContextService.addEventListener('connection-changed', handler);
        return () => fortnoxContextService.removeEventListener('connection-changed', handler);
    }, []);

    useEffect(() => {
        if (connectionStatus === 'connected') {
            void loadSupplierInvoices({ target: 'all' });
        }
    }, [connectionStatus]);

    useEffect(() => {
        if (connectionStatus !== 'connected') return;
        if (supplierFilter === 'authorizepending' && pendingInvoices === null && !loadingSupplier) {
            void loadSupplierInvoices({ filter: 'authorizepending', target: 'pending' });
        }
    }, [connectionStatus, supplierFilter, pendingInvoices, loadingSupplier]);

    const loadCustomerInvoices = async () => {
        setLoadingCustomer(true);
        setCustomerError(null);
        try {
            const result = await callFortnox<{ [key: string]: unknown }>('getInvoices', {
                fallbackErrorMessage: 'Kunde inte hämta kundfakturor.',
                missingAuthMessage: 'Du måste vara inloggad för att hämta Fortnox-data.'
            });

            if (!result.ok) {
                setCustomerError(result.message);
                updateScopeStatus(result.authMissing ? 'missing' : result.message);
                setCustomerInvoices((prev) => prev ?? []);
                return;
            }

            const items = getFortnoxList<CustomerInvoiceSummary>(result.data, 'Invoices');
            setCustomerInvoices(items);
            setLastUpdated(new Date().toISOString());
            if (scopeStatus !== 'missing') {
                updateScopeStatus(undefined, true);
            }
        } catch (err) {
            logger.error('Failed to load Fortnox customer invoices', err);
            setCustomerError('Ett fel uppstod vid hämtning av Fortnox-data.');
            setCustomerInvoices((prev) => prev ?? []);
            if (scopeStatus !== 'missing') {
                updateScopeStatus('unknown');
            }
        } finally {
            setLoadingCustomer(false);
        }
    };

    const approveSupplierInvoice = (givenNumberRaw: number | string, action: 'bookkeep' | 'payment') => {
        const givenNumber = Number(givenNumberRaw);
        if (!Number.isFinite(givenNumber)) {
            setSupplierError('Kunde inte läsa fakturanummer för attest.');
            return;
        }

        const confirmText = action === 'bookkeep'
            ? `Vill du attestera bokföring för faktura ${givenNumber}?\n\nKontrollera att uppgifterna stämmer. Du som företagare ansvarar för att bokföringen är korrekt.`
            : `Vill du attestera betalning för faktura ${givenNumber}?\n\nKontrollera att uppgifterna stämmer. Du som företagare ansvarar för att bokföringen är korrekt.`;

        setConfirmState({
            message: confirmText,
            onConfirm: async () => {
                setConfirmState(null);
                setActionLoadingId(String(givenNumberRaw));
                setSupplierError(null);
                try {
                    const result = await callFortnox(
                        action === 'bookkeep' ? 'approveSupplierInvoiceBookkeep' : 'approveSupplierInvoicePayment',
                        {
                            payload: {
                                givenNumber,
                                idempotencyKey: buildIdempotencyKey(action, givenNumber),
                                sourceContext: 'fortnox-panel',
                            },
                            fallbackErrorMessage: 'Kunde inte attestera fakturan.',
                            missingAuthMessage: 'Du måste vara inloggad för att attestera.'
                        }
                    );

                    if (!result.ok) {
                        setSupplierError(result.message);
                        if (!result.authMissing) {
                            updateScopeStatus(result.message);
                            updateAttestStatus(result.message);
                        }
                        return;
                    }

                    updateAttestStatus(undefined, true);
                    invoicePostingReviewService.invalidateInvoice(companyService.getCurrentId(), 'supplier', givenNumber);
                    await loadSupplierInvoices({ target: 'all' });
                    if (supplierFilter === 'authorizepending') {
                        await loadSupplierInvoices({ filter: 'authorizepending', target: 'pending' });
                    }
                    showToast(action === 'bookkeep' ? '✓ Bokföring attesterad' : '✓ Betalning attesterad');
                } catch (err) {
                    logger.error('Failed to approve supplier invoice', err);
                    setSupplierError('Ett fel uppstod vid attestering.');
                } finally {
                    setActionLoadingId(null);
                }
            },
        });
    };

    const openPostingTrace = async (invoiceType: InvoicePostingType, invoiceId: number | string) => {
        if (!invoicePostingReviewEnabled) return;
        const numericInvoiceId = Number(invoiceId);
        if (!Number.isFinite(numericInvoiceId)) {
            setPostingTraceError(
                invoiceType === 'customer'
                    ? CUSTOMER_TRACE_ID_MISSING_MESSAGE
                    : 'Kunde inte läsa faktura-id för kontering.'
            );
            setPostingDrawerOpen(true);
            return;
        }

        setPostingDrawerOpen(true);
        setPostingTraceLoading(true);
        setPostingTraceError(null);
        setPostingTrace(null);

        try {
            const trace = await invoicePostingReviewService.fetchPostingTrace({
                companyId: companyService.getCurrentId(),
                invoiceType,
                invoiceId: numericInvoiceId,
                forceRefresh: true,
            });
            setPostingTrace(trace);
        } catch (error) {
            setPostingTrace(null);
            setPostingTraceError(error instanceof Error ? error.message : 'Kunde inte hämta kontering.');
        } finally {
            setPostingTraceLoading(false);
        }
    };

    const createPostingCorrectionVoucher = async (payload: {
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
    }): Promise<PostingCorrectionResult> => {
        const companyId = companyService.getCurrentId();
        const created = await invoicePostingReviewService.createPostingCorrectionVoucher({
            companyId,
            invoiceType: payload.invoiceType,
            invoiceId: payload.invoiceId,
            correction: payload.correction,
            sourceContext: 'invoice-posting-review',
        });

        // Refresh the posting trace after successful creation.
        // This is best-effort: if the refresh fails we still return the created voucher
        // so the drawer can show the success state rather than a misleading error.
        invoicePostingReviewService.invalidateInvoice(companyId, payload.invoiceType, payload.invoiceId);
        try {
            const refreshed = await invoicePostingReviewService.fetchPostingTrace({
                companyId,
                invoiceType: payload.invoiceType,
                invoiceId: payload.invoiceId,
                forceRefresh: true,
            });
            setPostingTrace(refreshed);
            setPostingTraceError(null);
        } catch {
            // Non-fatal: the voucher was created; the trace will refresh on next open
        }

        return created;
    };

    useEffect(() => {
        if (connectionStatus !== 'connected') return;
        if (invoiceView === 'customer' && customerInvoices === null && !loadingCustomer) {
            void loadCustomerInvoices();
        }
    }, [connectionStatus, invoiceView, customerInvoices, loadingCustomer]);

    const filteredSupplierInvoices = useMemo(() => {
        const today = todayString();
        switch (supplierFilter) {
            case 'authorizepending':
                return pendingInvoices ?? [];
            case 'unbooked':
                return invoices.filter((inv) => !inv.Booked && hasOutstandingBalance(inv.Balance));
            case 'overdue':
                return invoices.filter((inv) => isInvoiceOverdue(inv.DueDate, inv.Balance, today));
            default:
                return invoices;
        }
    }, [supplierFilter, invoices, pendingInvoices]);

    const filteredCustomerInvoices = useMemo(() => {
        const today = todayString();
        const source = customerInvoices ?? [];
        switch (customerFilter) {
            case 'unpaid':
                return source.filter((inv) => hasOutstandingBalance(inv.Balance));
            case 'overdue':
                return source.filter((inv) => isInvoiceOverdue(inv.DueDate, inv.Balance, today));
            default:
                return source;
        }
    }, [customerFilter, customerInvoices]);

    const summary = useMemo(() => {
        const today = todayString();
        if (invoiceView === 'customer') {
            const source = customerInvoices ?? [];
            return summarizeCustomerInvoices(source, today);
        }
        return summarizeSupplierInvoices(invoices, today);
    }, [invoiceView, invoices, customerInvoices]);
    const summaryCards = [
        { id: 'overdue', label: 'Förfallna', value: summary.overdue },
        { id: 'unbooked', label: summary.unbookedLabel, value: summary.unbooked },
        { id: 'total', label: 'Totalt', value: summary.total },
    ] as const;

    const isSupplierView = invoiceView === 'supplier';
    const activeFilterOptions = isSupplierView ? SUPPLIER_FILTER_OPTIONS : CUSTOMER_FILTER_OPTIONS;
    const activeFilter = isSupplierView ? supplierFilter : customerFilter;
    const activeError = isSupplierView ? supplierError : customerError;
    const activeLoading = isSupplierView ? loadingSupplier : loadingCustomer;
    const supplierColumns: TableColumn[] = [
        ...SUPPLIER_BASE_COLUMNS,
        ...(invoicePostingReviewEnabled ? [TRACE_ACTION_COLUMN] : []),
        ...(supplierFilter === 'authorizepending' ? [SUPPLIER_ACTION_COLUMN] : []),
    ];
    const customerColumns = invoicePostingReviewEnabled ? CUSTOMER_COLUMNS_WITH_TRACE : CUSTOMER_COLUMNS;

    function applyActiveFilter(optionId: SupplierFilterMode | CustomerFilterMode): void {
        if (isSupplierView) {
            setSupplierFilter(optionId as SupplierFilterMode);
            return;
        }
        setCustomerFilter(optionId as CustomerFilterMode);
    }

    function refreshActiveView(): void {
        if (isSupplierView) {
            if (supplierFilter === 'authorizepending') {
                void loadSupplierInvoices({ filter: 'authorizepending', target: 'pending' });
                return;
            }
            void loadSupplierInvoices({ target: 'all' });
            return;
        }
        void loadCustomerInvoices();
    }

    return (
        <div
            className="panel-stagger fortnox-workspace-panel"
            data-testid="fortnox-panel-root"
            style={FORTNOX_PANEL_ROOT_STYLE}
        >
            <div style={FORTNOX_HEADER_STYLE}>
                <button
                    type="button"
                    onClick={onBack}
                    style={FORTNOX_BACK_BUTTON_STYLE}
                >
                    Tillbaka
                </button>
                <span style={FORTNOX_HEADER_HINT_STYLE}>
                    Fortnox-panelen samlar leverantörsfakturor och avvikelser på ett ställe.
                </span>
            </div>

            {connectionStatus === 'checking' && (
                <div className="panel-card panel-card--no-hover" style={{ padding: '2rem', color: 'var(--text-secondary)', fontSize: '0.875rem', textAlign: 'center' }}>
                    Kontrollerar Fortnox-anslutning...
                </div>
            )}

            {(connectionStatus === 'disconnected' || connectionStatus === 'error') && (
                <div className="panel-card panel-card--no-hover" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '1.5rem' }}>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>Fortnox är inte kopplat</div>
                    <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                        Koppla ihop Fortnox under Integrationer för att se fakturor och genomföra attest.
                    </div>
                    <button
                        type="button"
                        onClick={() => document.getElementById('integrations-btn')?.click()}
                        style={{ marginTop: '0.25rem', alignSelf: 'flex-start', padding: '0.5rem 1rem', borderRadius: '8px', border: 'none', background: 'var(--accent, #3b82f6)', color: '#fff', fontSize: '0.875rem', cursor: 'pointer', fontWeight: 500 }}
                    >
                        Öppna Integrationer
                    </button>
                </div>
            )}

            {connectionStatus === 'connected' && (<>
            <div className="panel-stagger" style={FORTNOX_SUMMARY_GRID_STYLE}>
                {summaryCards.map((card) => (
                    <SummaryStatCard key={card.id} label={card.label} value={card.value} />
                ))}
                <div className="panel-card panel-card--no-hover">
                    <div className="panel-label">Senast uppdaterad</div>
                    <div style={FORTNOX_SUMMARY_UPDATED_STYLE}>
                        {lastUpdated ? formatDate(lastUpdated) : '—'}
                    </div>
                </div>
            </div>

            <div className="panel-card panel-card--no-hover" style={FORTNOX_PERMISSION_CARD_STYLE}>
                <PermissionStatusRow
                    title="Behörighetsstatus"
                    message={scopeMessage}
                    status={scopeStatus}
                    messageTestId="fortnox-scope-message"
                    badgeTestId="fortnox-scope-status"
                />
                <PermissionStatusRow
                    title="Attestbehörighet"
                    message={attestMessage}
                    status={attestStatus}
                    messageTestId="fortnox-attest-message"
                    badgeTestId="fortnox-attest-status"
                />
            </div>

            <div className="fortnox-workspace-main-grid" style={FORTNOX_MAIN_GRID_STYLE}>
                <div className="panel-card panel-card--no-hover fortnox-workspace-table-card" style={FORTNOX_TABLE_CARD_STYLE}>
                    <div style={FORTNOX_TABLE_HEADER_STYLE}>
                        <div style={FORTNOX_TABLE_TITLE_WRAP_STYLE}>
                            <div className="panel-section-title" style={FORTNOX_SECTION_TITLE_STYLE}>
                                {getInvoiceSectionTitle(isSupplierView)}
                            </div>
                            <div style={FORTNOX_TABLE_SUBTEXT_STYLE}>
                                {getInvoiceSectionDescription(isSupplierView)}
                            </div>
                            <div style={FORTNOX_TOOLBAR_GROUP_STYLE}>
                                {INVOICE_VIEW_OPTIONS.map((viewOption) => (
                                    <button
                                        key={viewOption.id}
                                        type="button"
                                        onClick={() => setInvoiceView(viewOption.id)}
                                        data-testid={`fortnox-view-${viewOption.id}`}
                                        style={getSelectorButtonStyle(
                                            viewOption.id === invoiceView,
                                            'rgba(14, 165, 233, 0.18)',
                                            '#0ea5e9'
                                        )}
                                    >
                                        {viewOption.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div style={FORTNOX_TOOLBAR_GROUP_STYLE}>
                            {activeFilterOptions.map((option) => (
                                <button
                                    key={option.id}
                                    type="button"
                                    aria-pressed={option.id === activeFilter}
                                    onClick={() => applyActiveFilter(option.id)}
                                    data-testid={`fortnox-filter-${option.id}`}
                                    style={getSelectorButtonStyle(
                                        option.id === activeFilter,
                                        'rgba(59, 130, 246, 0.2)',
                                        '#3b82f6'
                                    )}
                                >
                                    {option.label}
                                </button>
                            ))}
                            <button
                                type="button"
                                onClick={refreshActiveView}
                                disabled={activeLoading}
                                data-testid="fortnox-refresh-button"
                                style={getRefreshButtonStyle(activeLoading)}
                            >
                                {activeLoading ? 'Hämtar...' : 'Uppdatera'}
                            </button>
                        </div>
                    </div>

                    {activeError && (
                        <div style={FORTNOX_ERROR_BOX_STYLE}>
                            <span>{activeError}</span>
                            <button
                                type="button"
                                onClick={refreshActiveView}
                                style={FORTNOX_RETRY_BUTTON_STYLE}
                            >
                                Försök igen
                            </button>
                        </div>
                    )}

                    <div
                        ref={tableScrollRef}
                        className={`fortnox-workspace-table-scroll fortnox-table-scroll--${tableScrollEdge}`}
                        style={FORTNOX_TABLE_SCROLL_STYLE}
                        onScroll={handleTableScroll}
                    >
                        {isSupplierView ? (
                            <table style={INVOICE_TABLE_STYLE}>
                                {renderTableHeader(supplierColumns)}
                                <tbody>
                                    {loadingSupplier && renderSkeletonRows(supplierColumns.length)}
                                    {filteredSupplierInvoices.length === 0 && !loadingSupplier && (
                                        renderEmptyInvoiceTableRow(supplierColumns.length)
                                    )}
                                    {filteredSupplierInvoices.map((invoice) => {
                                        const actionLoading = isSupplierActionLoading(actionLoadingId, invoice.GivenNumber);
                                        return (
                                            <tr
                                                key={`${invoice.GivenNumber}-${invoice.SupplierNumber}`}
                                                data-testid={`fortnox-supplier-row-${invoice.GivenNumber}`}
                                            >
                                                {renderTableCells(buildSupplierTableCells(invoice, supplierFilter))}
                                                {invoicePostingReviewEnabled && (
                                                    <td style={TABLE_CELL_RIGHT_STYLE}>
                                                        <button
                                                            type="button"
                                                            data-testid={`fortnox-view-posting-supplier-${invoice.GivenNumber}`}
                                                            onClick={() => void openPostingTrace('supplier', invoice.GivenNumber)}
                                                            style={getTraceButtonStyle(postingTraceLoading)}
                                                        >
                                                            Visa kontering
                                                        </button>
                                                    </td>
                                                )}
                                                {supplierFilter === 'authorizepending' && (
                                                    <td style={TABLE_CELL_RIGHT_STYLE}>
                                                        <div style={TABLE_ACTIONS_WRAP_STYLE}>
                                                            <button
                                                                type="button"
                                                                onClick={() => void approveSupplierInvoice(invoice.GivenNumber, 'bookkeep')}
                                                                disabled={actionLoading}
                                                                data-testid={`fortnox-approve-bookkeep-${invoice.GivenNumber}`}
                                                                style={getApprovalButtonStyle('bookkeep', actionLoading)}
                                                            >
                                                                {actionLoading ? 'Attesterar...' : 'Godkänn bokföring'}
                                                            </button>
                                                            {invoice.PaymentPending && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => void approveSupplierInvoice(invoice.GivenNumber, 'payment')}
                                                                    disabled={actionLoading}
                                                                    data-testid={`fortnox-approve-payment-${invoice.GivenNumber}`}
                                                                    style={getApprovalButtonStyle('payment', actionLoading)}
                                                                >
                                                                    Godkänn betalning
                                                                </button>
                                                            )}
                                                        </div>
                                                    </td>
                                                )}
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        ) : (
                            <table style={INVOICE_TABLE_STYLE}>
                                {renderTableHeader(customerColumns)}
                                <tbody>
                                    {loadingCustomer && renderSkeletonRows(customerColumns.length)}
                                    {filteredCustomerInvoices.length === 0 && !loadingCustomer && (
                                        renderEmptyInvoiceTableRow(customerColumns.length)
                                    )}
                                    {filteredCustomerInvoices.map((invoice, index) => {
                                        const rowId = resolveCustomerTraceInvoiceId(invoice);
                                        const rowIdText = rowId === null ? `missing-id-${index}` : String(rowId);
                                        const missingTraceId = rowId === null;
                                        return (
                                            <tr
                                                key={`${rowIdText}-${invoice.CustomerNumber}`}
                                                data-testid={missingTraceId
                                                    ? `fortnox-customer-row-missing-id-${index}`
                                                    : `fortnox-customer-row-${rowId}`}
                                            >
                                                {renderTableCells(buildCustomerTableCells(invoice))}
                                                {invoicePostingReviewEnabled && (
                                                    <td style={TABLE_CELL_RIGHT_STYLE}>
                                                        <button
                                                            type="button"
                                                            data-testid={missingTraceId
                                                                ? `fortnox-view-posting-customer-missing-id-${index}`
                                                                : `fortnox-view-posting-customer-${rowId}`}
                                                            onClick={() => {
                                                                if (rowId !== null) {
                                                                    void openPostingTrace('customer', rowId);
                                                                }
                                                            }}
                                                            disabled={postingTraceLoading || missingTraceId}
                                                            title={missingTraceId ? CUSTOMER_TRACE_ID_MISSING_MESSAGE : undefined}
                                                            style={getTraceButtonStyle(postingTraceLoading, missingTraceId)}
                                                        >
                                                            {missingTraceId ? 'ID saknas för kontering' : 'Visa kontering'}
                                                        </button>
                                                    </td>
                                                )}
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>

                <div className="panel-card panel-card--no-hover fortnox-workspace-copilot-card" style={FORTNOX_COPILOT_CARD_STYLE}>
                    <div>
                        <div className="panel-section-title" style={FORTNOX_SECTION_TITLE_STYLE}>Copilot</div>
                        <div style={FORTNOX_COPILOT_SUBTEXT_STYLE}>
                            Påminnelser och smarta förslag baserade på Fortnox-data.
                        </div>
                    </div>
                    <CopilotPanel />
                </div>
            </div>

            <InvoicePostingReviewDrawer
                open={postingDrawerOpen}
                loading={postingTraceLoading}
                error={postingTraceError}
                trace={postingTrace}
                presentation="fullscreen"
                onClose={() => setPostingDrawerOpen(false)}
                onCreateCorrection={createPostingCorrectionVoucher}
            />

            {confirmState && (
                <div style={CONFIRM_OVERLAY_STYLE} onClick={() => setConfirmState(null)}>
                    <div style={CONFIRM_DIALOG_STYLE} onClick={(e) => e.stopPropagation()}>
                        <p style={CONFIRM_MESSAGE_STYLE}>{confirmState.message}</p>
                        <div style={CONFIRM_ACTIONS_STYLE}>
                            <button type="button" onClick={() => setConfirmState(null)} style={CONFIRM_CANCEL_STYLE}>
                                Avbryt
                            </button>
                            <button type="button" onClick={() => void confirmState.onConfirm()} style={CONFIRM_OK_STYLE}>
                                Bekräfta
                            </button>
                        </div>
                    </div>
                </div>
            )}
            </>)}

            {toast && (
                <div role="status" aria-live="polite" style={TOAST_STYLE}>
                    {toast}
                </div>
            )}
        </div>
    );
}

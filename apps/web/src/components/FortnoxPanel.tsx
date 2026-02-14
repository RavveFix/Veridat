import { useEffect, useMemo, useState } from 'preact/hooks';
import { supabase } from '../lib/supabase';
import { logger } from '../services/LoggerService';
import { companyService } from '../services/CompanyService';
import { CopilotPanel } from './CopilotPanel';
import { getFortnoxList } from '../utils/fortnoxResponse';

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
    InvoiceNumber: number;
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
const SUPPLIER_BASE_COLUMNS: TableColumn[] = [
    { key: 'invoice', label: 'Faktura' },
    { key: 'supplier', label: 'Lev.nr' },
    { key: 'dueDate', label: 'Förfallo' },
    { key: 'total', label: 'Belopp', align: 'right' },
    { key: 'balance', label: 'Rest', align: 'right' },
    { key: 'status', label: 'Status' }
];
const SUPPLIER_ACTION_COLUMN: TableColumn = { key: 'action', label: 'Åtgärd', align: 'right' };
const CUSTOMER_COLUMNS: TableColumn[] = [
    { key: 'invoice', label: 'Faktura' },
    { key: 'customer', label: 'Kund.nr' },
    { key: 'dueDate', label: 'Förfallo' },
    { key: 'total', label: 'Belopp', align: 'right' },
    { key: 'balance', label: 'Rest', align: 'right' },
    { key: 'status', label: 'Status' }
];

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

export function FortnoxPanel({ onBack }: FortnoxPanelProps) {
    const companyId = companyService.getCurrentId();
    const fortnoxEndpoint = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fortnox`;
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
            includeCompanyId?: boolean;
            fallbackErrorMessage: string;
            missingAuthMessage: string;
        }
    ): Promise<{ ok: true; data: T } | { ok: false; message: string; authMissing: boolean }> {
        const accessToken = await getSessionAccessToken();
        if (!accessToken) {
            return { ok: false, message: options.missingAuthMessage, authMissing: true };
        }

        const body: Record<string, unknown> = { action };
        if (options.includeCompanyId) {
            body.companyId = companyId;
        }
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
        } finally {
            setLoadingSupplier(false);
        }
    };

    useEffect(() => {
        void loadSupplierInvoices({ target: 'all' });
    }, []);

    useEffect(() => {
        if (supplierFilter === 'authorizepending' && pendingInvoices === null && !loadingSupplier) {
            void loadSupplierInvoices({ filter: 'authorizepending', target: 'pending' });
        }
    }, [supplierFilter, pendingInvoices, loadingSupplier]);

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
            if (scopeStatus !== 'missing') {
                updateScopeStatus('unknown');
            }
        } finally {
            setLoadingCustomer(false);
        }
    };

    const approveSupplierInvoice = async (givenNumberRaw: number | string, action: 'bookkeep' | 'payment') => {
        const givenNumber = Number(givenNumberRaw);
        if (!Number.isFinite(givenNumber)) {
            setSupplierError('Kunde inte läsa fakturanummer för attest.');
            return;
        }

        const confirmText = action === 'bookkeep'
            ? `Vill du attestera bokföring för faktura ${givenNumber}?\n\nKontrollera att uppgifterna stämmer. Du som företagare ansvarar för att bokföringen är korrekt.`
            : `Vill du attestera betalning för faktura ${givenNumber}?\n\nKontrollera att uppgifterna stämmer. Du som företagare ansvarar för att bokföringen är korrekt.`;
        if (!window.confirm(confirmText)) return;

        setActionLoadingId(String(givenNumberRaw));
        setSupplierError(null);
        try {
            const result = await callFortnox(
                action === 'bookkeep' ? 'approveSupplierInvoiceBookkeep' : 'approveSupplierInvoicePayment',
                {
                    includeCompanyId: true,
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
            await loadSupplierInvoices({ target: 'all' });
            if (supplierFilter === 'authorizepending') {
                await loadSupplierInvoices({ filter: 'authorizepending', target: 'pending' });
            }
        } catch (err) {
            logger.error('Failed to approve supplier invoice', err);
            setSupplierError('Ett fel uppstod vid attestering.');
        } finally {
            setActionLoadingId(null);
        }
    };

    useEffect(() => {
        if (invoiceView === 'customer' && customerInvoices === null && !loadingCustomer) {
            void loadCustomerInvoices();
        }
    }, [invoiceView, customerInvoices, loadingCustomer]);

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
            const overdue = source.filter((inv) => isInvoiceOverdue(inv.DueDate, inv.Balance, today)).length;
            const unpaid = source.filter((inv) => hasOutstandingBalance(inv.Balance)).length;
            return { overdue, unbooked: unpaid, total: source.length, unbookedLabel: 'Obetalda' };
        }
        const overdue = invoices.filter((inv) => isInvoiceOverdue(inv.DueDate, inv.Balance, today)).length;
        const unbooked = invoices.filter((inv) => !inv.Booked && hasOutstandingBalance(inv.Balance)).length;
        return { overdue, unbooked, total: invoices.length, unbookedLabel: 'Obokförda' };
    }, [invoiceView, invoices, customerInvoices]);

    const supplierFilterOptions: { id: SupplierFilterMode; label: string }[] = [
        { id: 'all', label: 'Alla' },
        { id: 'unbooked', label: 'Obokförda' },
        { id: 'overdue', label: 'Förfallna' },
        { id: 'authorizepending', label: 'Under attest' }
    ];

    const customerFilterOptions: { id: CustomerFilterMode; label: string }[] = [
        { id: 'all', label: 'Alla' },
        { id: 'unpaid', label: 'Obetalda' },
        { id: 'overdue', label: 'Förfallna' }
    ];

    const isSupplierView = invoiceView === 'supplier';
    const activeFilterOptions = isSupplierView ? supplierFilterOptions : customerFilterOptions;
    const activeFilter = isSupplierView ? supplierFilter : customerFilter;
    const activeError = isSupplierView ? supplierError : customerError;
    const activeLoading = isSupplierView ? loadingSupplier : loadingCustomer;
    const supplierColumns = supplierFilter === 'authorizepending'
        ? [...SUPPLIER_BASE_COLUMNS, SUPPLIER_ACTION_COLUMN]
        : SUPPLIER_BASE_COLUMNS;

    return (
        <div
            className="panel-stagger"
            data-testid="fortnox-panel-root"
            style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <button
                    type="button"
                    onClick={onBack}
                    style={{
                        background: 'transparent',
                        border: '1px solid var(--glass-border)',
                        borderRadius: '8px',
                        color: 'var(--text-secondary)',
                        padding: '0.4rem 0.75rem',
                        fontSize: '0.8rem',
                        cursor: 'pointer'
                    }}
                >
                    Tillbaka
                </button>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    Fortnox-panelen samlar leverantörsfakturor och avvikelser på ett ställe.
                </span>
            </div>

            <div className="panel-stagger" style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: '0.75rem'
            }}>
                <div className="panel-card panel-card--no-hover">
                    <div className="panel-label">Förfallna</div>
                    <div className="panel-stat panel-stat--neutral">{summary.overdue}</div>
                </div>
                <div className="panel-card panel-card--no-hover">
                    <div className="panel-label">{summary.unbookedLabel}</div>
                    <div className="panel-stat panel-stat--neutral">{summary.unbooked}</div>
                </div>
                <div className="panel-card panel-card--no-hover">
                    <div className="panel-label">Totalt</div>
                    <div className="panel-stat panel-stat--neutral">{summary.total}</div>
                </div>
                <div className="panel-card panel-card--no-hover">
                    <div className="panel-label">Senast uppdaterad</div>
                    <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {lastUpdated ? formatDate(lastUpdated) : '—'}
                    </div>
                </div>
            </div>

            <div className="panel-card panel-card--no-hover" style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.6rem'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                        <div className="panel-label">Behörighetsstatus</div>
                        <div data-testid="fortnox-scope-message" style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>{scopeMessage}</div>
                    </div>
                    <span
                        data-testid="fortnox-scope-status"
                        style={getPermissionBadgeStyle(scopeStatus)}
                    >
                        {getPermissionBadgeLabel(scopeStatus)}
                    </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                        <div className="panel-label">Attestbehörighet</div>
                        <div data-testid="fortnox-attest-message" style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>{attestMessage}</div>
                    </div>
                    <span
                        data-testid="fortnox-attest-status"
                        style={getPermissionBadgeStyle(attestStatus)}
                    >
                        {getPermissionBadgeLabel(attestStatus)}
                    </span>
                </div>
            </div>

            <div style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)',
                gap: '1rem'
            }}>
                <div className="panel-card panel-card--no-hover" style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.75rem',
                    minHeight: '360px'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                            <div className="panel-section-title" style={{ margin: 0 }}>
                                {isSupplierView ? 'Leverantörsfakturor' : 'Kundfakturor'}
                            </div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                {isSupplierView
                                    ? 'Filtrera och följ upp leverantörsfakturor i Fortnox.'
                                    : 'Filtrera och följ upp kundfakturor i Fortnox.'}
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                {(['supplier', 'customer'] as InvoiceView[]).map((view) => (
                                    <button
                                        key={view}
                                        type="button"
                                        onClick={() => setInvoiceView(view)}
                                        data-testid={`fortnox-view-${view}`}
                                        style={getSelectorButtonStyle(
                                            view === invoiceView,
                                            'rgba(14, 165, 233, 0.18)',
                                            '#0ea5e9'
                                        )}
                                    >
                                        {view === 'supplier' ? 'Leverantörer' : 'Kunder'}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                            {activeFilterOptions.map((option) => (
                                <button
                                    key={option.id}
                                    type="button"
                                    onClick={() => {
                                        if (isSupplierView) {
                                            setSupplierFilter(option.id as SupplierFilterMode);
                                        } else {
                                            setCustomerFilter(option.id as CustomerFilterMode);
                                        }
                                    }}
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
                                onClick={() => {
                                    if (isSupplierView) {
                                        if (supplierFilter === 'authorizepending') {
                                            void loadSupplierInvoices({ filter: 'authorizepending', target: 'pending' });
                                        } else {
                                            void loadSupplierInvoices({ target: 'all' });
                                        }
                                    } else {
                                        void loadCustomerInvoices();
                                    }
                                }}
                                disabled={activeLoading}
                                data-testid="fortnox-refresh-button"
                                style={getRefreshButtonStyle(activeLoading)}
                            >
                                {activeLoading ? 'Hämtar...' : 'Uppdatera'}
                            </button>
                        </div>
                    </div>

                    {activeError && (
                        <div style={{
                            padding: '0.6rem 0.8rem',
                            borderRadius: '8px',
                            background: 'rgba(239, 68, 68, 0.12)',
                            color: '#ef4444',
                            fontSize: '0.8rem'
                        }}>
                            {activeError}
                        </div>
                    )}

                    <div style={{ overflowX: 'auto' }}>
                        {isSupplierView ? (
                            <table style={INVOICE_TABLE_STYLE}>
                                {renderTableHeader(supplierColumns)}
                                <tbody>
                                    {filteredSupplierInvoices.length === 0 && !loadingSupplier && (
                                        <tr>
                                            <td colSpan={supplierColumns.length} style={TABLE_EMPTY_CELL_STYLE}>
                                                Inga fakturor att visa.
                                            </td>
                                        </tr>
                                    )}
                                    {filteredSupplierInvoices.map((invoice) => (
                                        <tr
                                            key={`${invoice.GivenNumber}-${invoice.SupplierNumber}`}
                                            data-testid={`fortnox-supplier-row-${invoice.GivenNumber}`}
                                        >
                                            {renderTableCells([
                                                { key: 'invoice', content: String(invoice.InvoiceNumber || invoice.GivenNumber), nowrap: true },
                                                { key: 'supplier', content: invoice.SupplierNumber },
                                                { key: 'dueDate', content: formatDate(invoice.DueDate) },
                                                { key: 'total', content: formatAmount(toNumber(invoice.Total)), align: 'right' },
                                                { key: 'balance', content: formatAmount(toNumber(invoice.Balance)), align: 'right' },
                                                { key: 'status', content: getStatus(invoice, supplierFilter) }
                                            ])}
                                            {supplierFilter === 'authorizepending' && (
                                                <td style={TABLE_CELL_RIGHT_STYLE}>
                                                    <div style={TABLE_ACTIONS_WRAP_STYLE}>
                                                        <button
                                                            type="button"
                                                            onClick={() => void approveSupplierInvoice(invoice.GivenNumber, 'bookkeep')}
                                                            disabled={actionLoadingId === String(invoice.GivenNumber)}
                                                            data-testid={`fortnox-approve-bookkeep-${invoice.GivenNumber}`}
                                                            style={getApprovalButtonStyle('bookkeep', actionLoadingId === String(invoice.GivenNumber))}
                                                        >
                                                            {actionLoadingId === String(invoice.GivenNumber) ? 'Attesterar...' : 'Godkänn bokföring'}
                                                        </button>
                                                        {invoice.PaymentPending && (
                                                            <button
                                                                type="button"
                                                                onClick={() => void approveSupplierInvoice(invoice.GivenNumber, 'payment')}
                                                                disabled={actionLoadingId === String(invoice.GivenNumber)}
                                                                data-testid={`fortnox-approve-payment-${invoice.GivenNumber}`}
                                                                style={getApprovalButtonStyle('payment', actionLoadingId === String(invoice.GivenNumber))}
                                                            >
                                                                Godkänn betalning
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            )}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        ) : (
                            <table style={INVOICE_TABLE_STYLE}>
                                {renderTableHeader(CUSTOMER_COLUMNS)}
                                <tbody>
                                    {filteredCustomerInvoices.length === 0 && !loadingCustomer && (
                                        <tr>
                                            <td colSpan={CUSTOMER_COLUMNS.length} style={TABLE_EMPTY_CELL_STYLE}>
                                                Inga fakturor att visa.
                                            </td>
                                        </tr>
                                    )}
                                    {filteredCustomerInvoices.map((invoice) => (
                                        <tr
                                            key={`${invoice.InvoiceNumber}-${invoice.CustomerNumber}`}
                                            data-testid={`fortnox-customer-row-${invoice.InvoiceNumber}`}
                                        >
                                            {renderTableCells([
                                                { key: 'invoice', content: invoice.InvoiceNumber, nowrap: true },
                                                { key: 'customer', content: invoice.CustomerNumber },
                                                { key: 'dueDate', content: formatDate(invoice.DueDate) },
                                                { key: 'total', content: formatAmount(toNumber(invoice.Total)), align: 'right' },
                                                { key: 'balance', content: formatAmount(toNumber(invoice.Balance)), align: 'right' },
                                                { key: 'status', content: getCustomerStatus(invoice) }
                                            ])}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>

                <div className="panel-card panel-card--no-hover" style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.75rem'
                }}>
                    <div>
                        <div className="panel-section-title" style={{ margin: 0 }}>Copilot</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                            Påminnelser och smarta förslag baserade på Fortnox-data.
                        </div>
                    </div>
                    <CopilotPanel />
                </div>
            </div>
        </div>
    );
}

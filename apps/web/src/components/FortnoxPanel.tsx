import { useEffect, useMemo, useState } from 'preact/hooks';
import { supabase } from '../lib/supabase';
import { CopilotPanel } from './CopilotPanel';

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

function todayString(): string {
    return new Date().toISOString().split('T')[0];
}

function toNumber(value: number | string | null | undefined): number {
    if (typeof value === 'number') return value;
    if (value === null || value === undefined) return 0;
    const normalized = String(value).replace(/\s+/g, '').replace(',', '.');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
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
    const balance = toNumber(invoice.Balance);
    if (balance > 0 && invoice.DueDate && invoice.DueDate < todayString()) {
        return 'Förfallen';
    }
    if (!invoice.Booked) return 'Obokförd';
    return 'Bokförd';
}

function getCustomerStatus(invoice: CustomerInvoiceSummary): string {
    if (invoice.Cancelled) return 'Makulerad';
    const balance = toNumber(invoice.Balance);
    if (balance > 0 && invoice.DueDate && invoice.DueDate < todayString()) {
        return 'Förfallen';
    }
    if (balance > 0) return 'Obetald';
    if (invoice.Booked) return 'Bokförd';
    return 'Skapad';
}

export function FortnoxPanel({ onBack }: FortnoxPanelProps) {
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
    const [scopeStatus, setScopeStatus] = useState<'ok' | 'missing' | 'unknown'>('unknown');
    const [scopeMessage, setScopeMessage] = useState<string>('Ej kontrollerad');
    const [attestStatus, setAttestStatus] = useState<'ok' | 'missing' | 'unknown'>('unknown');
    const [attestMessage, setAttestMessage] = useState<string>('Ej kontrollerad');

    const updateScopeStatus = (message?: string, ok = false) => {
        if (ok) {
            setScopeStatus('ok');
            setScopeMessage('Behörigheter OK');
            return;
        }

        const text = (message || '').toLowerCase();
        if (text.includes('2003275') || text.includes('leverantörsregister')) {
            setScopeStatus('missing');
            setScopeMessage('Saknar behörighet för leverantörsregister i Fortnox. Kontrollera modul/rättighet och koppla om.');
            return;
        }
        const scopeMissing = text.includes('behörighet') || text.includes('scope') || text.includes('2000663');
        if (scopeMissing) {
            setScopeStatus('missing');
            setScopeMessage('Saknar behörighet för Leverantör/Leverantörsfaktura. Uppdatera behörigheter och koppla om Fortnox.');
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

    const loadSupplierInvoices = async (options?: { filter?: string; target?: 'all' | 'pending' }) => {
        const target = options?.target ?? 'all';
        setLoadingSupplier(true);
        setSupplierError(null);
        try {
            const { data: session } = await supabase.auth.getSession();
            const accessToken = session?.session?.access_token;
            if (!accessToken) {
                setSupplierError('Du måste vara inloggad för att hämta Fortnox-data.');
                updateScopeStatus('missing');
                return;
            }

            const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fortnox`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${accessToken}`
                },
                body: JSON.stringify({
                    action: 'getSupplierInvoices',
                    payload: options?.filter ? { filter: options.filter } : {}
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const message = errorData.message || errorData.error || 'Kunde inte hämta leverantörsfakturor.';
                setSupplierError(message);
                updateScopeStatus(message);
                return;
            }

            const result = await response.json();
            const items = ((result.data?.SupplierInvoices ?? result.SupplierInvoices) || []) as SupplierInvoiceSummary[];
            if (target === 'pending') {
                setPendingInvoices(items);
            } else {
                setInvoices(items);
            }
            setLastUpdated(new Date().toISOString());
            updateScopeStatus(undefined, true);
        } catch (err) {
            console.error('Failed to load Fortnox invoices', err);
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
            const { data: session } = await supabase.auth.getSession();
            const accessToken = session?.session?.access_token;
            if (!accessToken) {
                setCustomerError('Du måste vara inloggad för att hämta Fortnox-data.');
                updateScopeStatus('missing');
                return;
            }

            const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fortnox`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${accessToken}`
                },
                body: JSON.stringify({ action: 'getInvoices' })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const message = errorData.message || errorData.error || 'Kunde inte hämta kundfakturor.';
                setCustomerError(message);
                updateScopeStatus(message);
                return;
            }

            const result = await response.json();
            const items = ((result.data?.Invoices ?? result.Invoices) || []) as CustomerInvoiceSummary[];
            setCustomerInvoices(items);
            setLastUpdated(new Date().toISOString());
            if (scopeStatus !== 'missing') {
                updateScopeStatus(undefined, true);
            }
        } catch (err) {
            console.error('Failed to load Fortnox customer invoices', err);
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
            ? `Vill du attestera bokföring för faktura ${givenNumber}?`
            : `Vill du attestera betalning för faktura ${givenNumber}?`;
        if (!window.confirm(confirmText)) return;

        setActionLoadingId(String(givenNumberRaw));
        setSupplierError(null);
        try {
            const { data: session } = await supabase.auth.getSession();
            const accessToken = session?.session?.access_token;
            if (!accessToken) {
                setSupplierError('Du måste vara inloggad för att attestera.');
                return;
            }

            const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fortnox`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${accessToken}`
                },
                body: JSON.stringify({
                    action: action === 'bookkeep' ? 'approveSupplierInvoiceBookkeep' : 'approveSupplierInvoicePayment',
                    payload: { givenNumber }
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const message = errorData.message || errorData.error || 'Kunde inte attestera fakturan.';
                setSupplierError(message);
                updateScopeStatus(message);
                updateAttestStatus(message);
                return;
            }

            updateAttestStatus(undefined, true);
            await loadSupplierInvoices({ target: 'all' });
            if (supplierFilter === 'authorizepending') {
                await loadSupplierInvoices({ filter: 'authorizepending', target: 'pending' });
            }
        } catch (err) {
            console.error('Failed to approve supplier invoice', err);
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
                return invoices.filter((inv) => !inv.Booked && toNumber(inv.Balance) > 0);
            case 'overdue':
                return invoices.filter((inv) => toNumber(inv.Balance) > 0 && inv.DueDate && inv.DueDate < today);
            default:
                return invoices;
        }
    }, [supplierFilter, invoices, pendingInvoices]);

    const filteredCustomerInvoices = useMemo(() => {
        const today = todayString();
        const source = customerInvoices ?? [];
        switch (customerFilter) {
            case 'unpaid':
                return source.filter((inv) => toNumber(inv.Balance) > 0);
            case 'overdue':
                return source.filter((inv) => toNumber(inv.Balance) > 0 && inv.DueDate && inv.DueDate < today);
            default:
                return source;
        }
    }, [customerFilter, customerInvoices]);

    const summary = useMemo(() => {
        if (invoiceView === 'customer') {
            const source = customerInvoices ?? [];
            const overdue = source.filter((inv) => toNumber(inv.Balance) > 0 && inv.DueDate && inv.DueDate < todayString()).length;
            const unpaid = source.filter((inv) => toNumber(inv.Balance) > 0).length;
            return { overdue, unbooked: unpaid, total: source.length, unbookedLabel: 'Obetalda' };
        }
        const overdue = invoices.filter((inv) => toNumber(inv.Balance) > 0 && inv.DueDate && inv.DueDate < todayString()).length;
        const unbooked = invoices.filter((inv) => !inv.Booked && toNumber(inv.Balance) > 0).length;
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

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
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

            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: '0.75rem'
            }}>
                <div style={{
                    padding: '0.9rem',
                    borderRadius: '12px',
                    border: '1px solid var(--glass-border)',
                    background: 'rgba(255, 255, 255, 0.04)'
                }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Förfallna</div>
                    <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)' }}>{summary.overdue}</div>
                </div>
                <div style={{
                    padding: '0.9rem',
                    borderRadius: '12px',
                    border: '1px solid var(--glass-border)',
                    background: 'rgba(255, 255, 255, 0.04)'
                }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{summary.unbookedLabel}</div>
                    <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)' }}>{summary.unbooked}</div>
                </div>
                <div style={{
                    padding: '0.9rem',
                    borderRadius: '12px',
                    border: '1px solid var(--glass-border)',
                    background: 'rgba(255, 255, 255, 0.04)'
                }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Totalt</div>
                    <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)' }}>{summary.total}</div>
                </div>
                <div style={{
                    padding: '0.9rem',
                    borderRadius: '12px',
                    border: '1px solid var(--glass-border)',
                    background: 'rgba(255, 255, 255, 0.04)'
                }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Senast uppdaterad</div>
                    <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {lastUpdated ? formatDate(lastUpdated) : '—'}
                    </div>
                </div>
            </div>

            <div style={{
                padding: '0.75rem 1rem',
                borderRadius: '12px',
                border: '1px solid var(--glass-border)',
                background: 'rgba(255, 255, 255, 0.03)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.6rem'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Behörighetsstatus</div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>{scopeMessage}</div>
                    </div>
                    <span style={{
                        padding: '0.25rem 0.75rem',
                        borderRadius: '999px',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        background: scopeStatus === 'ok'
                            ? 'rgba(16, 185, 129, 0.15)'
                            : scopeStatus === 'missing'
                                ? 'rgba(239, 68, 68, 0.15)'
                                : 'rgba(255, 255, 255, 0.08)',
                        color: scopeStatus === 'ok'
                            ? '#10b981'
                            : scopeStatus === 'missing'
                                ? '#ef4444'
                                : 'var(--text-secondary)'
                    }}>
                        {scopeStatus === 'ok' ? 'OK' : scopeStatus === 'missing' ? 'Saknas' : 'Okänt'}
                    </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Attestbehörighet</div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>{attestMessage}</div>
                    </div>
                    <span style={{
                        padding: '0.25rem 0.75rem',
                        borderRadius: '999px',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        background: attestStatus === 'ok'
                            ? 'rgba(16, 185, 129, 0.15)'
                            : attestStatus === 'missing'
                                ? 'rgba(239, 68, 68, 0.15)'
                                : 'rgba(255, 255, 255, 0.08)',
                        color: attestStatus === 'ok'
                            ? '#10b981'
                            : attestStatus === 'missing'
                                ? '#ef4444'
                                : 'var(--text-secondary)'
                    }}>
                        {attestStatus === 'ok' ? 'OK' : attestStatus === 'missing' ? 'Saknas' : 'Okänt'}
                    </span>
                </div>
            </div>

            <div style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)',
                gap: '1rem'
            }}>
                <div style={{
                    padding: '1rem',
                    borderRadius: '12px',
                    border: '1px solid var(--glass-border)',
                    background: 'rgba(255, 255, 255, 0.04)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.75rem',
                    minHeight: '360px'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                            <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
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
                                        style={{
                                            height: '34px',
                                            padding: '0 0.8rem',
                                            borderRadius: '10px',
                                            border: '1px solid var(--glass-border)',
                                            background: view === invoiceView ? 'rgba(14, 165, 233, 0.18)' : 'transparent',
                                            color: view === invoiceView ? '#0ea5e9' : 'var(--text-secondary)',
                                            fontSize: '0.78rem',
                                            fontWeight: 600,
                                            cursor: 'pointer',
                                            display: 'inline-flex',
                                            alignItems: 'center'
                                        }}
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
                                    style={{
                                        height: '34px',
                                        padding: '0 0.8rem',
                                        borderRadius: '10px',
                                        border: '1px solid var(--glass-border)',
                                        background: option.id === activeFilter ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                                        color: option.id === activeFilter ? '#3b82f6' : 'var(--text-secondary)',
                                        fontSize: '0.78rem',
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        display: 'inline-flex',
                                        alignItems: 'center'
                                    }}
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
                                style={{
                                    height: '34px',
                                    padding: '0 0.8rem',
                                    borderRadius: '10px',
                                    border: '1px solid var(--glass-border)',
                                    background: 'transparent',
                                    color: 'var(--text-secondary)',
                                    fontSize: '0.78rem',
                                    fontWeight: 600,
                                    cursor: activeLoading ? 'wait' : 'pointer',
                                    display: 'inline-flex',
                                    alignItems: 'center'
                                }}
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
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                                <thead>
                                    <tr>
                                        <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem', color: 'var(--text-secondary)' }}>Faktura</th>
                                        <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem', color: 'var(--text-secondary)' }}>Lev.nr</th>
                                        <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem', color: 'var(--text-secondary)' }}>Förfallo</th>
                                        <th style={{ textAlign: 'right', padding: '0.4rem 0.5rem', color: 'var(--text-secondary)' }}>Belopp</th>
                                        <th style={{ textAlign: 'right', padding: '0.4rem 0.5rem', color: 'var(--text-secondary)' }}>Rest</th>
                                    <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem', color: 'var(--text-secondary)' }}>Status</th>
                                    {supplierFilter === 'authorizepending' && (
                                        <th style={{ textAlign: 'right', padding: '0.4rem 0.5rem', color: 'var(--text-secondary)' }}>Åtgärd</th>
                                    )}
                                </tr>
                            </thead>
                            <tbody>
                                    {filteredSupplierInvoices.length === 0 && !loadingSupplier && (
                                        <tr>
                                            <td colSpan={supplierFilter === 'authorizepending' ? 7 : 6} style={{ padding: '0.8rem', color: 'var(--text-secondary)' }}>
                                                Inga fakturor att visa.
                                            </td>
                                        </tr>
                                    )}
                                    {filteredSupplierInvoices.map((invoice) => (
                                        <tr key={`${invoice.GivenNumber}-${invoice.SupplierNumber}`}>
                                            <td style={{ padding: '0.35rem 0.5rem', whiteSpace: 'nowrap' }}>
                                                {invoice.InvoiceNumber || invoice.GivenNumber}
                                            </td>
                                            <td style={{ padding: '0.35rem 0.5rem' }}>{invoice.SupplierNumber}</td>
                                            <td style={{ padding: '0.35rem 0.5rem' }}>{formatDate(invoice.DueDate)}</td>
                                            <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right' }}>{formatAmount(toNumber(invoice.Total))}</td>
                                            <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right' }}>{formatAmount(toNumber(invoice.Balance))}</td>
                                            <td style={{ padding: '0.35rem 0.5rem' }}>{getStatus(invoice, supplierFilter)}</td>
                                            {supplierFilter === 'authorizepending' && (
                                                <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right' }}>
                                                    <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                                                        <button
                                                            type="button"
                                                            onClick={() => void approveSupplierInvoice(invoice.GivenNumber, 'bookkeep')}
                                                            disabled={actionLoadingId === String(invoice.GivenNumber)}
                                                            style={{
                                                                height: '30px',
                                                                padding: '0 0.7rem',
                                                                borderRadius: '8px',
                                                                border: '1px solid var(--glass-border)',
                                                                background: 'rgba(16, 185, 129, 0.15)',
                                                                color: '#10b981',
                                                                fontSize: '0.72rem',
                                                                fontWeight: 600,
                                                                cursor: actionLoadingId === String(invoice.GivenNumber) ? 'wait' : 'pointer'
                                                            }}
                                                        >
                                                            {actionLoadingId === String(invoice.GivenNumber) ? 'Attesterar...' : 'Godkänn bokföring'}
                                                        </button>
                                                        {invoice.PaymentPending && (
                                                            <button
                                                                type="button"
                                                                onClick={() => void approveSupplierInvoice(invoice.GivenNumber, 'payment')}
                                                                disabled={actionLoadingId === String(invoice.GivenNumber)}
                                                                style={{
                                                                    height: '30px',
                                                                    padding: '0 0.7rem',
                                                                    borderRadius: '8px',
                                                                    border: '1px solid var(--glass-border)',
                                                                    background: 'rgba(59, 130, 246, 0.15)',
                                                                    color: '#3b82f6',
                                                                    fontSize: '0.72rem',
                                                                    fontWeight: 600,
                                                                    cursor: actionLoadingId === String(invoice.GivenNumber) ? 'wait' : 'pointer'
                                                                }}
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
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                                <thead>
                                    <tr>
                                        <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem', color: 'var(--text-secondary)' }}>Faktura</th>
                                        <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem', color: 'var(--text-secondary)' }}>Kund.nr</th>
                                        <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem', color: 'var(--text-secondary)' }}>Förfallo</th>
                                        <th style={{ textAlign: 'right', padding: '0.4rem 0.5rem', color: 'var(--text-secondary)' }}>Belopp</th>
                                        <th style={{ textAlign: 'right', padding: '0.4rem 0.5rem', color: 'var(--text-secondary)' }}>Rest</th>
                                        <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem', color: 'var(--text-secondary)' }}>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredCustomerInvoices.length === 0 && !loadingCustomer && (
                                        <tr>
                                            <td colSpan={6} style={{ padding: '0.8rem', color: 'var(--text-secondary)' }}>
                                                Inga fakturor att visa.
                                            </td>
                                        </tr>
                                    )}
                                    {filteredCustomerInvoices.map((invoice) => (
                                        <tr key={`${invoice.InvoiceNumber}-${invoice.CustomerNumber}`}>
                                            <td style={{ padding: '0.35rem 0.5rem', whiteSpace: 'nowrap' }}>{invoice.InvoiceNumber}</td>
                                            <td style={{ padding: '0.35rem 0.5rem' }}>{invoice.CustomerNumber}</td>
                                            <td style={{ padding: '0.35rem 0.5rem' }}>{formatDate(invoice.DueDate)}</td>
                                            <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right' }}>{formatAmount(toNumber(invoice.Total))}</td>
                                            <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right' }}>{formatAmount(toNumber(invoice.Balance))}</td>
                                            <td style={{ padding: '0.35rem 0.5rem' }}>{getCustomerStatus(invoice)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>

                <div style={{
                    padding: '1rem',
                    borderRadius: '12px',
                    border: '1px solid var(--glass-border)',
                    background: 'rgba(255, 255, 255, 0.04)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.75rem'
                }}>
                    <div>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Copilot</div>
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

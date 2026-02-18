import { useState, useEffect } from 'preact/hooks';
import { supabase } from '../lib/supabase';
import { logger } from '../services/LoggerService';
import { companyService } from '../services/CompanyService';
import type { VATReportData } from '../types/vat';
import { VATReportCard } from './VATReportCard';

interface InvoiceDetail {
    nr: number;
    customer?: string;
    supplier?: string;
    date: string;
    net: number;
    vat: number;
    total: number;
    booked: boolean;
}

interface VATReportFromFortnoxPanelProps {
    onBack: () => void;
}

interface InvoiceTableProps {
    invoices: InvoiceDetail[];
    getCounterparty: (invoice: InvoiceDetail) => string | undefined;
}

function formatSEK(amount: number): string {
    return amount.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' SEK';
}

const VAT_BACK_BUTTON_STYLE = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.4rem',
    padding: '0.4rem 0.8rem',
    borderRadius: '8px',
    border: '1px solid var(--surface-border)',
    background: 'var(--surface-2)',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    fontSize: '0.85rem',
    marginBottom: '1rem'
} as const;

const VAT_REFRESH_BUTTON_STYLE = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.4rem',
    padding: '0.4rem 0.8rem',
    borderRadius: '8px',
    border: 'none',
    background: 'var(--accent-gradient)',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '0.85rem',
    fontWeight: 600,
    marginBottom: '1rem',
    marginLeft: '0.5rem'
} as const;

const VAT_LOADING_WRAP_STYLE = { textAlign: 'center', padding: '3rem 1rem' } as const;
const VAT_LOADING_SPINNER_STYLE = { margin: '0 auto 1rem' } as const;
const VAT_LOADING_TEXT_STYLE = { color: 'var(--text-secondary)', fontSize: '0.9rem' } as const;

const VAT_ERROR_BOX_STYLE = {
    padding: '1.5rem',
    borderRadius: '12px',
    background: 'var(--status-danger-bg)',
    border: '1px solid var(--status-danger-border)',
    textAlign: 'center'
} as const;

const VAT_ERROR_TEXT_STYLE = { color: 'var(--status-danger)', margin: '0 0 1rem', fontSize: '0.9rem' } as const;

const VAT_RETRY_BUTTON_STYLE = {
    padding: '0.5rem 1.2rem',
    borderRadius: '8px',
    border: 'none',
    background: 'var(--accent-gradient)',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '0.85rem',
    fontWeight: 600
} as const;

const VAT_SECTION_WRAP_STYLE = {
    marginTop: '1rem',
    padding: '1.2rem',
    borderRadius: '12px',
    background: 'var(--surface-1)',
    border: '1px solid var(--surface-border)',
} as const;

const VAT_SECTION_TITLE_STYLE = { margin: '0 0 0.8rem', fontSize: '0.95rem', color: 'var(--text-primary)' } as const;

const VAT_TABLE_STYLE = { width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' } as const;
const VAT_TABLE_ROW_STYLE = { borderBottom: '1px solid var(--surface-border)' } as const;

const VAT_TABLE_HEADER_BASE_STYLE = {
    padding: '0.4rem 0.6rem',
    color: 'var(--text-secondary)',
    fontWeight: 500
} as const;

const VAT_TABLE_BODY_BASE_STYLE = { padding: '0.5rem 0.6rem', color: 'var(--text-primary)' } as const;

const VAT_COUNTERPARTY_STYLE = { color: 'var(--text-secondary)', marginLeft: '0.4rem' } as const;
const VAT_DATE_STYLE = { fontSize: '0.75rem', color: 'var(--text-secondary)' } as const;

const VAT_STATUS_BADGE_BASE_STYLE = {
    display: 'inline-block',
    padding: '0.15rem 0.5rem',
    borderRadius: '6px',
    fontSize: '0.75rem',
    fontWeight: 600,
} as const;

const VAT_UNBOOKED_WARNING_STYLE = {
    marginTop: '0.8rem',
    padding: '0.8rem 1rem',
    borderRadius: '8px',
    background: 'rgba(251, 191, 36, 0.08)',
    border: '1px solid rgba(251, 191, 36, 0.25)',
    fontSize: '0.8rem',
    lineHeight: 1.5,
    color: 'var(--text-secondary)',
} as const;

const VAT_UNBOOKED_WARNING_LABEL_STYLE = { color: 'var(--status-warning, #fbbf24)' } as const;

function getHeaderCellStyle(align: 'left' | 'right' | 'center') {
    return {
        ...VAT_TABLE_HEADER_BASE_STYLE,
        textAlign: align
    } as const;
}

function getBodyCellStyle(align: 'left' | 'right' | 'center', bold = false) {
    return {
        ...VAT_TABLE_BODY_BASE_STYLE,
        textAlign: align,
        ...(bold ? { fontWeight: 600 } : {})
    } as const;
}

function getStatusBadgeStyle(booked: boolean) {
    return {
        ...VAT_STATUS_BADGE_BASE_STYLE,
        background: booked ? 'rgba(52, 211, 153, 0.15)' : 'rgba(251, 191, 36, 0.15)',
        color: booked ? 'var(--status-success)' : 'var(--status-warning, #fbbf24)',
    } as const;
}

function InvoiceTable({ invoices, getCounterparty }: InvoiceTableProps) {
    return (
        <table style={VAT_TABLE_STYLE}>
            <thead>
                <tr style={VAT_TABLE_ROW_STYLE}>
                    <th style={getHeaderCellStyle('left')}>Faktura</th>
                    <th style={getHeaderCellStyle('right')}>Netto</th>
                    <th style={getHeaderCellStyle('right')}>Moms</th>
                    <th style={getHeaderCellStyle('right')}>Totalt</th>
                    <th style={getHeaderCellStyle('center')}>Status</th>
                </tr>
            </thead>
            <tbody>
                {invoices.map((invoice) => {
                    const counterparty = getCounterparty(invoice);
                    return (
                        <tr key={invoice.nr} style={VAT_TABLE_ROW_STYLE}>
                            <td style={getBodyCellStyle('left')}>
                                #{invoice.nr}
                                {counterparty && <span style={VAT_COUNTERPARTY_STYLE}>({counterparty})</span>}
                                <br />
                                <span style={VAT_DATE_STYLE}>{invoice.date}</span>
                            </td>
                            <td style={getBodyCellStyle('right')}>{formatSEK(invoice.net)}</td>
                            <td style={getBodyCellStyle('right')}>{formatSEK(invoice.vat)}</td>
                            <td style={getBodyCellStyle('right', true)}>{formatSEK(invoice.total)}</td>
                            <td style={getBodyCellStyle('center')}>
                                <span style={getStatusBadgeStyle(invoice.booked)}>
                                    {invoice.booked ? 'Bokförd' : 'Ej bokförd'}
                                </span>
                            </td>
                        </tr>
                    );
                })}
            </tbody>
        </table>
    );
}

export function VATReportFromFortnoxPanel({ onBack }: VATReportFromFortnoxPanelProps) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [reportData, setReportData] = useState<VATReportData | null>(null);
    const [invoices, setInvoices] = useState<InvoiceDetail[]>([]);
    const [supplierInvoices, setSupplierInvoices] = useState<InvoiceDetail[]>([]);

    async function fetchVATReport() {
        setLoading(true);
        setError(null);

        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                setError('Du måste vara inloggad.');
                return;
            }
            const companyId = companyService.getCurrentId();

            const response = await fetch(
                `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fortnox`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${session.access_token}`
                    },
                    body: JSON.stringify({ action: 'getVATReport', companyId })
                }
            );

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(err.error || 'Kunde inte hämta momsrapport');
            }

            const result = await response.json();
            setReportData(result.data);
            setInvoices(result.invoices || []);
            setSupplierInvoices(result.supplierInvoices || []);
        } catch (err) {
            logger.error('VAT report fetch error:', err);
            setError(err instanceof Error ? err.message : 'Ett oväntat fel uppstod.');
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => { fetchVATReport(); }, []);

    const unbookedInvoices = invoices.filter(i => !i.booked);
    const hasUnbooked = unbookedInvoices.length > 0;

    return (
        <div>
            <button
                type="button"
                onClick={onBack}
                style={VAT_BACK_BUTTON_STYLE}
            >
                ← Tillbaka
            </button>

            {!loading && (
                <button
                    type="button"
                    onClick={fetchVATReport}
                    data-testid="vat-report-refresh-button"
                    style={VAT_REFRESH_BUTTON_STYLE}
                >
                    ↻ Uppdatera
                </button>
            )}

            {loading && (
                <div style={VAT_LOADING_WRAP_STYLE}>
                    <div className="modal-spinner" style={VAT_LOADING_SPINNER_STYLE} role="status" aria-label="Laddar" />
                    <p style={VAT_LOADING_TEXT_STYLE}>
                        Hämtar momsrapport från Fortnox...
                    </p>
                </div>
            )}

            {error && (
                <div style={VAT_ERROR_BOX_STYLE}>
                    <p style={VAT_ERROR_TEXT_STYLE}>
                        {error}
                    </p>
                    <button
                        type="button"
                        onClick={fetchVATReport}
                        style={VAT_RETRY_BUTTON_STYLE}
                    >
                        Försök igen
                    </button>
                </div>
            )}

            {reportData && <VATReportCard data={reportData} />}

            {/* Fakturaöversikt */}
            {invoices.length > 0 && (
                <div style={VAT_SECTION_WRAP_STYLE}>
                    <h4 style={VAT_SECTION_TITLE_STYLE}>
                        Fakturaöversikt
                    </h4>

                    <InvoiceTable
                        invoices={invoices}
                        getCounterparty={(invoice) => invoice.customer}
                    />

                    {hasUnbooked && (
                        <div style={VAT_UNBOOKED_WARNING_STYLE}>
                            <strong style={VAT_UNBOOKED_WARNING_LABEL_STYLE}>Obs!</strong>{' '}
                            {unbookedInvoices.length === 1
                                ? `Faktura #${unbookedInvoices[0].nr} (${formatSEK(unbookedInvoices[0].total)}) är ännu inte bokförd i Fortnox. `
                                : `${unbookedInvoices.length} fakturor är ännu inte bokförda i Fortnox. `
                            }
                            Momsen i rapporten ovan inkluderar alla fakturor, men tänk på att Skatteverket
                            kräver att underlagen är bokförda. Bokför fakturorna i Fortnox och uppdatera sedan rapporten.
                        </div>
                    )}
                </div>
            )}

            {/* Leverantörsfakturor */}
            {supplierInvoices.length > 0 && (
                <div style={VAT_SECTION_WRAP_STYLE}>
                    <h4 style={VAT_SECTION_TITLE_STYLE}>
                        Leverantörsfakturor
                    </h4>

                    <InvoiceTable
                        invoices={supplierInvoices}
                        getCounterparty={(invoice) => invoice.supplier || invoice.customer}
                    />
                </div>
            )}

        </div>
    );
}

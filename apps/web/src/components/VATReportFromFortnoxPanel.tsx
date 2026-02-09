import { useState, useEffect } from 'preact/hooks';
import { supabase } from '../lib/supabase';
import { logger } from '../services/LoggerService';
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

function formatSEK(amount: number): string {
    return amount.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' SEK';
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

            const response = await fetch(
                `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fortnox`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${session.access_token}`
                    },
                    body: JSON.stringify({ action: 'getVATReport' })
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
                style={{
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
                }}
            >
                ← Tillbaka
            </button>

            {!loading && (
                <button
                    type="button"
                    onClick={fetchVATReport}
                    style={{
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
                    }}
                >
                    ↻ Uppdatera
                </button>
            )}

            {loading && (
                <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
                    <div className="modal-spinner" style={{ margin: '0 auto 1rem' }} role="status" aria-label="Laddar" />
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                        Hämtar momsrapport från Fortnox...
                    </p>
                </div>
            )}

            {error && (
                <div style={{
                    padding: '1.5rem',
                    borderRadius: '12px',
                    background: 'var(--status-danger-bg)',
                    border: '1px solid var(--status-danger-border)',
                    textAlign: 'center'
                }}>
                    <p style={{ color: 'var(--status-danger)', margin: '0 0 1rem', fontSize: '0.9rem' }}>
                        {error}
                    </p>
                    <button
                        type="button"
                        onClick={fetchVATReport}
                        style={{
                            padding: '0.5rem 1.2rem',
                            borderRadius: '8px',
                            border: 'none',
                            background: 'var(--accent-gradient)',
                            color: '#fff',
                            cursor: 'pointer',
                            fontSize: '0.85rem',
                            fontWeight: 600
                        }}
                    >
                        Försök igen
                    </button>
                </div>
            )}

            {reportData && <VATReportCard data={reportData} />}

            {/* Fakturaöversikt */}
            {invoices.length > 0 && (
                <div style={{
                    marginTop: '1rem',
                    padding: '1.2rem',
                    borderRadius: '12px',
                    background: 'var(--surface-1)',
                    border: '1px solid var(--surface-border)',
                }}>
                    <h4 style={{ margin: '0 0 0.8rem', fontSize: '0.95rem', color: 'var(--text-primary)' }}>
                        Fakturaöversikt
                    </h4>

                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid var(--surface-border)' }}>
                                <th style={{ textAlign: 'left', padding: '0.4rem 0.6rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Faktura</th>
                                <th style={{ textAlign: 'right', padding: '0.4rem 0.6rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Netto</th>
                                <th style={{ textAlign: 'right', padding: '0.4rem 0.6rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Moms</th>
                                <th style={{ textAlign: 'right', padding: '0.4rem 0.6rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Totalt</th>
                                <th style={{ textAlign: 'center', padding: '0.4rem 0.6rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {invoices.map(inv => (
                                <tr key={inv.nr} style={{ borderBottom: '1px solid var(--surface-border)' }}>
                                    <td style={{ padding: '0.5rem 0.6rem', color: 'var(--text-primary)' }}>
                                        #{inv.nr}
                                        {inv.customer && <span style={{ color: 'var(--text-secondary)', marginLeft: '0.4rem' }}>({inv.customer})</span>}
                                        <br />
                                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{inv.date}</span>
                                    </td>
                                    <td style={{ textAlign: 'right', padding: '0.5rem 0.6rem', color: 'var(--text-primary)' }}>{formatSEK(inv.net)}</td>
                                    <td style={{ textAlign: 'right', padding: '0.5rem 0.6rem', color: 'var(--text-primary)' }}>{formatSEK(inv.vat)}</td>
                                    <td style={{ textAlign: 'right', padding: '0.5rem 0.6rem', color: 'var(--text-primary)', fontWeight: 600 }}>{formatSEK(inv.total)}</td>
                                    <td style={{ textAlign: 'center', padding: '0.5rem 0.6rem' }}>
                                        <span style={{
                                            display: 'inline-block',
                                            padding: '0.15rem 0.5rem',
                                            borderRadius: '6px',
                                            fontSize: '0.75rem',
                                            fontWeight: 600,
                                            background: inv.booked ? 'rgba(52, 211, 153, 0.15)' : 'rgba(251, 191, 36, 0.15)',
                                            color: inv.booked ? 'var(--status-success)' : 'var(--status-warning, #fbbf24)',
                                        }}>
                                            {inv.booked ? 'Bokförd' : 'Ej bokförd'}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    {hasUnbooked && (
                        <div style={{
                            marginTop: '0.8rem',
                            padding: '0.8rem 1rem',
                            borderRadius: '8px',
                            background: 'rgba(251, 191, 36, 0.08)',
                            border: '1px solid rgba(251, 191, 36, 0.25)',
                            fontSize: '0.8rem',
                            lineHeight: 1.5,
                            color: 'var(--text-secondary)',
                        }}>
                            <strong style={{ color: 'var(--status-warning, #fbbf24)' }}>Obs!</strong>{' '}
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
                <div style={{
                    marginTop: '1rem',
                    padding: '1.2rem',
                    borderRadius: '12px',
                    background: 'var(--surface-1)',
                    border: '1px solid var(--surface-border)',
                }}>
                    <h4 style={{ margin: '0 0 0.8rem', fontSize: '0.95rem', color: 'var(--text-primary)' }}>
                        Leverantörsfakturor
                    </h4>

                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid var(--surface-border)' }}>
                                <th style={{ textAlign: 'left', padding: '0.4rem 0.6rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Faktura</th>
                                <th style={{ textAlign: 'right', padding: '0.4rem 0.6rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Netto</th>
                                <th style={{ textAlign: 'right', padding: '0.4rem 0.6rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Moms</th>
                                <th style={{ textAlign: 'right', padding: '0.4rem 0.6rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Totalt</th>
                                <th style={{ textAlign: 'center', padding: '0.4rem 0.6rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {supplierInvoices.map(inv => (
                                <tr key={inv.nr} style={{ borderBottom: '1px solid var(--surface-border)' }}>
                                    <td style={{ padding: '0.5rem 0.6rem', color: 'var(--text-primary)' }}>
                                        #{inv.nr}
                                        {(inv.supplier || inv.customer) && <span style={{ color: 'var(--text-secondary)', marginLeft: '0.4rem' }}>({inv.supplier || inv.customer})</span>}
                                        <br />
                                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{inv.date}</span>
                                    </td>
                                    <td style={{ textAlign: 'right', padding: '0.5rem 0.6rem', color: 'var(--text-primary)' }}>{formatSEK(inv.net)}</td>
                                    <td style={{ textAlign: 'right', padding: '0.5rem 0.6rem', color: 'var(--text-primary)' }}>{formatSEK(inv.vat)}</td>
                                    <td style={{ textAlign: 'right', padding: '0.5rem 0.6rem', color: 'var(--text-primary)', fontWeight: 600 }}>{formatSEK(inv.total)}</td>
                                    <td style={{ textAlign: 'center', padding: '0.5rem 0.6rem' }}>
                                        <span style={{
                                            display: 'inline-block',
                                            padding: '0.15rem 0.5rem',
                                            borderRadius: '6px',
                                            fontSize: '0.75rem',
                                            fontWeight: 600,
                                            background: inv.booked ? 'rgba(52, 211, 153, 0.15)' : 'rgba(251, 191, 36, 0.15)',
                                            color: inv.booked ? 'var(--status-success)' : 'var(--status-warning, #fbbf24)',
                                        }}>
                                            {inv.booked ? 'Bokförd' : 'Ej bokförd'}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

        </div>
    );
}

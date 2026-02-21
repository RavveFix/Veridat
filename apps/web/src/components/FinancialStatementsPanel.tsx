/**
 * FinancialStatementsPanel - Resultaträkning & Balansräkning from Fortnox.
 *
 * Fetches account balances from Fortnox, classifies them by BAS account range,
 * and displays P&L and Balance Sheet with period selection.
 */

import { useState, useEffect, useCallback } from 'preact/hooks';
import { supabase } from '../lib/supabase';
import { logger } from '../services/LoggerService';
import { companyService } from '../services/CompanyService';

// =============================================================================
// TYPES
// =============================================================================

interface AccountLine {
    number: number;
    name: string;
    openingBalance: number;
    closingBalance: number;
    change: number;
}

interface AccountSection {
    title: string;
    accounts: AccountLine[];
    total: number;
}

interface FinancialYear {
    id: number;
    fromDate: string;
    toDate: string;
}

interface FinancialStatementsData {
    type: 'financial_statements';
    company: { name: string; orgNumber: string };
    financialYear: FinancialYear;
    availableYears: FinancialYear[];
    resultatRakning: {
        sections: AccountSection[];
        totalRevenue: number;
        totalExpenses: number;
        netResult: number;
    };
    balansRakning: {
        assets: AccountSection[];
        liabilitiesEquity: AccountSection[];
        totalAssets: number;
        totalLiabilitiesEquity: number;
        balanced: boolean;
    };
    accountCount: number;
}

type ReportTab = 'resultat' | 'balans';

interface FinancialStatementsPanelProps {
    onBack: () => void;
}

// =============================================================================
// STYLES
// =============================================================================

const BACK_BTN = {
    display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
    padding: '0.4rem 0.8rem', borderRadius: '8px',
    border: '1px solid var(--surface-border)', background: 'var(--surface-2)',
    color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.85rem',
} as const;

const REFRESH_BTN = {
    display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
    padding: '0.4rem 0.8rem', borderRadius: '8px', border: 'none',
    background: 'var(--accent-gradient)', color: '#fff',
    cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, marginLeft: '0.5rem',
} as const;

const LOADING_WRAP = { textAlign: 'center', padding: '3rem 1rem' } as const;
const LOADING_TEXT = { color: 'var(--text-secondary)', fontSize: '0.9rem' } as const;

const ERROR_BOX = {
    padding: '1.5rem', borderRadius: '12px',
    background: 'var(--status-danger-bg)', border: '1px solid var(--status-danger-border)',
    textAlign: 'center',
} as const;
const ERROR_TEXT = { color: 'var(--status-danger)', margin: '0 0 1rem', fontSize: '0.9rem' } as const;
const RETRY_BTN = {
    padding: '0.5rem 1.2rem', borderRadius: '8px', border: 'none',
    background: 'var(--accent-gradient)', color: '#fff',
    cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600,
} as const;

const HEADER_ROW = { display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' } as const;

const YEAR_SELECT = {
    padding: '0.4rem 0.6rem', borderRadius: '8px',
    border: '1px solid var(--glass-border)', background: 'rgba(255,255,255,0.04)',
    color: 'var(--text-primary)', fontSize: '0.85rem', outline: 'none',
} as const;

const TAB_BAR = {
    display: 'flex', gap: '0',
    borderBottom: '1px solid var(--glass-border)', marginBottom: '1rem',
} as const;

const TAB_BTN_BASE = {
    padding: '0.6rem 1.2rem', background: 'transparent', border: 'none',
    borderBottom: '2px solid transparent', fontSize: '0.85rem',
    fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s ease',
} as const;

const SECTION_CARD = {
    marginBottom: '0.75rem', padding: '1rem', borderRadius: '12px',
    background: 'var(--surface-1)', border: '1px solid var(--surface-border)',
} as const;

const SECTION_TITLE = {
    fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)',
    marginBottom: '0.6rem',
} as const;

const TABLE = { width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' } as const;
const TH_BASE = { padding: '0.35rem 0.5rem', color: 'var(--text-secondary)', fontWeight: 500, borderBottom: '1px solid var(--surface-border)' } as const;
const TD_BASE = { padding: '0.4rem 0.5rem', color: 'var(--text-primary)', borderBottom: '1px solid rgba(255,255,255,0.04)' } as const;

const TOTAL_ROW = {
    padding: '0.6rem 0.5rem', fontWeight: 700, fontSize: '0.9rem',
    color: 'var(--text-primary)', borderTop: '2px solid var(--glass-border)',
} as const;

const SUMMARY_GRID = {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: '0.75rem', marginBottom: '1rem',
} as const;

const COMPANY_HEADER = {
    fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '0.25rem',
} as const;

const BALANCE_CHECK = {
    padding: '0.5rem 0.75rem', borderRadius: '8px', fontSize: '0.8rem', marginTop: '0.5rem',
} as const;

// =============================================================================
// HELPERS
// =============================================================================

function formatSEK(amount: number): string {
    // In Fortnox, revenue accounts are credit-normal (negative = income)
    // Display with proper sign convention
    return amount.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(dateStr: string): string {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('sv-SE');
}

function getTabStyle(active: boolean) {
    return {
        ...TAB_BTN_BASE,
        color: active ? 'var(--accent-primary)' : 'var(--text-secondary)',
        borderBottomColor: active ? 'var(--accent-primary)' : 'transparent',
    } as const;
}

const FORTNOX_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fortnox`;

// =============================================================================
// COMPONENT
// =============================================================================

export function FinancialStatementsPanel({ onBack }: FinancialStatementsPanelProps) {
    const [data, setData] = useState<FinancialStatementsData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<ReportTab>('resultat');
    const [selectedYearId, setSelectedYearId] = useState<number | null>(null);
    const companyId = companyService.getCurrentId();

    const fetchReport = useCallback(async (yearId?: number) => {
        setLoading(true);
        setError(null);

        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.access_token) {
                setError('Du måste vara inloggad.');
                return;
            }

            const response = await fetch(FORTNOX_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${session.access_token}`,
                },
                body: JSON.stringify({
                    action: 'getFinancialStatements',
                    companyId,
                    payload: yearId ? { financialYearId: yearId } : {},
                }),
            });

            const body = await response.json().catch(() => ({}));
            if (!response.ok) {
                const msg = typeof body.error === 'string' ? body.error : `Kunde inte hämta rapporter (${response.status})`;
                throw new Error(msg);
            }

            setData(body as FinancialStatementsData);
            if (!selectedYearId && body.financialYear) {
                setSelectedYearId(body.financialYear.id);
            }
        } catch (err) {
            logger.error('Failed to fetch financial statements', err);
            setError(err instanceof Error ? err.message : 'Kunde inte hämta rapporter från Fortnox.');
        } finally {
            setLoading(false);
        }
    }, [companyId, selectedYearId]);

    useEffect(() => {
        void fetchReport();
    }, []);

    const handleYearChange = useCallback((yearId: number) => {
        setSelectedYearId(yearId);
        void fetchReport(yearId);
    }, [fetchReport]);

    // Loading state
    if (loading) {
        return (
            <div>
                <button type="button" onClick={onBack} style={BACK_BTN}>Tillbaka</button>
                <div style={LOADING_WRAP}>
                    <div className="spinner" style={{ margin: '0 auto 1rem' }} />
                    <div style={LOADING_TEXT}>Hämtar resultat- och balansräkning från Fortnox...</div>
                </div>
            </div>
        );
    }

    // Error state
    if (error) {
        return (
            <div>
                <button type="button" onClick={onBack} style={BACK_BTN}>Tillbaka</button>
                <div style={ERROR_BOX}>
                    <p style={ERROR_TEXT}>{error}</p>
                    <button type="button" onClick={() => void fetchReport(selectedYearId || undefined)} style={RETRY_BTN}>
                        Försök igen
                    </button>
                </div>
            </div>
        );
    }

    if (!data) return null;

    const { resultatRakning, balansRakning, company, financialYear, availableYears } = data;

    return (
        <div className="panel-stagger">
            {/* Header */}
            <div style={HEADER_ROW}>
                <button type="button" onClick={onBack} style={BACK_BTN}>Tillbaka</button>
                <button type="button" onClick={() => void fetchReport(selectedYearId || undefined)} style={REFRESH_BTN}>
                    Uppdatera
                </button>

                {availableYears.length > 1 && (
                    <select
                        value={selectedYearId || ''}
                        onChange={e => handleYearChange(Number(e.currentTarget.value))}
                        style={YEAR_SELECT}
                    >
                        {availableYears.map(fy => (
                            <option key={fy.id} value={fy.id}>
                                {formatDate(fy.fromDate)} – {formatDate(fy.toDate)}
                            </option>
                        ))}
                    </select>
                )}
            </div>

            {/* Company info */}
            <div style={COMPANY_HEADER}>
                {company.name} ({company.orgNumber}) — Räkenskapsår {formatDate(financialYear.fromDate)} – {formatDate(financialYear.toDate)}
            </div>

            {/* Summary cards */}
            <div style={SUMMARY_GRID}>
                <div className="panel-card panel-card--no-hover">
                    <div className="panel-label">Intäkter</div>
                    <div className="panel-stat" style={{ color: '#10b981' }}>
                        {formatSEK(Math.abs(resultatRakning.totalRevenue))} kr
                    </div>
                </div>
                <div className="panel-card panel-card--no-hover">
                    <div className="panel-label">Kostnader</div>
                    <div className="panel-stat" style={{ color: '#ef4444' }}>
                        {formatSEK(resultatRakning.totalExpenses)} kr
                    </div>
                </div>
                <div className="panel-card panel-card--no-hover">
                    <div className="panel-label">Resultat</div>
                    <div className="panel-stat" style={{ color: resultatRakning.netResult <= 0 ? '#10b981' : '#ef4444' }}>
                        {formatSEK(Math.abs(resultatRakning.netResult))} kr
                        {resultatRakning.netResult <= 0 ? ' vinst' : ' förlust'}
                    </div>
                </div>
                <div className="panel-card panel-card--no-hover">
                    <div className="panel-label">Tillgångar</div>
                    <div className="panel-stat" style={{ color: 'var(--text-primary)' }}>
                        {formatSEK(balansRakning.totalAssets)} kr
                    </div>
                </div>
            </div>

            {/* Tab bar */}
            <div style={TAB_BAR}>
                <button type="button" onClick={() => setActiveTab('resultat')} style={getTabStyle(activeTab === 'resultat')}>
                    Resultaträkning
                </button>
                <button type="button" onClick={() => setActiveTab('balans')} style={getTabStyle(activeTab === 'balans')}>
                    Balansräkning
                </button>
            </div>

            {/* P&L */}
            {activeTab === 'resultat' && (
                <div className="panel-stagger">
                    {resultatRakning.sections.map(section => (
                        <ReportSection key={section.title} section={section} isRevenue={section.title === 'Nettoomsättning'} />
                    ))}

                    <div style={SECTION_CARD}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)' }}>
                                Årets resultat
                            </span>
                            <span style={{
                                fontWeight: 700, fontSize: '1.1rem',
                                color: resultatRakning.netResult <= 0 ? '#10b981' : '#ef4444',
                            }}>
                                {formatSEK(Math.abs(resultatRakning.netResult))} kr
                                {resultatRakning.netResult <= 0 ? ' (vinst)' : ' (förlust)'}
                            </span>
                        </div>
                    </div>
                </div>
            )}

            {/* Balance Sheet */}
            {activeTab === 'balans' && (
                <div className="panel-stagger">
                    <div style={{ ...SECTION_TITLE, fontSize: '0.95rem', marginBottom: '0.5rem' }}>Tillgångar</div>
                    {balansRakning.assets.map(section => (
                        <ReportSection key={section.title} section={section} />
                    ))}
                    <div style={{ ...SECTION_CARD, background: 'rgba(59, 130, 246, 0.04)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Summa tillgångar</span>
                            <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{formatSEK(balansRakning.totalAssets)} kr</span>
                        </div>
                    </div>

                    <div style={{ ...SECTION_TITLE, fontSize: '0.95rem', marginBottom: '0.5rem', marginTop: '1rem' }}>Eget kapital och skulder</div>
                    {balansRakning.liabilitiesEquity.map(section => (
                        <ReportSection key={section.title} section={section} />
                    ))}
                    <div style={{ ...SECTION_CARD, background: 'rgba(59, 130, 246, 0.04)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Summa eget kapital och skulder</span>
                            <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{formatSEK(Math.abs(balansRakning.totalLiabilitiesEquity))} kr</span>
                        </div>
                    </div>

                    {/* Balance check */}
                    <div style={{
                        ...BALANCE_CHECK,
                        background: balansRakning.balanced ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)',
                        color: balansRakning.balanced ? '#10b981' : '#ef4444',
                        border: `1px solid ${balansRakning.balanced ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                    }}>
                        {balansRakning.balanced
                            ? 'Balansräkningen stämmer — tillgångar = eget kapital + skulder'
                            : `Differens: ${formatSEK(Math.abs(balansRakning.totalAssets + balansRakning.totalLiabilitiesEquity))} kr — kontrollera kontosaldon`}
                    </div>
                </div>
            )}

            {/* AI disclaimer */}
            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '0.75rem', fontStyle: 'italic' }}>
                Rapporterna baseras på kontosaldon i Fortnox. Kontrollera mot bokslut innan beslut.
            </div>
        </div>
    );
}

// =============================================================================
// SUBCOMPONENTS
// =============================================================================

function ReportSection({ section, isRevenue }: { section: AccountSection; isRevenue?: boolean }) {
    if (section.accounts.length === 0) return null;

    return (
        <div style={SECTION_CARD}>
            <div style={SECTION_TITLE}>{section.title}</div>
            <table style={TABLE}>
                <thead>
                    <tr>
                        <th style={{ ...TH_BASE, textAlign: 'left' }}>Konto</th>
                        <th style={{ ...TH_BASE, textAlign: 'right' }}>IB</th>
                        <th style={{ ...TH_BASE, textAlign: 'right' }}>UB</th>
                        <th style={{ ...TH_BASE, textAlign: 'right' }}>Förändring</th>
                    </tr>
                </thead>
                <tbody>
                    {section.accounts.map(acc => (
                        <tr key={acc.number}>
                            <td style={{ ...TD_BASE, textAlign: 'left' }}>
                                <span style={{ fontWeight: 600, marginRight: '0.5rem' }}>{acc.number}</span>
                                {acc.name}
                            </td>
                            <td style={{ ...TD_BASE, textAlign: 'right' }}>
                                {isRevenue ? formatSEK(Math.abs(acc.openingBalance)) : formatSEK(acc.openingBalance)}
                            </td>
                            <td style={{ ...TD_BASE, textAlign: 'right' }}>
                                {isRevenue ? formatSEK(Math.abs(acc.closingBalance)) : formatSEK(acc.closingBalance)}
                            </td>
                            <td style={{
                                ...TD_BASE, textAlign: 'right',
                                color: acc.change === 0 ? 'var(--text-secondary)' : acc.change > 0 ? '#ef4444' : '#10b981',
                            }}>
                                {formatSEK(isRevenue ? Math.abs(acc.change) : acc.change)}
                            </td>
                        </tr>
                    ))}
                </tbody>
                <tfoot>
                    <tr>
                        <td style={{ ...TOTAL_ROW, textAlign: 'left' }}>Summa {section.title.toLowerCase()}</td>
                        <td style={{ ...TOTAL_ROW, textAlign: 'right' }} />
                        <td style={{ ...TOTAL_ROW, textAlign: 'right' }}>
                            {isRevenue ? formatSEK(Math.abs(section.total)) : formatSEK(section.total)} kr
                        </td>
                        <td style={{ ...TOTAL_ROW, textAlign: 'right' }} />
                    </tr>
                </tfoot>
            </table>
        </div>
    );
}

/**
 * DashboardPanel - Ekonomisk översikt
 *
 * Aggregerar data från alla Veridat-verktyg:
 * - VAT-rapport (resultat, momssaldo)
 * - Bankimporter (banksaldo, perioder)
 * - Fakturainkorg (väntande fakturor)
 * - Copilot-notiser (förfallna, obokförda)
 * - Avstämning (oavstämda perioder)
 * - Fortnox (anslutningsstatus)
 */

import { FunctionComponent } from 'preact';
import { useState, useEffect, useMemo, useCallback } from 'preact/hooks';
import { bankImportService } from '../services/BankImportService';
import { copilotService } from '../services/CopilotService';
import { fortnoxContextService, type FortnoxConnectionStatus } from '../services/FortnoxContextService';
import { companyService } from '../services/CompanyService';
import { STORAGE_KEYS } from '../constants/storageKeys';

// =============================================================================
// TYPES
// =============================================================================

interface DashboardPanelProps {
    onBack: () => void;
    onNavigate: (tool: string) => void;
}

interface DashboardData {
    resultat: number | null;
    momssaldo: number | null;
    banksaldo: number;
    fortnoxStatus: FortnoxConnectionStatus;
    overdueCount: number;
    unbookedCount: number;
    pendingInvoices: number;
    unreconciledCount: number;
    guardianAlertCount: number;
    monthStatuses: MonthBadge[];
    deadlines: Deadline[];
}

interface MonthBadge {
    period: string;
    label: string;
    status: 'reconciled' | 'pending' | 'empty';
    txCount: number;
}

interface Deadline {
    id: string;
    title: string;
    date: Date;
    daysUntil: number;
    severity: 'critical' | 'warning' | 'info';
}

// =============================================================================
// DATA AGGREGATION (unchanged logic)
// =============================================================================

function aggregateDashboardData(companyId: string): DashboardData {
    let resultat: number | null = null;
    let momssaldo: number | null = null;
    try {
        const vatRaw = localStorage.getItem(`latest_vat_report_${companyId}`);
        if (vatRaw) {
            const vatReport = JSON.parse(vatRaw);
            resultat = vatReport?.summary?.result ?? null;
            momssaldo = vatReport?.vat?.net_vat ?? null;
        }
    } catch { /* ignore */ }

    const imports = bankImportService.getImports(companyId);
    const allTx = imports.flatMap(i => i.transactions);
    const banksaldo = allTx.reduce((sum, tx) => sum + tx.amount, 0);

    const notifications = copilotService.getNotifications();
    const overdueCount = notifications.filter(n => n.type === 'overdue_invoice').length;
    const unbookedCount = notifications.filter(n => n.type === 'unbooked_invoice').length;
    const guardianAlertCount = notifications.filter(n =>
        n.type === 'guardian_alert' && (n.severity === 'critical' || n.severity === 'warning')
    ).length;

    let pendingInvoices = 0;
    try {
        const inboxRaw = localStorage.getItem(STORAGE_KEYS.invoiceInbox);
        if (inboxRaw) {
            const inboxStore = JSON.parse(inboxRaw) as Record<string, Array<{ status: string }>>;
            pendingInvoices = (inboxStore[companyId] || []).filter(i => i.status === 'ny' || i.status === 'granskad').length;
        }
    } catch { /* ignore */ }

    let reconciledSet = new Set<string>();
    try {
        const reconRaw = localStorage.getItem(STORAGE_KEYS.reconciledPeriods);
        if (reconRaw) {
            const reconStore = JSON.parse(reconRaw) as Record<string, string[]>;
            reconciledSet = new Set(reconStore[companyId] || []);
        }
    } catch { /* ignore */ }

    const periodTxMap = new Map<string, number>();
    for (const tx of allTx) {
        if (tx.date) {
            const period = tx.date.substring(0, 7);
            periodTxMap.set(period, (periodTxMap.get(period) || 0) + 1);
        }
    }

    const allPeriods = [...periodTxMap.keys()].sort((a, b) => b.localeCompare(a));
    const unreconciledCount = allPeriods.filter(p => !reconciledSet.has(p)).length;

    const now = new Date();
    const monthStatuses: MonthBadge[] = [];
    for (let i = 0; i < 6; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const label = d.toLocaleDateString('sv-SE', { month: 'short' }).replace('.', '');
        const txCount = periodTxMap.get(period) || 0;
        const status: MonthBadge['status'] = reconciledSet.has(period) ? 'reconciled' : txCount > 0 ? 'pending' : 'empty';
        monthStatuses.push({ period, label, status, txCount });
    }

    const fortnoxStatus = fortnoxContextService.getConnectionStatus();
    const deadlines = computeDeadlines(companyId);

    return {
        resultat,
        momssaldo,
        banksaldo,
        fortnoxStatus,
        overdueCount,
        unbookedCount,
        pendingInvoices,
        unreconciledCount,
        guardianAlertCount,
        monthStatuses,
        deadlines
    };
}

function computeDeadlines(companyId: string): Deadline[] {
    const now = new Date();
    const deadlines: Deadline[] = [];

    const vatDay = 12;
    const vatMonth = now.getDate() <= vatDay ? now.getMonth() : now.getMonth() + 1;
    const vatDate = new Date(now.getFullYear(), vatMonth, vatDay);
    const vatDays = Math.ceil((vatDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    deadlines.push({
        id: 'vat-deadline',
        title: `Momsdeklaration ${vatDate.toLocaleDateString('sv-SE', { month: 'long' })}`,
        date: vatDate, daysUntil: vatDays,
        severity: vatDays <= 3 ? 'critical' : vatDays <= 7 ? 'warning' : 'info',
    });

    const empMonth = now.getDate() <= vatDay ? now.getMonth() : now.getMonth() + 1;
    const empDate = new Date(now.getFullYear(), empMonth, vatDay);
    const empDays = Math.ceil((empDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    deadlines.push({
        id: 'employer-deadline',
        title: `Arbetsgivaravgifter ${empDate.toLocaleDateString('sv-SE', { month: 'long' })}`,
        date: empDate, daysUntil: empDays,
        severity: empDays <= 3 ? 'critical' : empDays <= 7 ? 'warning' : 'info',
    });

    try {
        const inboxRaw = localStorage.getItem(STORAGE_KEYS.invoiceInbox);
        if (inboxRaw) {
            const inboxStore = JSON.parse(inboxRaw) as Record<string, Array<{ dueDate: string; supplierName: string; status: string }>>;
            for (const inv of (inboxStore[companyId] || [])) {
                if (inv.dueDate && inv.status !== 'betald') {
                    const due = new Date(inv.dueDate);
                    const days = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                    if (days >= -7 && days <= 30) {
                        deadlines.push({
                            id: `inv-${inv.dueDate}-${inv.supplierName}`,
                            title: `Faktura ${inv.supplierName || 'okänd'}`,
                            date: due, daysUntil: days,
                            severity: days <= 0 ? 'critical' : days <= 7 ? 'warning' : 'info',
                        });
                    }
                }
            }
        }
    } catch { /* ignore */ }

    deadlines.sort((a, b) => a.date.getTime() - b.date.getTime());
    return deadlines.slice(0, 5);
}

// =============================================================================
// HELPERS
// =============================================================================

const formatAmount = (value: number) =>
    value.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' kr';

const SEVERITY_COLORS: Record<string, { color: string; bg: string; border: string }> = {
    critical: { color: '#ef4444', bg: 'rgba(239, 68, 68, 0.12)', border: '#ef4444' },
    warning: { color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.12)', border: '#f59e0b' },
    info: { color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.12)', border: '#3b82f6' },
};

const MONTH_COLORS: Record<string, { dot: string; bg: string; border: string }> = {
    reconciled: { dot: '#10b981', bg: 'rgba(16, 185, 129, 0.1)', border: 'rgba(16, 185, 129, 0.3)' },
    pending: { dot: '#f59e0b', bg: 'rgba(245, 158, 11, 0.1)', border: 'rgba(245, 158, 11, 0.3)' },
    empty: { dot: '#475569', bg: 'rgba(71, 85, 105, 0.06)', border: 'var(--surface-border)' },
};

const STATUS_CONFIGS = [
    { key: 'overdue', icon: 'alert-circle', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.1)', label: 'Förfallna fakturor', nav: 'fortnox-panel' },
    { key: 'unbooked', icon: 'file-text', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.1)', label: 'Obokförda fakturor', nav: 'fortnox-panel' },
    { key: 'guardian', icon: 'shield-alert', color: '#f97316', bg: 'rgba(249, 115, 22, 0.1)', label: 'Guardian-larm', nav: 'fortnox-panel' },
    { key: 'inbox', icon: 'inbox', color: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.1)', label: 'Väntande i inkorgen', nav: 'invoice-inbox' },
    { key: 'unrecon', icon: 'check-circle', color: '#0ea5e9', bg: 'rgba(14, 165, 233, 0.1)', label: 'Ej avstämda perioder', nav: 'reconciliation' },
] as const;

const QUICK_ACTIONS = [
    { label: 'Importera bank', desc: 'CSV-kontoutdrag', color: '#0ea5e9', nav: 'bank-import', iconPath: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12' },
    { label: 'Fakturainkorg', desc: 'Ladda upp PDF', color: '#8b5cf6', nav: 'invoice-inbox', iconPath: 'M22 12l-6 0-2 3-4 0-2-3-6 0M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z' },
    { label: 'Bankavstämning', desc: 'Per period', color: '#10b981', nav: 'reconciliation', iconPath: 'M22 11.08V12a10 10 0 11-5.93-9.14M22 4L12 14.01l-3-3' },
    { label: 'Fortnoxpanel', desc: 'Fakturor & Copilot', color: '#2563eb', nav: 'fortnox-panel', iconPath: 'M2 3h20v14H2zM8 21h8M12 17v4' },
];

// =============================================================================
// COMPONENT
// =============================================================================

export const DashboardPanel: FunctionComponent<DashboardPanelProps> = ({ onNavigate }) => {
    const [refreshKey, setRefreshKey] = useState(0);
    const companyId = useMemo(() => companyService.getCurrentId(), []);
    const company = useMemo(() => companyService.getCurrent(), []);
    const data = useMemo(() => aggregateDashboardData(companyId), [companyId, refreshKey]);
    const refresh = useCallback(() => setRefreshKey(k => k + 1), []);

    useEffect(() => {
        const handler = () => refresh();
        copilotService.addEventListener('copilot-updated', handler as EventListener);
        return () => copilotService.removeEventListener('copilot-updated', handler as EventListener);
    }, [refresh]);

    const hasAnyData = data.resultat !== null || data.banksaldo !== 0 || data.pendingInvoices > 0 || data.overdueCount > 0 || data.guardianAlertCount > 0;
    const allClear = hasAnyData && data.overdueCount === 0 && data.unbookedCount === 0 && data.pendingInvoices === 0 && data.unreconciledCount === 0 && data.guardianAlertCount === 0;

    const statusCounts: Record<string, number> = {
        overdue: data.overdueCount,
        unbooked: data.unbookedCount,
        guardian: data.guardianAlertCount,
        inbox: data.pendingInvoices,
        unrecon: data.unreconciledCount,
    };

    return (
        <div className="panel-stagger" style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', letterSpacing: '0.02em' }}>
                        {company.name || 'Mitt Företag'}
                        {company.orgNumber ? ` \u00b7 ${company.orgNumber}` : ''}
                    </div>
                </div>
                <button
                    onClick={refresh}
                    className="panel-card panel-card--no-hover"
                    style={{
                        padding: '0.4rem 0.75rem',
                        borderRadius: '10px',
                        fontSize: '0.78rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        color: 'var(--text-secondary)',
                        fontWeight: 600,
                    }}
                >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M23 4v6h-6" /><path d="M1 20v-6h6" />
                        <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                    </svg>
                    Uppdatera
                </button>
            </div>

            {/* All-clear banner */}
            {allClear && (
                <div className="panel-card" style={{
                    background: 'rgba(16, 185, 129, 0.08)',
                    border: '1px solid rgba(16, 185, 129, 0.2)',
                    color: '#10b981',
                    fontSize: '0.88rem',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.6rem',
                }}>
                    <div className="panel-icon" style={{ background: 'rgba(16, 185, 129, 0.15)', width: '32px', height: '32px', borderRadius: '8px' }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
                        </svg>
                    </div>
                    Allt ser bra ut! Inga åtgärder behövs just nu.
                </div>
            )}

            {/* A. Financial Snapshot */}
            <div>
                <div className="panel-section-title">Ekonomisk översikt</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
                    <KPICard label="Resultat" value={data.resultat} color="#10b981" emptyText="Ingen momsrapport"
                        iconPath="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
                    <KPICard label="Momssaldo" value={data.momssaldo} color="#3b82f6" emptyText="Ingen momsrapport"
                        iconPath="M1 4h22v16H1zM1 10h22" />
                    <KPICard label="Banksaldo" value={data.banksaldo} color="#0ea5e9" emptyText="Inga kontoutdrag" alwaysShow
                        iconPath="M2 17l10 5 10-5M2 12l10 5 10-5M12 2L2 7l10 5 10-5L12 2z" />
                    {/* Fortnox Status */}
                    <div className="panel-card panel-card--gradient" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                            <div className="panel-icon" style={{
                                background: data.fortnoxStatus === 'connected' ? 'var(--accent-gradient)' : 'var(--surface-3)',
                                color: data.fortnoxStatus === 'connected' ? '#fff' : 'var(--text-secondary)',
                                fontSize: '0.9rem', fontWeight: 800,
                            }}>
                                F
                            </div>
                            <span className="panel-label">Fortnox</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <div style={{
                                width: '8px', height: '8px', borderRadius: '50%',
                                background: data.fortnoxStatus === 'connected' ? '#10b981' : '#64748b',
                            }} />
                            <span style={{
                                fontSize: '0.9rem', fontWeight: 700,
                                color: data.fortnoxStatus === 'connected' ? '#10b981' : 'var(--text-secondary)',
                            }}>
                                {data.fortnoxStatus === 'connected' ? 'Ansluten' : data.fortnoxStatus === 'checking' ? 'Kontrollerar...' : 'Ej ansluten'}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {/* B. Status Overview */}
            <div>
                <div className="panel-section-title">Status</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
                    {STATUS_CONFIGS.map(cfg => {
                        const count = statusCounts[cfg.key];
                        const isOk = count === 0;
                        return (
                            <button
                                key={cfg.key}
                                type="button"
                                className="panel-card panel-card--interactive"
                                onClick={() => onNavigate(cfg.nav)}
                                style={{
                                    border: `1px solid ${isOk ? 'rgba(16,185,129,0.2)' : `${cfg.color}30`}`,
                                    background: isOk ? 'rgba(16,185,129,0.04)' : cfg.bg,
                                    display: 'flex', alignItems: 'center', gap: '0.75rem', textAlign: 'left',
                                    ...(count > 0 ? { animation: 'urgentPulse 2.5s ease-in-out infinite' } : {}),
                                }}
                            >
                                <div className="panel-icon" style={{
                                    background: isOk ? 'rgba(16,185,129,0.12)' : `${cfg.color}18`,
                                    color: isOk ? '#10b981' : cfg.color,
                                }}>
                                    <StatusIcon type={cfg.icon} />
                                </div>
                                <div>
                                    <div className={`panel-stat ${isOk ? 'panel-stat--positive' : 'panel-stat--neutral'}`}
                                        style={{ fontSize: '1.5rem', color: isOk ? '#10b981' : cfg.color }}>
                                        {count}
                                    </div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                                        {cfg.label}
                                    </div>
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* C. Reconciliation Overview */}
            {data.monthStatuses.some(m => m.status !== 'empty') && (
                <div>
                    <div className="panel-section-title">Avstämning per månad</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '0.5rem' }}>
                        {data.monthStatuses.map(m => {
                            const c = MONTH_COLORS[m.status];
                            return (
                                <div key={m.period} className="panel-card panel-card--no-hover" style={{
                                    padding: '0.75rem 0.5rem',
                                    background: c.bg, border: `1px solid ${c.border}`,
                                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.35rem',
                                    textAlign: 'center',
                                }}>
                                    <div style={{
                                        width: '10px', height: '10px', borderRadius: '50%',
                                        background: m.status === 'reconciled' ? c.dot : 'transparent',
                                        border: `2px solid ${c.dot}`,
                                    }} />
                                    <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)', textTransform: 'capitalize' }}>
                                        {m.label}
                                    </div>
                                    <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>
                                        {m.txCount} trans.
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* D. Deadlines */}
            <div>
                <div className="panel-section-title">Kommande deadlines</div>
                {data.deadlines.length === 0 ? (
                    <div className="panel-card panel-card--no-hover" style={{
                        fontSize: '0.85rem', color: 'var(--text-secondary)', textAlign: 'center', padding: '1.5rem',
                    }}>
                        Inga kommande deadlines de närmaste 30 dagarna.
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {data.deadlines.map(dl => {
                            const c = SEVERITY_COLORS[dl.severity];
                            return (
                                <div key={dl.id} className="panel-card panel-card--no-hover" style={{
                                    display: 'flex', alignItems: 'center', gap: '0.75rem',
                                    borderLeft: `3px solid ${c.border}`,
                                    borderRadius: '0 16px 16px 0',
                                }}>
                                    <span style={{
                                        padding: '0.3rem 0.8rem', borderRadius: '999px',
                                        background: c.bg, color: c.color,
                                        fontSize: '0.78rem', fontWeight: 700,
                                        whiteSpace: 'nowrap', minWidth: '70px', textAlign: 'center',
                                    }}>
                                        {dl.daysUntil <= 0 ? 'Förfallen' : dl.daysUntil === 1 ? 'Imorgon' : `${dl.daysUntil} dagar`}
                                    </span>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                                            {dl.title}
                                        </div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '1px' }}>
                                            {dl.date.toLocaleDateString('sv-SE', { day: 'numeric', month: 'long', year: 'numeric' })}
                                        </div>
                                    </div>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4, flexShrink: 0 }}>
                                        <polyline points="9 18 15 12 9 6" />
                                    </svg>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* E. Quick Actions */}
            <div>
                <div className="panel-section-title">Snabbåtgärder</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem' }}>
                    {QUICK_ACTIONS.map(qa => (
                        <button
                            key={qa.nav}
                            type="button"
                            className="panel-card panel-card--interactive"
                            onClick={() => onNavigate(qa.nav)}
                            style={{
                                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem',
                                padding: '1.25rem 1rem', textAlign: 'center',
                            }}
                        >
                            <div style={{
                                width: '48px', height: '48px', borderRadius: '14px',
                                background: qa.color, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                boxShadow: `0 4px 14px ${qa.color}40`,
                            }}>
                                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d={qa.iconPath} />
                                </svg>
                            </div>
                            <div>
                                <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                                    {qa.label}
                                </div>
                                <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                                    {qa.desc}
                                </div>
                            </div>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

interface KPICardProps {
    label: string;
    value: number | null;
    color: string;
    iconPath: string;
    emptyText: string;
    alwaysShow?: boolean;
}

const KPICard: FunctionComponent<KPICardProps> = ({ label, value, color, iconPath, emptyText, alwaysShow }) => {
    const showValue = value !== null || alwaysShow;
    const displayValue = value ?? 0;
    const isPositive = displayValue >= 0;

    return (
        <div className="panel-card panel-card--gradient" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <div className="panel-icon" style={{ background: `${color}15`, color }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d={iconPath} />
                    </svg>
                </div>
                <span className="panel-label">{label}</span>
            </div>
            {showValue ? (
                <span className={`panel-stat ${isPositive ? 'panel-stat--positive' : 'panel-stat--negative'}`}>
                    {formatAmount(displayValue)}
                </span>
            ) : (
                <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                    {emptyText}
                </span>
            )}
        </div>
    );
};

const StatusIcon: FunctionComponent<{ type: string }> = ({ type }) => {
    const props = { width: '16', height: '16', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '2', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
    switch (type) {
        case 'alert-circle': return <svg {...props}><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>;
        case 'file-text': return <svg {...props}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>;
        case 'shield-alert': return <svg {...props}><path d="M12 2l7 4v6c0 5-3.5 9-7 10-3.5-1-7-5-7-10V6l7-4z" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>;
        case 'inbox': return <svg {...props}><polyline points="22 12 16 12 14 15 10 15 8 12 2 12" /><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" /></svg>;
        case 'check-circle': return <svg {...props}><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>;
        default: return null;
    }
};

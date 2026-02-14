/**
 * ReconciliationView - Period-based bank reconciliation overview.
 *
 * Shows monthly reconciliation status: how many bank transactions have been
 * matched vs unmatched, and allows marking periods as reconciled.
 * Data comes from local BankImportService (bank transactions) and
 * Fortnox (invoices/vouchers).
 */

import { useEffect, useMemo, useState } from 'preact/hooks';
import { bankImportService } from '../services/BankImportService';
import { companyService } from '../services/CompanyService';
import { financeAgentService } from '../services/FinanceAgentService';
import { logger } from '../services/LoggerService';
import type { BankImport, BankTransaction } from '../types/bank';

interface ReconciliationViewProps {
    onBack: () => void;
    onOpenBankImport?: () => void;
}

interface MonthStatus {
    period: string; // YYYY-MM
    label: string;
    totalTransactions: number;
    totalAmount: number;
    inflow: number;
    outflow: number;
    reconciled: boolean;
    reconciledAt: string | null;
}

interface ReconciliationPeriodStatus {
    period: string;
    status?: string | null;
}

function formatAmount(value: number): string {
    return value.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getMonthLabel(period: string): string {
    const [year, month] = period.split('-');
    const months = [
        'Januari', 'Februari', 'Mars', 'April', 'Maj', 'Juni',
        'Juli', 'Augusti', 'September', 'Oktober', 'November', 'December'
    ];
    const monthIndex = parseInt(month, 10) - 1;
    return `${months[monthIndex] || month} ${year}`;
}

function setReconcileButtonBackground(button: HTMLButtonElement, isReconciled: boolean, isHover: boolean): void {
    if (isReconciled) {
        button.style.background = isHover ? '#059669' : '#10b981';
        return;
    }

    button.style.background = isHover ? 'var(--surface-3)' : 'var(--surface-2)';
}

function isClosedReconciliationStatus(status: string | null | undefined): boolean {
    return status === 'reconciled' || status === 'locked';
}

function toReconciledPeriodsSet(periods: ReconciliationPeriodStatus[]): Set<string> {
    return new Set(
        periods
            .filter((period) => isClosedReconciliationStatus(period.status))
            .map((period) => period.period)
    );
}

export function ReconciliationView({ onBack, onOpenBankImport }: ReconciliationViewProps) {
    const [imports, setImports] = useState<BankImport[]>([]);
    const [reconciledPeriods, setReconciledPeriods] = useState<Set<string>>(new Set());
    const companyId = companyService.getCurrentId();

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const [nextImports, periods] = await Promise.all([
                    bankImportService.refreshImports(companyId),
                    financeAgentService.refreshReconciliation(companyId),
                ]);
                if (cancelled) return;
                setImports(nextImports);
                setReconciledPeriods(toReconciledPeriodsSet(periods));
            } catch (error) {
                logger.warn('Failed to load reconciliation data', error);
                if (cancelled) return;
                setImports(bankImportService.getImports(companyId));
                setReconciledPeriods(new Set());
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [companyId]);

    const allTransactions = useMemo(() => {
        const txs: BankTransaction[] = [];
        for (const imp of imports) {
            txs.push(...imp.transactions);
        }
        return txs;
    }, [imports]);

    const monthStatuses = useMemo(() => {
        const byMonth = new Map<string, BankTransaction[]>();

        for (const tx of allTransactions) {
            const period = tx.date.substring(0, 7); // YYYY-MM
            const existing = byMonth.get(period) || [];
            existing.push(tx);
            byMonth.set(period, existing);
        }

        const statuses: MonthStatus[] = [];
        for (const [period, txs] of byMonth) {
            const totalAmount = txs.reduce((sum, tx) => sum + tx.amount, 0);
            const inflow = txs.filter(tx => tx.amount > 0).reduce((sum, tx) => sum + tx.amount, 0);
            const outflow = txs.filter(tx => tx.amount < 0).reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
            const isReconciled = reconciledPeriods.has(period);

            statuses.push({
                period,
                label: getMonthLabel(period),
                totalTransactions: txs.length,
                totalAmount,
                inflow,
                outflow,
                reconciled: isReconciled,
                reconciledAt: isReconciled ? new Date().toISOString() : null
            });
        }

        // Sort newest first
        statuses.sort((a, b) => b.period.localeCompare(a.period));
        return statuses;
    }, [allTransactions, reconciledPeriods]);

    const summary = useMemo(() => ({
        totalPeriods: monthStatuses.length,
        reconciled: monthStatuses.filter(m => m.reconciled).length,
        pending: monthStatuses.filter(m => !m.reconciled).length,
        totalTransactions: allTransactions.length
    }), [monthStatuses, allTransactions]);

    const toggleReconciled = (period: string) => {
        const currentlyReconciled = reconciledPeriods.has(period);
        const nextStatus = currentlyReconciled ? 'open' : 'reconciled';

        setReconciledPeriods((prev) => {
            const next = new Set(prev);
            if (currentlyReconciled) {
                next.delete(period);
            } else {
                next.add(period);
            }
            return next;
        });

        void financeAgentService
            .setReconciliationStatus(companyId, period, nextStatus)
            .catch(async (error) => {
                logger.error('Failed to persist reconciliation status', error);
                const periods = await financeAgentService.refreshReconciliation(companyId).catch(() => []);
                setReconciledPeriods(toReconciledPeriodsSet(periods));
            });
    };

    return (
        <div className="panel-stagger" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <button
                    type="button"
                    onClick={onBack}
                    style={{
                        background: 'var(--surface-2)',
                        border: '1px solid var(--surface-border)',
                        borderRadius: '8px',
                        color: 'var(--text-primary)',
                        padding: '0.4rem 0.75rem',
                        fontSize: '0.8rem',
                        fontWeight: '600',
                        cursor: 'pointer'
                    }}
                    onMouseOver={(e) => (e.currentTarget.style.background = 'var(--surface-3)')}
                    onMouseOut={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
                >
                    Tillbaka
                </button>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    Bankavstämning per period. Markera månader som avstämda.
                </span>
            </div>

            {/* Summary cards */}
            <div className="panel-stagger" style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                gap: '0.75rem'
            }}>
                {[
                    { label: 'Perioder', value: summary.totalPeriods, color: 'var(--text-primary)' },
                    { label: 'Avstämda', value: summary.reconciled, color: '#10b981' },
                    { label: 'Ej avstämda', value: summary.pending, color: summary.pending > 0 ? '#f59e0b' : 'var(--text-primary)' },
                    { label: 'Transaktioner', value: summary.totalTransactions, color: 'var(--text-primary)' }
                ].map(card => (
                    <div key={card.label} className="panel-card panel-card--no-hover">
                        <div className="panel-label">{card.label}</div>
                        <div className="panel-stat" style={{ color: card.color }}>{card.value}</div>
                    </div>
                ))}
            </div>

            {monthStatuses.length === 0 ? (
                <div className="panel-card panel-card--no-hover" style={{
                    textAlign: 'center',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.75rem',
                    alignItems: 'center',
                    border: '1px dashed var(--surface-border)'
                }}>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                        Inga bankimporter hittades. Importera kontoutdrag för att börja avstämningen.
                    </div>
                    {onOpenBankImport && (
                        <button
                            type="button"
                            onClick={onOpenBankImport}
                            style={{
                                padding: '0.6rem 1.25rem',
                                borderRadius: '8px',
                                border: 'none',
                                background: '#2563eb',
                                color: '#fff',
                                fontSize: '0.85rem',
                                fontWeight: 700,
                                cursor: 'pointer',
                                boxShadow: 'none'
                            }}
                            onMouseOver={(e) => (e.currentTarget.style.background = '#1d4ed8')}
                            onMouseOut={(e) => (e.currentTarget.style.background = '#2563eb')}
                        >
                            Importera bankfil
                        </button>
                    )}
                </div>
            ) : (
                <div className="panel-stagger" style={{
                    display: 'grid',
                    gap: '0.75rem'
                }}>
                    {monthStatuses.map(month => (
                        <div
                            key={month.period}
                            className="panel-card panel-card--interactive"
                            style={{
                                border: `1px solid ${month.reconciled ? 'rgba(16, 185, 129, 0.3)' : 'var(--surface-border)'}`,
                                background: month.reconciled ? 'rgba(16, 185, 129, 0.05)' : undefined,
                                display: 'flex',
                                alignItems: 'center',
                                gap: '1rem',
                                flexWrap: 'wrap'
                            }}
                        >
                            {/* Status indicator */}
                            <div style={{
                                width: '12px',
                                height: '12px',
                                borderRadius: '50%',
                                background: month.reconciled ? '#10b981' : '#f59e0b',
                                flexShrink: 0
                            }} />

                            {/* Period info */}
                            <div style={{ flex: 1, minWidth: '150px' }}>
                                <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{month.label}</div>
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
                                    {month.totalTransactions} transaktioner
                                </div>
                            </div>

                            {/* Amounts */}
                            <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                                <div>
                                    <div className="panel-label">Inbetalningar</div>
                                    <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#10b981' }}>
                                        +{formatAmount(month.inflow)}
                                    </div>
                                </div>
                                <div>
                                    <div className="panel-label">Utbetalningar</div>
                                    <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#ef4444' }}>
                                        -{formatAmount(month.outflow)}
                                    </div>
                                </div>
                                <div>
                                    <div className="panel-label">Netto</div>
                                    <div style={{
                                        fontSize: '0.85rem',
                                        fontWeight: 600,
                                        color: month.totalAmount >= 0 ? '#10b981' : '#ef4444'
                                    }}>
                                        {formatAmount(month.totalAmount)}
                                    </div>
                                </div>
                            </div>

                            {/* Action */}
                            <button
                                type="button"
                                onClick={() => toggleReconciled(month.period)}
                                data-testid={`reconciliation-toggle-${month.period}`}
                                data-period={month.period}
                                style={{
                                    height: '34px',
                                    padding: '0 0.9rem',
                                    borderRadius: '10px',
                                    border: month.reconciled ? 'none' : '1px solid var(--surface-border)',
                                    background: month.reconciled ? '#10b981' : 'var(--surface-2)',
                                    color: month.reconciled ? '#fff' : 'var(--text-primary)',
                                    fontSize: '0.78rem',
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                    whiteSpace: 'nowrap',
                                    boxShadow: 'none'
                                }}
                                onMouseOver={(e) => {
                                    setReconcileButtonBackground(e.currentTarget, month.reconciled, true);
                                }}
                                onMouseOut={(e) => {
                                    setReconcileButtonBackground(e.currentTarget, month.reconciled, false);
                                }}
                            >
                                {month.reconciled ? 'Avstämd' : 'Markera som avstämd'}
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* Help text */}
            <div className="panel-card panel-card--no-hover" style={{
                fontSize: '0.8rem',
                color: 'var(--text-secondary)',
                lineHeight: 1.5
            }}>
                <strong style={{ color: 'var(--text-primary)' }}>Avstämning</strong>
                <br />
                Bankavstämning innebär att du kontrollerar att alla transaktioner på kontoutdraget
                stämmer överens med bokföringen. När du är nöjd, markera perioden som avstämd.
                Gröna perioder är klara, gula behöver granskas.
            </div>
        </div>
    );
}

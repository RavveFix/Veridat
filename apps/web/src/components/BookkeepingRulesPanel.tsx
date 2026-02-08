/**
 * BookkeepingRulesPanel - Manage automatic bookkeeping rules (expense patterns).
 *
 * Shows learned patterns from the expense_patterns table and lets users
 * view, edit, and delete rules. Each rule maps a supplier/description
 * to a BAS account and VAT rate.
 */

import { useEffect, useMemo, useState } from 'preact/hooks';
import { supabase } from '../lib/supabase';
import { companyService } from '../services/CompanyService';

interface ExpensePatternRow {
    id: string;
    supplier_name: string;
    bas_account: string;
    bas_account_name: string;
    vat_rate: number;
    expense_type: 'cost' | 'sale';
    category: string | null;
    usage_count: number;
    avg_amount: number;
    confirmation_count: number;
    rejection_count: number;
    last_used_at: string;
    description_keywords: string[];
}

interface BookkeepingRulesPanelProps {
    onBack: () => void;
}

function formatAmount(value: number): string {
    return value.toLocaleString('sv-SE', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatDate(value?: string): string {
    if (!value) return '-';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleDateString('sv-SE');
}

function vatLabel(rate: number): string {
    if (rate === 0) return '0%';
    return `${rate}%`;
}

export function BookkeepingRulesPanel({ onBack }: BookkeepingRulesPanelProps) {
    const [patterns, setPatterns] = useState<ExpensePatternRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [filter, setFilter] = useState<'all' | 'cost' | 'sale'>('all');
    const [search, setSearch] = useState('');

    const loadPatterns = async () => {
        setLoading(true);
        setError(null);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                setError('Du måste vara inloggad.');
                return;
            }

            const companyId = companyService.getCurrentId();
            // expense_patterns table isn't in the generated Supabase types yet
            const { data, error: queryError } = await (supabase as any)
                .from('expense_patterns')
                .select('id, supplier_name, bas_account, bas_account_name, vat_rate, expense_type, category, usage_count, avg_amount, confirmation_count, rejection_count, last_used_at, description_keywords')
                .eq('user_id', user.id)
                .eq('company_id', companyId)
                .order('last_used_at', { ascending: false })
                .limit(200);

            if (queryError) {
                setError('Kunde inte hämta bokföringsregler.');
                console.error('Load patterns error:', queryError);
                return;
            }

            setPatterns((data || []) as ExpensePatternRow[]);
        } catch (err) {
            console.error('Load patterns failed:', err);
            setError('Ett fel uppstod vid hämtning av regler.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadPatterns();
    }, []);

    const handleDelete = async (id: string, supplierName: string) => {
        if (!window.confirm(`Ta bort regel för "${supplierName}"?`)) return;

        setDeletingId(id);
        try {
            const { error: delError } = await (supabase as any)
                .from('expense_patterns')
                .delete()
                .eq('id', id);

            if (delError) {
                setError('Kunde inte ta bort regeln.');
                return;
            }

            setPatterns(prev => prev.filter(p => p.id !== id));
        } catch (err) {
            console.error('Delete pattern failed:', err);
            setError('Ett fel uppstod vid borttagning.');
        } finally {
            setDeletingId(null);
        }
    };

    const filtered = useMemo(() => {
        let result = patterns;
        if (filter !== 'all') {
            result = result.filter(p => p.expense_type === filter);
        }
        if (search.trim()) {
            const q = search.toLowerCase();
            result = result.filter(p =>
                p.supplier_name.toLowerCase().includes(q) ||
                p.bas_account.includes(q) ||
                p.bas_account_name.toLowerCase().includes(q)
            );
        }
        return result;
    }, [patterns, filter, search]);

    const summary = useMemo(() => ({
        total: patterns.length,
        costs: patterns.filter(p => p.expense_type === 'cost').length,
        sales: patterns.filter(p => p.expense_type === 'sale').length,
        trusted: patterns.filter(p => p.confirmation_count >= 4).length
    }), [patterns]);

    return (
        <div className="panel-stagger" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
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
                    Automatiska bokföringsregler baserade på tidigare konteringar.
                </span>
            </div>

            {/* Summary cards */}
            <div className="panel-stagger" style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                gap: '0.75rem'
            }}>
                {[
                    { label: 'Totalt regler', value: summary.total },
                    { label: 'Kostnader', value: summary.costs },
                    { label: 'Intäkter', value: summary.sales },
                    { label: 'Betrodda', value: summary.trusted }
                ].map(card => (
                    <div key={card.label} className="panel-card panel-card--no-hover">
                        <div className="panel-label">{card.label}</div>
                        <div className="panel-stat panel-stat--neutral">{card.value}</div>
                    </div>
                ))}
            </div>

            {/* Filters */}
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    {([
                        { id: 'all' as const, label: 'Alla' },
                        { id: 'cost' as const, label: 'Kostnader' },
                        { id: 'sale' as const, label: 'Intäkter' }
                    ]).map(opt => (
                        <button
                            key={opt.id}
                            type="button"
                            onClick={() => setFilter(opt.id)}
                            style={{
                                height: '34px',
                                padding: '0 0.8rem',
                                borderRadius: '10px',
                                border: '1px solid var(--glass-border)',
                                background: filter === opt.id ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                                color: filter === opt.id ? '#3b82f6' : 'var(--text-secondary)',
                                fontSize: '0.78rem',
                                fontWeight: 600,
                                cursor: 'pointer'
                            }}
                        >
                            {opt.label}
                        </button>
                    ))}
                </div>
                <input
                    type="text"
                    placeholder="Sök leverantör eller konto..."
                    value={search}
                    onInput={(e) => setSearch(e.currentTarget.value)}
                    style={{
                        flex: 1,
                        minWidth: '180px',
                        height: '34px',
                        padding: '0 0.75rem',
                        borderRadius: '10px',
                        border: '1px solid var(--glass-border)',
                        background: 'rgba(255, 255, 255, 0.04)',
                        color: 'var(--text-primary)',
                        fontSize: '0.8rem',
                        outline: 'none'
                    }}
                />
            </div>

            {error && (
                <div style={{
                    padding: '0.6rem 0.8rem',
                    borderRadius: '8px',
                    background: 'rgba(239, 68, 68, 0.12)',
                    color: '#ef4444',
                    fontSize: '0.8rem'
                }}>
                    {error}
                </div>
            )}

            {/* Rules table */}
            <div className="panel-card panel-card--no-hover" style={{ overflowX: 'auto' }}>
                {loading ? (
                    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                        Hämtar regler...
                    </div>
                ) : filtered.length === 0 ? (
                    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                        {patterns.length === 0
                            ? 'Inga bokföringsregler har skapats än. Regler läggs till automatiskt när du konterar transaktioner.'
                            : 'Inga regler matchar filtret.'}
                    </div>
                ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                        <thead>
                            <tr>
                                <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem', color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>Leverantör</th>
                                <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem', color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>Konto</th>
                                <th style={{ textAlign: 'right', padding: '0.4rem 0.5rem', color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>Moms</th>
                                <th style={{ textAlign: 'right', padding: '0.4rem 0.5rem', color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>Snitt</th>
                                <th style={{ textAlign: 'right', padding: '0.4rem 0.5rem', color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>Användningar</th>
                                <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem', color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>Status</th>
                                <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem', color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>Senast</th>
                                <th style={{ textAlign: 'right', padding: '0.4rem 0.5rem', color: 'var(--text-secondary)', fontWeight: 600 }}></th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map(pattern => {
                                const isDeleting = deletingId === pattern.id;
                                const isAutoApply = pattern.confirmation_count >= 6;
                                const isTrusted = pattern.confirmation_count >= 4;

                                return (
                                    <tr key={pattern.id} style={{ borderTop: '1px solid rgba(255, 255, 255, 0.05)' }}>
                                        <td style={{ padding: '0.5rem', color: 'var(--text-primary)' }}>
                                            <div style={{ fontWeight: 600 }}>{pattern.supplier_name}</div>
                                            {pattern.description_keywords.length > 0 && (
                                                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
                                                    {pattern.description_keywords.slice(0, 3).join(', ')}
                                                </div>
                                            )}
                                        </td>
                                        <td style={{ padding: '0.5rem', whiteSpace: 'nowrap' }}>
                                            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{pattern.bas_account}</span>
                                            <span style={{ color: 'var(--text-secondary)', marginLeft: '0.4rem' }}>{pattern.bas_account_name}</span>
                                        </td>
                                        <td style={{ padding: '0.5rem', textAlign: 'right', color: 'var(--text-primary)' }}>{vatLabel(pattern.vat_rate)}</td>
                                        <td style={{ padding: '0.5rem', textAlign: 'right', whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>
                                            {formatAmount(pattern.avg_amount)} kr
                                        </td>
                                        <td style={{ padding: '0.5rem', textAlign: 'right', color: 'var(--text-primary)' }}>
                                            {pattern.usage_count}
                                        </td>
                                        <td style={{ padding: '0.5rem' }}>
                                            <span style={{
                                                padding: '0.15rem 0.5rem',
                                                borderRadius: '999px',
                                                fontSize: '0.7rem',
                                                fontWeight: 600,
                                                background: isAutoApply
                                                    ? 'rgba(16, 185, 129, 0.15)'
                                                    : isTrusted
                                                        ? 'rgba(59, 130, 246, 0.15)'
                                                        : 'rgba(255, 255, 255, 0.08)',
                                                color: isAutoApply
                                                    ? '#10b981'
                                                    : isTrusted
                                                        ? '#3b82f6'
                                                        : 'var(--text-secondary)'
                                            }}>
                                                {isAutoApply ? 'Auto' : isTrusted ? 'Betrodd' : 'Ny'}
                                            </span>
                                        </td>
                                        <td style={{ padding: '0.5rem', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>
                                            {formatDate(pattern.last_used_at)}
                                        </td>
                                        <td style={{ padding: '0.5rem', textAlign: 'right' }}>
                                            <button
                                                type="button"
                                                onClick={() => void handleDelete(pattern.id, pattern.supplier_name)}
                                                disabled={isDeleting}
                                                style={{
                                                    height: '28px',
                                                    padding: '0 0.6rem',
                                                    borderRadius: '8px',
                                                    border: '1px solid var(--glass-border)',
                                                    background: 'transparent',
                                                    color: '#ef4444',
                                                    fontSize: '0.72rem',
                                                    cursor: isDeleting ? 'wait' : 'pointer'
                                                }}
                                            >
                                                {isDeleting ? '...' : 'Ta bort'}
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>

            {/* Help text */}
            <div className="panel-card panel-card--no-hover" style={{
                fontSize: '0.8rem',
                color: 'var(--text-secondary)',
                lineHeight: 1.5
            }}>
                <strong style={{ color: 'var(--text-primary)' }}>Hur fungerar regler?</strong>
                <br />
                När du konterar en transaktion läggs leverantören och kontot till automatiskt.
                Efter 2 bekräftelser visas förslaget automatiskt. Efter 6 bekräftelser
                appliceras regeln automatiskt på nya transaktioner från samma leverantör.
                <br />
                <strong>Ny</strong> = under 4 bekräftelser &bull;
                <strong> Betrodd</strong> = 4+ bekräftelser &bull;
                <strong> Auto</strong> = 6+ bekräftelser (appliceras automatiskt)
            </div>
        </div>
    );
}

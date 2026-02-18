/**
 * BookkeepingRulesPanel - Manage automatic bookkeeping rules (expense patterns).
 *
 * Shows learned patterns from the expense_patterns table and lets users
 * view, edit, and delete rules. Each rule maps a supplier/description
 * to a BAS account and VAT rate.
 */

import { useEffect, useMemo, useState } from 'preact/hooks';
import { supabase } from '../lib/supabase';
import { logger } from '../services/LoggerService';
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

const BOOKKEEPING_PANEL_ROOT_STYLE = {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem'
} as const;

const BOOKKEEPING_HEADER_STYLE = {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem'
} as const;

const BOOKKEEPING_BACK_BUTTON_STYLE = {
    background: 'transparent',
    border: '1px solid var(--glass-border)',
    borderRadius: '8px',
    color: 'var(--text-secondary)',
    padding: '0.4rem 0.75rem',
    fontSize: '0.8rem',
    cursor: 'pointer'
} as const;

const BOOKKEEPING_HEADER_HINT_STYLE = {
    fontSize: '0.85rem',
    color: 'var(--text-secondary)'
} as const;

const BOOKKEEPING_SUMMARY_GRID_STYLE = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: '0.75rem'
} as const;

const BOOKKEEPING_FILTER_ROW_STYLE = {
    display: 'flex',
    gap: '0.75rem',
    flexWrap: 'wrap',
    alignItems: 'center'
} as const;

const BOOKKEEPING_FILTER_BUTTON_GROUP_STYLE = {
    display: 'flex',
    gap: '0.5rem'
} as const;

const BOOKKEEPING_FILTER_BUTTON_BASE_STYLE = {
    height: '34px',
    padding: '0 0.8rem',
    borderRadius: '10px',
    border: '1px solid var(--glass-border)',
    fontSize: '0.78rem',
    fontWeight: 600,
    cursor: 'pointer'
} as const;

const BOOKKEEPING_SEARCH_INPUT_STYLE = {
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
} as const;

const BOOKKEEPING_ERROR_BOX_STYLE = {
    padding: '0.6rem 0.8rem',
    borderRadius: '8px',
    background: 'rgba(239, 68, 68, 0.12)',
    color: '#ef4444',
    fontSize: '0.8rem'
} as const;

const BOOKKEEPING_TABLE_WRAP_STYLE = { overflowX: 'auto' } as const;

const BOOKKEEPING_TABLE_STATE_STYLE = {
    padding: '2rem',
    textAlign: 'center',
    color: 'var(--text-secondary)',
    fontSize: '0.85rem'
} as const;

const BOOKKEEPING_TABLE_STYLE = {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '0.8rem'
} as const;

const BOOKKEEPING_TABLE_HEADER_BASE_STYLE = {
    padding: '0.4rem 0.5rem',
    color: 'var(--text-secondary)',
    fontWeight: 600,
    whiteSpace: 'nowrap'
} as const;

const BOOKKEEPING_TABLE_ROW_STYLE = {
    borderTop: '1px solid rgba(255, 255, 255, 0.05)'
} as const;

const BOOKKEEPING_CELL_BASE_STYLE = { padding: '0.5rem' } as const;
const BOOKKEEPING_CELL_PRIMARY_STYLE = { ...BOOKKEEPING_CELL_BASE_STYLE, color: 'var(--text-primary)' } as const;
const BOOKKEEPING_CELL_RIGHT_PRIMARY_STYLE = { ...BOOKKEEPING_CELL_PRIMARY_STYLE, textAlign: 'right' } as const;
const BOOKKEEPING_CELL_RIGHT_NOWRAP_PRIMARY_STYLE = { ...BOOKKEEPING_CELL_RIGHT_PRIMARY_STYLE, whiteSpace: 'nowrap' } as const;
const BOOKKEEPING_CELL_NOWRAP_STYLE = { ...BOOKKEEPING_CELL_BASE_STYLE, whiteSpace: 'nowrap' } as const;
const BOOKKEEPING_CELL_LAST_USED_STYLE = { ...BOOKKEEPING_CELL_BASE_STYLE, whiteSpace: 'nowrap', color: 'var(--text-secondary)' } as const;
const BOOKKEEPING_CELL_ACTION_STYLE = { ...BOOKKEEPING_CELL_BASE_STYLE, textAlign: 'right' } as const;

const BOOKKEEPING_SUPPLIER_NAME_STYLE = { fontWeight: 600 } as const;
const BOOKKEEPING_KEYWORDS_STYLE = { fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '0.15rem' } as const;
const BOOKKEEPING_ACCOUNT_CODE_STYLE = { fontWeight: 600, color: 'var(--text-primary)' } as const;
const BOOKKEEPING_ACCOUNT_NAME_STYLE = { color: 'var(--text-secondary)', marginLeft: '0.4rem' } as const;

const BOOKKEEPING_STATUS_PILL_BASE_STYLE = {
    padding: '0.15rem 0.5rem',
    borderRadius: '999px',
    fontSize: '0.7rem',
    fontWeight: 600
} as const;

const BOOKKEEPING_DELETE_BUTTON_BASE_STYLE = {
    height: '28px',
    padding: '0 0.6rem',
    borderRadius: '8px',
    border: '1px solid var(--glass-border)',
    background: 'transparent',
    color: '#ef4444',
    fontSize: '0.72rem'
} as const;

const BOOKKEEPING_HELP_CARD_STYLE = {
    fontSize: '0.8rem',
    color: 'var(--text-secondary)',
    lineHeight: 1.5
} as const;

const BOOKKEEPING_HELP_TITLE_STYLE = { color: 'var(--text-primary)' } as const;

function getFilterButtonStyle(active: boolean) {
    return {
        ...BOOKKEEPING_FILTER_BUTTON_BASE_STYLE,
        background: active ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
        color: active ? '#3b82f6' : 'var(--text-secondary)'
    } as const;
}

function getTableHeaderCellStyle(align: 'left' | 'right') {
    return {
        ...BOOKKEEPING_TABLE_HEADER_BASE_STYLE,
        textAlign: align
    } as const;
}

function getRuleStatusStyle(isAutoApply: boolean, isTrusted: boolean) {
    return {
        ...BOOKKEEPING_STATUS_PILL_BASE_STYLE,
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
    } as const;
}

function getDeleteButtonStyle(isDeleting: boolean) {
    return {
        ...BOOKKEEPING_DELETE_BUTTON_BASE_STYLE,
        cursor: isDeleting ? 'wait' : 'pointer'
    } as const;
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
                logger.error('Load patterns error:', queryError);
                return;
            }

            setPatterns((data || []) as ExpensePatternRow[]);
        } catch (err) {
            logger.error('Load patterns failed:', err);
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
            logger.error('Delete pattern failed:', err);
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
        <div
            className="panel-stagger"
            data-testid="bookkeeping-rules-panel"
            style={BOOKKEEPING_PANEL_ROOT_STYLE}
        >
            <div style={BOOKKEEPING_HEADER_STYLE}>
                <button
                    type="button"
                    onClick={onBack}
                    style={BOOKKEEPING_BACK_BUTTON_STYLE}
                >
                    Tillbaka
                </button>
                <span style={BOOKKEEPING_HEADER_HINT_STYLE}>
                    Automatiska bokföringsregler baserade på tidigare konteringar.
                </span>
            </div>

            {/* Summary cards */}
            <div className="panel-stagger" style={BOOKKEEPING_SUMMARY_GRID_STYLE}>
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
            <div style={BOOKKEEPING_FILTER_ROW_STYLE}>
                <div style={BOOKKEEPING_FILTER_BUTTON_GROUP_STYLE}>
                    {([
                        { id: 'all' as const, label: 'Alla' },
                        { id: 'cost' as const, label: 'Kostnader' },
                        { id: 'sale' as const, label: 'Intäkter' }
                    ]).map(opt => (
                        <button
                            key={opt.id}
                            type="button"
                            onClick={() => setFilter(opt.id)}
                            data-testid={`bookkeeping-rules-filter-${opt.id}`}
                            style={getFilterButtonStyle(filter === opt.id)}
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
                    data-testid="bookkeeping-rules-search"
                    style={BOOKKEEPING_SEARCH_INPUT_STYLE}
                />
            </div>

            {error && (
                <div style={BOOKKEEPING_ERROR_BOX_STYLE}>
                    {error}
                </div>
            )}

            {/* Rules table */}
            <div className="panel-card panel-card--no-hover" style={BOOKKEEPING_TABLE_WRAP_STYLE}>
                {loading ? (
                    <div style={BOOKKEEPING_TABLE_STATE_STYLE}>
                        Hämtar regler...
                    </div>
                ) : filtered.length === 0 ? (
                    <div style={BOOKKEEPING_TABLE_STATE_STYLE}>
                        {patterns.length === 0
                            ? 'Inga bokföringsregler har skapats än. Regler läggs till automatiskt när du konterar transaktioner.'
                            : 'Inga regler matchar filtret.'}
                    </div>
                ) : (
                    <table style={BOOKKEEPING_TABLE_STYLE}>
                        <thead>
                            <tr>
                                <th style={getTableHeaderCellStyle('left')}>Leverantör</th>
                                <th style={getTableHeaderCellStyle('left')}>Konto</th>
                                <th style={getTableHeaderCellStyle('right')}>Moms</th>
                                <th style={getTableHeaderCellStyle('right')}>Snitt</th>
                                <th style={getTableHeaderCellStyle('right')}>Användningar</th>
                                <th style={getTableHeaderCellStyle('left')}>Status</th>
                                <th style={getTableHeaderCellStyle('left')}>Senast</th>
                                <th style={getTableHeaderCellStyle('right')}></th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map(pattern => {
                                const isDeleting = deletingId === pattern.id;
                                const isAutoApply = pattern.confirmation_count >= 6;
                                const isTrusted = pattern.confirmation_count >= 4;

                                return (
                                    <tr
                                        key={pattern.id}
                                        data-testid={`bookkeeping-rules-row-${pattern.id}`}
                                        style={BOOKKEEPING_TABLE_ROW_STYLE}
                                    >
                                        <td style={BOOKKEEPING_CELL_PRIMARY_STYLE}>
                                            <div style={BOOKKEEPING_SUPPLIER_NAME_STYLE}>{pattern.supplier_name}</div>
                                            {pattern.description_keywords.length > 0 && (
                                                <div style={BOOKKEEPING_KEYWORDS_STYLE}>
                                                    {pattern.description_keywords.slice(0, 3).join(', ')}
                                                </div>
                                            )}
                                        </td>
                                        <td style={BOOKKEEPING_CELL_NOWRAP_STYLE}>
                                            <span style={BOOKKEEPING_ACCOUNT_CODE_STYLE}>{pattern.bas_account}</span>
                                            <span style={BOOKKEEPING_ACCOUNT_NAME_STYLE}>{pattern.bas_account_name}</span>
                                        </td>
                                        <td style={BOOKKEEPING_CELL_RIGHT_PRIMARY_STYLE}>{vatLabel(pattern.vat_rate)}</td>
                                        <td style={BOOKKEEPING_CELL_RIGHT_NOWRAP_PRIMARY_STYLE}>
                                            {formatAmount(pattern.avg_amount)} kr
                                        </td>
                                        <td style={BOOKKEEPING_CELL_RIGHT_PRIMARY_STYLE}>
                                            {pattern.usage_count}
                                        </td>
                                        <td style={BOOKKEEPING_CELL_BASE_STYLE}>
                                            <span style={getRuleStatusStyle(isAutoApply, isTrusted)}>
                                                {isAutoApply ? 'Auto' : isTrusted ? 'Betrodd' : 'Ny'}
                                            </span>
                                        </td>
                                        <td style={BOOKKEEPING_CELL_LAST_USED_STYLE}>
                                            {formatDate(pattern.last_used_at)}
                                        </td>
                                        <td style={BOOKKEEPING_CELL_ACTION_STYLE}>
                                            <button
                                                type="button"
                                                onClick={() => void handleDelete(pattern.id, pattern.supplier_name)}
                                                disabled={isDeleting}
                                                data-testid={`bookkeeping-rules-delete-${pattern.id}`}
                                                style={getDeleteButtonStyle(isDeleting)}
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
            <div className="panel-card panel-card--no-hover" style={BOOKKEEPING_HELP_CARD_STYLE}>
                <strong style={BOOKKEEPING_HELP_TITLE_STYLE}>Hur fungerar regler?</strong>
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

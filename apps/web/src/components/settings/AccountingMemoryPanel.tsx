import { useEffect, useMemo, useState } from 'preact/hooks';
import { supabase } from '../../lib/supabase';
import { companyManager } from '../../services/CompanyService';
import { logger } from '../../services/LoggerService';

type PlanType = 'free' | 'pro' | 'trial';

type AccountingMemoryRow = {
    id: string;
    entity_type: string;
    entity_key?: string | null;
    label?: string | null;
    payload?: Record<string, unknown> | null;
    source_type: string;
    source_reliability?: number | null;
    review_status?: string | null;
    fiscal_year?: string | null;
    period_start?: string | null;
    period_end?: string | null;
    valid_from?: string | null;
    valid_to?: string | null;
    last_used_at?: string | null;
    updated_at?: string | null;
    created_at?: string | null;
};

interface AccountingMemoryPanelProps {
    userId: string;
    plan: PlanType;
}

const STATUS_LABELS: Record<string, string> = {
    auto: 'Auto',
    confirmed: 'Godkänd',
    needs_review: 'Pausad',
    rejected: 'Avvisad'
};

const SOURCE_LABELS: Record<string, string> = {
    ledger: 'Bokföring',
    annual_report: 'Årsredovisning',
    sie: 'SIE',
    fortnox: 'Fortnox',
    bank: 'Bank',
    user: 'Användare',
    system: 'System',
    other: 'Övrigt'
};

const TYPE_LABELS: Record<string, string> = {
    company_profile: 'Bolagsprofil',
    account_policy: 'Kontoplan & policy',
    supplier_profile: 'Leverantörer',
    tax_profile: 'Skatt & moms',
    period_summary: 'Period',
    annual_report: 'Årsredovisning',
    journal_summary: 'Bokföring',
    rule: 'Regel',
    other: 'Övrigt'
};

const STATUS_FILTERS = ['all', 'auto', 'confirmed', 'needs_review', 'rejected'] as const;
const SOURCE_FILTERS = ['all', 'ledger', 'annual_report', 'sie', 'fortnox', 'bank', 'user', 'system', 'other'] as const;

const formatDateTime = (value?: string | null): string => {
    if (!value) return '—';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '—';
    return parsed.toLocaleString('sv-SE', { dateStyle: 'medium', timeStyle: 'short' });
};

const formatPeriod = (memory: AccountingMemoryRow): string => {
    if (memory.fiscal_year) return memory.fiscal_year;
    if (memory.period_start && memory.period_end) {
        return `${memory.period_start} – ${memory.period_end}`;
    }
    return '—';
};

const getMemoryText = (memory: AccountingMemoryRow): string => {
    if (memory.label && memory.label.trim()) return memory.label.trim();
    const summary = typeof memory.payload?.summary === 'string' ? memory.payload?.summary?.trim() : '';
    if (summary) return summary;
    if (memory.payload && Object.keys(memory.payload).length > 0) {
        return JSON.stringify(memory.payload);
    }
    return 'Saknar beskrivning';
};

export function AccountingMemoryPanel({ userId, plan }: AccountingMemoryPanelProps) {
    const [memories, setMemories] = useState<AccountingMemoryRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [statusFilter, setStatusFilter] = useState<typeof STATUS_FILTERS[number]>('all');
    const [sourceFilter, setSourceFilter] = useState<typeof SOURCE_FILTERS[number]>('all');
    const [companyId, setCompanyId] = useState(companyManager.getCurrentId());

    const isPro = plan === 'pro' || plan === 'trial';

    useEffect(() => {
        const handleCompanyChange = (event: Event) => {
            const detail = (event as CustomEvent<{ companyId: string }>).detail;
            if (detail?.companyId) {
                setCompanyId(detail.companyId);
            }
        };

        window.addEventListener('company-changed', handleCompanyChange);
        return () => window.removeEventListener('company-changed', handleCompanyChange);
    }, []);

    useEffect(() => {
        if (!isPro || !userId || !companyId) {
            setMemories([]);
            return;
        }

        void loadMemories();
    }, [userId, companyId, isPro, statusFilter, sourceFilter]);

    const filteredMemories = useMemo(() => {
        return memories.filter((memory) => {
            if (statusFilter !== 'all' && memory.review_status !== statusFilter) return false;
            if (sourceFilter !== 'all' && memory.source_type !== sourceFilter) return false;
            return true;
        });
    }, [memories, statusFilter, sourceFilter]);

    async function loadMemories() {
        setLoading(true);
        setError(null);
        try {
            const query = supabase
                .from('accounting_memories')
                .select('id, entity_type, entity_key, label, payload, source_type, source_reliability, review_status, fiscal_year, period_start, period_end, valid_from, valid_to, last_used_at, updated_at, created_at')
                .eq('user_id', userId)
                .eq('company_id', companyId)
                .order('updated_at', { ascending: false })
                .limit(200);

            const { data, error: fetchError } = await query;
            if (fetchError) throw fetchError;

            setMemories((data || []) as AccountingMemoryRow[]);
        } catch (loadError) {
            logger.warn('Failed to load accounting memories', loadError);
            setError('Kunde inte ladda redovisningsminnet.');
        } finally {
            setLoading(false);
        }
    }

    async function updateStatus(memoryId: string, status: 'confirmed' | 'needs_review') {
        if (!memoryId) return;
        try {
            setLoading(true);
            const { error: updateError } = await supabase
                .from('accounting_memories')
                .update({ review_status: status })
                .eq('id', memoryId)
                .eq('user_id', userId)
                .eq('company_id', companyId);

            if (updateError) throw updateError;
            await loadMemories();
        } catch (updateError) {
            logger.warn('Failed to update accounting memory status', updateError);
            setError('Kunde inte uppdatera status.');
        } finally {
            setLoading(false);
        }
    }

    async function deleteMemory(memoryId: string) {
        if (!memoryId) return;
        if (!confirm('Är du säker på att du vill radera minnet?')) return;
        try {
            setLoading(true);
            const { error: deleteError } = await supabase
                .from('accounting_memories')
                .delete()
                .eq('id', memoryId)
                .eq('user_id', userId)
                .eq('company_id', companyId);

            if (deleteError) throw deleteError;
            await loadMemories();
        } catch (deleteError) {
            logger.warn('Failed to delete accounting memory', deleteError);
            setError('Kunde inte radera minnet.');
        } finally {
            setLoading(false);
        }
    }

    if (!isPro) {
        return null;
    }

    return (
        <section style={{ marginBottom: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                <div>
                    <h3 style={{ fontSize: '1.1rem', marginBottom: '0.35rem', color: 'var(--text-primary)' }}>
                        Redovisningsminne
                    </h3>
                    <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                        Strukturerade minnen per bolag och period. Godkänn eller pausa minnen som används av AI.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => void loadMemories()}
                    disabled={loading}
                    style={{
                        borderRadius: '12px',
                        padding: '0.5rem 1.1rem',
                        border: '1px solid var(--surface-border)',
                        background: 'var(--surface-2)',
                        color: 'var(--text-primary)',
                        cursor: loading ? 'not-allowed' : 'pointer',
                        boxShadow: 'none',
                        fontSize: '0.85rem',
                        fontWeight: '600',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.4rem'
                    }}
                    onMouseOver={(e) => {
                        if (!loading) {
                            e.currentTarget.style.background = 'var(--surface-3)';
                        }
                    }}
                    onMouseOut={(e) => {
                        e.currentTarget.style.background = 'var(--surface-2)';
                    }}
                >
                    {loading ? 'Laddar...' : 'Uppdatera'}
                </button>
            </div>

            <div style={{
                display: 'flex',
                gap: '0.6rem',
                marginBottom: '1rem',
                flexWrap: 'wrap'
            }}>
                <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
                        Status
                    </label>
                    <select
                        value={statusFilter}
                        onChange={(event) => setStatusFilter((event.target as HTMLSelectElement).value as typeof statusFilter)}
                        style={{
                            padding: '0.5rem 0.75rem',
                            borderRadius: '8px',
                            border: '1px solid var(--surface-border)',
                            background: 'var(--input-bg)',
                            color: 'var(--text-primary)'
                        }}
                    >
                        {STATUS_FILTERS.map((status) => (
                            <option value={status} key={status}>
                                {status === 'all' ? 'Alla' : STATUS_LABELS[status]}
                            </option>
                        ))}
                    </select>
                </div>
                <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
                        Källa
                    </label>
                    <select
                        value={sourceFilter}
                        onChange={(event) => setSourceFilter((event.target as HTMLSelectElement).value as typeof sourceFilter)}
                        style={{
                            padding: '0.5rem 0.75rem',
                            borderRadius: '8px',
                            border: '1px solid var(--surface-border)',
                            background: 'var(--input-bg)',
                            color: 'var(--text-primary)'
                        }}
                    >
                        {SOURCE_FILTERS.map((source) => (
                            <option value={source} key={source}>
                                {source === 'all' ? 'Alla' : SOURCE_LABELS[source]}
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            {error && (
                <div style={{
                    padding: '0.8rem',
                    borderRadius: '8px',
                    marginBottom: '1rem',
                    background: 'var(--status-danger-bg)',
                    color: 'var(--status-danger)',
                    border: '1px solid var(--status-danger-border)'
                }}>
                    {error}
                </div>
            )}

            <div style={{
                borderRadius: '12px',
                border: '1px solid var(--surface-border)',
                background: 'var(--surface-1)',
                boxShadow: 'var(--surface-shadow)',
                padding: '1rem'
            }}>
                {loading && memories.length === 0 && (
                    <div style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>Laddar...</div>
                )}

                {!loading && filteredMemories.length === 0 && (
                    <div style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>Inga minnen hittades för filtret.</div>
                )}

                {filteredMemories.map((memory) => {
                    const reliability = Math.round((memory.source_reliability ?? 0) * 100);
                    const statusLabel = STATUS_LABELS[memory.review_status || 'auto'] || 'Auto';
                    const sourceLabel = SOURCE_LABELS[memory.source_type] || memory.source_type;
                    const typeLabel = TYPE_LABELS[memory.entity_type] || memory.entity_type;

                    return (
                        <div
                            key={memory.id}
                            style={{
                                padding: '0.9rem',
                                borderRadius: '10px',
                                border: '1px solid var(--surface-border)',
                                background: 'var(--surface-2)',
                                marginBottom: '0.75rem'
                            }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                                <div style={{ flex: 1 }}>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.35rem' }}>
                                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{typeLabel}</span>
                                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>• {sourceLabel}</span>
                                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>• {statusLabel}</span>
                                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>• Tillförlitlighet {reliability}%</span>
                                    </div>
                                    <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
                                        {getMemoryText(memory)}
                                    </div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                        Period: {formatPeriod(memory)} • Senast använd: {formatDateTime(memory.last_used_at)}
                                    </div>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                    {memory.review_status !== 'confirmed' ? (
                                        <button
                                            type="button"
                                            onClick={() => void updateStatus(memory.id, 'confirmed')}
                                            disabled={loading}
                                            style={{
                                                borderRadius: '10px',
                                                padding: '0.45rem 0.85rem',
                                                border: 'none',
                                                background: '#10b981',
                                                color: '#fff',
                                                cursor: 'pointer',
                                                fontSize: '0.85rem',
                                                fontWeight: '600',
                                                boxShadow: 'none'
                                            }}
                                            onMouseOver={(e) => {
                                                e.currentTarget.style.background = '#059669';
                                            }}
                                            onMouseOut={(e) => {
                                                e.currentTarget.style.background = '#10b981';
                                            }}
                                        >
                                            Godkänn
                                        </button>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() => void updateStatus(memory.id, 'needs_review')}
                                            disabled={loading}
                                            style={{
                                                borderRadius: '10px',
                                                padding: '0.45rem 0.85rem',
                                                border: 'none',
                                                background: '#f59e0b',
                                                color: '#fff',
                                                cursor: 'pointer',
                                                fontSize: '0.85rem',
                                                fontWeight: '600',
                                                boxShadow: 'none'
                                            }}
                                            onMouseOver={(e) => {
                                                e.currentTarget.style.background = '#d97706';
                                            }}
                                            onMouseOut={(e) => {
                                                e.currentTarget.style.background = '#f59e0b';
                                            }}
                                        >
                                            Pausa
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => void deleteMemory(memory.id)}
                                        disabled={loading}
                                        style={{
                                            borderRadius: '10px',
                                            padding: '0.45rem 0.85rem',
                                            border: 'none',
                                            background: '#ef4444',
                                            color: '#fff',
                                            cursor: 'pointer',
                                            fontSize: '0.85rem',
                                            fontWeight: '600',
                                            boxShadow: 'none'
                                        }}
                                        onMouseOver={(e) => {
                                            e.currentTarget.style.background = '#dc2626';
                                        }}
                                        onMouseOut={(e) => {
                                            e.currentTarget.style.background = '#ef4444';
                                        }}
                                    >
                                        Radera
                                    </button>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </section>
    );
}

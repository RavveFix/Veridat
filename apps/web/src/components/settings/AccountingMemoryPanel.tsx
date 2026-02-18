import { useEffect, useMemo, useState } from 'preact/hooks';
import type { JSX } from 'preact';
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
const ACCOUNTING_MEMORY_SELECT_FIELDS = 'id, entity_type, entity_key, label, payload, source_type, source_reliability, review_status, fiscal_year, period_start, period_end, valid_from, valid_to, last_used_at, updated_at, created_at';
type StatusFilter = typeof STATUS_FILTERS[number];
type SourceFilter = typeof SOURCE_FILTERS[number];

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

const matchesMemoryFilters = (
    memory: AccountingMemoryRow,
    statusFilter: typeof STATUS_FILTERS[number],
    sourceFilter: typeof SOURCE_FILTERS[number]
): boolean => {
    if (statusFilter !== 'all' && memory.review_status !== statusFilter) return false;
    if (sourceFilter !== 'all' && memory.source_type !== sourceFilter) return false;
    return true;
};

type MemoryMutationResult = { error: unknown };

interface MemoryActionButtonProps {
    label: string;
    baseColor: string;
    hoverColor: string;
    onClick: () => void;
    disabled: boolean;
}

interface StatusFilterSelectProps {
    value: StatusFilter;
    onChange: (value: StatusFilter) => void;
}

interface SourceFilterSelectProps {
    value: SourceFilter;
    onChange: (value: SourceFilter) => void;
}

interface MemoryCardProps {
    memory: AccountingMemoryRow;
    loading: boolean;
    onUpdateStatus: (memoryId: string, status: 'confirmed' | 'needs_review') => void;
    onDelete: (memoryId: string) => void;
}

async function fetchAccountingMemories(userId: string, companyId: string): Promise<AccountingMemoryRow[]> {
    const { data, error } = await supabase
        .from('accounting_memories')
        .select(ACCOUNTING_MEMORY_SELECT_FIELDS)
        .eq('user_id', userId)
        .eq('company_id', companyId)
        .order('updated_at', { ascending: false })
        .limit(200);

    if (error) throw error;
    return (data || []) as AccountingMemoryRow[];
}

async function updateAccountingMemoryStatus(
    memoryId: string,
    userId: string,
    companyId: string,
    status: 'confirmed' | 'needs_review'
): Promise<MemoryMutationResult> {
    return supabase
        .from('accounting_memories')
        .update({ review_status: status })
        .eq('id', memoryId)
        .eq('user_id', userId)
        .eq('company_id', companyId);
}

async function removeAccountingMemory(
    memoryId: string,
    userId: string,
    companyId: string
): Promise<MemoryMutationResult> {
    return supabase
        .from('accounting_memories')
        .delete()
        .eq('id', memoryId)
        .eq('user_id', userId)
        .eq('company_id', companyId);
}

const FILTER_SELECT_STYLE = {
    padding: '0.5rem 0.75rem',
    borderRadius: '8px',
    border: '1px solid var(--surface-border)',
    background: 'var(--input-bg)',
    color: 'var(--text-primary)'
};

const REFRESH_BUTTON_STYLE = {
    borderRadius: '12px',
    padding: '0.5rem 1.1rem',
    border: '1px solid var(--surface-border)',
    background: 'var(--surface-2)',
    color: 'var(--text-primary)',
    boxShadow: 'none',
    fontSize: '0.85rem',
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem'
};

const FILTER_LABEL_STYLE = {
    display: 'block',
    fontSize: '0.75rem',
    color: 'var(--text-secondary)',
    marginBottom: '0.35rem'
};

const MEMORY_CARD_STYLE = {
    padding: '0.9rem',
    borderRadius: '10px',
    border: '1px solid var(--surface-border)',
    background: 'var(--surface-2)',
    marginBottom: '0.75rem'
};

const MEMORY_CARD_LAYOUT_STYLE = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '1rem'
};

const MEMORY_CONTENT_STYLE = { flex: 1 };

const MEMORY_META_ROW_STYLE = {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.5rem',
    marginBottom: '0.35rem'
};

const MEMORY_META_TEXT_STYLE = {
    fontSize: '0.75rem',
    color: 'var(--text-secondary)'
};

const MEMORY_TEXT_STYLE = {
    fontWeight: 600,
    color: 'var(--text-primary)',
    marginBottom: '0.25rem'
};

const MEMORY_PERIOD_STYLE = {
    fontSize: '0.8rem',
    color: 'var(--text-secondary)'
};

const MEMORY_ACTIONS_STYLE = {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.4rem'
};

const MEMORY_SECTION_STYLE = { marginBottom: '2rem' };

const MEMORY_SECTION_HEADER_STYLE = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '0.75rem'
};

const MEMORY_SECTION_TITLE_STYLE = {
    fontSize: '1.1rem',
    marginBottom: '0.35rem',
    color: 'var(--text-primary)'
};

const MEMORY_SECTION_DESCRIPTION_STYLE = {
    margin: 0,
    color: 'var(--text-secondary)',
    fontSize: '0.9rem'
};

const MEMORY_FILTERS_ROW_STYLE = {
    display: 'flex',
    gap: '0.6rem',
    marginBottom: '1rem',
    flexWrap: 'wrap'
};

const MEMORY_ERROR_STYLE = {
    padding: '0.8rem',
    borderRadius: '8px',
    marginBottom: '1rem',
    background: 'var(--status-danger-bg)',
    color: 'var(--status-danger)',
    border: '1px solid var(--status-danger-border)'
};

const MEMORY_LIST_WRAP_STYLE = {
    borderRadius: '12px',
    border: '1px solid var(--surface-border)',
    background: 'var(--surface-1)',
    boxShadow: 'var(--surface-shadow)',
    padding: '1rem'
};

const MEMORY_LIST_EMPTY_STYLE = {
    textAlign: 'center',
    color: 'var(--text-secondary)'
};

function buildActionButtonStyle(background: string) {
    return {
        borderRadius: '10px',
        padding: '0.45rem 0.85rem',
        border: 'none',
        background,
        color: '#fff',
        cursor: 'pointer',
        fontSize: '0.85rem',
        fontWeight: 600,
        boxShadow: 'none'
    };
}

function getRefreshButtonStyle(loading: boolean) {
    return {
        ...REFRESH_BUTTON_STYLE,
        cursor: loading ? 'not-allowed' : 'pointer',
    };
}

function setButtonBackground(event: JSX.TargetedMouseEvent<HTMLButtonElement>, color: string): void {
    event.currentTarget.style.background = color;
}

function buildHoverHandlers(
    baseColor: string,
    hoverColor: string,
    enabled = true
): Pick<JSX.HTMLAttributes<HTMLButtonElement>, 'onMouseOver' | 'onMouseOut'> {
    return {
        onMouseOver: (event) => {
            if (!enabled) return;
            setButtonBackground(event, hoverColor);
        },
        onMouseOut: (event) => {
            setButtonBackground(event, baseColor);
        }
    };
}

function getFilterOptionLabel(value: string, labels: Record<string, string>): string {
    return value === 'all' ? 'Alla' : labels[value] || value;
}

function MemoryActionButton({
    label,
    baseColor,
    hoverColor,
    onClick,
    disabled,
}: MemoryActionButtonProps) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            style={buildActionButtonStyle(baseColor)}
            {...buildHoverHandlers(baseColor, hoverColor)}
        >
            {label}
        </button>
    );
}

function StatusFilterSelect({ value, onChange }: StatusFilterSelectProps) {
    return (
        <div>
            <label style={FILTER_LABEL_STYLE}>
                Status
            </label>
            <select
                value={value}
                onChange={(event) => onChange((event.target as HTMLSelectElement).value as StatusFilter)}
                style={FILTER_SELECT_STYLE}
            >
                {STATUS_FILTERS.map((status) => (
                    <option value={status} key={status}>
                        {getFilterOptionLabel(status, STATUS_LABELS)}
                    </option>
                ))}
            </select>
        </div>
    );
}

function SourceFilterSelect({ value, onChange }: SourceFilterSelectProps) {
    return (
        <div>
            <label style={FILTER_LABEL_STYLE}>
                Källa
            </label>
            <select
                value={value}
                onChange={(event) => onChange((event.target as HTMLSelectElement).value as SourceFilter)}
                style={FILTER_SELECT_STYLE}
            >
                {SOURCE_FILTERS.map((source) => (
                    <option value={source} key={source}>
                        {getFilterOptionLabel(source, SOURCE_LABELS)}
                    </option>
                ))}
            </select>
        </div>
    );
}

function MemoryCard({ memory, loading, onUpdateStatus, onDelete }: MemoryCardProps) {
    const reliability = Math.round((memory.source_reliability ?? 0) * 100);
    const statusLabel = STATUS_LABELS[memory.review_status || 'auto'] || 'Auto';
    const sourceLabel = SOURCE_LABELS[memory.source_type] || memory.source_type;
    const typeLabel = TYPE_LABELS[memory.entity_type] || memory.entity_type;
    const isConfirmed = memory.review_status === 'confirmed';
    const metadata = [typeLabel, sourceLabel, statusLabel, `Tillförlitlighet ${reliability}%`];

    return (
        <div style={MEMORY_CARD_STYLE}>
            <div style={MEMORY_CARD_LAYOUT_STYLE}>
                <div style={MEMORY_CONTENT_STYLE}>
                    <div style={MEMORY_META_ROW_STYLE}>
                        {metadata.map((value, index) => (
                            <span key={`${index}-${value}`} style={MEMORY_META_TEXT_STYLE}>
                                {index > 0 ? `• ${value}` : value}
                            </span>
                        ))}
                    </div>
                    <div style={MEMORY_TEXT_STYLE}>
                        {getMemoryText(memory)}
                    </div>
                    <div style={MEMORY_PERIOD_STYLE}>
                        Period: {formatPeriod(memory)} • Senast använd: {formatDateTime(memory.last_used_at)}
                    </div>
                </div>
                <div style={MEMORY_ACTIONS_STYLE}>
                    {isConfirmed ? (
                        <MemoryActionButton
                            label="Pausa"
                            baseColor="#f59e0b"
                            hoverColor="#d97706"
                            onClick={() => onUpdateStatus(memory.id, 'needs_review')}
                            disabled={loading}
                        />
                    ) : (
                        <MemoryActionButton
                            label="Godkänn"
                            baseColor="#10b981"
                            hoverColor="#059669"
                            onClick={() => onUpdateStatus(memory.id, 'confirmed')}
                            disabled={loading}
                        />
                    )}
                    <MemoryActionButton
                        label="Radera"
                        baseColor="#ef4444"
                        hoverColor="#dc2626"
                        onClick={() => onDelete(memory.id)}
                        disabled={loading}
                    />
                </div>
            </div>
        </div>
    );
}

export function AccountingMemoryPanel({ userId, plan }: AccountingMemoryPanelProps) {
    const [memories, setMemories] = useState<AccountingMemoryRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
    const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
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
    }, [userId, companyId, isPro]);

    const filteredMemories = useMemo(() => {
        return memories.filter((memory) => matchesMemoryFilters(memory, statusFilter, sourceFilter));
    }, [memories, statusFilter, sourceFilter]);

    async function loadMemories(options: { showLoading?: boolean; clearError?: boolean } = {}) {
        const showLoading = options.showLoading ?? true;
        const clearError = options.clearError ?? true;

        if (showLoading) setLoading(true);
        if (clearError) setError(null);

        try {
            const rows = await fetchAccountingMemories(userId, companyId);
            setMemories(rows);
        } catch (loadError) {
            logger.warn('Failed to load accounting memories', loadError);
            setError('Kunde inte ladda redovisningsminnet.');
        } finally {
            if (showLoading) setLoading(false);
        }
    }

    async function runMutationAndReload(
        operation: () => PromiseLike<MemoryMutationResult>,
        logMessage: string,
        userMessage: string
    ): Promise<void> {
        setLoading(true);
        try {
            const { error: mutationError } = await operation();
            if (mutationError) throw mutationError;
            await loadMemories({ showLoading: false, clearError: false });
        } catch (mutationError) {
            logger.warn(logMessage, mutationError);
            setError(userMessage);
        } finally {
            setLoading(false);
        }
    }

    async function updateStatus(memoryId: string, status: 'confirmed' | 'needs_review') {
        if (!memoryId) return;
        await runMutationAndReload(
            () => updateAccountingMemoryStatus(memoryId, userId, companyId, status),
            'Failed to update accounting memory status',
            'Kunde inte uppdatera status.'
        );
    }

    async function deleteMemory(memoryId: string) {
        if (!memoryId) return;
        if (!confirm('Är du säker på att du vill radera minnet?')) return;
        await runMutationAndReload(
            () => removeAccountingMemory(memoryId, userId, companyId),
            'Failed to delete accounting memory',
            'Kunde inte radera minnet.'
        );
    }

    if (!isPro) {
        return null;
    }

    return (
        <section style={MEMORY_SECTION_STYLE}>
            <div style={MEMORY_SECTION_HEADER_STYLE}>
                <div>
                    <h3 style={MEMORY_SECTION_TITLE_STYLE}>
                        Redovisningsminne
                    </h3>
                    <p style={MEMORY_SECTION_DESCRIPTION_STYLE}>
                        Strukturerade minnen per bolag och period. Godkänn eller pausa minnen som används av AI.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => void loadMemories()}
                    disabled={loading}
                    style={getRefreshButtonStyle(loading)}
                    {...buildHoverHandlers('var(--surface-2)', 'var(--surface-3)', !loading)}
                >
                    {loading ? 'Laddar...' : 'Uppdatera'}
                </button>
            </div>

            <div style={MEMORY_FILTERS_ROW_STYLE}>
                <StatusFilterSelect value={statusFilter} onChange={setStatusFilter} />
                <SourceFilterSelect value={sourceFilter} onChange={setSourceFilter} />
            </div>

            {error && (
                <div style={MEMORY_ERROR_STYLE}>
                    {error}
                </div>
            )}

            <div style={MEMORY_LIST_WRAP_STYLE}>
                {loading && memories.length === 0 && (
                    <div style={MEMORY_LIST_EMPTY_STYLE}>Laddar...</div>
                )}

                {!loading && filteredMemories.length === 0 && (
                    <div style={MEMORY_LIST_EMPTY_STYLE}>Inga minnen hittades för filtret.</div>
                )}

                {filteredMemories.map((memory) => (
                    <MemoryCard
                        key={memory.id}
                        memory={memory}
                        loading={loading}
                        onUpdateStatus={(memoryId, status) => {
                            void updateStatus(memoryId, status);
                        }}
                        onDelete={(memoryId) => {
                            void deleteMemory(memoryId);
                        }}
                    />
                ))}
            </div>
        </section>
    );
}

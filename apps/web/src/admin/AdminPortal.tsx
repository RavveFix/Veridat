import { useEffect, useMemo, useState } from 'preact/hooks';
import { supabase } from '../lib/supabase';

type PlanType = 'free' | 'pro' | 'trial';
type BillingStatus = 'active' | 'past_due' | 'suspended';

type PlanFilter = 'all' | PlanType;
type StatusFilter = 'all' | BillingStatus;

interface AccountRecord {
    id: string;
    company: string;
    contact: string;
    email: string;
    plan: PlanType;
    status: BillingStatus;
    periodEnd: string | null;
    graceUntil: string | null;
    trialEnd: string | null;
    invoiceId: string | null;
    invoiceDueDate: string | null;
    paidAt: string | null;
}

const DEFAULT_PERIOD_DAYS = 30;
const DEFAULT_TRIAL_DAYS = 14;

const formatDate = (value: string | null): string => {
    if (!value) {
        return '—';
    }
    const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? `${value}T00:00:00`
        : value;
    return new Intl.DateTimeFormat('sv-SE', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    }).format(new Date(normalized));
};

const getPlanLabel = (plan: PlanType): string => {
    if (plan === 'pro') return 'Pro';
    if (plan === 'trial') return 'Trial';
    return 'Free';
};

const getStatusLabel = (status: BillingStatus): string => {
    if (status === 'past_due') return 'Past due';
    if (status === 'suspended') return 'Avstängd';
    return 'Aktiv';
};

const getStatusTone = (status: BillingStatus): string => {
    if (status === 'past_due') return 'warning';
    if (status === 'suspended') return 'danger';
    return 'success';
};

interface InviteFormState {
    fullName: string;
    email: string;
    plan: PlanType;
    periodDays: number;
    invoiceId: string;
    invoiceDueDate: string;
}

interface EditFormState {
    plan: PlanType;
    billingStatus: BillingStatus;
    periodDays: number;
    invoiceId: string;
    invoiceDueDate: string;
}

export function AdminPortal() {
    const [query, setQuery] = useState('');
    const [planFilter, setPlanFilter] = useState<PlanFilter>('all');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
    const [accounts, setAccounts] = useState<AccountRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [actionMessage, setActionMessage] = useState<string | null>(null);
    const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
    const [maintenanceConfirmOpen, setMaintenanceConfirmOpen] = useState(false);
    const [maintenanceRunning, setMaintenanceRunning] = useState(false);

    const [inviteForm, setInviteForm] = useState<InviteFormState>({
        fullName: '',
        email: '',
        plan: 'pro',
        periodDays: DEFAULT_PERIOD_DAYS,
        invoiceId: '',
        invoiceDueDate: ''
    });

    const [editForm, setEditForm] = useState<EditFormState>({
        plan: 'pro',
        billingStatus: 'active',
        periodDays: DEFAULT_PERIOD_DAYS,
        invoiceId: '',
        invoiceDueDate: ''
    });

    useEffect(() => {
        void loadAccounts();
    }, []);

    useEffect(() => {
        if (!selectedAccountId) return;
        const account = accounts.find((entry) => entry.id === selectedAccountId);
        if (!account) return;

        setEditForm({
            plan: account.plan,
            billingStatus: account.status,
            periodDays: account.plan === 'trial' ? DEFAULT_TRIAL_DAYS : DEFAULT_PERIOD_DAYS,
            invoiceId: account.invoiceId ?? '',
            invoiceDueDate: account.invoiceDueDate ?? ''
        });
    }, [accounts, selectedAccountId]);

    async function loadAccounts() {
        setLoading(true);
        setError(null);
        setActionMessage(null);

        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
            window.location.href = '/login?next=/admin';
            return;
        }

        const { data, error: invokeError } = await supabase.functions.invoke('admin-billing', {
            body: { action: 'list' }
        });

        if (invokeError) {
            setError('Kunde inte hämta admin-data.');
            setLoading(false);
            return;
        }

        const accountRows = (data as { accounts?: AccountRecord[] })?.accounts ?? [];
        setAccounts(accountRows);
        setLoading(false);
    }

    async function handleInviteSubmit(event: Event) {
        event.preventDefault();
        setActionMessage(null);

        const { data, error: invokeError } = await supabase.functions.invoke('admin-billing', {
            body: {
                action: 'invite',
                payload: {
                    fullName: inviteForm.fullName,
                    email: inviteForm.email,
                    plan: inviteForm.plan,
                    periodDays: inviteForm.periodDays,
                    invoiceId: inviteForm.invoiceId || null,
                    invoiceDueDate: inviteForm.invoiceDueDate || null
                }
            }
        });

        if (invokeError || !(data as { success?: boolean })?.success) {
            setActionMessage('Kunde inte skicka inbjudan.');
            return;
        }

        setInviteForm({
            fullName: '',
            email: '',
            plan: 'pro',
            periodDays: DEFAULT_PERIOD_DAYS,
            invoiceId: '',
            invoiceDueDate: ''
        });
        setActionMessage('Inbjudan skapad.');
        await loadAccounts();
    }

    async function handleUpdateAccount(event: Event) {
        event.preventDefault();
        if (!selectedAccountId) return;

        setActionMessage(null);
        const { data, error: invokeError } = await supabase.functions.invoke('admin-billing', {
            body: {
                action: 'update',
                payload: {
                    userId: selectedAccountId,
                    plan: editForm.plan,
                    billingStatus: editForm.billingStatus,
                    periodDays: editForm.periodDays,
                    invoiceId: editForm.invoiceId || null,
                    invoiceDueDate: editForm.invoiceDueDate || null
                }
            }
        });

        if (invokeError || !(data as { success?: boolean })?.success) {
            setActionMessage('Kunde inte uppdatera kontot.');
            return;
        }

        setActionMessage('Kontot uppdaterades.');
        await loadAccounts();
    }

    async function handleMarkPaid(accountId: string) {
        setActionMessage(null);
        const { data, error: invokeError } = await supabase.functions.invoke('admin-billing', {
            body: {
                action: 'mark_paid',
                payload: {
                    userId: accountId,
                    periodDays: DEFAULT_PERIOD_DAYS
                }
            }
        });

        if (invokeError || !(data as { success?: boolean })?.success) {
            setActionMessage('Kunde inte markera fakturan som betald.');
            return;
        }

        setActionMessage('Fakturan markerades som betald.');
        await loadAccounts();
    }

    async function handleRunMaintenance() {
        if (maintenanceRunning) return;
        setMaintenanceRunning(true);
        setActionMessage(null);
        const { data, error: invokeError } = await supabase.functions.invoke('billing-maintenance', {
            body: {}
        });

        if (invokeError || !(data as { ok?: boolean })?.ok) {
            setActionMessage('Kunde inte köra underhållsjobbet.');
            setMaintenanceRunning(false);
            return;
        }

        const result = (data as { result?: Record<string, number> })?.result;
        if (result) {
            setActionMessage(
                `Underhåll klart: ${result.moved_to_past_due ?? 0} past due, ` +
                `${result.downgraded_after_grace ?? 0} nedgraderade, ` +
                `${result.trial_expired ?? 0} trials avslutade.`
            );
        } else {
            setActionMessage('Underhåll klart.');
        }

        setMaintenanceConfirmOpen(false);
        setMaintenanceRunning(false);
        await loadAccounts();
    }

    async function handleSignOut() {
        setActionMessage(null);
        const { error: signOutError } = await supabase.auth.signOut();
        if (signOutError) {
            setActionMessage('Kunde inte logga ut.');
            return;
        }
        window.location.href = '/login?next=/admin';
    }

    const metrics = useMemo(() => {
        const total = accounts.length;
        const pro = accounts.filter((account) => account.plan === 'pro').length;
        const free = accounts.filter((account) => account.plan === 'free').length;
        const trial = accounts.filter((account) => account.plan === 'trial').length;
        const pastDue = accounts.filter((account) => account.status === 'past_due').length;

        return {
            total,
            pro,
            free,
            trial,
            pastDue
        };
    }, [accounts]);

    const filteredAccounts = useMemo(() => {
        const queryValue = query.trim().toLowerCase();
        return accounts.filter((account) => {
            const matchesQuery =
                !queryValue ||
                account.company.toLowerCase().includes(queryValue) ||
                account.contact.toLowerCase().includes(queryValue) ||
                account.email.toLowerCase().includes(queryValue);
            const matchesPlan = planFilter === 'all' || account.plan === planFilter;
            const matchesStatus = statusFilter === 'all' || account.status === statusFilter;

            return matchesQuery && matchesPlan && matchesStatus;
        });
    }, [accounts, planFilter, query, statusFilter]);

    const selectedAccount = selectedAccountId
        ? accounts.find((account) => account.id === selectedAccountId) ?? null
        : null;

    return (
        <div class="admin-page">
            <div class="aurora-bg">
                <div class="blob blob-1"></div>
                <div class="blob blob-2"></div>
                <div class="blob blob-3"></div>
            </div>

            <div class="admin-shell">
                <header class="admin-topbar">
                    <div class="admin-title-block">
                        <p class="admin-eyebrow">Billing Console</p>
                        <h1>Adminportal</h1>
                        <p class="admin-subtitle">
                            Fakturastyrd Pro med 30‑dagars period, 14 dagar grace och admin‑styrda trials.
                        </p>
                    </div>
                    <div class="admin-actions">
                        <button class="admin-btn admin-btn-primary" onClick={() => setSelectedAccountId(null)}>Ny inbjudan</button>
                        <button class="admin-btn admin-btn-ghost" onClick={loadAccounts}>Uppdatera</button>
                        <button class="admin-btn admin-btn-ghost" onClick={() => setMaintenanceConfirmOpen(true)}>Kör underhåll</button>
                        <button class="admin-btn admin-btn-ghost" onClick={handleSignOut}>Logga ut</button>
                    </div>
                </header>

                {maintenanceConfirmOpen && (
                    <div class="admin-modal-overlay" role="dialog" aria-modal="true">
                        <div class="admin-modal">
                            <h3>Bekräfta underhåll</h3>
                            <p>Detta uppdaterar status för periodslut, grace och trial‑slut.</p>
                            <div class="admin-modal-actions">
                                <button
                                    class="admin-btn admin-btn-ghost"
                                    type="button"
                                    onClick={() => setMaintenanceConfirmOpen(false)}
                                    disabled={maintenanceRunning}
                                >
                                    Avbryt
                                </button>
                                <button
                                    class="admin-btn admin-btn-primary"
                                    type="button"
                                    onClick={handleRunMaintenance}
                                    disabled={maintenanceRunning}
                                >
                                    {maintenanceRunning ? 'Kör…' : 'Kör nu'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {error && (
                    <div class="admin-banner admin-banner-error">
                        {error}
                    </div>
                )}

                {actionMessage && (
                    <div class="admin-banner admin-banner-success">
                        {actionMessage}
                    </div>
                )}

                <section class="admin-metrics">
                    <div class="admin-card metric-card delay-1">
                        <span class="metric-label">Totalt</span>
                        <div class="metric-value">{metrics.total}</div>
                        <span class="metric-caption">Aktiva och pausade konton</span>
                    </div>
                    <div class="admin-card metric-card delay-2">
                        <span class="metric-label">Pro</span>
                        <div class="metric-value">{metrics.pro}</div>
                        <span class="metric-caption">Fakturaperioder pågår</span>
                    </div>
                    <div class="admin-card metric-card delay-3">
                        <span class="metric-label">Free</span>
                        <div class="metric-value">{metrics.free}</div>
                        <span class="metric-caption">Grundplan utan faktura</span>
                    </div>
                    <div class="admin-card metric-card delay-4">
                        <span class="metric-label">Trial</span>
                        <div class="metric-value">{metrics.trial}</div>
                        <span class="metric-caption">Manuellt aktiverade testperioder</span>
                    </div>
                    <div class="admin-card metric-card delay-5">
                        <span class="metric-label">Past due</span>
                        <div class="metric-value">{metrics.pastDue}</div>
                        <span class="metric-caption">Inom grace just nu</span>
                    </div>
                </section>

                <section class="admin-grid">
                    <div class="admin-card admin-table-card">
                        <div class="admin-table-header">
                            <div>
                                <h2>Konton</h2>
                                <p class="admin-muted">Sök, filtrera och agera på pågående fakturor.</p>
                            </div>
                            <div class="admin-controls">
                                <div class="admin-search">
                                    <input
                                        type="search"
                                        placeholder="Sök bolag, kontakt eller e-post"
                                        value={query}
                                        onInput={(event) => setQuery((event.target as HTMLInputElement).value)}
                                    />
                                </div>
                                <select
                                    value={planFilter}
                                    onChange={(event) => setPlanFilter((event.target as HTMLSelectElement).value as PlanFilter)}
                                >
                                    <option value="all">Alla planer</option>
                                    <option value="pro">Pro</option>
                                    <option value="free">Free</option>
                                    <option value="trial">Trial</option>
                                </select>
                                <select
                                    value={statusFilter}
                                    onChange={(event) =>
                                        setStatusFilter((event.target as HTMLSelectElement).value as StatusFilter)
                                    }
                                >
                                    <option value="all">Alla statusar</option>
                                    <option value="active">Aktiva</option>
                                    <option value="past_due">Past due</option>
                                    <option value="suspended">Avstängda</option>
                                </select>
                            </div>
                        </div>

                        <div class="admin-table">
                            <div class="admin-table-row admin-table-head">
                                <span>Bolag</span>
                                <span>Plan</span>
                                <span>Status</span>
                                <span>Period</span>
                                <span>Faktura</span>
                                <span>Åtgärder</span>
                            </div>
                            {loading ? (
                                <div class="admin-empty">Laddar konton…</div>
                            ) : filteredAccounts.length === 0 ? (
                                <div class="admin-empty">Inga konton matchar filtret.</div>
                            ) : (
                                filteredAccounts.map((account) => {
                                    const mainPeriod = account.plan === 'trial' ? account.trialEnd : account.periodEnd;
                                    const secondaryPeriod = account.plan === 'trial'
                                        ? `Trial slutar ${formatDate(account.trialEnd)}`
                                        : account.graceUntil
                                            ? `Grace till ${formatDate(account.graceUntil)}`
                                            : '—';

                                    return (
                                        <div class="admin-table-row" key={account.id}>
                                            <div class="admin-company">
                                                <div>
                                                    <strong>{account.company}</strong>
                                                    <span>{account.contact}</span>
                                                </div>
                                                <span class="admin-muted">{account.email}</span>
                                            </div>
                                            <span class={`admin-chip plan ${account.plan}`}>{getPlanLabel(account.plan)}</span>
                                            <span class={`admin-chip status ${getStatusTone(account.status)}`}>
                                                {getStatusLabel(account.status)}
                                            </span>
                                            <div class="admin-period">
                                                <span>{formatDate(mainPeriod)}</span>
                                                <span class="admin-muted">{secondaryPeriod}</span>
                                            </div>
                                            <div class="admin-invoice">
                                                <span>{account.invoiceId ?? '—'}</span>
                                                <span class="admin-muted">
                                                    {account.invoiceDueDate ? `Förfaller ${formatDate(account.invoiceDueDate)}` : '—'}
                                                </span>
                                            </div>
                                            <div class="admin-row-actions">
                                                <button
                                                    class="admin-btn admin-btn-ghost"
                                                    onClick={() => handleMarkPaid(account.id)}
                                                >
                                                    Markera betald
                                                </button>
                                                <button
                                                    class="admin-btn admin-btn-outline"
                                                    onClick={() => setSelectedAccountId(account.id)}
                                                >
                                                    Ändra plan
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>

                    <aside class="admin-side">
                        <div class="admin-card admin-panel">
                            <h3>{selectedAccount ? `Redigera ${selectedAccount.company}` : 'Ny inbjudan'}</h3>
                            <p class="admin-muted">
                                {selectedAccount
                                    ? 'Justera plan, status och fakturadetaljer.'
                                    : 'Bjud in och sätt plan direkt. Fakturan skapas i Fortnox.'}
                            </p>
                            {selectedAccount ? (
                                <form class="admin-form" onSubmit={handleUpdateAccount}>
                                    <label>
                                        Plan
                                        <select
                                            value={editForm.plan}
                                            onChange={(event) =>
                                                setEditForm({
                                                    ...editForm,
                                                    plan: (event.target as HTMLSelectElement).value as PlanType
                                                })
                                            }
                                        >
                                            <option value="pro">Pro</option>
                                            <option value="trial">Trial</option>
                                            <option value="free">Free</option>
                                        </select>
                                    </label>
                                    <label>
                                        Status
                                        <select
                                            value={editForm.billingStatus}
                                            onChange={(event) =>
                                                setEditForm({
                                                    ...editForm,
                                                    billingStatus: (event.target as HTMLSelectElement).value as BillingStatus
                                                })
                                            }
                                        >
                                            <option value="active">Aktiv</option>
                                            <option value="past_due">Past due</option>
                                            <option value="suspended">Avstängd</option>
                                        </select>
                                    </label>
                                    <div class="admin-form-row">
                                        <label>
                                            Period (dagar)
                                            <input
                                                type="number"
                                                min={1}
                                                value={editForm.periodDays}
                                                onInput={(event) =>
                                                    setEditForm({
                                                        ...editForm,
                                                        periodDays: Number((event.target as HTMLInputElement).value)
                                                    })
                                                }
                                            />
                                        </label>
                                        <label>
                                            Förfallodatum
                                            <input
                                                type="date"
                                                value={editForm.invoiceDueDate}
                                                onInput={(event) =>
                                                    setEditForm({
                                                        ...editForm,
                                                        invoiceDueDate: (event.target as HTMLInputElement).value
                                                    })
                                                }
                                            />
                                        </label>
                                    </div>
                                    <label>
                                        Faktura-ID
                                        <input
                                            type="text"
                                            value={editForm.invoiceId}
                                            onInput={(event) =>
                                                setEditForm({
                                                    ...editForm,
                                                    invoiceId: (event.target as HTMLInputElement).value
                                                })
                                            }
                                        />
                                    </label>
                                    <button class="admin-btn admin-btn-primary" type="submit">
                                        Spara ändringar
                                    </button>
                                </form>
                            ) : (
                                <form class="admin-form" onSubmit={handleInviteSubmit}>
                                    <label>
                                        Kontaktperson
                                        <input
                                            type="text"
                                            placeholder="Ex. Anna Andersson"
                                            value={inviteForm.fullName}
                                            onInput={(event) =>
                                                setInviteForm({
                                                    ...inviteForm,
                                                    fullName: (event.target as HTMLInputElement).value
                                                })
                                            }
                                            required
                                        />
                                    </label>
                                    <label>
                                        E-post
                                        <input
                                            type="email"
                                            placeholder="namn@foretag.se"
                                            value={inviteForm.email}
                                            onInput={(event) =>
                                                setInviteForm({
                                                    ...inviteForm,
                                                    email: (event.target as HTMLInputElement).value
                                                })
                                            }
                                            required
                                        />
                                    </label>
                                    <div class="admin-form-row">
                                        <label>
                                            Plan
                                            <select
                                                value={inviteForm.plan}
                                                onChange={(event) =>
                                                    setInviteForm({
                                                        ...inviteForm,
                                                        plan: (event.target as HTMLSelectElement).value as PlanType
                                                    })
                                                }
                                            >
                                                <option value="pro">Pro</option>
                                                <option value="trial">Trial</option>
                                                <option value="free">Free</option>
                                            </select>
                                        </label>
                                        <label>
                                            Period (dagar)
                                            <input
                                                type="number"
                                                min={1}
                                                value={inviteForm.periodDays}
                                                onInput={(event) =>
                                                    setInviteForm({
                                                        ...inviteForm,
                                                        periodDays: Number((event.target as HTMLInputElement).value)
                                                    })
                                                }
                                            />
                                        </label>
                                    </div>
                                    <div class="admin-form-row">
                                        <label>
                                            Faktura-ID
                                            <input
                                                type="text"
                                                value={inviteForm.invoiceId}
                                                onInput={(event) =>
                                                    setInviteForm({
                                                        ...inviteForm,
                                                        invoiceId: (event.target as HTMLInputElement).value
                                                    })
                                                }
                                            />
                                        </label>
                                        <label>
                                            Förfallodatum
                                            <input
                                                type="date"
                                                value={inviteForm.invoiceDueDate}
                                                onInput={(event) =>
                                                    setInviteForm({
                                                        ...inviteForm,
                                                        invoiceDueDate: (event.target as HTMLInputElement).value
                                                    })
                                                }
                                            />
                                        </label>
                                    </div>
                                    <button class="admin-btn admin-btn-primary" type="submit">
                                        Skicka inbjudan
                                    </button>
                                </form>
                            )}
                        </div>

                        <div class="admin-card admin-panel">
                            <h3>Snabbåtgärder</h3>
                            <ul class="admin-action-list">
                                <li>
                                    <span>Skicka påminnelse</span>
                                    <button class="admin-btn admin-btn-ghost" type="button">Ny påminnelse</button>
                                </li>
                                <li>
                                    <span>Förläng period</span>
                                    <button class="admin-btn admin-btn-ghost" type="button">+30 dagar</button>
                                </li>
                                <li>
                                    <span>Stäng av Pro</span>
                                    <button class="admin-btn admin-btn-outline" type="button">Nedgradera</button>
                                </li>
                            </ul>
                        </div>

                        <div class="admin-card admin-panel">
                            <h3>Policy</h3>
                            <div class="admin-policy">
                                <div>
                                    <strong>Period</strong>
                                    <span>30 dagar faktura</span>
                                </div>
                                <div>
                                    <strong>Grace</strong>
                                    <span>14 dagar, full Pro</span>
                                </div>
                                <div>
                                    <strong>Trial</strong>
                                    <span>14 dagar, admin‑styrt</span>
                                </div>
                            </div>
                        </div>
                    </aside>
                </section>
            </div>
        </div>
    );
}

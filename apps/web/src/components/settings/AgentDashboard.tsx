/**
 * Agent Dashboard — Förenklad vy med hälsostatus, varningar och senaste aktivitet.
 * Ersätter den tekniska agentöversikten med en användarvänlig dashboard.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { supabase } from '../../lib/supabase';
import { companyManager } from '../../services/CompanyService';
import { agentOrchestratorService } from '../../services/AgentOrchestratorService';
import { logger } from '../../services/LoggerService';
import type { AgentTask } from '../../types/agentSwarm';
import { AGENT_DISPLAY_INFO } from '../../types/agentSwarm';

const REFRESH_INTERVAL_MS = 30_000;

// ─── Types ───────────────────────────────────────────────────────────────────

interface GuardianAlert {
    id: string;
    title: string;
    description: string;
    severity: 'critical' | 'warning' | 'info';
    status: 'open' | 'acknowledged' | 'resolved';
    action_target?: string | null;
    created_at: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const formatRelative = (value?: string | null): string => {
    if (!value) return 'Aldrig';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '';
    const diffMs = Date.now() - parsed.getTime();
    const mins = Math.floor(diffMs / 60_000);
    if (mins < 1) return 'Just nu';
    if (mins < 60) return `${mins} min sedan`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h sedan`;
    const days = Math.floor(hours / 24);
    return `${days}d sedan`;
};

const SEVERITY_ICON: Record<string, string> = {
    critical: '\u26D4',
    warning: '\u26A0\uFE0F',
    info: '\u2139\uFE0F',
};

const ACTION_TARGET_LABELS: Record<string, string> = {
    'fortnox-panel': 'Fortnox',
    'invoice-inbox': 'Fakturor',
    'vat-report': 'Momsrapport',
};

function getAgentStatusDotStyle(statusColor: string) {
    return {
        background: statusColor,
        boxShadow: `0 0 8px ${statusColor}55`
    };
}

function getAgentStatusTextStyle(statusColor: string) {
    return {
        color: statusColor
    };
}

function sendToAI(prompt: string) {
    const input = document.getElementById('user-input') as HTMLInputElement | null;
    const form = document.getElementById('chat-form') as HTMLFormElement | null;
    if (!input || !form) return;
    input.value = prompt;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    form.dispatchEvent(new Event('submit', { cancelable: true }));
}

function closeAgentDashboard() {
    window.dispatchEvent(new CustomEvent('close-agent-dashboard'));
}

async function fetchGuardianAlerts(companyId: string): Promise<GuardianAlert[]> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return [];

    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fortnox-guardian`;
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
            action: 'list_alerts',
            payload: { limit: 20, companyId },
        }),
    });

    if (!response.ok) return [];
    const result = await response.json().catch(() => ({}));
    return Array.isArray(result?.alerts) ? (result.alerts as GuardianAlert[]) : [];
}

async function resolveGuardianAlert(alertId: string): Promise<boolean> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return false;

    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fortnox-guardian`;
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
            action: 'update_alert',
            payload: { alertId, status: 'resolved' },
        }),
    });

    return response.ok;
}

// ─── Agent name mapping ──────────────────────────────────────────────────────

const AGENT_NAMES: Record<string, string> = {
    faktura: 'Faktura',
    bank: 'Bank',
    moms: 'Moms',
    bokforings: 'Bokföring',
    guardian: 'Hälsokontroll',
    agi: 'Arbetsgivardeklaration',
};

const TASK_STATUS_LABELS: Record<string, string> = {
    succeeded: 'Klar',
    failed: 'Misslyckades',
    cancelled: 'Avbruten',
    running: 'Pågår',
    pending: 'Väntar',
    claimed: 'Startar',
};

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export function AgentDashboard() {
    const [companyId, setCompanyId] = useState(companyManager.getCurrentId());
    const [alerts, setAlerts] = useState<GuardianAlert[]>([]);
    const [recentTasks, setRecentTasks] = useState<AgentTask[]>([]);
    const [loading, setLoading] = useState(false);
    const [healthCheckRunning, setHealthCheckRunning] = useState(false);
    const [expandedAlertId, setExpandedAlertId] = useState<string | null>(null);
    const [lastChecked, setLastChecked] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // ─── Company change ──────────────────────────────────────────────────────
    useEffect(() => {
        const handleCompanyChange = (event: Event) => {
            const detail = (event as CustomEvent<{ companyId: string }>).detail;
            if (detail?.companyId) setCompanyId(detail.companyId);
        };
        window.addEventListener('company-changed', handleCompanyChange);
        return () => window.removeEventListener('company-changed', handleCompanyChange);
    }, []);

    // ─── Data loading ────────────────────────────────────────────────────────
    const loadData = useCallback(async () => {
        if (!companyId) return;
        setError(null);

        try {
            const [alertsData, tasksData] = await Promise.all([
                fetchGuardianAlerts(companyId),
                agentOrchestratorService.listTasks({ limit: 5, company_id: companyId }),
            ]);

            setAlerts(alertsData);

            const finished = (tasksData.tasks ?? [])
                .filter((t) => t.status === 'succeeded' || t.status === 'failed' || t.status === 'cancelled')
                .slice(0, 5);
            setRecentTasks(finished);

            // Determine last checked time from guardian tasks
            const guardianTasks = (tasksData.tasks ?? [])
                .filter((t) => t.agent_type === 'guardian' && t.finished_at);
            if (guardianTasks.length > 0) {
                setLastChecked(guardianTasks[0].finished_at ?? null);
            }
        } catch (loadError) {
            logger.warn('Failed to load dashboard data', loadError);
            setError('Kunde inte ladda data. Försök igen.');
        }
    }, [companyId]);

    useEffect(() => {
        if (!companyId) return;

        setLoading(true);
        loadData().finally(() => setLoading(false));

        refreshRef.current = setInterval(() => { void loadData(); }, REFRESH_INTERVAL_MS);
        return () => {
            if (refreshRef.current) clearInterval(refreshRef.current);
        };
    }, [companyId, loadData]);

    // ─── Handlers ────────────────────────────────────────────────────────────

    async function handleHealthCheck() {
        setHealthCheckRunning(true);
        setError(null);
        try {
            await agentOrchestratorService.dispatch({
                agent_type: 'guardian',
                company_id: companyId,
            });
            // Wait a bit then refresh to show results
            setTimeout(() => {
                void loadData();
                setHealthCheckRunning(false);
            }, 3000);
        } catch (dispatchError) {
            logger.warn('Failed to dispatch guardian', dispatchError);
            setError('Kunde inte starta hälsokontroll.');
            setHealthCheckRunning(false);
        }
    }

    async function handleResolveAlert(alertId: string) {
        const ok = await resolveGuardianAlert(alertId);
        if (ok) {
            setAlerts((prev) => prev.filter((a) => a.id !== alertId));
        }
    }

    function handleAskAI(alert: GuardianAlert) {
        closeAgentDashboard();
        // Small delay to let modal close, then send to AI
        setTimeout(() => {
            const target = alert.action_target
                ? ` Berörd del: ${ACTION_TARGET_LABELS[alert.action_target] || alert.action_target}.`
                : '';
            sendToAI(`Guardian hittade: ${alert.title}. ${alert.description}.${target} Vad ska jag göra?`);
        }, 200);
    }

    // ─── Derived state ───────────────────────────────────────────────────────

    const openAlerts = alerts.filter((a) => a.status === 'open' || a.status === 'acknowledged');
    const criticalCount = openAlerts.filter((a) => a.severity === 'critical').length;
    const warningCount = openAlerts.filter((a) => a.severity === 'warning').length;

    let statusColor: string;
    let statusText: string;
    if (criticalCount > 0) {
        statusColor = '#ef4444';
        statusText = `${openAlerts.length} ${openAlerts.length === 1 ? 'sak' : 'saker'} att åtgärda`;
    } else if (warningCount > 0) {
        statusColor = '#f59e0b';
        statusText = `${openAlerts.length} ${openAlerts.length === 1 ? 'sak' : 'saker'} att kolla på`;
    } else {
        statusColor = '#10b981';
        statusText = 'Allt ser bra ut';
    }

    // ─── Render ──────────────────────────────────────────────────────────────

    return (
        <section className="agent-dash agent-dash--stagger" data-testid="agent-dashboard-root">

            {error && (
                <div className="agent-dash__message agent-dash__message--error">{error}</div>
            )}

            {/* ─── Status Hero ─────────────────────────────────────────── */}
            <div className="agent-dash__status-hero" data-testid="agent-dash-status-hero">
                <div className="agent-dash__status-left">
                    <span
                        className="agent-dash__status-dot"
                        style={getAgentStatusDotStyle(statusColor)}
                    />
                    <div>
                        <div className="agent-dash__status-text" style={getAgentStatusTextStyle(statusColor)}>
                            {statusText}
                        </div>
                        <div className="agent-dash__status-sub">
                            Senast kontrollerad: {formatRelative(lastChecked)}
                        </div>
                    </div>
                </div>
                <button
                    type="button"
                    className="agent-dash__health-btn"
                    onClick={() => void handleHealthCheck()}
                    disabled={healthCheckRunning || loading}
                    data-testid="agent-dash-health-check"
                >
                    {healthCheckRunning ? 'Kontrollerar...' : 'Kör hälsokontroll'}
                </button>
            </div>

            {/* ─── Alert List ──────────────────────────────────────────── */}
            {openAlerts.length > 0 && (
                <section className="agent-dash__section" data-testid="agent-dash-alerts">
                    <div className="agent-dash__section-header">
                        <h4 className="agent-dash__section-title">
                            Varningar ({openAlerts.length})
                        </h4>
                    </div>
                    <div className="agent-dash__alert-list">
                        {openAlerts.map((alert) => {
                            const isExpanded = expandedAlertId === alert.id;
                            return (
                                <div
                                    key={alert.id}
                                    className={`agent-dash__alert-card agent-dash__alert-card--${alert.severity}`}
                                    data-testid={`agent-alert-${alert.id}`}
                                >
                                    <div
                                        className="agent-dash__alert-top"
                                        onClick={() => setExpandedAlertId(isExpanded ? null : alert.id)}
                                    >
                                        <span className="agent-dash__alert-icon">
                                            {SEVERITY_ICON[alert.severity] || '\u2139\uFE0F'}
                                        </span>
                                        <div className="agent-dash__alert-title">{alert.title}</div>
                                        <span className="agent-dash__alert-chevron">
                                            {isExpanded ? '\u25B2' : '\u25BC'}
                                        </span>
                                    </div>
                                    {isExpanded && (
                                        <div className="agent-dash__alert-body">
                                            <p className="agent-dash__alert-desc">{alert.description}</p>
                                            <div className="agent-dash__alert-actions">
                                                <button
                                                    type="button"
                                                    className="agent-dash__alert-action-btn agent-dash__alert-action-btn--primary"
                                                    onClick={() => handleAskAI(alert)}
                                                >
                                                    Hantera med AI
                                                </button>
                                                <button
                                                    type="button"
                                                    className="agent-dash__alert-action-btn agent-dash__alert-action-btn--resolve"
                                                    onClick={() => void handleResolveAlert(alert.id)}
                                                >
                                                    Markera som löst
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </section>
            )}

            {/* ─── Recent Activity ─────────────────────────────────────── */}
            <section className="agent-dash__section" data-testid="agent-dash-activity">
                <div className="agent-dash__section-header">
                    <h4 className="agent-dash__section-title">Senaste aktivitet</h4>
                </div>
                {recentTasks.length === 0 ? (
                    <div className="agent-dash__empty">Inga avslutade körningar ännu.</div>
                ) : (
                    <div className="agent-dash__activity-list">
                        {recentTasks.map((task) => {
                            const info = AGENT_DISPLAY_INFO[task.agent_type] ?? { icon: '?', color: '#888' };
                            const name = AGENT_NAMES[task.agent_type] || task.agent_type;
                            const statusLabel = TASK_STATUS_LABELS[task.status] || task.status;
                            const isOk = task.status === 'succeeded';

                            // Extract summary from output
                            let summaryText = '';
                            if (task.output_payload) {
                                const summary = task.output_payload.summary as Record<string, unknown> | undefined;
                                if (summary) {
                                    const parts: string[] = [];
                                    if ('alertsCreated' in summary) parts.push(`${summary.alertsCreated} varningar`);
                                    if ('processedInvoices' in summary) parts.push(`${summary.processedInvoices} fakturor`);
                                    if ('totalAmount' in summary) parts.push(`${summary.totalAmount} kr`);
                                    summaryText = parts.join(', ');
                                }
                            }

                            return (
                                <div key={task.id} className="agent-dash__activity-item" data-testid={`agent-activity-${task.id}`}>
                                    <span className="agent-dash__activity-icon">{info.icon}</span>
                                    <div className="agent-dash__activity-info">
                                        <span className="agent-dash__activity-name">{name}</span>
                                        <span className={`agent-dash__activity-status agent-dash__activity-status--${isOk ? 'ok' : 'fail'}`}>
                                            {statusLabel}
                                        </span>
                                        {summaryText && (
                                            <span className="agent-dash__activity-summary">{summaryText}</span>
                                        )}
                                    </div>
                                    <span className="agent-dash__activity-time">
                                        {formatRelative(task.finished_at)}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>

            {loading && <div className="agent-dash__loading">Laddar...</div>}
        </section>
    );
}

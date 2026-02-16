/**
 * Agent Dashboard — Översikt, task-kö och aktivitetslogg för agent swarm
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { companyManager } from '../../services/CompanyService';
import { agentOrchestratorService } from '../../services/AgentOrchestratorService';
import { testOrchestratorService } from '../../services/TestOrchestratorService';
import { logger } from '../../services/LoggerService';
import type {
    AgentType,
    AgentTask,
    AgentRegistryEntry,
} from '../../types/agentSwarm';
import { AGENT_DISPLAY_INFO, STATUS_DISPLAY } from '../../types/agentSwarm';
import type {
    TestOrchestratorRunResponse,
    TestSuiteDefinition,
    TestSuiteId,
} from '../../types/testOrchestrator';

const REFRESH_INTERVAL_MS = 15_000;

const formatDateTime = (value?: string | null): string => {
    if (!value) return '—';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '—';
    return parsed.toLocaleString('sv-SE', { dateStyle: 'medium', timeStyle: 'short' });
};

const formatRelative = (value?: string | null): string => {
    if (!value) return 'Aldrig';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '—';
    const diffMs = Date.now() - parsed.getTime();
    const mins = Math.floor(diffMs / 60_000);
    if (mins < 1) return 'Just nu';
    if (mins < 60) return `${mins} min sedan`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h sedan`;
    const days = Math.floor(hours / 24);
    return `${days}d sedan`;
};

const prioLabel = (p: number): { text: string; cls: string } => {
    if (p <= 3) return { text: 'Hög', cls: 'prio-high' };
    if (p <= 7) return { text: 'Normal', cls: 'prio-normal' };
    return { text: 'Låg', cls: 'prio-low' };
};

const ORCHESTRATOR_STATUS_LABELS: Record<string, string> = {
    running: 'Körs',
    succeeded: 'Klar',
    failed: 'Misslyckades',
};

export function AgentDashboard() {
    const [companyId, setCompanyId] = useState(companyManager.getCurrentId());
    const [agents, setAgents] = useState<AgentRegistryEntry[]>([]);
    const [tasks, setTasks] = useState<AgentTask[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [dispatchingAgent, setDispatchingAgent] = useState<AgentType | null>(null);
    const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
    const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Test orchestrator state (preserved from SkillsHubPanel)
    const [suites, setSuites] = useState<TestSuiteDefinition[]>([]);
    const [selectedSuite, setSelectedSuite] = useState<TestSuiteId | ''>('core_ui');
    const [suiteRunLoading, setSuiteRunLoading] = useState(false);
    const [suiteRunError, setSuiteRunError] = useState<string | null>(null);
    const [lastSuiteRun, setLastSuiteRun] = useState<TestOrchestratorRunResponse | null>(null);

    // Derived: active queue (pending/claimed/running)
    const queueTasks = useMemo(
        () => tasks.filter((t) => t.status === 'pending' || t.status === 'claimed' || t.status === 'running'),
        [tasks],
    );

    // Derived: recent completed (succeeded/failed/cancelled), max 10
    const recentTasks = useMemo(
        () =>
            tasks
                .filter((t) => t.status === 'succeeded' || t.status === 'failed' || t.status === 'cancelled')
                .slice(0, 10),
        [tasks],
    );

    // Company change listener
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

    const loadData = useCallback(async () => {
        setError(null);
        try {
            const [agentsRes, tasksRes] = await Promise.all([
                agentOrchestratorService.listAgents(),
                agentOrchestratorService.listTasks({ limit: 30, company_id: companyId }),
            ]);
            setAgents(agentsRes.agents ?? []);
            setTasks(tasksRes.tasks ?? []);
        } catch (loadError) {
            logger.warn('Failed to load agent dashboard data', loadError);
            setError('Kunde inte ladda agentdata. Prova att uppdatera.');
        }
    }, [companyId]);

    const loadSuites = useCallback(async () => {
        try {
            const response = await testOrchestratorService.listSuites();
            setSuites(response.suites || []);
            if (!selectedSuite && response.suites?.[0]?.id) {
                setSelectedSuite(response.suites[0].id);
            }
        } catch (loadError) {
            logger.warn('Failed to load test suites', loadError);
        }
    }, [selectedSuite]);

    // Initial load + auto-refresh
    useEffect(() => {
        if (!companyId) return;

        setLoading(true);
        Promise.all([loadData(), loadSuites()]).finally(() => setLoading(false));

        // Auto-refresh every 15s
        refreshRef.current = setInterval(() => {
            void loadData();
        }, REFRESH_INTERVAL_MS);

        return () => {
            if (refreshRef.current) clearInterval(refreshRef.current);
        };
    }, [companyId, loadData, loadSuites]);

    // --- Handlers ---
    async function handleDispatch(agentType: AgentType) {
        setDispatchingAgent(agentType);
        setError(null);
        try {
            await agentOrchestratorService.dispatch({
                agent_type: agentType,
                company_id: companyId,
            });
            await loadData();
        } catch (dispatchError) {
            logger.warn('Failed to dispatch agent', dispatchError);
            setError(`Kunde inte starta ${agentType}-agenten.`);
        } finally {
            setDispatchingAgent(null);
        }
    }

    async function handleToggle(agentType: AgentType, enabled: boolean) {
        try {
            await agentOrchestratorService.toggleAgent(agentType, enabled);
            setAgents((prev) =>
                prev.map((a) => (a.agent_type === agentType ? { ...a, enabled } : a)),
            );
        } catch (toggleError) {
            logger.warn('Failed to toggle agent', toggleError);
            setError('Kunde inte ändra agentstatus.');
        }
    }

    async function handleCancel(taskId: string) {
        try {
            await agentOrchestratorService.cancelTask(taskId);
            await loadData();
        } catch (cancelError) {
            logger.warn('Failed to cancel task', cancelError);
            setError('Kunde inte avbryta uppgiften.');
        }
    }

    async function handleRetry(taskId: string) {
        try {
            await agentOrchestratorService.retryTask(taskId);
            await loadData();
        } catch (retryError) {
            logger.warn('Failed to retry task', retryError);
            setError('Kunde inte köa om uppgiften.');
        }
    }

    async function handleRunSuite() {
        if (!selectedSuite) return;
        setSuiteRunLoading(true);
        setSuiteRunError(null);
        try {
            const result = await testOrchestratorService.runSuite(companyId, selectedSuite, 'manual');
            setLastSuiteRun(result);
        } catch (runError) {
            logger.warn('Failed to run suite', runError);
            setSuiteRunError('Kunde inte köra testsviten.');
        } finally {
            setSuiteRunLoading(false);
        }
    }

    async function handleRunAllSuites() {
        setSuiteRunLoading(true);
        setSuiteRunError(null);
        try {
            const result = await testOrchestratorService.runAll(companyId, 'manual');
            setLastSuiteRun(result);
        } catch (runError) {
            logger.warn('Failed to run all suites', runError);
            setSuiteRunError('Kunde inte köra alla testsviter.');
        } finally {
            setSuiteRunLoading(false);
        }
    }

    // --- Render helpers ---
    function renderAgentCard(agent: AgentRegistryEntry) {
        const info = AGENT_DISPLAY_INFO[agent.agent_type] ?? { icon: '?', color: '#888' };
        const isDispatching = dispatchingAgent === agent.agent_type;

        return (
            <div
                key={agent.agent_type}
                className={`agent-dash__agent-card${agent.enabled ? '' : ' agent-dash__agent-card--disabled'}`}
                data-testid={`agent-card-${agent.agent_type}`}
            >
                <div className="agent-dash__agent-top">
                    <div
                        className="agent-dash__agent-icon"
                        style={{ background: `${info.color}22`, color: info.color }}
                    >
                        {info.icon}
                    </div>
                    <button
                        type="button"
                        className={`agent-dash__agent-toggle${agent.enabled ? ' agent-dash__agent-toggle--on' : ''}`}
                        onClick={() => void handleToggle(agent.agent_type, !agent.enabled)}
                        title={agent.enabled ? 'Inaktivera' : 'Aktivera'}
                        data-testid={`agent-toggle-${agent.agent_type}`}
                    />
                </div>
                <div className="agent-dash__agent-name">{agent.display_name}</div>
                <div className="agent-dash__agent-desc">{agent.description}</div>
                <div className="agent-dash__agent-meta">
                    <span className="agent-dash__agent-last-run">
                        {formatRelative(agent.last_run_at)}
                    </span>
                    {agent.schedule_cron && (
                        <span className="agent-dash__agent-cron">{agent.schedule_cron}</span>
                    )}
                    <button
                        type="button"
                        className="agent-dash__run-btn"
                        onClick={() => void handleDispatch(agent.agent_type)}
                        disabled={isDispatching || !agent.enabled}
                        data-testid={`agent-run-${agent.agent_type}`}
                    >
                        {isDispatching ? 'Startar...' : 'Kör'}
                    </button>
                </div>
            </div>
        );
    }

    function renderTaskRow(task: AgentTask, showActions: boolean) {
        const info = AGENT_DISPLAY_INFO[task.agent_type] ?? { icon: '?', color: '#888' };
        const status = STATUS_DISPLAY[task.status] ?? { label: task.status, color: '#888' };
        const prio = prioLabel(task.priority);

        return (
            <div key={task.id} className="agent-dash__task" data-testid={`agent-task-${task.id}`}>
                <div className="agent-dash__task-left">
                    <span className="agent-dash__task-icon">{info.icon}</span>
                    <div className="agent-dash__task-info">
                        <div className="agent-dash__task-title">
                            {AGENT_DISPLAY_INFO[task.agent_type]
                                ? task.agent_type.charAt(0).toUpperCase() + task.agent_type.slice(1)
                                : task.agent_type}
                            {task.parent_task_id && <span style={{ opacity: 0.5 }}> (kedja)</span>}
                        </div>
                        <div className="agent-dash__task-sub">
                            {formatDateTime(task.created_at)}
                            {task.retry_count > 0 && ` • ${task.retry_count}/${task.max_retries} retries`}
                            {task.error_message && ` • ${task.error_message.slice(0, 60)}`}
                        </div>
                    </div>
                </div>
                <div className="agent-dash__task-right">
                    <span className={`agent-dash__badge agent-dash__badge--${prio.cls}`}>{prio.text}</span>
                    <span className={`agent-dash__badge agent-dash__badge--${task.status}`}>{status.label}</span>
                    {showActions && task.status === 'pending' && (
                        <button
                            type="button"
                            className="agent-dash__task-btn agent-dash__task-btn--cancel"
                            onClick={() => void handleCancel(task.id)}
                        >
                            Avbryt
                        </button>
                    )}
                    {showActions && task.status === 'failed' && task.retry_count < task.max_retries && (
                        <button
                            type="button"
                            className="agent-dash__task-btn agent-dash__task-btn--retry"
                            onClick={() => void handleRetry(task.id)}
                        >
                            Kör om
                        </button>
                    )}
                </div>
            </div>
        );
    }

    function renderOutputPayload(payload: Record<string, unknown>) {
        const summary = payload.summary as Record<string, unknown> | undefined;
        const ok = payload.ok as boolean | undefined;

        // Structured display for known formats (guardian, finance-agent)
        if (summary && typeof summary === 'object') {
            const items: { label: string; value: string | number; type?: 'success' | 'warn' | 'error' }[] = [];

            if ('alertsCreated' in summary) {
                const created = summary.alertsCreated as number;
                items.push({ label: 'Nya varningar', value: created, type: created > 0 ? 'warn' : 'success' });
            }
            if ('alertsResolved' in summary) items.push({ label: 'Lösta', value: summary.alertsResolved as number, type: 'success' });
            if ('alertsUpdated' in summary) items.push({ label: 'Uppdaterade', value: summary.alertsUpdated as number });
            if ('errors' in summary) {
                const errors = summary.errors as number;
                items.push({ label: 'Fel', value: errors, type: errors > 0 ? 'error' : 'success' });
            }
            if ('processedUsers' in summary) items.push({ label: 'Användare', value: summary.processedUsers as number });
            if ('processedInvoices' in summary) items.push({ label: 'Fakturor', value: summary.processedInvoices as number });
            if ('totalAmount' in summary) items.push({ label: 'Belopp', value: `${summary.totalAmount} kr` });
            if ('vatAmount' in summary) items.push({ label: 'Moms', value: `${summary.vatAmount} kr` });

            if (items.length > 0) {
                return (
                    <div className="agent-dash__output">
                        <div className="agent-dash__output-status">
                            <span className={`agent-dash__output-dot agent-dash__output-dot--${ok ? 'ok' : 'fail'}`} />
                            {ok ? 'Lyckades' : 'Misslyckades'}
                            {payload.mode && <span className="agent-dash__output-mode">{String(payload.mode)}</span>}
                        </div>
                        <div className="agent-dash__output-grid">
                            {items.map((item) => (
                                <div key={item.label} className="agent-dash__output-stat">
                                    <span className="agent-dash__output-stat-value">{item.value}</span>
                                    <span className="agent-dash__output-stat-label">{item.label}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                );
            }
        }

        // Fallback: formatted JSON
        return <pre className="agent-dash__output-json">{JSON.stringify(payload, null, 2)}</pre>;
    }

    function renderLogItem(task: AgentTask) {
        const info = AGENT_DISPLAY_INFO[task.agent_type] ?? { icon: '?', color: '#888' };
        const status = STATUS_DISPLAY[task.status] ?? { label: task.status, color: '#888' };
        const isExpanded = expandedLogId === task.id;

        return (
            <div
                key={task.id}
                className="agent-dash__log-item"
                onClick={() => setExpandedLogId(isExpanded ? null : task.id)}
                data-testid={`agent-log-${task.id}`}
            >
                <div className="agent-dash__log-top">
                    <div className="agent-dash__log-title">
                        <span>{info.icon}</span>
                        {task.agent_type.charAt(0).toUpperCase() + task.agent_type.slice(1)}
                        <span className={`agent-dash__badge agent-dash__badge--${task.status}`}>
                            {status.label}
                        </span>
                    </div>
                    <span className="agent-dash__log-time">{formatRelative(task.finished_at)}</span>
                </div>
                {isExpanded && (
                    <div className="agent-dash__log-details">
                        <div className="agent-dash__log-meta">
                            <span>Startad: {formatDateTime(task.started_at)}</span>
                            <span>Avslutad: {formatDateTime(task.finished_at)}</span>
                        </div>
                        {task.error_message && (
                            <div className="agent-dash__log-error">Fel: {task.error_message}</div>
                        )}
                        {task.ai_decision_id && <div>AI-beslut: {task.ai_decision_id.slice(0, 8)}...</div>}
                        {task.output_payload && renderOutputPayload(task.output_payload)}
                    </div>
                )}
            </div>
        );
    }

    return (
        <section className="agent-dash agent-dash--stagger" data-testid="agent-dashboard-root">
            <div className="agent-dash__header">
                <div>
                    <h3 className="agent-dash__title">AI-agenter</h3>
                    <p className="agent-dash__subtitle">
                        6 autonoma agenter som samarbetar via en task-kö. Starta manuellt eller schemalägga via cron.
                    </p>
                </div>
                <button
                    type="button"
                    className="agent-dash__refresh"
                    onClick={() => {
                        setLoading(true);
                        Promise.all([loadData(), loadSuites()]).finally(() => setLoading(false));
                    }}
                    disabled={loading}
                    data-testid="agent-dash-refresh"
                >
                    Uppdatera
                </button>
            </div>

            {error && (
                <div className="agent-dash__message agent-dash__message--error">{error}</div>
            )}

            {/* --- Section 1: Agentöversikt --- */}
            <section className="agent-dash__section" data-testid="agent-dash-overview">
                <div className="agent-dash__section-header">
                    <div>
                        <h4 className="agent-dash__section-title">Agentöversikt</h4>
                        <p className="agent-dash__section-subtitle">
                            Aktivera/inaktivera agenter och starta manuella körningar.
                        </p>
                    </div>
                </div>
                {agents.length === 0 && !loading ? (
                    <div className="agent-dash__empty">Inga agenter registrerade.</div>
                ) : (
                    <div className="agent-dash__agents-grid">
                        {agents.map((agent) => renderAgentCard(agent))}
                    </div>
                )}
            </section>

            {/* --- Section 2: Task-kö --- */}
            <section className="agent-dash__section" data-testid="agent-dash-queue">
                <div className="agent-dash__section-header">
                    <div>
                        <h4 className="agent-dash__section-title">Task-kö</h4>
                        <p className="agent-dash__section-subtitle">
                            Väntande och aktiva uppgifter. Uppdateras var 15:e sekund.
                        </p>
                    </div>
                    {queueTasks.length > 0 && (
                        <span className="agent-dash__badge agent-dash__badge--running">
                            {queueTasks.length} aktiva
                        </span>
                    )}
                </div>
                {queueTasks.length === 0 ? (
                    <div className="agent-dash__empty">Inga uppgifter i kö just nu.</div>
                ) : (
                    <div className="agent-dash__queue">
                        {queueTasks.map((task) => renderTaskRow(task, true))}
                    </div>
                )}
            </section>

            {/* --- Section 3: Aktivitetslogg --- */}
            <section className="agent-dash__section" data-testid="agent-dash-log">
                <div className="agent-dash__section-header">
                    <div>
                        <h4 className="agent-dash__section-title">Aktivitetslogg</h4>
                        <p className="agent-dash__section-subtitle">
                            Senaste avslutade körningar. Klicka för detaljer.
                        </p>
                    </div>
                </div>
                {recentTasks.length === 0 ? (
                    <div className="agent-dash__empty">Inga avslutade körningar ännu.</div>
                ) : (
                    <div className="agent-dash__queue">
                        {recentTasks.map((task) => renderLogItem(task))}
                    </div>
                )}
            </section>

            {/* --- Section 4: Testagenter (preserved from SkillsHubPanel) --- */}
            <section className="agent-dash__section" data-testid="agent-dash-test-agents">
                <div className="agent-dash__section-header">
                    <div>
                        <h4 className="agent-dash__section-title">Testagenter</h4>
                        <p className="agent-dash__section-subtitle">
                            Kör agentstyrda sviter (core, säkerhet, billing, guardian) direkt i plattformen.
                        </p>
                    </div>
                </div>

                <div className="skills-hub__grid">
                    <div className="skills-hub__card">
                        <h4>Kör testsvit</h4>
                        <div className="skills-hub__form">
                            <label>
                                Testsvit
                                <select
                                    value={selectedSuite}
                                    onChange={(event) =>
                                        setSelectedSuite(
                                            (event.target as HTMLSelectElement).value as TestSuiteId,
                                        )
                                    }
                                    data-testid="agent-dash-suite-select"
                                >
                                    {suites.map((suite) => (
                                        <option key={suite.id} value={suite.id}>
                                            {suite.label}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <div className="skills-hub__hint">
                                Kör i manuellt läge. Schemalagt läge triggas via GitHub Actions.
                            </div>
                            {suiteRunError && (
                                <div className="skills-hub__message skills-hub__message--error">
                                    {suiteRunError}
                                </div>
                            )}
                            <div className="skills-hub__actions">
                                <button
                                    type="button"
                                    onClick={() => void handleRunSuite()}
                                    disabled={suiteRunLoading || !selectedSuite}
                                    data-testid="agent-dash-run-suite"
                                >
                                    {suiteRunLoading ? 'Kör...' : 'Kör vald svit'}
                                </button>
                                <button
                                    type="button"
                                    className="skills-hub__secondary"
                                    onClick={() => void handleRunAllSuites()}
                                    disabled={suiteRunLoading}
                                    data-testid="agent-dash-run-all"
                                >
                                    Kör alla sviter
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="skills-hub__card" data-testid="agent-dash-last-suite-result">
                        <h4>Senaste agentkörning</h4>
                        {lastSuiteRun ? (
                            <div className="skills-hub__form">
                                <div className="skills-hub__selection">
                                    <span className="skills-hub__selection-label">Status</span>
                                    <span
                                        className={`skills-hub__badge skills-hub__badge--${lastSuiteRun.status}`}
                                    >
                                        {ORCHESTRATOR_STATUS_LABELS[lastSuiteRun.status] ||
                                            lastSuiteRun.status}
                                    </span>
                                </div>
                                <div className="skills-hub__hint">
                                    Passerade: {lastSuiteRun.summary.passed} • Misslyckade:{' '}
                                    {lastSuiteRun.summary.failed} •{' '}
                                    {Math.round(lastSuiteRun.summary.duration_ms)} ms
                                </div>
                            </div>
                        ) : (
                            <div className="skills-hub__empty">Ingen agentkörning ännu.</div>
                        )}
                    </div>
                </div>
            </section>

            {loading && <div className="agent-dash__loading">Laddar agentdata...</div>}
        </section>
    );
}

import { useEffect, useMemo, useState } from 'preact/hooks';
import { companyManager } from '../../services/CompanyService';
import { skillService } from '../../services/SkillService';
import { testOrchestratorService } from '../../services/TestOrchestratorService';
import { logger } from '../../services/LoggerService';
import type { SkillApproval, SkillDefinition, SkillRun } from '../../types/skills';
import type {
    TestOrchestratorRunResponse,
    TestSuiteDefinition,
    TestSuiteId,
} from '../../types/testOrchestrator';

const SKILL_STATUS_LABELS: Record<string, string> = {
    draft: 'Utkast',
    active: 'Aktiv',
    deprecated: 'Utfasad',
    archived: 'Arkiverad'
};

const RUN_STATUS_LABELS: Record<string, string> = {
    preview: 'Preview',
    pending_approval: 'Väntar godkännande',
    running: 'Körs',
    succeeded: 'Klar',
    failed: 'Misslyckades',
    cancelled: 'Avbruten'
};

const ORCHESTRATOR_STATUS_LABELS: Record<string, string> = {
    running: 'Körs',
    succeeded: 'Klar',
    failed: 'Misslyckades'
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const formatDateTime = (value?: string | null): string => {
    if (!value) return '—';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '—';
    return parsed.toLocaleString('sv-SE', { dateStyle: 'medium', timeStyle: 'short' });
};

const getOrchestratorRunMeta = (run: SkillRun): { suite: string; mode: string } | null => {
    const inputPayload = run.input_payload;
    if (!isRecord(inputPayload)) return null;
    if (inputPayload.agent_type !== 'test-orchestrator') return null;

    return {
        suite: typeof inputPayload.suite === 'string' ? inputPayload.suite : 'okänd',
        mode: typeof inputPayload.mode === 'string' ? inputPayload.mode : 'manual'
    };
};

const getSuiteLabel = (suites: TestSuiteDefinition[], suiteId: string): string => {
    return suites.find((suite) => suite.id === suiteId)?.label || suiteId;
};

export function SkillsHubPanel() {
    const [companyId, setCompanyId] = useState(companyManager.getCurrentId());
    const [skills, setSkills] = useState<SkillDefinition[]>([]);
    const [runs, setRuns] = useState<SkillRun[]>([]);
    const [approvals, setApprovals] = useState<SkillApproval[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [newName, setNewName] = useState('');
    const [newDescription, setNewDescription] = useState('');
    const [requiresApproval, setRequiresApproval] = useState(true);
    const [creating, setCreating] = useState(false);

    const [newSkillName, setNewSkillName] = useState('');
    const [newSkillDescription, setNewSkillDescription] = useState('');
    const [creatingSkill, setCreatingSkill] = useState(false);
    const [skillCreateError, setSkillCreateError] = useState<string | null>(null);

    const [runSkillId, setRunSkillId] = useState('');
    const [runError, setRunError] = useState<string | null>(null);
    const [creatingRun, setCreatingRun] = useState(false);
    const [lastRunId, setLastRunId] = useState<string | null>(null);

    const [suites, setSuites] = useState<TestSuiteDefinition[]>([]);
    const [selectedSuite, setSelectedSuite] = useState<TestSuiteId | ''>('core_ui');
    const [suiteRunLoading, setSuiteRunLoading] = useState(false);
    const [suiteRunError, setSuiteRunError] = useState<string | null>(null);
    const [lastSuiteRun, setLastSuiteRun] = useState<TestOrchestratorRunResponse | null>(null);

    const automationItems = useMemo(
        () => skills.filter((skill) => (skill.kind ?? 'automation') !== 'skill'),
        [skills]
    );

    const skillItems = useMemo(
        () => skills.filter((skill) => (skill.kind ?? 'automation') === 'skill'),
        [skills]
    );

    const selectedSkill = useMemo(
        () => skills.find((skill) => skill.id === runSkillId) || null,
        [skills, runSkillId]
    );

    const pendingApprovals = useMemo(
        () => approvals.filter((approval) => approval.status === 'pending'),
        [approvals]
    );

    const orchestratorRuns = useMemo(() => {
        return runs
            .map((run) => ({ run, meta: getOrchestratorRunMeta(run) }))
            .filter((entry): entry is { run: SkillRun; meta: { suite: string; mode: string } } => Boolean(entry.meta))
            .slice(0, 8);
    }, [runs]);

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
        if (!companyId) return;
        void loadAll();
        void loadSuites();
    }, [companyId]);

    async function loadAll() {
        setLoading(true);
        setError(null);
        try {
            const hub = await skillService.listHub(companyId);
            setSkills(hub.skills);
            setRuns(hub.runs);
            setApprovals(hub.approvals);
        } catch (loadError) {
            logger.warn('Failed to load skills hub data', loadError);
            setError('Vi kunde inte ansluta till Skills just nu. Prova att uppdatera.');
        } finally {
            setLoading(false);
        }
    }

    async function loadSuites() {
        try {
            const response = await testOrchestratorService.listSuites();
            setSuites(response.suites || []);

            if (!selectedSuite && response.suites?.[0]?.id) {
                setSelectedSuite(response.suites[0].id);
            }
        } catch (loadError) {
            logger.warn('Failed to load test suites', loadError);
            setSuiteRunError('Kunde inte läsa testsviter just nu.');
        }
    }

    async function handleRunSuite() {
        if (!selectedSuite) {
            setSuiteRunError('Välj en testsvit först.');
            return;
        }

        setSuiteRunLoading(true);
        setSuiteRunError(null);

        try {
            const result = await testOrchestratorService.runSuite(companyId, selectedSuite, 'manual');
            setLastSuiteRun(result);
            await loadAll();
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
            await loadAll();
        } catch (runError) {
            logger.warn('Failed to run all suites', runError);
            setSuiteRunError('Kunde inte köra alla testsviter.');
        } finally {
            setSuiteRunLoading(false);
        }
    }

    async function handleCreateSkill(event: Event) {
        event.preventDefault();
        if (!newName.trim()) {
            setError('Ange ett namn för automationen.');
            return;
        }

        setCreating(true);
        setError(null);
        try {
            await skillService.createSkill(companyId, {
                name: newName.trim(),
                description: newDescription.trim(),
                kind: 'automation',
                requires_approval: requiresApproval
            });

            setNewName('');
            setNewDescription('');
            await loadAll();
        } catch (createError) {
            logger.warn('Failed to create skill', createError);
            setError('Kunde inte skapa automationen.');
        } finally {
            setCreating(false);
        }
    }

    async function handleCreateSkillDefinition(event: Event) {
        event.preventDefault();
        if (!newSkillName.trim()) {
            setSkillCreateError('Ange ett namn för skillen.');
            return;
        }

        setCreatingSkill(true);
        setSkillCreateError(null);
        try {
            await skillService.createSkill(companyId, {
                name: newSkillName.trim(),
                description: newSkillDescription.trim(),
                kind: 'skill',
                status: 'active',
                requires_approval: false
            });

            setNewSkillName('');
            setNewSkillDescription('');
            await loadAll();
        } catch (createError) {
            logger.warn('Failed to create skill definition', createError);
            setSkillCreateError('Kunde inte skapa skillen.');
        } finally {
            setCreatingSkill(false);
        }
    }

    async function handleCreateRun() {
        if (!runSkillId) {
            setRunError('Välj en automation att köra.');
            return;
        }

        setCreatingRun(true);
        setRunError(null);

        try {
            const run = await skillService.createRun(companyId, runSkillId, {
                input_payload: {},
                preview_output: null,
                status: 'preview',
                triggered_by: 'user'
            });

            setLastRunId(run.id);
            await loadAll();
        } catch (nextRunError) {
            logger.warn('Failed to create skill run', nextRunError);
            setRunError('Kunde inte skapa testkörningen.');
        } finally {
            setCreatingRun(false);
        }
    }

    async function handleRequestApproval() {
        if (!lastRunId) {
            setRunError('Skapa en testkörning först.');
            return;
        }

        setCreatingRun(true);
        setRunError(null);
        try {
            await skillService.requestApproval(lastRunId, {});
            await loadAll();
        } catch (approvalError) {
            logger.warn('Failed to request approval', approvalError);
            setRunError('Kunde inte begära godkännande.');
        } finally {
            setCreatingRun(false);
        }
    }

    async function handleApprove(approvalId: string) {
        try {
            await skillService.approveRun(approvalId, {});
            await loadAll();
        } catch (approvalError) {
            logger.warn('Failed to approve run', approvalError);
            setError('Kunde inte godkänna körningen.');
        }
    }

    async function handleReject(approvalId: string) {
        try {
            await skillService.rejectRun(approvalId, {});
            await loadAll();
        } catch (approvalError) {
            logger.warn('Failed to reject run', approvalError);
            setError('Kunde inte avvisa körningen.');
        }
    }

    return (
        <section className="skills-hub skills-hub--stagger" data-testid="skills-hub-root">
            <div className="skills-hub__header">
                <div>
                    <h3 className="skills-hub__title">Skills & Automationer</h3>
                    <p className="skills-hub__subtitle">
                        Hantera byggklossar (skills), automationer och autonoma testagenter per bolag.
                    </p>
                </div>
                <button
                    type="button"
                    className="skills-hub__refresh"
                    onClick={() => {
                        void loadAll();
                        void loadSuites();
                    }}
                    disabled={loading}
                    data-testid="skills-hub-refresh"
                >
                    Uppdatera
                </button>
            </div>

            {error && (
                <div className="skills-hub__message skills-hub__message--error">{error}</div>
            )}

            <section className="skills-hub__section" data-testid="skills-hub-test-agents">
                <div className="skills-hub__section-header">
                    <div>
                        <h4 className="skills-hub__section-title">Testagenter</h4>
                        <p className="skills-hub__section-subtitle">
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
                                    onChange={(event) => setSelectedSuite((event.target as HTMLSelectElement).value as TestSuiteId)}
                                    data-testid="skills-hub-suite-select"
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
                                <div className="skills-hub__message skills-hub__message--error" data-testid="skills-hub-suite-error">
                                    {suiteRunError}
                                </div>
                            )}
                            <div className="skills-hub__actions">
                                <button
                                    type="button"
                                    onClick={() => void handleRunSuite()}
                                    disabled={suiteRunLoading || !selectedSuite}
                                    data-testid="skills-hub-run-suite"
                                >
                                    {suiteRunLoading ? 'Kör...' : 'Kör vald svit'}
                                </button>
                                <button
                                    type="button"
                                    className="skills-hub__secondary"
                                    onClick={() => void handleRunAllSuites()}
                                    disabled={suiteRunLoading}
                                    data-testid="skills-hub-run-all"
                                >
                                    Kör alla sviter
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="skills-hub__card" data-testid="skills-hub-last-suite-result">
                        <h4>Senaste agentkörning</h4>
                        {lastSuiteRun ? (
                            <div className="skills-hub__form">
                                <div className="skills-hub__selection">
                                    <span className="skills-hub__selection-label">Status</span>
                                    <span className={`skills-hub__badge skills-hub__badge--${lastSuiteRun.status}`}>
                                        {ORCHESTRATOR_STATUS_LABELS[lastSuiteRun.status] || lastSuiteRun.status}
                                    </span>
                                </div>
                                <div className="skills-hub__hint" data-testid="skills-hub-last-summary">
                                    Passerade: {lastSuiteRun.summary.passed} • Misslyckade: {lastSuiteRun.summary.failed} • {Math.round(lastSuiteRun.summary.duration_ms)} ms
                                </div>
                            </div>
                        ) : (
                            <div className="skills-hub__empty">Ingen agentkörning ännu.</div>
                        )}
                    </div>
                </div>

                <div className="skills-hub__list">
                    <div className="skills-hub__list-header">
                        <h4>Agentkörningar i historik</h4>
                    </div>
                    {orchestratorRuns.length === 0 ? (
                        <div className="skills-hub__empty">Inga orchestrator-körningar sparade än.</div>
                    ) : (
                        <div className="skills-hub__items">
                            {orchestratorRuns.map(({ run, meta }) => (
                                <div key={run.id} className="skills-hub__item" data-testid={`skills-hub-orchestrator-run-${run.id}`}>
                                    <div>
                                        <div className="skills-hub__item-title">
                                            {getSuiteLabel(suites, meta.suite)}
                                        </div>
                                        <div className="skills-hub__item-subtitle">
                                            {RUN_STATUS_LABELS[run.status] || run.status} • {meta.mode} • {formatDateTime(run.created_at)}
                                        </div>
                                    </div>
                                    <span className={`skills-hub__badge skills-hub__badge--${run.status}`}>
                                        {RUN_STATUS_LABELS[run.status] || run.status}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </section>

            <section className="skills-hub__section">
                <div className="skills-hub__section-header">
                    <div>
                        <h4 className="skills-hub__section-title">Skills</h4>
                        <p className="skills-hub__section-subtitle">
                            Byggklossar som automationer använder i bakgrunden.
                        </p>
                    </div>
                </div>
                <div className="skills-hub__skills-grid">
                    <div className="skills-hub__skill-card skills-hub__skill-card--create">
                        <h5>Ny skill</h5>
                        <form onSubmit={handleCreateSkillDefinition} className="skills-hub__form">
                            <label>
                                Namn
                                <input
                                    type="text"
                                    value={newSkillName}
                                    onInput={(event) => setNewSkillName((event.target as HTMLInputElement).value)}
                                    placeholder="T.ex. Moms-kontroll"
                                    required
                                    data-testid="skills-hub-create-skill-name"
                                />
                            </label>
                            <label>
                                Beskrivning
                                <textarea
                                    value={newSkillDescription}
                                    onInput={(event) => setNewSkillDescription((event.target as HTMLTextAreaElement).value)}
                                    placeholder="Kort beskrivning av vad skillen gör."
                                    rows={3}
                                    data-testid="skills-hub-create-skill-description"
                                />
                            </label>
                            {skillCreateError && (
                                <div className="skills-hub__message skills-hub__message--error">
                                    {skillCreateError}
                                </div>
                            )}
                            <button type="submit" disabled={creatingSkill} data-testid="skills-hub-create-skill-submit">
                                {creatingSkill ? 'Skapar...' : 'Skapa skill'}
                            </button>
                        </form>
                    </div>
                    {skillItems.length === 0 ? (
                        <div className="skills-hub__empty">Inga skills ännu.</div>
                    ) : (
                        skillItems.map((skill) => (
                            <div key={skill.id} className="skills-hub__skill-card">
                                <div className="skills-hub__skill-avatar">{skill.name.slice(0, 1)}</div>
                                <div className="skills-hub__skill-content">
                                    <div className="skills-hub__skill-title">{skill.name}</div>
                                    <div className="skills-hub__skill-subtitle">
                                        {skill.description || 'Ingen beskrivning'}
                                    </div>
                                </div>
                                <span className={`skills-hub__badge skills-hub__badge--${skill.status}`}>
                                    {SKILL_STATUS_LABELS[skill.status] || skill.status}
                                </span>
                            </div>
                        ))
                    )}
                </div>
            </section>

            <section className="skills-hub__section">
                <div className="skills-hub__section-header">
                    <div>
                        <h4 className="skills-hub__section-title">Automationer</h4>
                        <p className="skills-hub__section-subtitle">
                            Skapa och godkänn automationer för bokföringsflöden.
                        </p>
                    </div>
                </div>

                <div className="skills-hub__grid">
                    <div className="skills-hub__card">
                        <h4>Ny automation</h4>
                        <form onSubmit={handleCreateSkill} className="skills-hub__form">
                            <label>
                                Namn
                                <input
                                    type="text"
                                    value={newName}
                                    onInput={(event) => setNewName((event.target as HTMLInputElement).value)}
                                    placeholder="Momsrapport"
                                    required
                                    data-testid="skills-hub-create-automation-name"
                                />
                            </label>
                            <label>
                                Beskrivning
                                <textarea
                                    value={newDescription}
                                    onInput={(event) => setNewDescription((event.target as HTMLTextAreaElement).value)}
                                    placeholder="Beskriv vad som ska hända och när."
                                    rows={3}
                                    data-testid="skills-hub-create-automation-description"
                                />
                            </label>
                            <label className="skills-hub__checkbox">
                                <input
                                    type="checkbox"
                                    checked={requiresApproval}
                                    onChange={(event) => setRequiresApproval((event.target as HTMLInputElement).checked)}
                                    data-testid="skills-hub-create-automation-requires-approval"
                                />
                                Kräver godkännande
                            </label>
                            <button type="submit" disabled={creating} data-testid="skills-hub-create-automation-submit">
                                {creating ? 'Skapar...' : 'Skapa automation'}
                            </button>
                        </form>
                    </div>

                    <div className="skills-hub__card">
                        <h4>Testkörning</h4>
                        <div className="skills-hub__form">
                            <label>
                                Välj automation
                                <select
                                    value={runSkillId}
                                    onChange={(event) => setRunSkillId((event.target as HTMLSelectElement).value)}
                                    data-testid="skills-hub-run-select"
                                >
                                    <option value="">Välj automation...</option>
                                    {automationItems.map((skill) => (
                                        <option key={skill.id} value={skill.id}>
                                            {skill.name}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <div className="skills-hub__hint">Vi testar med standarddata utan tekniska inställningar.</div>
                            {selectedSkill && (
                                <div className="skills-hub__selection">
                                    <span className="skills-hub__selection-label">Vald automation</span>
                                    <span className={`skills-hub__badge skills-hub__badge--${selectedSkill.status}`}>
                                        {selectedSkill.name} • {SKILL_STATUS_LABELS[selectedSkill.status] || selectedSkill.status}
                                    </span>
                                </div>
                            )}
                            {runError && (
                                <div className="skills-hub__message skills-hub__message--error">{runError}</div>
                            )}
                            <div className="skills-hub__actions">
                                <button type="button" onClick={() => void handleCreateRun()} disabled={creatingRun} data-testid="skills-hub-create-run">
                                    {creatingRun ? 'Skapar...' : 'Skapa testkörning'}
                                </button>
                                <button
                                    type="button"
                                    className="skills-hub__secondary"
                                    onClick={() => void handleRequestApproval()}
                                    disabled={creatingRun || !lastRunId}
                                    data-testid="skills-hub-request-approval"
                                >
                                    Begär godkännande
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="skills-hub__list">
                    <div className="skills-hub__list-header">
                        <h4>Automationer ({automationItems.length})</h4>
                    </div>
                    {automationItems.length === 0 ? (
                        <div className="skills-hub__empty">Inga automationer ännu. Skapa den första ovan.</div>
                    ) : (
                        <div className="skills-hub__items">
                            {automationItems.map((skill) => (
                                <div key={skill.id} className="skills-hub__item">
                                    <div>
                                        <div className="skills-hub__item-title">{skill.name}</div>
                                        <div className="skills-hub__item-subtitle">{skill.description || 'Ingen beskrivning'}</div>
                                    </div>
                                    <div className="skills-hub__item-badges">
                                        <span className={`skills-hub__badge skills-hub__badge--${skill.status}`}>
                                            {SKILL_STATUS_LABELS[skill.status] || skill.status}
                                        </span>
                                        {skill.requires_approval && (
                                            <span className="skills-hub__badge skills-hub__badge--approval">Godkännande</span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="skills-hub__list">
                    <div className="skills-hub__list-header">
                        <h4>Godkännanden ({pendingApprovals.length})</h4>
                    </div>
                    {pendingApprovals.length === 0 ? (
                        <div className="skills-hub__empty">Inga väntande godkännanden.</div>
                    ) : (
                        <div className="skills-hub__items">
                            {pendingApprovals.map((approval) => (
                                <div key={approval.id} className="skills-hub__item">
                                    <div>
                                        <div className="skills-hub__item-title">Körning {approval.run_id.slice(0, 8)}</div>
                                        <div className="skills-hub__item-subtitle">
                                            Kräver {approval.required_role} • {formatDateTime(approval.created_at)}
                                        </div>
                                    </div>
                                    <div className="skills-hub__actions">
                                        <button type="button" onClick={() => void handleApprove(approval.id)} data-testid={`skills-hub-approve-${approval.id}`}>Godkänn</button>
                                        <button type="button" className="skills-hub__secondary" onClick={() => void handleReject(approval.id)} data-testid={`skills-hub-reject-${approval.id}`}>Avvisa</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="skills-hub__list">
                    <div className="skills-hub__list-header">
                        <h4>Senaste testkörningar</h4>
                    </div>
                    {runs.length === 0 ? (
                        <div className="skills-hub__empty">Inga körningar än.</div>
                    ) : (
                        <div className="skills-hub__items">
                            {runs.slice(0, 6).map((run) => (
                                <div key={run.id} className="skills-hub__item">
                                    <div>
                                        <div className="skills-hub__item-title">Run {run.id.slice(0, 8)}</div>
                                        <div className="skills-hub__item-subtitle">
                                            {RUN_STATUS_LABELS[run.status] || run.status} • {formatDateTime(run.created_at)}
                                        </div>
                                    </div>
                                    <span className={`skills-hub__badge skills-hub__badge--${run.status}`}>
                                        {RUN_STATUS_LABELS[run.status] || run.status}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {loading && (
                    <div className="skills-hub__loading">Laddar skills...</div>
                )}
            </section>
        </section>
    );
}

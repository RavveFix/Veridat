import { useEffect, useMemo, useState } from 'preact/hooks';
import { companyManager } from '../../services/CompanyService';
import { skillService } from '../../services/SkillService';
import { logger } from '../../services/LoggerService';
import type { SkillApproval, SkillDefinition, SkillRun } from '../../types/skills';

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

const formatDateTime = (value?: string | null): string => {
    if (!value) return '—';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '—';
    return parsed.toLocaleString('sv-SE', { dateStyle: 'medium', timeStyle: 'short' });
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

    const [runSkillId, setRunSkillId] = useState('');
    const [runError, setRunError] = useState<string | null>(null);
    const [creatingRun, setCreatingRun] = useState(false);
    const [lastRunId, setLastRunId] = useState<string | null>(null);

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
    }, [companyId]);

    const pendingApprovals = useMemo(() => approvals.filter((approval) => approval.status === 'pending'), [approvals]);

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
        } catch (runError) {
            logger.warn('Failed to create skill run', runError);
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
        <section className="skills-hub">
            <div className="skills-hub__header">
                <div>
                    <h3 className="skills-hub__title">Skills & Automationer</h3>
                    <p className="skills-hub__subtitle">
                        Hantera byggklossar (skills) och automationer för bokföringsflöden. Allt loggas per bolag.
                    </p>
                </div>
                <button
                    type="button"
                    className="skills-hub__refresh"
                    onClick={() => void loadAll()}
                    disabled={loading}
                >
                    Uppdatera
                </button>
            </div>

            {error && (
                <div className="skills-hub__message skills-hub__message--error">{error}</div>
            )}

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
                                />
                            </label>
                            <label>
                                Beskrivning
                                <textarea
                                    value={newSkillDescription}
                                    onInput={(event) => setNewSkillDescription((event.target as HTMLTextAreaElement).value)}
                                    placeholder="Kort beskrivning av vad skillen gör."
                                    rows={3}
                                />
                            </label>
                            {skillCreateError && (
                                <div className="skills-hub__message skills-hub__message--error">
                                    {skillCreateError}
                                </div>
                            )}
                            <button type="submit" disabled={creatingSkill}>
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
                            />
                        </label>
                        <label>
                            Beskrivning
                            <textarea
                                value={newDescription}
                                onInput={(event) => setNewDescription((event.target as HTMLTextAreaElement).value)}
                                placeholder="Beskriv vad som ska hända och när."
                                rows={3}
                            />
                        </label>
                        <label className="skills-hub__checkbox">
                            <input
                                type="checkbox"
                                checked={requiresApproval}
                                onChange={(event) => setRequiresApproval((event.target as HTMLInputElement).checked)}
                            />
                            Kräver godkännande
                        </label>
                        <button type="submit" disabled={creating}>
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
                            <button type="button" onClick={() => void handleCreateRun()} disabled={creatingRun}>
                                {creatingRun ? 'Skapar...' : 'Skapa testkörning'}
                            </button>
                            <button
                                type="button"
                                className="skills-hub__secondary"
                                onClick={() => void handleRequestApproval()}
                                disabled={creatingRun || !lastRunId}
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
                                    <button type="button" onClick={() => void handleApprove(approval.id)}>Godkänn</button>
                                    <button type="button" className="skills-hub__secondary" onClick={() => void handleReject(approval.id)}>Avvisa</button>
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

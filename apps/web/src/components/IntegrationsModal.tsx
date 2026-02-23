/**
 * IntegrationsModal
 *
 * Modal for managing third-party integrations like Fortnox.
 * Designed to be extensible for multiple integration providers.
 */

import type { ComponentChildren } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { supabase } from '../lib/supabase';
import type { Integration, IntegrationStatus } from '../types/integrations';
import { withTimeout, TimeoutError } from '../utils/asyncTimeout';
import { logger } from '../services/LoggerService';
import { isFortnoxEligible, normalizeUserPlan, type UserPlan } from '../services/PlanGateService';
import { fortnoxContextService } from '../services/FortnoxContextService';
import { companyService } from '../services/CompanyService';
import { ModalWrapper } from './ModalWrapper';

interface IntegrationsModalProps {
    onClose: () => void;
}

// Integration definitions - easily extensible
const INTEGRATIONS_CONFIG: Omit<Integration, 'status'>[] = [
    {
        id: 'fortnox',
        name: 'Fortnox',
        description: 'Bokföringssystem för fakturering och redovisning',
        icon: 'fortnox'
    },
    {
        id: 'visma',
        name: 'Visma',
        description: 'Ekonomisystem och lönesystem',
        icon: 'visma'
    },
    {
        id: 'bankid',
        name: 'BankID',
        description: 'Elektronisk identifiering',
        icon: 'bankid'
    }
];

// Which integrations are available vs coming soon
const AVAILABLE_INTEGRATIONS = ['fortnox'];

// ---------------------------------------------------------------------------
// Integration icon mapping
// ---------------------------------------------------------------------------

const ICON_MAP: Record<string, { letter: string; className: string }> = {
    fortnox: { letter: 'F', className: 'integ-icon integ-icon--fortnox' },
    visma: { letter: 'V', className: 'integ-icon integ-icon--visma' },
    bankid: { letter: 'B', className: 'integ-icon integ-icon--bankid' },
};

const STATUS_CLASS_MAP: Record<IntegrationStatus, string> = {
    connected: 'integ-badge--connected',
    disconnected: 'integ-badge--disconnected',
    connecting: 'integ-badge--connecting',
    error: 'integ-badge--error',
    coming_soon: 'integ-badge--coming-soon',
};

const STATUS_TEXT_MAP: Record<IntegrationStatus, string> = {
    connected: 'Ansluten',
    disconnected: 'Ej ansluten',
    connecting: 'Ansluter...',
    error: 'Fel',
    coming_soon: 'Kommer snart',
};

const UPGRADE_TO_PRO_MAILTO =
    'mailto:hej@veridat.se?subject=Uppgradera%20till%20Pro&body=Hej%2C%0A%0AJag%20vill%20uppgradera%20till%20Pro%20och%20aktivera%20Fortnox-integration.%0A%0AMvh';

const FORTNOX_RECONNECT_BANNER = {
    testId: 'fortnox-reconnect-banner',
    message: 'Fortnox är inte kopplat för det aktiva bolaget. Anslut på nytt för att återaktivera Fortnox-verktygen.',
} as const;

const INTEGRATIONS_INFO_CARD = {
    title: 'Hur fungerar det?',
    message:
        'När du ansluter Fortnox kan Veridat automatiskt skapa fakturor, hämta kunder och artiklar, samt synka bokföringsdata. All kommunikation sker säkert via Fortnox officiella API.',
} as const;

const FORTNOX_RECONNECT_BANNER_STYLE = {
    padding: '0.9rem 1rem',
    borderRadius: '10px',
    border: '1px solid rgba(59, 130, 246, 0.3)',
    background: 'rgba(59, 130, 246, 0.08)',
    color: 'var(--text-secondary)',
    fontSize: '0.85rem',
    lineHeight: 1.5,
} as const;

const INTEGRATIONS_MODAL_BODY_STYLE = {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem',
} as const;

const INTEGRATIONS_LOADING_STYLE = {
    textAlign: 'center',
    padding: '2rem',
} as const;

const INTEGRATIONS_LOADING_TIMEOUT_STYLE = {
    fontSize: '0.85rem',
    color: 'var(--accent-primary)',
    marginTop: '0.5rem',
} as const;

const INTEGRATIONS_LIST_GRID_STYLE = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
    gap: '0.75rem',
    marginTop: '0.75rem',
} as const;

const INTEGRATIONS_INFO_CARD_TITLE_STYLE = {
    margin: '0 0 0.4rem',
    fontSize: '0.78rem',
} as const;

const INTEGRATIONS_INFO_CARD_TEXT_STYLE = {
    margin: 0,
    fontSize: '0.82rem',
    color: 'var(--text-secondary)',
    lineHeight: 1.5,
} as const;

const INTEGRATION_CONNECTION_CARD_BASE_STYLE = {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
} as const;

const INTEGRATION_CONNECTION_CONTENT_STYLE = {
    flex: 1,
    minWidth: 0,
} as const;

const INTEGRATION_CONNECTION_HEADER_ROW_STYLE = {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    marginBottom: '0.25rem',
} as const;

const INTEGRATION_CONNECTION_NAME_STYLE = {
    fontWeight: 700,
    color: 'var(--text-primary)',
    fontSize: '0.95rem',
    fontFamily: 'var(--font-display)',
} as const;

const INTEGRATION_CONNECTION_DESCRIPTION_STYLE = {
    margin: 0,
    color: 'var(--text-secondary)',
    fontSize: '0.8rem',
    lineHeight: 1.4,
} as const;

const INTEGRATION_CONNECTION_DATE_STYLE = {
    margin: '0.4rem 0 0',
    color: 'var(--text-secondary)',
    fontSize: '0.72rem',
} as const;

const INTEGRATION_CONNECTION_ACTION_STYLE = {
    flexShrink: 0,
} as const;

const MODAL_ERROR_BOX_STYLE = {
    padding: '0.8rem',
    borderRadius: '8px',
    background: 'var(--status-danger-bg)',
    color: 'var(--status-danger)',
    border: '1px solid var(--status-danger-border)',
    fontSize: '0.9rem'
} as const;

const MODAL_LOADING_SPINNER_STYLE = {
    margin: '0 auto 1rem'
} as const;

function getIntegrationConnectionCardStyle(isComingSoon: boolean) {
    return {
        ...INTEGRATION_CONNECTION_CARD_BASE_STYLE,
        opacity: isComingSoon ? 0.6 : 1,
    } as const;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface InlineNoticeBannerProps {
    message: string;
    style: {
        padding: string;
        borderRadius: string;
        border: string;
        background: string;
        color: string;
        fontSize: string;
        lineHeight: number;
    };
    testId?: string;
}

function InlineNoticeBanner({ message, style, testId }: InlineNoticeBannerProps) {
    return (
        <div data-testid={testId} style={style}>
            {message}
        </div>
    );
}

function IntegrationsInfoCard() {
    return (
        <div className="panel-card panel-card--no-hover integ-info-card">
            <div className="integ-info-card__icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
            </div>
            <div>
                <h4 className="panel-label" style={INTEGRATIONS_INFO_CARD_TITLE_STYLE}>
                    {INTEGRATIONS_INFO_CARD.title}
                </h4>
                <p style={INTEGRATIONS_INFO_CARD_TEXT_STYLE}>
                    {INTEGRATIONS_INFO_CARD.message}
                </p>
            </div>
        </div>
    );
}

interface IntegrationIconGlyph {
    letter: string;
    className: string;
}

interface IntegrationConnectionCardProps {
    integration: Integration;
    icon: IntegrationIconGlyph;
    isComingSoon: boolean;
    isConnected: boolean;
    statusBadge: ComponentChildren;
    action?: ComponentChildren;
}

function IntegrationConnectionCard({
    integration,
    icon,
    isComingSoon,
    isConnected,
    statusBadge,
    action,
}: IntegrationConnectionCardProps) {
    return (
        <div
            data-testid={`integration-card-${integration.id}`}
            className={`panel-card ${isComingSoon ? 'panel-card--no-hover' : 'panel-card--interactive'} ${isConnected ? 'integ-card--connected' : ''}`}
            style={getIntegrationConnectionCardStyle(isComingSoon)}
        >
            <div className={icon.className}>{icon.letter}</div>

            <div style={INTEGRATION_CONNECTION_CONTENT_STYLE}>
                <div style={INTEGRATION_CONNECTION_HEADER_ROW_STYLE}>
                    <span style={INTEGRATION_CONNECTION_NAME_STYLE}>
                        {integration.name}
                    </span>
                    {statusBadge}
                </div>
                <p style={INTEGRATION_CONNECTION_DESCRIPTION_STYLE}>
                    {integration.description}
                </p>
                {integration.connectedAt && (
                    <p style={INTEGRATION_CONNECTION_DATE_STYLE}>
                        Ansluten {new Date(integration.connectedAt).toLocaleDateString('sv-SE')}
                    </p>
                )}
            </div>

            {!isComingSoon && action && (
                <div style={INTEGRATION_CONNECTION_ACTION_STYLE}>
                    {action}
                </div>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function IntegrationsModal({ onClose }: IntegrationsModalProps) {
    const [integrations, setIntegrations] = useState<Integration[]>([]);
    const [loading, setLoading] = useState(true);
    const [connecting, setConnecting] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const [loadingTimeout, setLoadingTimeout] = useState(false);
    const [userPlan, setUserPlan] = useState<UserPlan>('free');
    const [activeCompanyId, setActiveCompanyId] = useState<string | null>(() => {
        try {
            return companyService.getCurrentId();
        } catch {
            return null;
        }
    });
    const isFortnoxPlanEligible = isFortnoxEligible(userPlan);
    const [disconnectConfirm, setDisconnectConfirm] = useState<string | null>(null);

    async function getSessionAccessToken(): Promise<string | null> {
        const { data: { session } } = await supabase.auth.getSession();
        return session?.access_token ?? null;
    }

    function buildAuthHeaders(accessToken: string): Record<string, string> {
        return {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`
        };
    }

    function getActiveCompanyId(): string | null {
        if (activeCompanyId) return activeCompanyId;
        try {
            return companyService.getCurrentId();
        } catch {
            return null;
        }
    }

    function refreshCompanyScope(): string | null {
        let companyId: string | null = null;
        try {
            companyId = companyService.getCurrentId();
        } catch {
            companyId = null;
        }
        setActiveCompanyId(companyId);
        return companyId;
    }

    async function postAuthedFunction(
        functionName: 'fortnox' | 'fortnox-oauth',
        accessToken: string,
        body: Record<string, unknown>
    ): Promise<Response> {
        return fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${functionName}`,
            {
                method: 'POST',
                headers: buildAuthHeaders(accessToken),
                body: JSON.stringify(body)
            }
        );
    }

    useEffect(() => {
        const handler = () => {
            const companyId = refreshCompanyScope();
            void loadIntegrationStatus(companyId);
        };

        window.addEventListener('company-changed', handler as EventListener);
        return () => window.removeEventListener('company-changed', handler as EventListener);
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        abortControllerRef.current = controller;

        const companyId = refreshCompanyScope() ?? getActiveCompanyId();
        void loadIntegrationStatus(companyId);

        // Show "taking longer than usual" after 5 seconds
        const feedbackTimeout = setTimeout(() => {
            setLoadingTimeout(true);
        }, 5000);

        // Cleanup: abort pending requests and clear timeout
        return () => {
            controller.abort();
            clearTimeout(feedbackTimeout);
            abortControllerRef.current = null;
        };
    }, []);

    async function loadIntegrationStatus(companyIdOverride?: string | null) {
        setLoading(true);
        setError(null);


        try {
            const companyId = companyIdOverride ?? getActiveCompanyId();
            if (!companyId) {
                setUserPlan('free');

                setError('Välj ett aktivt bolag för att hantera Fortnox-kopplingen.');
                setLoading(false);
                return;
            }

            // Check Fortnox connection status with timeout (10s for auth)
            const { data: { user } } = await withTimeout(
                supabase.auth.getUser(),
                10000,
                'Tidsgräns för autentisering'
            );

            if (!user) {
                setUserPlan('free');

                setError('Du måste vara inloggad för att hantera integreringar.');
                setLoading(false);
                return;
            }

            const profileQuery = supabase
                .from('profiles')
                .select('plan')
                .eq('id', user.id)
                .maybeSingle();

            const { data: profile, error: profileError } = await withTimeout(
                profileQuery,
                10000,
                'Tidsgräns för att hämta abonnemang'
            );

            if (profileError) {
                logger.error('Error checking plan status:', profileError);
            }

            const normalizedProfile = profile as { plan?: unknown } | null;
            const plan = normalizeUserPlan(normalizedProfile?.plan);
            const fortnoxAllowed = isFortnoxEligible(plan);
            setUserPlan(plan);

            // Check if user has Fortnox tokens with timeout (10s for DB query)
            const fortnoxQuery = supabase
                .from('fortnox_tokens')
                .select('created_at, expires_at')
                .eq('user_id', user.id)
                .eq('company_id', companyId)
                .maybeSingle();

            const { data: fortnoxTokens, error: tokenError } = await withTimeout(
                fortnoxQuery,
                10000,
                'Tidsgräns för att hämta Fortnox-status'
            );

            if (tokenError && tokenError.code !== 'PGRST116') {
                logger.error('Error checking Fortnox status:', tokenError);
            }

            // Fire-and-forget: sync Fortnox profile to memory on connection
            if (fortnoxAllowed && fortnoxTokens && user) {
                void (async () => {
                    const accessToken = await getSessionAccessToken();
                    if (!accessToken) return;
                    await postAuthedFunction('fortnox', accessToken, { action: 'sync_profile', companyId });
                })().catch((err) => logger.warn('Fortnox profile sync skipped:', err));
            }

            // Build integrations list with status
            const integrationsWithStatus: Integration[] = INTEGRATIONS_CONFIG.map(config => {
                let status: IntegrationStatus = 'coming_soon';
                let statusMessage: string | undefined;
                let connectedAt: string | undefined;

                if (AVAILABLE_INTEGRATIONS.includes(config.id)) {
                    if (config.id === 'fortnox') {
                        if (!fortnoxAllowed) {
                            status = fortnoxTokens ? 'connected' : 'disconnected';
                            statusMessage = 'Kräver Pro';
                            connectedAt = fortnoxTokens?.created_at ?? undefined;
                        } else if (fortnoxTokens) {
                            status = 'connected';
                            connectedAt = fortnoxTokens.created_at ?? undefined;
                        } else {
                            status = 'disconnected';
                        }
                    } else {
                        status = 'disconnected';
                    }
                } else {
                    statusMessage = 'Kommer snart';
                }

                return {
                    ...config,
                    status,
                    statusMessage,
                    connectedAt: connectedAt || undefined
                };
            });

            setIntegrations(integrationsWithStatus);
        } catch (err) {
            logger.error('Error loading integrations:', err);
            setUserPlan('free');

            // Check if component was aborted (unmounted)
            if (abortControllerRef.current?.signal.aborted) {
                return; // Don't show error if user closed modal
            }

            // Specific handling for timeout errors
            if (err instanceof TimeoutError) {
                setError('Tidsgränsen nåddes. Kontrollera din internetanslutning och försök igen.');
            } else {
                setError('Kunde inte ladda integreringar. Försök igen.');
            }
        } finally {
            setLoading(false);
        }
    }

    async function handleConnect(integrationId: string) {
        if (integrationId !== 'fortnox') {
            return; // Only Fortnox is implemented
        }

        const companyId = getActiveCompanyId();
        if (!companyId) {
            setError('Välj ett aktivt bolag innan du ansluter Fortnox.');
            return;
        }

        if (!isFortnoxPlanEligible) {
            setError('Fortnox kräver Veridat Pro eller Trial.');
            return;
        }

        setConnecting(integrationId);
        setError(null);

        try {
            // Get the OAuth authorization URL from our Edge Function
            const accessToken = await withTimeout(
                getSessionAccessToken(),
                10000,
                'Tidsgräns för sessionshämtning'
            );

            if (!accessToken) {
                throw new Error('Not authenticated');
            }

            const response = await withTimeout(
                postAuthedFunction('fortnox-oauth', accessToken, { action: 'initiate', companyId }),
                15000, // Edge function may take longer
                'Tidsgräns för Fortnox-anslutning'
            );

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({})) as { errorCode?: string; error?: string };
                if (errorData.errorCode === 'PLAN_REQUIRED' || errorData.error === 'plan_required') {
                    throw new Error('Fortnox kräver Veridat Pro eller Trial.');
                }
                if (errorData.errorCode === 'COMPANY_ORG_REQUIRED' || errorData.error === 'company_org_required') {
                    throw new Error('Bolaget måste ha organisationsnummer innan Fortnox kan anslutas.');
                }
                if (errorData.errorCode === 'COMPANY_NOT_FOUND' || errorData.error === 'company_not_found') {
                    throw new Error('Det aktiva bolaget hittades inte. Uppdatera sidan och försök igen.');
                }
                if (errorData.errorCode === 'MISSING_COMPANY_ID') {
                    throw new Error('Bolagskontext saknas. Försök igen.');
                }
                throw new Error(errorData.error || 'Failed to initiate OAuth');
            }

            const { authorizationUrl } = await response.json();

            // Redirect to Fortnox OAuth
            window.location.href = authorizationUrl;
        } catch (err) {
            logger.error('Error connecting to Fortnox:', err);

            if (err instanceof TimeoutError) {
                setError('Tidsgränsen nåddes vid anslutning. Försök igen.');
            } else {
                setError(err instanceof Error ? err.message : 'Kunde inte ansluta till Fortnox.');
            }
            setConnecting(null);
        }
    }

    function handleDisconnect(integrationId: string) {
        if (integrationId !== 'fortnox') return;
        const companyId = getActiveCompanyId();
        if (!companyId) {
            setError('Välj ett aktivt bolag innan du kopplar bort Fortnox.');
            return;
        }
        setDisconnectConfirm(integrationId);
    }

    async function doDisconnect() {
        const integrationId = disconnectConfirm;
        setDisconnectConfirm(null);
        if (!integrationId) return;

        const companyId = getActiveCompanyId();
        if (!companyId) return;

        setConnecting(integrationId);
        setError(null);

        try {
            const accessToken = await withTimeout(
                getSessionAccessToken(),
                10000,
                'Tidsgräns för sessionshämtning'
            );

            if (!accessToken) throw new Error('Not authenticated');

            const response = await withTimeout(
                postAuthedFunction('fortnox-oauth', accessToken, {
                    action: 'disconnect',
                    companyId,
                }),
                10000,
                'Tidsgräns för bortkoppling'
            );

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({})) as { error?: string };
                throw new Error(errorData.error || 'Kunde inte koppla bort Fortnox.');
            }

            // Refresh modal list + notify FortnoxPanel via service
            await loadIntegrationStatus(companyId);
            void fortnoxContextService.checkConnection();
        } catch (err) {
            logger.error('Error disconnecting Fortnox:', err);

            if (err instanceof TimeoutError) {
                setError('Tidsgränsen nåddes vid bortkoppling. Försök igen.');
            } else {
                setError('Kunde inte koppla bort Fortnox.');
            }
        } finally {
            setConnecting(null);
        }
    }

    function getStatusBadge(integration: Integration) {
        if (integration.id === 'fortnox' && !isFortnoxPlanEligible) {
            return <span className="integ-badge integ-badge--pro">Kräver Pro</span>;
        }

        const status = connecting === integration.id ? 'connecting' : integration.status;
        return (
            <span className={`integ-badge ${STATUS_CLASS_MAP[status]}`}>
                {STATUS_TEXT_MAP[status]}
            </span>
        );
    }

    function renderDisconnectButton(integrationId: string) {
        const isBusy = connecting === integrationId;
        return (
            <button
                onClick={() => handleDisconnect(integrationId)}
                data-testid={`integration-disconnect-${integrationId}`}
                disabled={isBusy}
                className="integ-btn integ-btn--disconnect"
            >
                {isBusy ? '...' : 'Koppla bort'}
            </button>
        );
    }

    function renderConnectButton(integrationId: string) {
        const isBusy = connecting === integrationId;
        return (
            <button
                onClick={() => handleConnect(integrationId)}
                data-testid={`integration-connect-${integrationId}`}
                disabled={isBusy}
                className="integ-btn integ-btn--connect"
            >
                {isBusy ? 'Ansluter...' : 'Anslut'}
            </button>
        );
    }

    function renderIntegrationAction(integration: Integration) {
        if (integration.status === 'coming_soon') return null;

        const fortnoxNeedsPlan = integration.id === 'fortnox' && !isFortnoxPlanEligible;
        if (fortnoxNeedsPlan && integration.status !== 'connected') {
            return (
                <a
                    href={UPGRADE_TO_PRO_MAILTO}
                    className="integ-btn integ-btn--upgrade"
                >
                    Uppgradera
                </a>
            );
        }

        return integration.status === 'connected'
            ? renderDisconnectButton(integration.id)
            : renderConnectButton(integration.id);
    }

    const fortnoxIntegration = integrations.find((integration) => integration.id === 'fortnox');
    const showReconnectBanner = Boolean(
        activeCompanyId
        && isFortnoxPlanEligible
        && fortnoxIntegration?.status === 'disconnected'
    );

    return (
        <>
        <ModalWrapper onClose={onClose} title="Integreringar" subtitle="Anslut Veridat till dina bokföringssystem." maxWidth="700px">
            <div className="panel-stagger" style={INTEGRATIONS_MODAL_BODY_STYLE}>
                {error && (
                    <div style={MODAL_ERROR_BOX_STYLE}>
                        {error}
                    </div>
                )}

                {loading ? (
                    <div style={INTEGRATIONS_LOADING_STYLE}>
                        <div className="modal-spinner" style={MODAL_LOADING_SPINNER_STYLE} role="status" aria-label="Laddar"></div>
                        {loadingTimeout && (
                            <div style={INTEGRATIONS_LOADING_TIMEOUT_STYLE}>
                                Detta tar längre tid än vanligt. Kontrollera din internetanslutning.
                            </div>
                        )}
                    </div>
                ) : (
                    <>
                        {showReconnectBanner && (
                            <InlineNoticeBanner
                                testId={FORTNOX_RECONNECT_BANNER.testId}
                                message={FORTNOX_RECONNECT_BANNER.message}
                                style={FORTNOX_RECONNECT_BANNER_STYLE}
                            />
                        )}

                        {/* Integration Cards (Fortnox, Visma, BankID) */}
                        <div>
                            <div className="panel-section-title">Integrationer</div>
                            <div
                                className="integrations-list"
                                style={INTEGRATIONS_LIST_GRID_STYLE}
                            >
                                {integrations.map((integration) => {
                                    const icon = ICON_MAP[integration.icon] || { letter: '?', className: 'integ-icon' };
                                    const isComingSoon = integration.status === 'coming_soon';
                                    const isConnected = integration.status === 'connected';

                                    return (
                                        <IntegrationConnectionCard
                                            key={integration.id}
                                            integration={integration}
                                            icon={icon}
                                            isComingSoon={isComingSoon}
                                            isConnected={isConnected}
                                            statusBadge={getStatusBadge(integration)}
                                            action={renderIntegrationAction(integration)}
                                        />
                                    );
                                })}
                            </div>
                        </div>

                        <IntegrationsInfoCard />
                    </>
                )}
            </div>
        </ModalWrapper>

            {disconnectConfirm && (
                <div style={{
                    position: 'fixed', inset: 0, zIndex: 3100,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)',
                }} onClick={() => setDisconnectConfirm(null)}>
                    <div style={{
                        background: 'var(--surface-2, #1e293b)', borderRadius: '12px',
                        padding: '1.5rem', maxWidth: '420px', width: '90vw',
                        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                        border: '1px solid var(--border-subtle, rgba(255,255,255,0.08))',
                    }} onClick={(e) => e.stopPropagation()}>
                        <p style={{
                            margin: '0 0 1.25rem', fontSize: '0.9rem',
                            color: 'var(--text-primary)', lineHeight: 1.6,
                        }}>
                            Är du säker på att du vill koppla bort Fortnox? Du kan alltid ansluta igen senare.
                        </p>
                        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                            <button type="button" onClick={() => setDisconnectConfirm(null)} style={{
                                padding: '0.5rem 1rem', borderRadius: '8px',
                                border: '1px solid var(--border-subtle, rgba(255,255,255,0.12))',
                                background: 'transparent', color: 'var(--text-secondary)',
                                fontSize: '0.875rem', cursor: 'pointer',
                            }}>
                                Avbryt
                            </button>
                            <button type="button" onClick={() => void doDisconnect()} style={{
                                padding: '0.5rem 1rem', borderRadius: '8px', border: 'none',
                                background: '#ef4444', color: '#fff',
                                fontSize: '0.875rem', cursor: 'pointer', fontWeight: 500,
                            }}>
                                Koppla bort
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

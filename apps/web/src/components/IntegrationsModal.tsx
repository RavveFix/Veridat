/**
 * IntegrationsModal
 *
 * Modal for managing third-party integrations like Fortnox.
 * Designed to be extensible for multiple integration providers.
 */

import { useState, useEffect, useRef } from 'preact/hooks';
import { supabase } from '../lib/supabase';
import type { Integration, IntegrationStatus } from '../types/integrations';
import { withTimeout, TimeoutError } from '../utils/asyncTimeout';
import { logger } from '../services/LoggerService';
import { isFortnoxEligible, normalizeUserPlan, type UserPlan } from '../services/PlanGateService';
import { copilotService } from '../services/CopilotService';
import { companyService } from '../services/CompanyService';
import { financeAgentService } from '../services/FinanceAgentService';
import { ModalWrapper } from './ModalWrapper';
import { BankImportPanel } from './BankImportPanel';
import { AgencyPanel } from './AgencyPanel';
import { FortnoxPanel } from './FortnoxPanel';
import { BookkeepingRulesPanel } from './BookkeepingRulesPanel';
import { ReconciliationView } from './ReconciliationView';
import { InvoiceInboxPanel } from './InvoiceInboxPanel';
import { DashboardPanel } from './DashboardPanel';
import { VATReportFromFortnoxPanel } from './VATReportFromFortnoxPanel';

interface IntegrationsModalProps {
    onClose: () => void;
    initialTool?: string;
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

type IntegrationTool =
    | 'bank-import'
    | 'agency'
    | 'fortnox-panel'
    | 'bookkeeping-rules'
    | 'reconciliation'
    | 'invoice-inbox'
    | 'dashboard'
    | 'vat-report';

const FORTNOX_LOCKED_TOOLS: IntegrationTool[] = ['fortnox-panel', 'invoice-inbox', 'vat-report'];

function isIntegrationTool(value: unknown): value is IntegrationTool {
    return typeof value === 'string' && [
        'bank-import',
        'agency',
        'fortnox-panel',
        'bookkeeping-rules',
        'reconciliation',
        'invoice-inbox',
        'dashboard',
        'vat-report'
    ].includes(value);
}

function isFortnoxTool(tool: IntegrationTool | null | undefined): boolean {
    return !!tool && FORTNOX_LOCKED_TOOLS.includes(tool);
}

// ---------------------------------------------------------------------------
// Tool Groups — data-driven rendering
// ---------------------------------------------------------------------------

interface ToolDef {
    id: IntegrationTool;
    title: string;
    description: string;
    iconPath: string;
    iconColor: string;
    badge: 'new' | 'pro' | 'beta';
    testId: string;
    requiresPro?: boolean;
}

const TOOL_GROUPS: { title: string; tools: ToolDef[] }[] = [
    {
        title: 'Fortnox-verktyg',
        tools: [
            {
                id: 'fortnox-panel',
                title: 'Fortnoxpanel',
                description: 'Se leverantörsfakturor, status och Copilot i en vy.',
                iconPath: 'M2 3h20v14H2zM8 21h8M12 17v4',
                iconColor: '#2563eb',
                badge: 'pro',
                testId: 'integration-tool-fortnox-panel',
                requiresPro: true,
            },
            {
                id: 'vat-report',
                title: 'Momsdeklaration',
                description: 'Hämta momsrapport direkt från Fortnox med intäkter, kostnader och momsavräkning.',
                iconPath: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8',
                iconColor: '#3b82f6',
                badge: 'pro',
                testId: 'integration-tool-vat-report',
                requiresPro: true,
            },
            {
                id: 'invoice-inbox',
                title: 'Fakturainkorg',
                description: 'Ladda upp leverantörsfakturor (PDF/bild), AI-extrahera och exportera till Fortnox.',
                iconPath: 'M22 12h-6l-2 3H10l-2-3H2M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z',
                iconColor: '#8b5cf6',
                badge: 'pro',
                testId: 'integration-tool-invoice-inbox',
                requiresPro: true,
            },
        ],
    },
    {
        title: 'Bokföring och Bank',
        tools: [
            {
                id: 'dashboard',
                title: 'Översikt',
                description: 'Dashboard med ekonomisk status, deadlines och snabbåtgärder.',
                iconPath: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
                iconColor: '#10b981',
                badge: 'new',
                testId: 'integration-tool-dashboard',
            },
            {
                id: 'bank-import',
                title: 'Bankimport (CSV)',
                description: 'Importera kontoutdrag (Handelsbanken, SEB, Nordea, Swedbank) och matcha mot fakturor.',
                iconPath: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12',
                iconColor: '#0ea5e9',
                badge: 'beta',
                testId: 'integration-tool-bank-import',
            },
            {
                id: 'reconciliation',
                title: 'Bankavstämning',
                description: 'Översikt per period, markera månader som avstämda.',
                iconPath: 'M22 11.08V12a10 10 0 11-5.93-9.14M22 4L12 14.01l-3-3',
                iconColor: '#10b981',
                badge: 'new',
                testId: 'integration-tool-reconciliation',
            },
            {
                id: 'bookkeeping-rules',
                title: 'Bokföringsregler',
                description: 'Visa och hantera automatiska konteringsregler (leverantör \u2192 konto).',
                iconPath: 'M4 19.5A2.5 2.5 0 016.5 17H20M4 19.5A2.5 2.5 0 006.5 22H20V2H6.5A2.5 2.5 0 004 4.5v15z',
                iconColor: '#f59e0b',
                badge: 'new',
                testId: 'integration-tool-bookkeeping-rules',
            },
        ],
    },
    {
        title: 'Administration',
        tools: [
            {
                id: 'agency',
                title: 'Byråvy',
                description: 'Byt snabbt mellan klientbolag och få en enkel översikt.',
                iconPath: 'M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v4M12 14v4M16 14v4',
                iconColor: '#6366f1',
                badge: 'new',
                testId: 'integration-tool-agency',
            },
        ],
    },
];

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

export function IntegrationsModal({ onClose, initialTool }: IntegrationsModalProps) {
    const requestedInitialTool = isIntegrationTool(initialTool) ? initialTool : null;
    const pendingInitialToolRef = useRef<IntegrationTool | null>(requestedInitialTool);
    const [integrations, setIntegrations] = useState<Integration[]>([]);
    const [loading, setLoading] = useState(true);
    const [connecting, setConnecting] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [abortController, setAbortController] = useState<AbortController | null>(null);
    const [loadingTimeout, setLoadingTimeout] = useState(false);
    const [activeTool, setActiveTool] = useState<IntegrationTool | null>(
        requestedInitialTool && !isFortnoxTool(requestedInitialTool) ? requestedInitialTool : null
    );
    const [userPlan, setUserPlan] = useState<UserPlan>('free');
    const [isAdmin, setIsAdmin] = useState(false);
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
    const [planLoaded, setPlanLoaded] = useState(false);
    const isFortnoxPlanEligible = isFortnoxEligible(userPlan);
    const [guardianBadgeCount, setGuardianBadgeCount] = useState(0);
    const [complianceBadgeCount, setComplianceBadgeCount] = useState(0);

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
        const update = () => {
            const notifications = copilotService.getNotifications();
            const count = notifications.filter(n =>
                n.id.startsWith('guardian-') && (n.severity === 'critical' || n.severity === 'warning')
            ).length;
            setGuardianBadgeCount(count);
        };

        update();
        copilotService.addEventListener('copilot-updated', update as EventListener);
        return () => copilotService.removeEventListener('copilot-updated', update as EventListener);
    }, []);

    useEffect(() => {
        if (!currentUserId) {
            setComplianceBadgeCount(0);
            return;
        }
        const companyId = companyService.getCurrentId();
        if (!companyId) {
            setComplianceBadgeCount(0);
            return;
        }

        let cancelled = false;
        void (async () => {
            try {
                const alerts = await financeAgentService.listComplianceAlerts(companyId);
                if (cancelled) return;
                const count = alerts.filter((alert) => alert.severity === 'warning' || alert.severity === 'critical').length;
                setComplianceBadgeCount(count);
            } catch (error) {
                logger.warn('Could not load compliance badge', error);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [currentUserId, planLoaded, activeTool]);

    useEffect(() => {
        const controller = new AbortController();
        setAbortController(controller);

        loadIntegrationStatus();

        // Show "taking longer than usual" after 5 seconds
        const feedbackTimeout = setTimeout(() => {
            setLoadingTimeout(true);
        }, 5000);

        // Cleanup: abort pending requests and clear timeout
        return () => {
            controller.abort();
            clearTimeout(feedbackTimeout);
            setAbortController(null);
        };
    }, []);

    useEffect(() => {
        if (!activeTool) return;
        if (!['bank-import', 'invoice-inbox', 'reconciliation'].includes(activeTool)) return;

        const companyId = companyService.getCurrentId();
        if (!companyId) return;

        void financeAgentService.preloadCompany(companyId);
    }, [activeTool]);

    function openTool(tool: IntegrationTool): void {
        if (isFortnoxTool(tool) && !isFortnoxPlanEligible) {
            setError('Fortnox-funktioner kräver Veridat Pro eller Trial.');
            return;
        }
        setError(null);
        setActiveTool(tool);
    }

    async function loadIntegrationStatus() {
        setLoading(true);
        setError(null);
        setPlanLoaded(false);
        setIsAdmin(false);
        setCurrentUserId(null);

        try {
            // Check Fortnox connection status with timeout (10s for auth)
            const { data: { user } } = await withTimeout(
                supabase.auth.getUser(),
                10000,
                'Tidsgräns för autentisering'
            );

            if (!user) {
                setUserPlan('free');
                setIsAdmin(false);
                setCurrentUserId(null);
                setPlanLoaded(true);
                setError('Du måste vara inloggad för att hantera integreringar.');
                setLoading(false);
                return;
            }

            setCurrentUserId(user.id);

            const profileQuery = supabase
                .from('profiles')
                .select('plan, is_admin')
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

            const normalizedProfile = profile as { plan?: unknown; is_admin?: unknown } | null;
            const plan = normalizeUserPlan(normalizedProfile?.plan);
            const fortnoxAllowed = isFortnoxEligible(plan);
            setIsAdmin(Boolean(normalizedProfile?.is_admin));
            setUserPlan(plan);
            setPlanLoaded(true);

            if (pendingInitialToolRef.current && isFortnoxTool(pendingInitialToolRef.current)) {
                if (fortnoxAllowed) {
                    setActiveTool(pendingInitialToolRef.current);
                }
                pendingInitialToolRef.current = null;
            }

            // Check if user has Fortnox tokens with timeout (10s for DB query)
            const fortnoxQuery = supabase
                .from('fortnox_tokens')
                .select('created_at, expires_at')
                .eq('user_id', user.id)
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
                const companyId = localStorage.getItem('activeCompanyId');
                if (companyId) {
                    void (async () => {
                        const accessToken = await getSessionAccessToken();
                        if (!accessToken) return;
                        await postAuthedFunction('fortnox', accessToken, { action: 'sync_profile', companyId });
                    })().catch((err) => logger.warn('Fortnox profile sync skipped:', err));
                }
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
            setIsAdmin(false);
            setCurrentUserId(null);
            setPlanLoaded(true);

            // Check if component was aborted (unmounted)
            if (abortController?.signal.aborted) {
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
                postAuthedFunction('fortnox-oauth', accessToken, { action: 'initiate' }),
                15000, // Edge function may take longer
                'Tidsgräns för Fortnox-anslutning'
            );

            if (!response.ok) {
                const errorData = await response.json();
                if (errorData.errorCode === 'PLAN_REQUIRED' || errorData.error === 'plan_required') {
                    throw new Error('Fortnox kräver Veridat Pro eller Trial.');
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

    async function handleDisconnect(integrationId: string) {
        if (integrationId !== 'fortnox') {
            return;
        }

        if (!confirm('Är du säker på att du vill koppla bort Fortnox?')) {
            return;
        }

        setConnecting(integrationId);
        setError(null);

        try {
            const { data: { user } } = await withTimeout(
                supabase.auth.getUser(),
                10000,
                'Tidsgräns för autentisering'
            );

            if (!user) throw new Error('Not authenticated');

            // Delete the Fortnox tokens with timeout
            const deleteQuery = supabase
                .from('fortnox_tokens')
                .delete()
                .eq('user_id', user.id);

            const { error: deleteError } = await withTimeout(
                deleteQuery,
                10000,
                'Tidsgräns för borttagning'
            );

            if (deleteError) throw deleteError;

            // Refresh the list
            await loadIntegrationStatus();
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
                    href="mailto:hej@veridat.se?subject=Uppgradera%20till%20Pro&body=Hej%2C%0A%0AJag%20vill%20uppgradera%20till%20Pro%20och%20aktivera%20Fortnox-integration.%0A%0AMvh"
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

    function renderActiveToolModal() {
        if (!activeTool) return null;

        const onBack = () => setActiveTool(null);

        switch (activeTool) {
            case 'dashboard':
                return (
                    <ModalWrapper
                        onClose={onClose}
                        title="Översikt"
                        subtitle="Din bokföringsöversikt på ett ställe."
                        maxWidth="1400px"
                    >
                        <DashboardPanel
                            onBack={onBack}
                            onNavigate={(tool) => openTool(tool as IntegrationTool)}
                            isAdmin={isAdmin}
                            userId={currentUserId}
                            timeWindowDays={7}
                        />
                    </ModalWrapper>
                );
            case 'bank-import':
                return (
                    <ModalWrapper
                        onClose={onClose}
                        title="Bankimport (CSV)"
                        subtitle="Importera kontoutdrag och matcha mot Fortnox-fakturor."
                        maxWidth="1200px"
                    >
                        <BankImportPanel onBack={onBack} />
                    </ModalWrapper>
                );
            case 'agency':
                return (
                    <ModalWrapper
                        onClose={onClose}
                        title="Byråvy (beta)"
                        subtitle="Hantera klientbolag och byt aktivt bolag snabbt."
                        maxWidth="1200px"
                    >
                        <AgencyPanel onBack={onBack} />
                    </ModalWrapper>
                );
            case 'reconciliation':
                return (
                    <ModalWrapper
                        onClose={onClose}
                        title="Bankavstämning"
                        subtitle="Översikt och periodstatus för bankavstämning."
                        maxWidth="1200px"
                    >
                        <ReconciliationView
                            onBack={onBack}
                            onOpenBankImport={() => openTool('bank-import')}
                        />
                    </ModalWrapper>
                );
            case 'bookkeeping-rules':
                return (
                    <ModalWrapper
                        onClose={onClose}
                        title="Bokföringsregler"
                        subtitle="Hantera automatiska konteringsregler baserade på tidigare bokföringar."
                        maxWidth="1200px"
                    >
                        <BookkeepingRulesPanel onBack={onBack} />
                    </ModalWrapper>
                );
            case 'invoice-inbox':
                return (
                    <ModalWrapper
                        onClose={onClose}
                        title="Fakturainkorg"
                        subtitle="Ladda upp leverantörsfakturor, AI-extrahera och exportera till Fortnox."
                        maxWidth="1200px"
                    >
                        <InvoiceInboxPanel onBack={onBack} />
                    </ModalWrapper>
                );
            case 'vat-report':
                return (
                    <ModalWrapper
                        onClose={onClose}
                        title="Momsdeklaration"
                        subtitle="Momsrapport baserad på din Fortnox-bokföring."
                        maxWidth="1200px"
                    >
                        <VATReportFromFortnoxPanel onBack={onBack} />
                    </ModalWrapper>
                );
            case 'fortnox-panel':
                return (
                    <ModalWrapper
                        onClose={onClose}
                        title="Fortnoxpanel"
                        subtitle="Leverantörsfakturor, status och Copilot på ett ställe."
                        maxWidth="1200px"
                    >
                        <FortnoxPanel onBack={onBack} />
                    </ModalWrapper>
                );
            default:
                return null;
        }
    }

    if (activeTool && isFortnoxTool(activeTool) && (!planLoaded || !isFortnoxPlanEligible)) {
        return (
            <ModalWrapper
                onClose={onClose}
                title="Fortnox-funktioner"
                subtitle="Tillgängligt i Veridat Pro eller Trial."
                maxWidth="640px"
            >
                <div
                    data-testid="fortnox-plan-gated-message"
                    style={{
                        padding: '1rem',
                        borderRadius: '12px',
                        border: '1px solid rgba(245, 158, 11, 0.25)',
                        background: 'rgba(245, 158, 11, 0.08)',
                        color: 'var(--text-secondary)',
                        fontSize: '0.9rem',
                        lineHeight: 1.5
                    }}
                >
                    Fortnoxpanel, momsrapport och fakturainkorg kräver Veridat Pro eller Trial.
                </div>
                <a
                    href="mailto:hej@veridat.se?subject=Uppgradera%20till%20Pro&body=Hej%2C%0A%0AJag%20vill%20uppgradera%20till%20Pro%20och%20aktivera%20Fortnox-integration.%0A%0AMvh"
                    data-testid="fortnox-upgrade-link"
                    style={{
                        display: 'inline-block',
                        marginTop: '1rem',
                        padding: '0.7rem 1rem',
                        borderRadius: '999px',
                        textDecoration: 'none',
                        fontWeight: 600,
                        fontSize: '0.9rem',
                        color: '#fff',
                        background: '#2563eb',
                        boxShadow: 'none'
                    }}
                >
                    Uppgradera till Pro
                </a>
            </ModalWrapper>
        );
    }

    const activeToolModal = renderActiveToolModal();
    if (activeToolModal) return activeToolModal;

    return (
        <ModalWrapper onClose={onClose} title="Integreringar" subtitle="Anslut Veridat till dina bokföringssystem." maxWidth="1200px">
            <div className="panel-stagger" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                {error && (
                    <div style={{
                        padding: '0.8rem',
                        borderRadius: '8px',
                        background: 'var(--status-danger-bg)',
                        color: 'var(--status-danger)',
                        border: '1px solid var(--status-danger-border)',
                        fontSize: '0.9rem'
                    }}>
                        {error}
                    </div>
                )}

                {loading ? (
                    <div style={{ textAlign: 'center', padding: '2rem' }}>
                        <div className="modal-spinner" style={{ margin: '0 auto 1rem' }} role="status" aria-label="Laddar"></div>
                        {loadingTimeout && (
                            <div style={{
                                fontSize: '0.85rem',
                                color: 'var(--accent-primary)',
                                marginTop: '0.5rem'
                            }}>
                                Detta tar längre tid än vanligt. Kontrollera din internetanslutning.
                            </div>
                        )}
                    </div>
                ) : (
                    <>
                        {/* Integration Cards (Fortnox, Visma, BankID) */}
                        <div>
                            <div className="panel-section-title">Integrationer</div>
                            <div
                                className="integrations-list"
                                style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                                    gap: '0.75rem',
                                    marginTop: '0.75rem',
                                }}
                            >
                                {integrations.map((integration) => {
                                    const icon = ICON_MAP[integration.icon] || { letter: '?', className: 'integ-icon' };
                                    const isComingSoon = integration.status === 'coming_soon';
                                    const isConnected = integration.status === 'connected';

                                    return (
                                        <div
                                            key={integration.id}
                                            data-testid={`integration-card-${integration.id}`}
                                            className={`panel-card ${isComingSoon ? 'panel-card--no-hover' : 'panel-card--interactive'} ${isConnected ? 'integ-card--connected' : ''}`}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '1rem',
                                                opacity: isComingSoon ? 0.6 : 1,
                                            }}
                                        >
                                            <div className={icon.className}>{icon.letter}</div>

                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '0.75rem',
                                                    marginBottom: '0.25rem',
                                                }}>
                                                    <span style={{
                                                        fontWeight: 700,
                                                        color: 'var(--text-primary)',
                                                        fontSize: '0.95rem',
                                                        fontFamily: 'var(--font-display)',
                                                    }}>
                                                        {integration.name}
                                                    </span>
                                                    {getStatusBadge(integration)}
                                                </div>
                                                <p style={{
                                                    margin: 0,
                                                    color: 'var(--text-secondary)',
                                                    fontSize: '0.8rem',
                                                    lineHeight: 1.4,
                                                }}>
                                                    {integration.description}
                                                </p>
                                                {integration.connectedAt && (
                                                    <p style={{
                                                        margin: '0.4rem 0 0',
                                                        color: 'var(--text-secondary)',
                                                        fontSize: '0.72rem',
                                                    }}>
                                                        Ansluten {new Date(integration.connectedAt).toLocaleDateString('sv-SE')}
                                                    </p>
                                                )}
                                            </div>

                                            {!isComingSoon && (
                                                <div style={{ flexShrink: 0 }}>
                                                    {renderIntegrationAction(integration)}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </>
                )}

                {/* Tool Groups */}
                {!loading && (
                    <div className="panel-stagger integ-stagger" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                        {TOOL_GROUPS.map((group) => (
                            <div key={group.title}>
                                <div className="panel-section-title">{group.title}</div>
                                <div style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                                    gap: '0.75rem',
                                    marginTop: '0.75rem',
                                }}>
                                    {group.tools.map((tool) => {
                                        const disabled = tool.requiresPro === true && !isFortnoxPlanEligible;
                                        const badgeClass = disabled
                                            ? 'integ-tool-badge integ-tool-badge--pro'
                                            : tool.badge === 'beta'
                                                ? 'integ-tool-badge integ-tool-badge--beta'
                                                : 'integ-tool-badge integ-tool-badge--new';
                                        const badgeText = disabled ? 'Pro' : tool.badge === 'beta' ? 'Beta' : 'Nytt';

                                        return (
                                            <button
                                                key={tool.id}
                                                type="button"
                                                onClick={() => openTool(tool.id)}
                                                data-testid={tool.testId}
                                                disabled={disabled}
                                                className={`panel-card panel-card--interactive ${disabled ? 'integ-tool-card--disabled' : ''}`}
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'flex-start',
                                                    gap: '0.85rem',
                                                    textAlign: 'left',
                                                    cursor: disabled ? 'not-allowed' : 'pointer',
                                                }}
                                            >
                                                <div
                                                    className="integ-tool-icon"
                                                    style={{
                                                        background: `${tool.iconColor}15`,
                                                        color: tool.iconColor,
                                                    }}
                                                >
                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                                                        stroke="currentColor" stroke-width="2"
                                                        stroke-linecap="round" stroke-linejoin="round">
                                                        <path d={tool.iconPath} />
                                                    </svg>
                                                </div>

                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div style={{
                                                        fontWeight: 700,
                                                        fontSize: '0.88rem',
                                                        color: 'var(--text-primary)',
                                                        fontFamily: 'var(--font-display)',
                                                        marginBottom: '0.2rem',
                                                    }}>
                                                        {tool.title}
                                                    </div>
                                                    <div style={{
                                                        fontSize: '0.78rem',
                                                        color: 'var(--text-secondary)',
                                                        lineHeight: 1.4,
                                                    }}>
                                                        {tool.description}
                                                    </div>
                                                </div>

                                                <div style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '0.4rem',
                                                    flexShrink: 0,
                                                    marginTop: '0.1rem',
                                                }}>
                                                    {tool.id === 'fortnox-panel' && guardianBadgeCount > 0 && (
                                                        <span
                                                            title="Guardian-larm"
                                                            data-testid="integration-tool-fortnox-guardian-badge"
                                                            className="integ-alert-count integ-alert-count--critical"
                                                        >
                                                            {guardianBadgeCount > 9 ? '9+' : guardianBadgeCount}
                                                        </span>
                                                    )}
                                                    {tool.id === 'fortnox-panel' && complianceBadgeCount > 0 && (
                                                        <span
                                                            title="Compliance-varningar"
                                                            className="integ-alert-count integ-alert-count--warning"
                                                        >
                                                            {complianceBadgeCount > 9 ? '9+' : complianceBadgeCount}
                                                        </span>
                                                    )}
                                                    <span className={badgeClass}>{badgeText}</span>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Hur fungerar det? */}
                {!loading && (
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
                            <h4 className="panel-label" style={{ margin: '0 0 0.4rem', fontSize: '0.78rem' }}>
                                Hur fungerar det?
                            </h4>
                            <p style={{
                                margin: 0,
                                fontSize: '0.82rem',
                                color: 'var(--text-secondary)',
                                lineHeight: 1.5,
                            }}>
                                När du ansluter Fortnox kan Veridat automatiskt skapa fakturor,
                                hämta kunder och artiklar, samt synka bokföringsdata.
                                All kommunikation sker säkert via Fortnox officiella API.
                            </p>
                        </div>
                    </div>
                )}
            </div>
        </ModalWrapper>
    );
}

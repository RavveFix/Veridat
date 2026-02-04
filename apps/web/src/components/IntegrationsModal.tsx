/**
 * IntegrationsModal
 *
 * Modal for managing third-party integrations like Fortnox.
 * Designed to be extensible for multiple integration providers.
 */

import { useState, useEffect } from 'preact/hooks';
import { supabase } from '../lib/supabase';
import type { Integration, IntegrationStatus } from '../types/integrations';
import { withTimeout, TimeoutError } from '../utils/asyncTimeout';
import { ModalWrapper } from './ModalWrapper';
import { BankImportPanel } from './BankImportPanel';
import { AgencyPanel } from './AgencyPanel';
import { FortnoxPanel } from './FortnoxPanel';

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
        description: 'Ekonomisystem och lonesystem',
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

export function IntegrationsModal({ onClose }: IntegrationsModalProps) {
    const [integrations, setIntegrations] = useState<Integration[]>([]);
    const [loading, setLoading] = useState(true);
    const [connecting, setConnecting] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [abortController, setAbortController] = useState<AbortController | null>(null);
    const [loadingTimeout, setLoadingTimeout] = useState(false);
    const [activeTool, setActiveTool] = useState<'bank-import' | 'agency' | 'fortnox-panel' | null>(null);

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

    async function loadIntegrationStatus() {
        setLoading(true);
        setError(null);

        try {
            // Check Fortnox connection status with timeout (10s for auth)
            const { data: { user } } = await withTimeout(
                supabase.auth.getUser(),
                10000,
                'Tidsgräns för autentisering'
            );

            if (!user) {
                setError('Du måste vara inloggad för att hantera integreringar.');
                setLoading(false);
                return;
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
                console.error('Error checking Fortnox status:', tokenError);
            }

            // Build integrations list with status
            const integrationsWithStatus: Integration[] = INTEGRATIONS_CONFIG.map(config => {
                let status: IntegrationStatus = 'coming_soon';
                let statusMessage: string | undefined;
                let connectedAt: string | undefined;

                if (AVAILABLE_INTEGRATIONS.includes(config.id)) {
                    if (config.id === 'fortnox') {
                        if (fortnoxTokens) {
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
            console.error('Error loading integrations:', err);

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

        setConnecting(integrationId);
        setError(null);

        try {
            // Get the OAuth authorization URL from our Edge Function
            const { data: { session } } = await withTimeout(
                supabase.auth.getSession(),
                10000,
                'Tidsgräns för sessionshämtning'
            );

            if (!session) {
                throw new Error('Not authenticated');
            }

            const response = await withTimeout(
                fetch(
                    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fortnox-oauth`,
                    {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${session.access_token}`
                        },
                        body: JSON.stringify({ action: 'initiate' })
                    }
                ),
                15000, // Edge function may take longer
                'Tidsgräns för Fortnox-anslutning'
            );

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to initiate OAuth');
            }

            const { authorizationUrl } = await response.json();

            // Redirect to Fortnox OAuth
            window.location.href = authorizationUrl;
        } catch (err) {
            console.error('Error connecting to Fortnox:', err);

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
            console.error('Error disconnecting Fortnox:', err);

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
        const badgeStyles: Record<IntegrationStatus, { bg: string; color: string; text: string }> = {
            connected: {
                bg: 'rgba(16, 185, 129, 0.15)',
                color: '#10b981',
                text: 'Ansluten'
            },
            disconnected: {
                bg: 'rgba(255, 255, 255, 0.08)',
                color: 'var(--text-secondary)',
                text: 'Ej ansluten'
            },
            connecting: {
                bg: 'rgba(59, 130, 246, 0.15)',
                color: '#3b82f6',
                text: 'Ansluter...'
            },
            error: {
                bg: 'rgba(239, 68, 68, 0.15)',
                color: '#ef4444',
                text: 'Fel'
            },
            coming_soon: {
                bg: 'rgba(255, 255, 255, 0.05)',
                color: 'var(--text-secondary)',
                text: 'Kommer snart'
            }
        };

        const status = connecting === integration.id ? 'connecting' : integration.status;
        const badge = badgeStyles[status];

        return (
            <span style={{
                background: badge.bg,
                color: badge.color,
                padding: '0.25rem 0.75rem',
                borderRadius: '999px',
                fontSize: '0.75rem',
                fontWeight: 600
            }}>
                {badge.text}
            </span>
        );
    }

    function getIntegrationIcon(iconId: string) {
        // Simple icon representations - can be replaced with actual logos
        const icons: Record<string, string> = {
            fortnox: 'F',
            visma: 'V',
            bankid: 'B'
        };
        return icons[iconId] || '?';
    }

    if (activeTool === 'bank-import') {
        return (
            <ModalWrapper
                onClose={onClose}
                title="Bankimport (CSV)"
                subtitle="Importera kontoutdrag från Handelsbanken och förhandsvisa matchning."
                maxWidth="1200px"
                variant="fullscreen"
            >
                <BankImportPanel onBack={() => setActiveTool(null)} />
            </ModalWrapper>
        );
    }

    if (activeTool === 'agency') {
        return (
            <ModalWrapper
                onClose={onClose}
                title="Byråvy (beta)"
                subtitle="Hantera klientbolag och byt aktivt bolag snabbt."
                maxWidth="1200px"
                variant="fullscreen"
            >
                <AgencyPanel onBack={() => setActiveTool(null)} />
            </ModalWrapper>
        );
    }

    if (activeTool === 'fortnox-panel') {
        return (
            <ModalWrapper
                onClose={onClose}
                title="Fortnoxpanel"
                subtitle="Leverantörsfakturor, status och Copilot på ett ställe."
                maxWidth="1200px"
                variant="fullscreen"
            >
                <FortnoxPanel onBack={() => setActiveTool(null)} />
            </ModalWrapper>
        );
    }

    return (
        <ModalWrapper onClose={onClose} title="Integreringar" subtitle="Anslut Veridat till dina bokföringssystem." maxWidth="1200px" variant="fullscreen">
                {error && (
                    <div style={{
                        padding: '0.8rem',
                        borderRadius: '8px',
                        marginBottom: '1rem',
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
                    <div className="integrations-list" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
                        {integrations.map((integration) => (
                            <div
                                key={integration.id}
                                className="integration-card"
                                style={{
                                    padding: '1.25rem',
                                    borderRadius: '12px',
                                    border: '1px solid var(--glass-border)',
                                    background: 'rgba(255, 255, 255, 0.04)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '1rem',
                                    transition: 'background 0.2s',
                                    opacity: integration.status === 'coming_soon' ? 0.6 : 1
                                }}
                            >
                                {/* Icon */}
                                <div style={{
                                    width: '48px',
                                    height: '48px',
                                    borderRadius: '12px',
                                    background: integration.status === 'connected'
                                        ? 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))'
                                        : 'rgba(255, 255, 255, 0.08)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: '1.25rem',
                                    fontWeight: 700,
                                    color: integration.status === 'connected' ? '#fff' : 'var(--text-secondary)',
                                    flexShrink: 0
                                }}>
                                    {getIntegrationIcon(integration.icon)}
                                </div>

                                {/* Info */}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
                                        <span style={{
                                            fontWeight: 600,
                                            color: 'var(--text-primary)',
                                            fontSize: '1rem'
                                        }}>
                                            {integration.name}
                                        </span>
                                        {getStatusBadge(integration)}
                                    </div>
                                    <p style={{
                                        margin: 0,
                                        color: 'var(--text-secondary)',
                                        fontSize: '0.85rem'
                                    }}>
                                        {integration.description}
                                    </p>
                                    {integration.connectedAt && (
                                        <p style={{
                                            margin: '0.5rem 0 0',
                                            color: 'var(--text-secondary)',
                                            fontSize: '0.75rem'
                                        }}>
                                            Ansluten {new Date(integration.connectedAt).toLocaleDateString('sv-SE')}
                                        </p>
                                    )}
                                </div>

                                {/* Action */}
                                {integration.status !== 'coming_soon' && (
                                    <div style={{ flexShrink: 0 }}>
                                        {integration.status === 'connected' ? (
                                            <button
                                                onClick={() => handleDisconnect(integration.id)}
                                                disabled={connecting === integration.id}
                                                style={{
                                                    padding: '0.5rem 1rem',
                                                    borderRadius: '8px',
                                                    border: '1px solid var(--glass-border)',
                                                    background: 'transparent',
                                                    color: 'var(--text-secondary)',
                                                    cursor: connecting === integration.id ? 'wait' : 'pointer',
                                                    fontSize: '0.85rem',
                                                    fontWeight: 500,
                                                    transition: 'all 0.2s'
                                                }}
                                            >
                                                {connecting === integration.id ? '...' : 'Koppla bort'}
                                            </button>
                                        ) : (
                                            <button
                                                onClick={() => handleConnect(integration.id)}
                                                disabled={connecting === integration.id}
                                                style={{
                                                    padding: '0.5rem 1rem',
                                                    borderRadius: '8px',
                                                    border: 'none',
                                                    background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
                                                    color: '#fff',
                                                    cursor: connecting === integration.id ? 'wait' : 'pointer',
                                                    fontSize: '0.85rem',
                                                    fontWeight: 600,
                                                    transition: 'all 0.2s',
                                                    opacity: connecting === integration.id ? 0.7 : 1
                                                }}
                                            >
                                                {connecting === integration.id ? 'Ansluter...' : 'Anslut'}
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                <div style={{
                    marginTop: '1.5rem',
                    padding: '1rem',
                    borderRadius: '12px',
                    background: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid var(--glass-border)'
                }}>
                    <h4 style={{
                        margin: '0 0 0.75rem',
                        fontSize: '0.9rem',
                        color: 'var(--text-primary)'
                    }}>
                        Verktyg
                    </h4>
                    <div style={{ display: 'grid', gap: '0.75rem' }}>
                        <button
                            type="button"
                            onClick={() => setActiveTool('fortnox-panel')}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: '1rem',
                                padding: '0.9rem 1rem',
                                borderRadius: '10px',
                                border: '1px solid var(--glass-border)',
                                background: 'rgba(255, 255, 255, 0.03)',
                                color: 'var(--text-primary)',
                                cursor: 'pointer'
                            }}
                        >
                            <div style={{ textAlign: 'left' }}>
                                <div style={{ fontWeight: 600 }}>Fortnoxpanel</div>
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                    Se leverantörsfakturor, status och Copilot i en vy.
                                </div>
                            </div>
                            <span style={{
                                padding: '0.2rem 0.6rem',
                                borderRadius: '999px',
                                background: 'rgba(16, 185, 129, 0.15)',
                                color: '#10b981',
                                fontSize: '0.7rem',
                                fontWeight: 600
                            }}>
                                Nytt
                            </span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveTool('bank-import')}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: '1rem',
                                padding: '0.9rem 1rem',
                                borderRadius: '10px',
                                border: '1px solid var(--glass-border)',
                                background: 'rgba(255, 255, 255, 0.03)',
                                color: 'var(--text-primary)',
                                cursor: 'pointer'
                            }}
                        >
                            <div style={{ textAlign: 'left' }}>
                                <div style={{ fontWeight: 600 }}>Bankimport (CSV)</div>
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                    Importera kontoutdrag från Handelsbanken och skapa matchningsförslag.
                                </div>
                            </div>
                            <span style={{
                                padding: '0.2rem 0.6rem',
                                borderRadius: '999px',
                                background: 'rgba(59, 130, 246, 0.15)',
                                color: '#3b82f6',
                                fontSize: '0.7rem',
                                fontWeight: 600
                            }}>
                                Beta
                            </span>
                        </button>

                        <button
                            type="button"
                            onClick={() => setActiveTool('agency')}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: '1rem',
                                padding: '0.9rem 1rem',
                                borderRadius: '10px',
                                border: '1px solid var(--glass-border)',
                                background: 'rgba(255, 255, 255, 0.03)',
                                color: 'var(--text-primary)',
                                cursor: 'pointer'
                            }}
                        >
                            <div style={{ textAlign: 'left' }}>
                                <div style={{ fontWeight: 600 }}>Byråvy</div>
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                    Byt snabbt mellan klientbolag och få en enkel översikt.
                                </div>
                            </div>
                            <span style={{
                                padding: '0.2rem 0.6rem',
                                borderRadius: '999px',
                                background: 'rgba(16, 185, 129, 0.15)',
                                color: '#10b981',
                                fontSize: '0.7rem',
                                fontWeight: 600
                            }}>
                                Nytt
                            </span>
                        </button>
                    </div>
                </div>

                <div style={{
                    marginTop: '1.5rem',
                    padding: '1rem',
                    borderRadius: '12px',
                    background: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid var(--glass-border)'
                }}>
                    <h4 style={{
                        margin: '0 0 0.5rem',
                        fontSize: '0.9rem',
                        color: 'var(--text-primary)'
                    }}>
                        Hur fungerar det?
                    </h4>
                    <p style={{
                        margin: 0,
                        fontSize: '0.85rem',
                        color: 'var(--text-secondary)',
                        lineHeight: 1.5
                    }}>
                        När du ansluter Fortnox kan Veridat automatiskt skapa fakturor,
                        hämta kunder och artiklar, samt synka bokföringsdata.
                        All kommunikation sker säkert via Fortnox officiella API.
                    </p>
                </div>
        </ModalWrapper>
    );
}

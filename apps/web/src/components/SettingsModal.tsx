import { useState, useEffect } from 'preact/hooks';
import { supabase } from '../lib/supabase';
import { logger } from '../services/LoggerService';
import { CURRENT_TERMS_VERSION } from '../constants/termsVersion';
import type { User } from '@supabase/supabase-js';
import { withTimeout, TimeoutError } from '../utils/asyncTimeout';
import { ModalWrapper } from './ModalWrapper';
import { UsageDisplay } from './settings/UsageDisplay';
import { ChangelogPanel } from './settings/ChangelogPanel';
import { AccountingMemoryPanel } from './settings/AccountingMemoryPanel';


interface SettingsModalProps {
    onClose: () => void;
    onLogout: () => void;
}

const SETTINGS_LOADING_CONTAINER_STYLE = {
    textAlign: 'center',
    padding: '2rem'
};

const SETTINGS_LOADING_SPINNER_STYLE = {
    margin: '0 auto 1rem'
};

const SETTINGS_LOADING_TIMEOUT_NOTICE_STYLE = {
    fontSize: '0.85rem',
    color: 'var(--accent-primary)',
    marginTop: '0.5rem'
};

const SETTINGS_SECTION_STYLE = {
    marginBottom: '2rem'
};

const SETTINGS_SECTION_TITLE_STYLE = {
    fontSize: '1.1rem',
    marginBottom: '1rem',
    color: 'var(--text-primary)'
};

const SETTINGS_SECTION_TITLE_COMPACT_STYLE = {
    fontSize: '1.1rem',
    marginBottom: '0.35rem',
    color: 'var(--text-primary)'
};

const SETTINGS_SECTION_DESCRIPTION_STYLE = {
    margin: 0,
    color: 'var(--text-secondary)',
    fontSize: '0.9rem'
};

const SETTINGS_PRIMARY_PILL_LINK_STYLE = {
    display: 'inline-block',
    marginTop: '0.9rem',
    padding: '0.7rem 1rem',
    borderRadius: '999px',
    textDecoration: 'none',
    fontWeight: 600,
    fontSize: '0.9rem',
    color: '#fff',
    background: '#2563eb',
    boxShadow: 'none'
};

const SETTINGS_FIELD_WRAPPER_STYLE = {
    marginBottom: '1rem'
};

const SETTINGS_LABEL_STYLE = {
    display: 'block',
    marginBottom: '0.5rem',
    color: 'var(--text-secondary)',
    fontSize: '0.9rem'
};

const SETTINGS_DISABLED_INPUT_STYLE = {
    width: '100%',
    padding: '0.8rem',
    borderRadius: '8px',
    border: '1px solid var(--surface-border)',
    background: 'var(--surface-2)',
    color: 'var(--text-secondary)',
    cursor: 'not-allowed'
};

const SETTINGS_EDITABLE_INPUT_STYLE = {
    width: '100%',
    padding: '0.8rem',
    borderRadius: '8px',
    border: '1px solid var(--surface-border)',
    background: 'var(--input-bg)',
    color: 'var(--text-primary)',
    outline: 'none',
    boxShadow: 'inset 0 1px 2px rgba(15, 23, 42, 0.06)'
};

const SETTINGS_LEGAL_SECTION_STYLE = {
    marginBottom: '2rem',
    borderTop: '1px solid var(--surface-border)',
    paddingTop: '1.5rem'
};

const SETTINGS_TOP_BORDER_SECTION_STYLE = {
    borderTop: '1px solid var(--surface-border)',
    paddingTop: '1.5rem'
};

const SETTINGS_LEGAL_ROW_STYLE = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '1rem'
};

const SETTINGS_MUTED_TEXT_STYLE = {
    color: 'var(--text-secondary)'
};

const SETTINGS_TERMS_VERSION_BADGE_STYLE = {
    background: 'var(--surface-2)',
    border: '1px solid var(--surface-border)',
    padding: '0.2rem 0.6rem',
    borderRadius: '4px',
    fontSize: '0.9rem'
};

const SETTINGS_LINK_ROW_STYLE = {
    display: 'flex',
    gap: '1rem'
};

const SETTINGS_LEGAL_LINK_STYLE = {
    color: 'var(--accent-primary)',
    textDecoration: 'none',
    fontSize: '0.9rem'
};

const SETTINGS_LOGOUT_BUTTON_STYLE = {
    width: '100%',
    padding: '0.8rem',
    borderRadius: '8px',
    border: '1px solid var(--surface-border)',
    background: 'var(--surface-2)',
    color: 'var(--text-primary)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    transition: 'background 0.2s',
    boxShadow: 'inset 0 1px 0 var(--glass-highlight)'
};

function getSettingsMessageStyle(messageType: 'success' | 'error') {
    return {
        padding: '0.8rem',
        borderRadius: '8px',
        marginBottom: '1rem',
        background: messageType === 'success'
            ? 'var(--status-success-bg)'
            : 'var(--status-danger-bg)',
        color: messageType === 'success'
            ? 'var(--status-success)'
            : 'var(--status-danger)',
        border: `1px solid ${messageType === 'success'
            ? 'var(--status-success-border)'
            : 'var(--status-danger-border)'}`
    };
}

function getSettingsSaveButtonStyle(saving: boolean) {
    return {
        width: '100%',
        padding: '0.85rem',
        borderRadius: '99px',
        border: 'none',
        background: '#2563eb',
        color: '#fff',
        fontWeight: '600',
        fontSize: '0.95rem',
        cursor: saving ? 'wait' : 'pointer',
        opacity: saving ? 0.7 : 1,
        boxShadow: 'none'
    };
}

function getTermsVersionBadgeStyle(termsVersion: string) {
    return {
        ...SETTINGS_TERMS_VERSION_BADGE_STYLE,
        color: termsVersion === CURRENT_TERMS_VERSION ? '#10b981' : 'var(--text-secondary)'
    };
}

export function SettingsModal({ onClose, onLogout }: SettingsModalProps) {
    const [user, setUser] = useState<User | null>(null);
    const [fullName, setFullName] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
    const [termsVersion, setTermsVersion] = useState<string>('-');
    const [plan, setPlan] = useState<'free' | 'pro' | 'trial'>('free');
    const [usage, setUsage] = useState<{
        hourlyUsed: number;
        dailyUsed: number;
        hourlyReset: string | null;
        dailyReset: string | null;
    } | null>(null);
    const [usageError, setUsageError] = useState<string | null>(null);
    const [abortController, setAbortController] = useState<AbortController | null>(null);
    const [loadingTimeout, setLoadingTimeout] = useState(false);

    const planLimits = plan === 'free'
        ? { hourly: 10, daily: 50 }
        : { hourly: 40, daily: 200 };

    useEffect(() => {
        const controller = new AbortController();
        setAbortController(controller);

        loadData();

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

    function normalizePlan(value: unknown): 'free' | 'pro' | 'trial' {
        if (value === 'pro' || value === 'trial') return value;
        return 'free';
    }

    function formatResetAt(resetIso: string | null, windowMs: number): string {
        if (!resetIso) return '-';
        const resetAt = new Date(new Date(resetIso).getTime() + windowMs);
        return resetAt.toLocaleString('sv-SE', { hour: '2-digit', minute: '2-digit' });
    }

    async function loadUsage(userId: string) {
        setUsageError(null);
        try {
            const usageQuery = supabase
                .from('api_usage')
                .select('hourly_count, daily_count, hourly_reset, daily_reset')
                .eq('user_id', userId)
                .eq('endpoint', 'ai')
                .maybeSingle();

            const { data, error } = await withTimeout(
                usageQuery,
                10000,
                'Tidsgräns för användningsdata'
            );

            if (error) throw error;

            if (!data) {
                setUsage({
                    hourlyUsed: 0,
                    dailyUsed: 0,
                    hourlyReset: null,
                    dailyReset: null
                });
                return;
            }

            setUsage({
                hourlyUsed: data.hourly_count ?? 0,
                dailyUsed: data.daily_count ?? 0,
                hourlyReset: data.hourly_reset ?? null,
                dailyReset: data.daily_reset ?? null
            });
        } catch (error) {
            logger.error('Error loading usage data:', error);
            setUsage(null);

            if (error instanceof TimeoutError) {
                setUsageError('Tidsgränsen nåddes. Försök igen.');
            } else {
                setUsageError('Kunde inte ladda användning just nu.');
            }
        }
    }

    async function loadData() {
        try {
            // Get user first with timeout (10s for auth)
            const { data: { user: currentUser }, error: userError } = await withTimeout(
                supabase.auth.getUser(),
                10000,
                'Tidsgräns för autentisering'
            );

            if (userError) throw userError;
            if (!currentUser) throw new Error('No user found');

            setUser(currentUser);

            // Then get profile with timeout (10s for DB query)
            const profileQuery = supabase
                .from('profiles')
                .select('full_name, terms_version, plan')
                .eq('id', currentUser.id)
                .single();

            const { data, error } = await withTimeout(
                profileQuery,
                10000,
                'Tidsgräns för profilhämtning'
            );

            if (error) throw error;

            if (data) {
                setFullName(data.full_name || '');
                setTermsVersion(data.terms_version || '-');
                setPlan(normalizePlan((data as unknown as { plan?: unknown })?.plan));
            }

            // Load usage data (another 10s timeout)
            await loadUsage(currentUser.id);
        } catch (error) {
            logger.error('Error loading settings data:', error);

            // Check if component was aborted (unmounted)
            if (abortController?.signal.aborted) {
                return; // Don't show error if user closed modal
            }

            if (error instanceof TimeoutError) {
                setMessage({ type: 'error', text: 'Tidsgränsen nåddes. Försök igen.' });
            } else {
                setMessage({ type: 'error', text: 'Kunde inte ladda användardata.' });
            }
        } finally {
            setLoading(false);
        }
    }

    async function handleSave(e: Event) {
        e.preventDefault();
        if (!user) return; // Guard clause for null user

        setSaving(true);
        setMessage(null);

        try {
            const updateQuery = supabase
                .from('profiles')
                .update({ full_name: fullName })
                .eq('id', user.id);

            const { error } = await withTimeout(
                updateQuery,
                10000,
                'Tidsgräns för sparande'
            );

            if (error) throw error;

            setMessage({ type: 'success', text: 'Profil uppdaterad!' });

            // Clear success message after 3 seconds
            setTimeout(() => setMessage(null), 3000);
        } catch (error) {
            logger.error('Error updating profile:', error);

            if (error instanceof TimeoutError) {
                setMessage({ type: 'error', text: 'Tidsgränsen nåddes. Försök igen.' });
            } else {
                setMessage({ type: 'error', text: 'Kunde inte spara ändringar.' });
            }
        } finally {
            setSaving(false);
        }
    }

    return (
        <ModalWrapper onClose={onClose} title="Inställningar" maxWidth="600px">
                {loading ? (
                    <div style={SETTINGS_LOADING_CONTAINER_STYLE}>
                        <div className="modal-spinner" style={SETTINGS_LOADING_SPINNER_STYLE} role="status" aria-label="Laddar"></div>
                        {loadingTimeout && (
                            <div style={SETTINGS_LOADING_TIMEOUT_NOTICE_STYLE}>
                                Detta tar längre tid än vanligt. Kontrollera din internetanslutning.
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="settings-content">
                        <UsageDisplay
                            usage={usage}
                            usageError={usageError}
                            plan={plan}
                            planLimits={planLimits}
                            formatResetAt={formatResetAt}
                        />

                        {user && (plan === 'pro' || plan === 'trial') ? (
                            <AccountingMemoryPanel userId={user.id} plan={plan} />
                        ) : (
                            <section style={SETTINGS_SECTION_STYLE}>
                                <h3 style={SETTINGS_SECTION_TITLE_COMPACT_STYLE}>
                                    Redovisningsminne (Pro)
                                </h3>
                                <p style={SETTINGS_SECTION_DESCRIPTION_STYLE}>
                                    Få en översikt av AI-minnet per bolag, godkänn viktiga siffror och säkra redovisningskvaliteten.
                                </p>
                                <a
                                    href="mailto:hej@veridat.se?subject=Uppgradera%20till%20Pro&body=Hej%2C%0A%0AJag%20vill%20uppgradera%20till%20Pro%20(40%20förfrågningar%2Ftimme%2C%20200%2Fdag)%20för%20att%20få%20redovisningsminne.%0A%0AMvh"
                                    style={SETTINGS_PRIMARY_PILL_LINK_STYLE}
                                    onMouseOver={(e) => (e.currentTarget.style.background = '#1d4ed8')}
                                    onMouseOut={(e) => (e.currentTarget.style.background = '#2563eb')}
                                >
                                    Uppgradera till Pro (40/t, 200/d)
                                </a>
                            </section>
                        )}

                        <section style={SETTINGS_SECTION_STYLE}>
                            <h3 style={SETTINGS_SECTION_TITLE_STYLE}>Profil</h3>
                            {user && (
                                <form onSubmit={handleSave}>
                                    <div style={SETTINGS_FIELD_WRAPPER_STYLE}>
                                        <label style={SETTINGS_LABEL_STYLE}>
                                            E-post
                                        </label>
                                        <input
                                            type="email"
                                            value={user.email}
                                            disabled
                                            style={SETTINGS_DISABLED_INPUT_STYLE}
                                        />
                                    </div>
                                    <div style={SETTINGS_FIELD_WRAPPER_STYLE}>
                                        <label style={SETTINGS_LABEL_STYLE}>
                                            Namn
                                        </label>
                                        <input
                                            type="text"
                                            value={fullName}
                                            onInput={(e) => setFullName((e.target as HTMLInputElement).value)}
                                            style={SETTINGS_EDITABLE_INPUT_STYLE}
                                        />
                                    </div>

                                    {message && (
                                        <div style={getSettingsMessageStyle(message.type)}>
                                            {message.text}
                                        </div>
                                    )}

                                    <button
                                        type="submit"
                                        disabled={saving}
                                        style={getSettingsSaveButtonStyle(saving)}
                                        onMouseOver={(e) => !saving && (e.currentTarget.style.background = '#1d4ed8')}
                                        onMouseOut={(e) => (e.currentTarget.style.background = '#2563eb')}
                                    >
                                        {saving ? 'Sparar...' : 'Spara ändringar'}
                                    </button>
                                </form>
                            )}
                        </section>

                        <section style={SETTINGS_LEGAL_SECTION_STYLE}>
                            <h3 style={SETTINGS_SECTION_TITLE_STYLE}>Juridik</h3>
                            <div style={SETTINGS_LEGAL_ROW_STYLE}>
                                <span style={SETTINGS_MUTED_TEXT_STYLE}>Godkänd version:</span>
                                <span style={getTermsVersionBadgeStyle(termsVersion)}>
                                    {termsVersion}
                                </span>
                            </div>
                            <div style={SETTINGS_LINK_ROW_STYLE}>
                                <a href="/terms.html" target="_blank" style={SETTINGS_LEGAL_LINK_STYLE}>Användarvillkor</a>
                                <a href="/privacy.html" target="_blank" style={SETTINGS_LEGAL_LINK_STYLE}>Integritetspolicy</a>
                            </div>
                        </section>

                        <ChangelogPanel />

                        <section style={SETTINGS_TOP_BORDER_SECTION_STYLE}>
                            <h3 style={SETTINGS_SECTION_TITLE_STYLE}>Konto</h3>
                            <button
                                onClick={onLogout}
                                style={SETTINGS_LOGOUT_BUTTON_STYLE}
                                onMouseOver={(e) => (e.currentTarget.style.background = 'var(--surface-1)')}
                                onMouseOut={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
                            >
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                                    <polyline points="16 17 21 12 16 7"></polyline>
                                    <line x1="21" y1="12" x2="9" y2="12"></line>
                                </svg>
                                Logga ut
                            </button>
                        </section>
                    </div>
                )}
        </ModalWrapper>
    );
}

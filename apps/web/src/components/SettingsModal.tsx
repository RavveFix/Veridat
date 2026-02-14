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
import { SkillsHubPanel } from './settings/SkillsHubPanel';


interface SettingsModalProps {
    onClose: () => void;
    onLogout: () => void;
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
        <ModalWrapper onClose={onClose} title="Inställningar" maxWidth="1200px">
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
                            <section style={{ marginBottom: '2rem' }}>
                                <h3 style={{ fontSize: '1.1rem', marginBottom: '0.35rem', color: 'var(--text-primary)' }}>
                                    Redovisningsminne (Pro)
                                </h3>
                                <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                                    Få en översikt av AI-minnet per bolag, godkänn viktiga siffror och säkra redovisningskvaliteten.
                                </p>
                                <a
                                    href="mailto:hej@veridat.se?subject=Uppgradera%20till%20Pro&body=Hej%2C%0A%0AJag%20vill%20uppgradera%20till%20Pro%20(40%20förfrågningar%2Ftimme%2C%20200%2Fdag)%20för%20att%20få%20redovisningsminne.%0A%0AMvh"
                                    style={{
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
                                    }}
                                    onMouseOver={(e) => (e.currentTarget.style.background = '#1d4ed8')}
                                    onMouseOut={(e) => (e.currentTarget.style.background = '#2563eb')}
                                >
                                    Uppgradera till Pro (40/t, 200/d)
                                </a>
                            </section>
                        )}

                        <section style={{ marginBottom: '2rem' }}>
                            <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', color: 'var(--text-primary)' }}>Profil</h3>
                            {user && (
                                <form onSubmit={handleSave}>
                                    <div style={{ marginBottom: '1rem' }}>
                                        <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                                            E-post
                                        </label>
                                        <input
                                            type="email"
                                            value={user.email}
                                            disabled
                                            style={{
                                                width: '100%',
                                                padding: '0.8rem',
                                                borderRadius: '8px',
                                                border: '1px solid var(--surface-border)',
                                                background: 'var(--surface-2)',
                                                color: 'var(--text-secondary)',
                                                cursor: 'not-allowed'
                                            }}
                                        />
                                    </div>
                                    <div style={{ marginBottom: '1rem' }}>
                                        <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                                            Namn
                                        </label>
                                        <input
                                            type="text"
                                            value={fullName}
                                            onInput={(e) => setFullName((e.target as HTMLInputElement).value)}
                                            style={{
                                                width: '100%',
                                                padding: '0.8rem',
                                                borderRadius: '8px',
                                                border: '1px solid var(--surface-border)',
                                                background: 'var(--input-bg)',
                                                color: 'var(--text-primary)',
                                                outline: 'none',
                                                boxShadow: 'inset 0 1px 2px rgba(15, 23, 42, 0.06)'
                                            }}
                                        />
                                    </div>

                                    {message && (
                                        <div style={{
                                            padding: '0.8rem',
                                            borderRadius: '8px',
                                            marginBottom: '1rem',
                                            background: message.type === 'success'
                                                ? 'var(--status-success-bg)'
                                                : 'var(--status-danger-bg)',
                                            color: message.type === 'success'
                                                ? 'var(--status-success)'
                                                : 'var(--status-danger)',
                                            border: `1px solid ${message.type === 'success'
                                                ? 'var(--status-success-border)'
                                                : 'var(--status-danger-border)'}`
                                        }}>
                                            {message.text}
                                        </div>
                                    )}

                                    <button
                                        type="submit"
                                        disabled={saving}
                                        style={{
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
                                        }}
                                        onMouseOver={(e) => !saving && (e.currentTarget.style.background = '#1d4ed8')}
                                        onMouseOut={(e) => (e.currentTarget.style.background = '#2563eb')}
                                    >
                                        {saving ? 'Sparar...' : 'Spara ändringar'}
                                    </button>
                                </form>
                            )}
                        </section>

                        <section style={{ marginBottom: '2rem', borderTop: '1px solid var(--surface-border)', paddingTop: '1.5rem' }}>
                            <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', color: 'var(--text-primary)' }}>Juridik</h3>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                <span style={{ color: 'var(--text-secondary)' }}>Godkänd version:</span>
                                <span style={{
                                    background: 'var(--surface-2)',
                                    border: '1px solid var(--surface-border)',
                                    padding: '0.2rem 0.6rem',
                                    borderRadius: '4px',
                                    fontSize: '0.9rem',
                                    color: termsVersion === CURRENT_TERMS_VERSION ? '#10b981' : 'var(--text-secondary)'
                                }}>
                                    {termsVersion}
                                </span>
                            </div>
                            <div style={{ display: 'flex', gap: '1rem' }}>
                                <a href="/terms.html" target="_blank" style={{ color: 'var(--accent-primary)', textDecoration: 'none', fontSize: '0.9rem' }}>Användarvillkor</a>
                                <a href="/privacy.html" target="_blank" style={{ color: 'var(--accent-primary)', textDecoration: 'none', fontSize: '0.9rem' }}>Integritetspolicy</a>
                            </div>
                        </section>

                        <ChangelogPanel />

                        <section
                            style={{ marginBottom: '2rem', borderTop: '1px solid var(--surface-border)', paddingTop: '1.5rem' }}
                            data-testid="settings-test-agents-section"
                        >
                            <h3 style={{ fontSize: '1.1rem', marginBottom: '0.35rem', color: 'var(--text-primary)' }}>
                                Testagenter
                            </h3>
                            <p style={{ margin: '0 0 1rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                                Kör och följ upp automatiska testsviter direkt i plattformen.
                            </p>
                            <SkillsHubPanel />
                        </section>

                        <section style={{ borderTop: '1px solid var(--surface-border)', paddingTop: '1.5rem' }}>
                            <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', color: 'var(--text-primary)' }}>Konto</h3>
                            <button
                                onClick={onLogout}
                                style={{
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
                                }}
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

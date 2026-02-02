import { useState, useEffect } from 'preact/hooks';
import { supabase } from '../lib/supabase';
import { CURRENT_TERMS_VERSION } from '../constants/termsVersion';
import type { User } from '@supabase/supabase-js';
import { withTimeout, TimeoutError } from '../utils/asyncTimeout';
import { ModalWrapper } from './ModalWrapper';
import { UsageDisplay } from './settings/UsageDisplay';
import { ChangelogPanel } from './settings/ChangelogPanel';

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
    const [plan, setPlan] = useState<'free' | 'pro'>('free');
    const [usage, setUsage] = useState<{
        hourlyUsed: number;
        dailyUsed: number;
        hourlyReset: string | null;
        dailyReset: string | null;
    } | null>(null);
    const [usageError, setUsageError] = useState<string | null>(null);
    const [abortController, setAbortController] = useState<AbortController | null>(null);
    const [loadingTimeout, setLoadingTimeout] = useState(false);

    const planLimits = plan === 'pro'
        ? { hourly: 40, daily: 200 }
        : { hourly: 10, daily: 50 };

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

    function normalizePlan(value: unknown): 'free' | 'pro' {
        return value === 'pro' ? 'pro' : 'free';
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
            console.error('Error loading usage data:', error);
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
            console.error('Error loading settings data:', error);

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
            console.error('Error updating profile:', error);

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
        <ModalWrapper onClose={onClose} title="Inställningar">
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
                                                border: '1px solid var(--glass-border)',
                                                background: 'rgba(255, 255, 255, 0.05)',
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
                                                border: '1px solid var(--glass-border)',
                                                background: 'rgba(255, 255, 255, 0.1)',
                                                color: 'var(--text-primary)',
                                                outline: 'none'
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
                                            background: '#1a1a1a',
                                            color: 'white',
                                            fontWeight: '500',
                                            fontSize: '0.9rem',
                                            cursor: saving ? 'wait' : 'pointer',
                                            opacity: saving ? 0.7 : 1,
                                            transition: 'all 0.2s ease',
                                            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)'
                                        }}
                                        onMouseOver={(e) => !saving && (e.currentTarget.style.background = '#2a2a2a')}
                                        onMouseOut={(e) => (e.currentTarget.style.background = '#1a1a1a')}
                                    >
                                        {saving ? 'Sparar...' : 'Spara ändringar'}
                                    </button>
                                </form>
                            )}
                        </section>

                        <section style={{ marginBottom: '2rem', borderTop: '1px solid var(--glass-border)', paddingTop: '1.5rem' }}>
                            <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', color: 'var(--text-primary)' }}>Juridik</h3>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                <span style={{ color: 'var(--text-secondary)' }}>Godkänd version:</span>
                                <span style={{
                                    background: 'rgba(255, 255, 255, 0.1)',
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

                        <section style={{ borderTop: '1px solid var(--glass-border)', paddingTop: '1.5rem' }}>
                            <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', color: 'var(--text-primary)' }}>Konto</h3>
                            <button
                                onClick={onLogout}
                                style={{
                                    width: '100%',
                                    padding: '0.8rem',
                                    borderRadius: '8px',
                                    border: '1px solid var(--glass-border)',
                                    background: 'rgba(255, 255, 255, 0.05)',
                                    color: 'var(--text-primary)',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '0.5rem',
                                    transition: 'background 0.2s'
                                }}
                                onMouseOver={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)')}
                                onMouseOut={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)')}
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

import { useState, useEffect } from 'preact/hooks';
import { supabase } from '../lib/supabase';
import { CURRENT_TERMS_VERSION } from '../constants/termsVersion';
import { CHANGELOG, type ChangelogEntry } from '../constants/changelog';
import type { User } from '@supabase/supabase-js';
import { withTimeout, TimeoutError } from '../utils/asyncTimeout';

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
                usageQuery as unknown as Promise<typeof usageQuery>,
                10000,
                'Tidsgräns för användningsdata'
            ) as any;

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
                profileQuery as unknown as Promise<typeof profileQuery>,
                10000,
                'Tidsgräns för profilhämtning'
            ) as any;

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
                updateQuery as unknown as Promise<typeof updateQuery>,
                10000,
                'Tidsgräns för sparande'
            ) as any;

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
        <div className="modal-overlay" style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'var(--overlay-bg)',
            backdropFilter: 'blur(5px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            animation: 'fadeIn 0.3s ease-out'
        }}
            onClick={(e) => {
                // Only close if clicking the overlay itself (backdrop), not the content
                if (e.target === e.currentTarget) {
                    onClose();
                }
            }}>
            <div className="modal-content glass-panel" style={{
                background: 'var(--glass-bg)',
                border: '1px solid var(--glass-border)',
                borderRadius: '16px',
                padding: '2rem',
                width: '100%',
                maxWidth: '500px',
                maxHeight: '85vh',
                overflowY: 'auto',
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
                position: 'relative'
            }}>
                <button
                    onClick={onClose}
                    style={{
                        position: 'absolute',
                        top: '1rem',
                        right: '1rem',
                        background: 'none',
                        border: 'none',
                        color: 'var(--text-secondary)',
                        cursor: 'pointer',
                        fontSize: '1.5rem',
                        padding: '0.5rem',
                        lineHeight: 1
                    }}
                >
                    &times;
                </button>

                <h2 style={{
                    marginTop: 0,
                    marginBottom: '1.5rem',
                    background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    fontSize: '1.8rem'
                }}>
                    Inställningar
                </h2>

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
                        <section style={{ marginBottom: '2rem' }}>
                            <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', color: 'var(--text-primary)' }}>Plan & Användning</h3>

                            <div style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                marginBottom: '1rem'
                            }}>
                                <span style={{ color: 'var(--text-secondary)' }}>Din plan</span>
                                <span style={{
                                    background: plan === 'pro'
                                        ? 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))'
                                        : 'rgba(255, 255, 255, 0.08)',
                                    padding: '0.2rem 0.6rem',
                                    borderRadius: '999px',
                                    fontSize: '0.85rem',
                                    fontWeight: 700,
                                    color: plan === 'pro' ? '#fff' : 'var(--text-secondary)',
                                    border: plan === 'pro' ? 'none' : '1px solid var(--glass-border)'
                                }}>
                                    {plan === 'pro' ? 'Pro (199 kr/mån)' : 'Gratis'}
                                </span>
                            </div>

                            {usageError ? (
                                <div style={{
                                    padding: '0.8rem',
                                    borderRadius: '8px',
                                    marginBottom: '1rem',
                                    background: 'var(--status-danger-bg)',
                                    color: 'var(--status-danger)',
                                    border: '1px solid var(--status-danger-border)'
                                }}>
                                    {usageError}
                                </div>
                            ) : (
                                <div style={{
                                    padding: '1rem',
                                    borderRadius: '12px',
                                    border: '1px solid var(--glass-border)',
                                    background: 'rgba(255, 255, 255, 0.04)'
                                }}>
                                    <div style={{ marginBottom: '1rem' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                                            <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Denna timme</span>
                                            <span style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.9rem' }}>
                                                {(usage?.hourlyUsed ?? 0)}/{planLimits.hourly}
                                            </span>
                                        </div>
                                        <div style={{ height: '8px', background: 'rgba(255, 255, 255, 0.08)', borderRadius: '999px', overflow: 'hidden' }}>
                                            <div style={{
                                                width: `${Math.min(100, ((usage?.hourlyUsed ?? 0) / planLimits.hourly) * 100)}%`,
                                                height: '100%',
                                                background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))'
                                            }} />
                                        </div>
                                        <div style={{ marginTop: '0.4rem', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                                            Återställs {formatResetAt(usage?.hourlyReset ?? null, 60 * 60 * 1000)}
                                        </div>
                                    </div>

                                    <div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                                            <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Idag</span>
                                            <span style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.9rem' }}>
                                                {(usage?.dailyUsed ?? 0)}/{planLimits.daily}
                                            </span>
                                        </div>
                                        <div style={{ height: '8px', background: 'rgba(255, 255, 255, 0.08)', borderRadius: '999px', overflow: 'hidden' }}>
                                            <div style={{
                                                width: `${Math.min(100, ((usage?.dailyUsed ?? 0) / planLimits.daily) * 100)}%`,
                                                height: '100%',
                                                background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))'
                                            }} />
                                        </div>
                                        <div style={{ marginTop: '0.4rem', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                                            Återställs {formatResetAt(usage?.dailyReset ?? null, 24 * 60 * 60 * 1000)}
                                        </div>
                                    </div>

                                    {plan !== 'pro' && (
                                        <a
                                            href="mailto:hej@britta.se?subject=Uppgradera%20till%20Pro&body=Hej%2C%0A%0AJag%20skulle%20vilja%20uppgradera%20till%20Pro%20(199%20kr%2Fm%C3%A5n).%0A%0AMvh"
                                            style={{
                                                display: 'block',
                                                marginTop: '1rem',
                                                padding: '0.85rem 1rem',
                                                borderRadius: '99px',
                                                textAlign: 'center',
                                                textDecoration: 'none',
                                                fontWeight: '500',
                                                fontSize: '0.9rem',
                                                color: '#fff',
                                                background: '#1a1a1a',
                                                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
                                                transition: 'all 0.2s ease'
                                            }}
                                            onMouseOver={(e) => (e.currentTarget.style.background = '#2a2a2a')}
                                            onMouseOut={(e) => (e.currentTarget.style.background = '#1a1a1a')}
                                        >
                                            Uppgradera till Pro
                                        </a>
                                    )}
                                </div>
                            )}
                        </section>

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

                        <section style={{ marginBottom: '2rem', borderTop: '1px solid var(--glass-border)', paddingTop: '1.5rem' }}>
                            <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', color: 'var(--text-primary)' }}>Nyheter & Uppdateringar</h3>
                            <div>
                                {CHANGELOG.map((entry: ChangelogEntry, index: number) => (
                                    <div key={entry.version} style={{
                                        marginBottom: index === CHANGELOG.length - 1 ? 0 : '1.5rem',
                                        paddingBottom: index === CHANGELOG.length - 1 ? 0 : '1.5rem',
                                        borderBottom: index === CHANGELOG.length - 1 ? 'none' : '1px solid rgba(255, 255, 255, 0.05)'
                                    }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.5rem' }}>
                                            <h4 style={{
                                                fontSize: '0.95rem',
                                                margin: 0,
                                                color: 'var(--text-primary)',
                                                fontWeight: '600'
                                            }}>
                                                {entry.title}
                                            </h4>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                <span style={{
                                                    fontSize: '0.75rem',
                                                    color: 'var(--text-secondary)'
                                                }}>
                                                    {entry.date}
                                                </span>
                                                <span style={{
                                                    background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
                                                    padding: '0.15rem 0.5rem',
                                                    borderRadius: '6px',
                                                    fontSize: '0.7rem',
                                                    fontWeight: '600',
                                                    color: 'white'
                                                }}>
                                                    v{entry.version}
                                                </span>
                                            </div>
                                        </div>
                                        <div style={{ marginTop: '0.75rem' }}>
                                            {entry.changes.map((change, idx) => (
                                                <div key={idx} style={{
                                                    marginBottom: idx === entry.changes.length - 1 ? 0 : '0.6rem',
                                                    fontSize: '0.85rem',
                                                    color: 'var(--text-secondary)',
                                                    display: 'flex',
                                                    gap: '0.6rem',
                                                    alignItems: 'flex-start'
                                                }}>
                                                    <span style={{
                                                        display: 'inline-block',
                                                        padding: '0.15rem 0.4rem',
                                                        borderRadius: '4px',
                                                        fontSize: '0.65rem',
                                                        fontWeight: '700',
                                                        textTransform: 'uppercase',
                                                        letterSpacing: '0.5px',
                                                        background: change.type === 'new' ? 'rgba(16, 185, 129, 0.15)' :
                                                            change.type === 'improved' ? 'rgba(59, 130, 246, 0.15)' :
                                                                'rgba(251, 191, 36, 0.15)',
                                                        color: change.type === 'new' ? '#10b981' :
                                                            change.type === 'improved' ? '#3b82f6' :
                                                                '#fbbf24',
                                                        border: `1px solid ${change.type === 'new' ? 'rgba(16, 185, 129, 0.3)' :
                                                            change.type === 'improved' ? 'rgba(59, 130, 246, 0.3)' :
                                                                'rgba(251, 191, 36, 0.3)'}`,
                                                        minWidth: '55px',
                                                        textAlign: 'center',
                                                        flexShrink: 0
                                                    }}>
                                                        {change.type === 'new' ? 'Nytt' : change.type === 'improved' ? 'Bättre' : 'Fixat'}
                                                    </span>
                                                    <span style={{ flex: 1, lineHeight: '1.5' }}>{change.description}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </section>

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
            </div>
        </div>
    );
}

import { useState, useEffect } from 'preact/hooks';
import { supabase } from '../lib/supabase';
import { CURRENT_TERMS_VERSION } from '../constants/termsVersion';
import { CHANGELOG, type ChangelogEntry } from '../constants/changelog';
import type { User } from '../types/user';

interface SettingsModalProps {
    user: User;
    onClose: () => void;
    onLogout: () => void;
}

export function SettingsModal({ user, onClose, onLogout }: SettingsModalProps) {
    const [fullName, setFullName] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
    const [termsVersion, setTermsVersion] = useState<string>('-');

    useEffect(() => {
        loadProfile();
    }, []);

    async function loadProfile() {
        try {
            const { data, error } = await supabase
                .from('profiles')
                .select('full_name, terms_version')
                .eq('id', user.id)
                .single();

            if (error) throw error;

            if (data) {
                setFullName(data.full_name || '');
                setTermsVersion(data.terms_version || '-');
            }
        } catch (error) {
            console.error('Error loading profile:', error);
        } finally {
            setLoading(false);
        }
    }

    async function handleSave(e: Event) {
        e.preventDefault();
        setSaving(true);
        setMessage(null);

        try {
            const { error } = await supabase
                .from('profiles')
                .update({ full_name: fullName })
                .eq('id', user.id);

            if (error) throw error;

            setMessage({ type: 'success', text: 'Profil uppdaterad!' });

            // Clear success message after 3 seconds
            setTimeout(() => setMessage(null), 3000);
        } catch (error) {
            console.error('Error updating profile:', error);
            setMessage({ type: 'error', text: 'Kunde inte spara ändringar.' });
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
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            backdropFilter: 'blur(5px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            animation: 'fadeIn 0.3s ease-out'
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
                    <div style={{ textAlign: 'center', padding: '2rem' }}>Laddar...</div>
                ) : (
                    <div className="settings-content">
                        <section style={{ marginBottom: '2rem' }}>
                            <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', color: 'var(--text-primary)' }}>Profil</h3>
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
                                        background: message.type === 'success' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                                        color: message.type === 'success' ? '#10b981' : '#ef4444',
                                        border: `1px solid ${message.type === 'success' ? '#10b981' : '#ef4444'}`
                                    }}>
                                        {message.text}
                                    </div>
                                )}

                                <button
                                    type="submit"
                                    disabled={saving}
                                    className="btn-glow"
                                    style={{
                                        width: '100%',
                                        padding: '0.8rem',
                                        borderRadius: '8px',
                                        border: 'none',
                                        background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
                                        color: 'white',
                                        fontWeight: '600',
                                        cursor: saving ? 'wait' : 'pointer',
                                        opacity: saving ? 0.7 : 1
                                    }}
                                >
                                    {saving ? 'Sparar...' : 'Spara ändringar'}
                                </button>
                            </form>
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
                                <a href="/terms" target="_blank" style={{ color: 'var(--accent-primary)', textDecoration: 'none', fontSize: '0.9rem' }}>Användarvillkor</a>
                                <a href="/privacy" target="_blank" style={{ color: 'var(--accent-primary)', textDecoration: 'none', fontSize: '0.9rem' }}>Integritetspolicy</a>
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

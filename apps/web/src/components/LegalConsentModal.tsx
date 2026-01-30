import { useEffect, useState } from 'preact/hooks';
import { supabase } from '../lib/supabase';
import { CURRENT_TERMS_VERSION, getVersionChanges, getVersionsSince } from '../constants/termsVersion';
import { logger } from '../services/LoggerService';

interface LegalConsentModalProps {
    onAccepted: (fullName: string) => void;
    mode?: 'authenticated' | 'local';
}

/**
 * LegalConsentModal - Re-consent modal for updated terms
 *
 * This modal is ONLY shown when a user needs to re-accept updated terms.
 * New users accept terms via click-through consent on the login page.
 *
 * Pattern: Full-screen overlay with centered card (same as SettingsModal)
 */
export function LegalConsentModal({ onAccepted, mode = 'authenticated' }: LegalConsentModalProps) {
    const [isAccepting, setIsAccepting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [fullName, setFullName] = useState('');
    const [previousTermsVersion, setPreviousTermsVersion] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    // Name is always valid if we have it from DB (re-consent scenario)
    const isValid = fullName.trim().length > 0;

    // Prefill name and capture previous terms version for re-consent UX
    useEffect(() => {
        if (mode !== 'authenticated') {
            setIsLoading(false);
            return;
        }

        let cancelled = false;

        (async () => {
            try {
                logger.debug('LegalConsentModal: Fetching user profile...');
                const { data: { user } } = await supabase.auth.getUser();
                if (!user || cancelled) {
                    setIsLoading(false);
                    return;
                }

                const { data: profile } = await supabase
                    .from('profiles')
                    .select('full_name, terms_version, has_accepted_terms')
                    .eq('id', user.id)
                    .single();

                if (cancelled) return;

                if (profile) {
                    logger.debug('LegalConsentModal: Profile loaded', {
                        hasName: !!profile.full_name,
                        termsVersion: profile.terms_version
                    });
                    setPreviousTermsVersion(profile.terms_version ?? null);

                    if (profile.full_name) {
                        setFullName(profile.full_name);
                    }
                }
            } catch (err) {
                logger.warn('LegalConsentModal: Failed to fetch profile', err);
            } finally {
                if (!cancelled) {
                    setIsLoading(false);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [mode]);

    // This modal is only shown for re-consent, so we always have a previous version
    const isReconsent = mode === 'authenticated' && !!previousTermsVersion;

    const versionsSince = isReconsent ? getVersionsSince(previousTermsVersion) : [];
    const majorChanges = versionsSince.flatMap((v) => getVersionChanges(v)).filter(Boolean);

    const handleAccept = async () => {
        if (!isValid) {
            return;
        }

        setIsAccepting(true);
        setError(null);

        try {
            if (mode === 'authenticated') {
                const { data: { user }, error: authError } = await supabase.auth.getUser();

                if (authError) {
                    throw new Error(`Autentiseringsfel: ${authError.message}`);
                }

                if (!user) {
                    throw new Error('Ingen användare inloggad');
                }

                const acceptedAt = new Date().toISOString();

                // Update profile with new terms version
                const { error: updateError } = await supabase
                    .from('profiles')
                    .upsert({
                        id: user.id,
                        has_accepted_terms: true,
                        terms_accepted_at: acceptedAt,
                        terms_version: CURRENT_TERMS_VERSION,
                        full_name: fullName.trim()
                    });

                if (updateError) throw updateError;

                logger.info('LegalConsentModal: Terms accepted, version updated to', CURRENT_TERMS_VERSION);

                // Send re-consent confirmation email (non-blocking)
                supabase.functions.invoke('send-consent-email', {
                    body: {
                        userId: user.id,
                        email: user.email,
                        fullName: fullName.trim(),
                        termsVersion: CURRENT_TERMS_VERSION,
                        acceptedAt: acceptedAt
                    }
                }).catch(err => {
                    logger.warn('Failed to send re-consent email', err);
                });
            }

            onAccepted(fullName.trim());
        } catch (err: unknown) {
            console.error('Error accepting terms:', err);
            setError('Kunde inte spara ditt godkännande. Försök igen.');
        } finally {
            setIsAccepting(false);
        }
    };

    // Show loading state while fetching profile
    if (isLoading) {
        return (
            <div style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(5, 5, 15, 0.95)',
                backdropFilter: 'blur(10px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 10000
            }}>
                <div style={{
                    color: '#fff',
                    fontSize: '1rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem'
                }}>
                    <div style={{
                        width: '20px',
                        height: '20px',
                        border: '2px solid rgba(0, 240, 255, 0.3)',
                        borderTopColor: '#00f0ff',
                        borderRadius: '50%',
                        animation: 'spin 1s linear infinite'
                    }} />
                    Laddar...
                </div>
                <style>{`
                    @keyframes spin { to { transform: rotate(360deg); } }
                `}</style>
            </div>
        );
    }

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(5, 5, 15, 0.95)',
            backdropFilter: 'blur(10px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
            padding: '1rem',
            animation: 'fadeIn 0.3s ease-out'
        }}>
            <style>{`
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes slideUp {
                    from { opacity: 0; transform: translateY(20px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
            `}</style>

            {/* Modal Card */}
            <div style={{
                background: 'linear-gradient(135deg, rgba(20, 20, 35, 0.98), rgba(15, 15, 25, 0.98))',
                border: '1px solid rgba(0, 240, 255, 0.15)',
                borderRadius: '20px',
                padding: '2rem',
                width: '100%',
                maxWidth: '440px',
                boxShadow: '0 25px 80px -12px rgba(0, 0, 0, 0.8), 0 0 40px rgba(0, 240, 255, 0.05)',
                animation: 'slideUp 0.4s ease-out'
            }}>
                {/* Logo/Title */}
                <div style={{
                    textAlign: 'center',
                    marginBottom: '1.5rem'
                }}>
                    <h1 style={{
                        margin: 0,
                        fontSize: '2rem',
                        fontWeight: '700',
                        background: 'linear-gradient(135deg, #00f0ff, #00c8ff)',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        backgroundClip: 'text'
                    }}>
                        Veridat
                    </h1>
                    <p style={{
                        margin: '0.5rem 0 0 0',
                        fontSize: '0.9rem',
                        color: 'rgba(255, 255, 255, 0.6)'
                    }}>
                        Din AI-bokföringsassistent
                    </p>
                </div>

                {/* Update Notice */}
                <div style={{
                    marginBottom: '1.5rem',
                    padding: '1rem 1.25rem',
                    borderRadius: '12px',
                    background: 'rgba(0, 240, 255, 0.06)',
                    border: '1px solid rgba(0, 240, 255, 0.15)'
                }}>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        marginBottom: '0.75rem',
                        fontWeight: '600',
                        color: '#00f0ff',
                        fontSize: '0.95rem'
                    }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/>
                            <path d="M12 6v6l4 2"/>
                        </svg>
                        Uppdaterade villkor (v{CURRENT_TERMS_VERSION})
                    </div>
                    <p style={{
                        margin: 0,
                        fontSize: '0.875rem',
                        color: 'rgba(255, 255, 255, 0.75)',
                        lineHeight: '1.5'
                    }}>
                        Vi har uppdaterat våra användarvillkor. Granska ändringarna och godkänn för att fortsätta.
                    </p>

                    {majorChanges.length > 0 && (
                        <ul style={{
                            margin: '0.75rem 0 0 0',
                            paddingLeft: '1.25rem',
                            fontSize: '0.85rem',
                            color: 'rgba(255, 255, 255, 0.65)',
                            lineHeight: '1.6'
                        }}>
                            {majorChanges.map((change, index) => (
                                <li key={index} style={{ marginBottom: '0.25rem' }}>{change}</li>
                            ))}
                        </ul>
                    )}
                </div>

                {/* User Info */}
                {fullName && (
                    <div style={{
                        marginBottom: '1.5rem',
                        padding: '0.875rem 1rem',
                        background: 'rgba(255, 255, 255, 0.03)',
                        borderRadius: '10px',
                        border: '1px solid rgba(255, 255, 255, 0.08)'
                    }}>
                        <div style={{
                            fontSize: '0.75rem',
                            color: 'rgba(255, 255, 255, 0.5)',
                            marginBottom: '0.25rem',
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px'
                        }}>
                            Inloggad som
                        </div>
                        <div style={{
                            fontWeight: '500',
                            color: '#fff',
                            fontSize: '1rem'
                        }}>
                            {fullName}
                        </div>
                    </div>
                )}

                {/* Accept Button */}
                <button
                    onClick={handleAccept}
                    disabled={isAccepting || !isValid}
                    style={{
                        width: '100%',
                        background: isAccepting || !isValid
                            ? 'rgba(0, 240, 255, 0.3)'
                            : 'linear-gradient(135deg, #00f0ff, #00c8ff)',
                        color: isAccepting || !isValid ? 'rgba(0, 0, 0, 0.5)' : '#000',
                        borderRadius: '12px',
                        fontWeight: '600',
                        padding: '1rem 1.5rem',
                        border: 'none',
                        cursor: isAccepting || !isValid ? 'not-allowed' : 'pointer',
                        fontSize: '1rem',
                        transition: 'all 0.2s ease',
                        boxShadow: isAccepting || !isValid ? 'none' : '0 4px 20px rgba(0, 240, 255, 0.3)'
                    }}
                >
                    {isAccepting ? (
                        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                            <span style={{
                                width: '18px',
                                height: '18px',
                                border: '2px solid rgba(0,0,0,0.2)',
                                borderTopColor: '#000',
                                borderRadius: '50%',
                                animation: 'spin 1s linear infinite',
                                display: 'inline-block'
                            }} />
                            Godkänner...
                        </span>
                    ) : (
                        'Godkänn & Fortsätt'
                    )}
                </button>

                {/* Terms Links */}
                <p style={{
                    marginTop: '1.25rem',
                    fontSize: '0.8rem',
                    color: 'rgba(255, 255, 255, 0.5)',
                    textAlign: 'center',
                    lineHeight: '1.6'
                }}>
                    Läs fullständiga{' '}
                    <a
                        href="/terms.html"
                        target="_blank"
                        style={{ color: '#00f0ff', textDecoration: 'underline' }}
                    >
                        användarvillkor
                    </a>
                    {' '}och{' '}
                    <a
                        href="/privacy.html"
                        target="_blank"
                        style={{ color: '#00f0ff', textDecoration: 'underline' }}
                    >
                        integritetspolicy
                    </a>
                </p>

                {/* Error Message */}
                {error && (
                    <div style={{
                        marginTop: '1rem',
                        padding: '0.875rem 1rem',
                        background: 'rgba(255, 68, 68, 0.1)',
                        border: '1px solid rgba(255, 68, 68, 0.25)',
                        borderRadius: '10px',
                        color: '#ff6b6b',
                        fontSize: '0.9rem',
                        textAlign: 'center'
                    }}>
                        {error}
                    </div>
                )}
            </div>
        </div>
    );
}

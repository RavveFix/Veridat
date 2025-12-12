import { useEffect, useState } from 'preact/hooks';
import { supabase } from '../lib/supabase';
import { CURRENT_TERMS_VERSION, getVersionChanges, getVersionsSince } from '../constants/termsVersion';
import { authService } from '../services/AuthService';

interface LegalConsentModalProps {
    onAccepted: (fullName: string) => void;
    mode?: 'authenticated' | 'local';
}

export function LegalConsentModal({ onAccepted, mode = 'authenticated' }: LegalConsentModalProps) {
    const [isAccepting, setIsAccepting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [fullName, setFullName] = useState('');
    const [touched, setTouched] = useState(false);
    const [previousTermsVersion, setPreviousTermsVersion] = useState<string | null>(null);

    // Check for prior local consent (from login checkbox)
    const localConsent = typeof localStorage !== 'undefined' ? localStorage.getItem('has_accepted_terms_local') : null;
    const localTimestamp = typeof localStorage !== 'undefined' ? localStorage.getItem('terms_accepted_at_local') : null;

    // If we have local consent, we are just collecting the name for the profile
    const isProfileCompletion = mode === 'authenticated' && localConsent === 'true';

    const isValid = fullName.trim().length > 0;

    // Prefill name and capture previous terms version for re-consent UX
    useEffect(() => {
        if (mode !== 'authenticated') return;

        let cancelled = false;

        (async () => {
            try {
                const { data: { user } } = await supabase.auth.getUser();
                if (!user || cancelled) return;

                const { data: profile } = await supabase
                    .from('profiles')
                    .select('full_name, terms_version, has_accepted_terms')
                    .eq('id', user.id)
                    .single();

                if (cancelled || !profile) return;

                setPreviousTermsVersion(profile.terms_version ?? null);

                // Only prefill if user hasn't started typing
                if (!fullName && profile.full_name) {
                    setFullName(profile.full_name);
                }
            } catch {
                // Non-blocking; modal still works without prefill
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [mode]);

    const isReconsent =
        mode === 'authenticated' &&
        !!previousTermsVersion &&
        previousTermsVersion !== CURRENT_TERMS_VERSION;

    const versionsSince = isReconsent ? getVersionsSince(previousTermsVersion) : [];
    const majorChanges = isReconsent
        ? versionsSince.flatMap((v) => getVersionChanges(v)).filter(Boolean)
        : [];

    const handleAccept = async () => {
        if (!isValid) {
            setTouched(true);
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

                // Use original timestamp if available (Audit Trail Integrity), otherwise now
                const acceptedAt = (isProfileCompletion && localTimestamp)
                    ? localTimestamp
                    : new Date().toISOString();

                // Update profile
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

                // Clear any local consent so it can't leak across users/devices
                authService.clearLocalConsent();

                // Send consent confirmation email with retry logic (non-blocking)
                const sendEmailWithRetry = async (maxRetries = 3) => {
                    for (let attempt = 1; attempt <= maxRetries; attempt++) {
                        try {
                            console.log(`[Consent Email] Attempt ${attempt}/${maxRetries}...`);
                            const { error: emailError } = await supabase.functions.invoke('send-consent-email', {
                                body: {
                                    userId: user.id,
                                    email: user.email,
                                    fullName: fullName.trim(),
                                    termsVersion: CURRENT_TERMS_VERSION,
                                    acceptedAt: acceptedAt
                                }
                            });

                            if (emailError) {
                                throw emailError;
                            }

                            console.log('✅ Consent confirmation email sent successfully');
                            return true;
                        } catch (emailError: any) {
                            console.warn(`❌ Email attempt ${attempt}/${maxRetries} failed:`, emailError);

                            // If last attempt, log critical error for admin monitoring
                            if (attempt === maxRetries) {
                                console.error('🚨 CRITICAL: Failed to send consent email after all retries', {
                                    userId: user.id,
                                    email: user.email,
                                    error: emailError,
                                    timestamp: new Date().toISOString()
                                });
                                // In production, this should trigger an alert to admins
                                return false;
                            }

                            // Wait before retry (exponential backoff: 1s, 2s)
                            const delayMs = 1000 * Math.pow(2, attempt - 1);
                            await new Promise(resolve => setTimeout(resolve, delayMs));
                        }
                    }
                    return false;
                };

                // Send email asynchronously (don't block user)
                sendEmailWithRetry().catch(err => {
                    console.error('Unexpected error in sendEmailWithRetry:', err);
                });
            }

            // For 'local' mode, we just pass the name back
            onAccepted(fullName.trim());
        } catch (err: any) {
            console.error('Error accepting terms:', err);
            setError('Kunde inte spara ditt godkännande. Försök igen.');
        } finally {
            setIsAccepting(false);
        }
    };

    return (
        <div
            className="overflow-hidden transition-all duration-300 ease-out"
            style={{
                maxHeight: '0px',
                opacity: 0,
                animation: 'slideDown 300ms ease-out forwards'
            }}
        >
            <style>{`
                @keyframes slideDown {
                    from {
                        max-height: 0px;
                        opacity: 0;
                        transform: translateY(-10px);
                    }
                    to {
                        max-height: 400px;
                        opacity: 1;
                        transform: translateY(0);
                    }
                }
                @keyframes slideUp {
                    from {
                        max-height: 400px;
                        opacity: 1;
                        transform: translateY(0);
                    }
                    to {
                        max-height: 0px;
                        opacity: 0;
                        transform: translateY(-10px);
                    }
                }
            `}</style>

            <div style={{
                marginTop: '1.5rem',
                paddingTop: '1.5rem',
                borderTop: '1px solid var(--glass-border)'
            }}>
                {isReconsent && (
                    <div
                        className="message-box"
                        style={{
                            marginBottom: '1rem',
                            padding: '0.9rem',
                            borderRadius: '10px',
                            background: 'rgba(255, 255, 255, 0.05)',
                            border: '1px solid var(--glass-border)',
                            color: 'var(--text-secondary)',
                            fontSize: '0.85rem',
                            lineHeight: '1.5'
                        }}
                    >
                        <div style={{ marginBottom: majorChanges.length > 0 ? '0.5rem' : 0 }}>
                            Våra villkor har uppdaterats till version <strong>{CURRENT_TERMS_VERSION}</strong>.
                            <br />
                            Du behöver godkänna de nya villkoren för att fortsätta.
                        </div>
                        {majorChanges.length > 0 && (
                            <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
                                {majorChanges.map((change) => (
                                    <li key={change}>{change}</li>
                                ))}
                            </ul>
                        )}
                    </div>
                )}
                {/* Name Input */}
                <div className="input-group" style={{ textAlign: 'left' }}>
                    <label htmlFor="fullName" style={{ marginLeft: '0.25rem', display: 'block', color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '0.5rem', fontWeight: '500' }}>
                        <span className="text-gradient-primary" style={{ fontSize: '0.9rem' }}>
                            {isProfileCompletion ? '👋 Välkommen till Britta!' : '✨ Ett sista steg!'}
                        </span><br />
                        {isProfileCompletion ? 'Vad får vi lov att kalla dig?' : 'Ditt fullständiga namn'}
                    </label>
                    <input
                        type="text"
                        id="fullName"
                        value={fullName}
                        onInput={(e) => setFullName((e.target as HTMLInputElement).value)}
                        onBlur={() => setTouched(true)}
                        placeholder="T.ex. Anna Andersson"
                        className="input-glass"
                        style={{ marginBottom: touched && !isValid ? '0.5rem' : '0' }}
                        autoFocus
                    />
                    {touched && !isValid && (
                        <p style={{ color: 'var(--accent-tertiary)', fontSize: '0.75rem', marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                            <span>⚠️</span> Vänligen ange ditt namn.
                        </p>
                    )}
                </div>

                {/* Continue Button */}
                <button
                    onClick={handleAccept}
                    disabled={isAccepting || !isValid}
                    className="btn btn-glow"
                    style={{
                        width: '100%',
                        background: 'var(--accent-primary)',
                        color: 'black',
                        borderRadius: '12px',
                        marginTop: '1rem',
                        opacity: !isValid ? 0.5 : 1,
                        cursor: !isValid ? 'not-allowed' : 'pointer'
                    }}
                >
                    {isAccepting ? (
                        <div className="flex items-center justify-center gap-2">
                            <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin"></div>
                            <span>Bearbetar...</span>
                        </div>
                    ) : (
                        isProfileCompletion ? 'Spara & Börja' : 'Fortsätt'
                    )}
                </button>

                {/* Terms Text */}
                <p style={{
                    marginTop: '1rem',
                    fontSize: '0.75rem',
                    color: 'var(--text-secondary)',
                    textAlign: 'center',
                    opacity: 0.7,
                    lineHeight: '1.4'
                }}>
                    {isProfileCompletion ? (
                        <span>Du godkände <a href="/terms.html" target="_blank" style={{ color: 'inherit', textDecoration: 'underline' }}>villkoren</a> vid inloggning.</span>
                    ) : (
                        <span>Genom att fortsätta godkänner du våra <a href="/terms.html" target="_blank" style={{ color: 'inherit', textDecoration: 'underline' }}>villkor</a> och <a href="/privacy.html" target="_blank" style={{ color: 'inherit', textDecoration: 'underline' }}>integritetspolicy</a>.</span>
                    )}
                </p>

                {error && (
                    <div className="message-box error" style={{ marginTop: '1rem' }}>
                        {error}
                    </div>
                )}
            </div>
        </div>
    );
}

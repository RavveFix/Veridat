import { useState } from 'preact/hooks';
import { supabase } from '../lib/supabase';
import { CURRENT_TERMS_VERSION } from '../constants/termsVersion';

interface LegalConsentModalProps {
    onAccepted: (fullName: string) => void;
    mode?: 'authenticated' | 'local';
}

export function LegalConsentModal({ onAccepted, mode = 'authenticated' }: LegalConsentModalProps) {
    const [isAccepting, setIsAccepting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [fullName, setFullName] = useState('');
    const [touched, setTouched] = useState(false);

    // Check for prior local consent (from login checkbox)
    const localConsent = typeof localStorage !== 'undefined' ? localStorage.getItem('has_accepted_terms_local') : null;
    const localTimestamp = typeof localStorage !== 'undefined' ? localStorage.getItem('terms_accepted_at_local') : null;

    // If we have local consent, we are just collecting the name for the profile
    const isProfileCompletion = mode === 'authenticated' && localConsent === 'true';

    const isValid = fullName.trim().length > 0;

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

                // Send consent confirmation email (non-blocking)
                try {
                    console.log('Sending consent confirmation email...');
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
                        console.error('Failed to send consent email:', emailError);
                    } else {
                        console.log('Consent confirmation email sent successfully');
                    }
                } catch (emailException) {
                    console.error('Exception sending consent email:', emailException);
                }
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

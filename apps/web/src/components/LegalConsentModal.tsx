import { useEffect, useState } from 'preact/hooks';
import { supabase } from '../lib/supabase';
import { CURRENT_TERMS_VERSION, getVersionChanges, getVersionsSince } from '../constants/termsVersion';
import { LEGAL_DOCS, type LegalDocType } from '../constants/legalDocs';
import { getRequiredDocsForUser } from '../constants/consentPolicy';
import { logger } from '../services/LoggerService';
import { companyManager } from '../services/CompanyService';

interface LegalConsentModalProps {
    onAccepted: (fullName: string) => void;
    mode?: 'authenticated' | 'local';
}

const LEGAL_MODAL_LOADING_OVERLAY_STYLE = {
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
} as const;

const LEGAL_MODAL_LOADING_CONTENT_STYLE = {
    color: '#fff',
    fontSize: '1rem',
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem'
} as const;

const LEGAL_MODAL_LOADING_SPINNER_STYLE = {
    width: '20px',
    height: '20px',
    border: '2px solid rgba(0, 240, 255, 0.3)',
    borderTopColor: '#00f0ff',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite'
} as const;

const LEGAL_MODAL_OVERLAY_STYLE = {
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
} as const;

const LEGAL_MODAL_CARD_STYLE = {
    background: 'linear-gradient(135deg, rgba(20, 20, 35, 0.98), rgba(15, 15, 25, 0.98))',
    border: '1px solid rgba(0, 240, 255, 0.15)',
    borderRadius: '20px',
    padding: '2rem',
    width: '100%',
    maxWidth: '440px',
    boxShadow: '0 25px 80px -12px rgba(0, 0, 0, 0.8), 0 0 40px rgba(0, 240, 255, 0.05)',
    animation: 'slideUp 0.4s ease-out'
} as const;

const LEGAL_MODAL_HEADER_STYLE = {
    textAlign: 'center',
    marginBottom: '1.5rem'
} as const;

const LEGAL_MODAL_TITLE_STYLE = {
    margin: 0,
    fontSize: '2rem',
    fontWeight: '700',
    background: 'linear-gradient(135deg, #00f0ff, #00c8ff)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text'
} as const;

const LEGAL_MODAL_SUBTITLE_STYLE = {
    margin: '0.5rem 0 0 0',
    fontSize: '0.9rem',
    color: 'rgba(255, 255, 255, 0.6)'
} as const;

const LEGAL_MODAL_NOTICE_STYLE = {
    marginBottom: '1.5rem',
    padding: '1rem 1.25rem',
    borderRadius: '12px',
    background: 'rgba(0, 240, 255, 0.06)',
    border: '1px solid rgba(0, 240, 255, 0.15)'
} as const;

const LEGAL_MODAL_NOTICE_HEADER_STYLE = {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    marginBottom: '0.75rem',
    fontWeight: '600',
    color: '#00f0ff',
    fontSize: '0.95rem'
} as const;

const LEGAL_MODAL_NOTICE_TEXT_STYLE = {
    margin: 0,
    fontSize: '0.875rem',
    color: 'rgba(255, 255, 255, 0.75)',
    lineHeight: '1.5'
} as const;

const LEGAL_MODAL_CHANGE_LIST_STYLE = {
    margin: '0.75rem 0 0 0',
    paddingLeft: '1.25rem',
    fontSize: '0.85rem',
    color: 'rgba(255, 255, 255, 0.65)',
    lineHeight: '1.6'
} as const;

const LEGAL_MODAL_CHANGE_ITEM_STYLE = {
    marginBottom: '0.25rem'
} as const;

const LEGAL_MODAL_USER_INFO_STYLE = {
    marginBottom: '1.5rem',
    padding: '0.875rem 1rem',
    background: 'rgba(255, 255, 255, 0.03)',
    borderRadius: '10px',
    border: '1px solid rgba(255, 255, 255, 0.08)'
} as const;

const LEGAL_MODAL_USER_LABEL_STYLE = {
    fontSize: '0.75rem',
    color: 'rgba(255, 255, 255, 0.5)',
    marginBottom: '0.25rem',
    textTransform: 'uppercase',
    letterSpacing: '0.5px'
} as const;

const LEGAL_MODAL_USER_NAME_STYLE = {
    fontWeight: '500',
    color: '#fff',
    fontSize: '1rem'
} as const;

const LEGAL_MODAL_NAME_FIELD_WRAP_STYLE = {
    marginBottom: '1.5rem'
} as const;

const LEGAL_MODAL_NAME_LABEL_STYLE = {
    display: 'block',
    marginBottom: '0.5rem',
    fontSize: '0.85rem',
    color: 'rgba(255, 255, 255, 0.7)'
} as const;

const LEGAL_MODAL_NAME_INPUT_STYLE = {
    width: '100%',
    padding: '0.75rem 0.9rem',
    borderRadius: '10px',
    fontSize: '0.95rem',
    color: '#fff'
} as const;

const LEGAL_MODAL_CONSENT_WRAP_STYLE = {
    marginBottom: '1.5rem',
    fontSize: '0.8rem',
    color: 'rgba(255, 255, 255, 0.7)',
    lineHeight: '1.6'
} as const;

const LEGAL_MODAL_CONSENT_LABEL_STYLE = {
    display: 'flex',
    gap: '0.5rem',
    alignItems: 'flex-start',
    marginBottom: '0.5rem'
} as const;

const LEGAL_MODAL_CONSENT_HELP_STYLE = {
    fontSize: '0.75rem',
    color: 'rgba(255, 255, 255, 0.55)',
    marginLeft: '1.7rem'
} as const;

const LEGAL_MODAL_LINK_STYLE = {
    color: '#00f0ff',
    textDecoration: 'underline'
} as const;

const LEGAL_MODAL_ACCEPT_BUTTON_BASE_STYLE = {
    width: '100%',
    borderRadius: '12px',
    fontWeight: '600',
    padding: '1rem 1.5rem',
    border: 'none',
    fontSize: '1rem',
    transition: 'all 0.2s ease'
} as const;

const LEGAL_MODAL_ACCEPT_LOADING_ROW_STYLE = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem'
} as const;

const LEGAL_MODAL_ACCEPT_LOADING_SPINNER_STYLE = {
    width: '18px',
    height: '18px',
    border: '2px solid rgba(0,0,0,0.2)',
    borderTopColor: '#000',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    display: 'inline-block'
} as const;

const LEGAL_MODAL_FOOTER_LINKS_STYLE = {
    marginTop: '1.25rem',
    fontSize: '0.8rem',
    color: 'rgba(255, 255, 255, 0.5)',
    textAlign: 'center',
    lineHeight: '1.6'
} as const;

const LEGAL_MODAL_ERROR_BOX_STYLE = {
    marginTop: '1rem',
    padding: '0.875rem 1rem',
    background: 'rgba(255, 68, 68, 0.1)',
    border: '1px solid rgba(255, 68, 68, 0.25)',
    borderRadius: '10px',
    color: '#ff6b6b',
    fontSize: '0.9rem',
    textAlign: 'center'
} as const;

function getLegalAcceptButtonStyle(disabled: boolean) {
    return {
        ...LEGAL_MODAL_ACCEPT_BUTTON_BASE_STYLE,
        background: disabled
            ? 'rgba(0, 240, 255, 0.3)'
            : 'linear-gradient(135deg, #00f0ff, #00c8ff)',
        color: disabled ? 'rgba(0, 0, 0, 0.5)' : '#000',
        cursor: disabled ? 'not-allowed' : 'pointer',
        boxShadow: disabled ? 'none' : '0 4px 20px rgba(0, 240, 255, 0.3)'
    } as const;
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
    const [requiredDocs, setRequiredDocs] = useState<LegalDocType[]>(getRequiredDocsForUser(null));
    const [acceptedDocs, setAcceptedDocs] = useState<Record<LegalDocType, boolean>>({
        terms: false,
        privacy: false,
        security: false,
        dpa: false,
        systemdoc: false
    });

    // Name is always valid if we have it from DB (re-consent scenario)
    const hasAllDocs = requiredDocs.every((doc) => acceptedDocs[doc]);
    const isValid = fullName.trim().length > 0 && hasAllDocs;

    const toggleRequiredDocs = () => {
        setAcceptedDocs((prev) => {
            const shouldAccept = !requiredDocs.every((doc) => prev[doc]);
            const next = { ...prev };
            requiredDocs.forEach((doc) => {
                next[doc] = shouldAccept;
            });
            return {
                ...next
            };
        });
    };

    // Prefill name and capture previous terms version for re-consent UX
    useEffect(() => {
        if (mode !== 'authenticated') {
            setRequiredDocs(getRequiredDocsForUser(new Date().toISOString()));
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
                setRequiredDocs(getRequiredDocsForUser(user.created_at ?? null));

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

    const consentTitle = isReconsent
        ? `Uppdaterade villkor (v${CURRENT_TERMS_VERSION})`
        : `Godkänn villkor (v${CURRENT_TERMS_VERSION})`;
    const requiresDpa = requiredDocs.includes('dpa');
    const consentDescription = isReconsent
        ? (requiresDpa
            ? 'Vi har uppdaterat våra villkor. Granska och godkänn användarvillkor, integritetspolicy och DPA för att fortsätta.'
            : 'Vi har uppdaterat våra villkor och integritetspolicy. Granska ändringarna och godkänn för att fortsätta.')
        : (requiresDpa
            ? 'Godkänn användarvillkor, integritetspolicy och DPA för att fortsätta använda Veridat.'
            : 'Godkänn användarvillkor och integritetspolicy för att fortsätta använda Veridat.');

    const handleAccept = async () => {
        if (!fullName.trim()) {
            setError('Vänligen ange ditt fullständiga namn.');
            return;
        }

        if (!hasAllDocs) {
            setError(requiresDpa
                ? 'Du måste godkänna användarvillkor, integritetspolicy och DPA för att fortsätta.'
                : 'Du måste godkänna användarvillkor och integritetspolicy för att fortsätta.');
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
                const currentCompany = companyManager.getCurrent();
                const companyContext = {
                    companyId: currentCompany.id,
                    companyOrgNumber: currentCompany.orgNumber?.trim() ? currentCompany.orgNumber.trim() : null
                };

                if (requiredDocs.includes('dpa') && !companyContext.companyId) {
                    throw new Error('Saknar företagskontext för DPA-godkännande');
                }

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

                const acceptanceRows = requiredDocs.map((doc) => ({
                    user_id: user.id,
                    doc_type: doc,
                    version: CURRENT_TERMS_VERSION,
                    accepted_at: acceptedAt,
                    user_agent: navigator.userAgent,
                    dpa_authorized: false,
                    company_id: doc === 'dpa' ? companyContext.companyId : null,
                    company_org_number: doc === 'dpa' ? companyContext.companyOrgNumber : null,
                    accepted_from: 'reconsent'
                }));

                const { error: acceptanceError } = await supabase
                    .from('legal_acceptances')
                    .upsert(acceptanceRows, { onConflict: 'user_id,doc_type,version' });

                if (acceptanceError) throw acceptanceError;

                logger.info('LegalConsentModal: Terms accepted, version updated to', CURRENT_TERMS_VERSION);

                // No consent email sent (email disabled)
            }

            onAccepted(fullName.trim());
        } catch (err: unknown) {
            logger.error('Error accepting terms', err);
            setError('Kunde inte spara ditt godkännande. Försök igen.');
        } finally {
            setIsAccepting(false);
        }
    };

    // Show loading state while fetching profile
    if (isLoading) {
        return (
            <div style={LEGAL_MODAL_LOADING_OVERLAY_STYLE}>
                <div style={LEGAL_MODAL_LOADING_CONTENT_STYLE}>
                    <div style={LEGAL_MODAL_LOADING_SPINNER_STYLE} />
                    Laddar...
                </div>
                <style>{`
                    @keyframes spin { to { transform: rotate(360deg); } }
                `}</style>
            </div>
        );
    }

    return (
        <div style={LEGAL_MODAL_OVERLAY_STYLE}
            data-testid="legal-consent-modal"
        >
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
            <div style={LEGAL_MODAL_CARD_STYLE}>
                {/* Logo/Title */}
                <div style={LEGAL_MODAL_HEADER_STYLE}>
                    <h1 style={LEGAL_MODAL_TITLE_STYLE}>
                        Veridat
                    </h1>
                    <p style={LEGAL_MODAL_SUBTITLE_STYLE}>
                        Din AI-bokföringsassistent
                    </p>
                </div>

                {/* Update Notice */}
                <div style={LEGAL_MODAL_NOTICE_STYLE}>
                    <div style={LEGAL_MODAL_NOTICE_HEADER_STYLE}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/>
                            <path d="M12 6v6l4 2"/>
                        </svg>
                        {consentTitle}
                    </div>
                    <p style={LEGAL_MODAL_NOTICE_TEXT_STYLE}>
                        {consentDescription}
                    </p>

                    {majorChanges.length > 0 && (
                        <ul style={LEGAL_MODAL_CHANGE_LIST_STYLE}>
                            {majorChanges.map((change, index) => (
                                <li key={index} style={LEGAL_MODAL_CHANGE_ITEM_STYLE}>{change}</li>
                            ))}
                        </ul>
                    )}
                </div>

                {/* User Info */}
                {fullName && (
                    <div style={LEGAL_MODAL_USER_INFO_STYLE}>
                        <div style={LEGAL_MODAL_USER_LABEL_STYLE}>
                            Inloggad som
                        </div>
                        <div style={LEGAL_MODAL_USER_NAME_STYLE}>
                            {fullName}
                        </div>
                    </div>
                )}

                {!fullName && (
                    <div style={LEGAL_MODAL_NAME_FIELD_WRAP_STYLE}>
                        <label style={LEGAL_MODAL_NAME_LABEL_STYLE}>
                            Fullständigt namn
                        </label>
                        <input
                            type="text"
                            value={fullName}
                            onInput={(e) => setFullName((e.target as HTMLInputElement).value)}
                            placeholder="T.ex. Anna Andersson"
                            class="input-glass"
                            data-testid="legal-consent-full-name"
                            style={LEGAL_MODAL_NAME_INPUT_STYLE}
                        />
                    </div>
                )}

                <div style={LEGAL_MODAL_CONSENT_WRAP_STYLE}>
                    <label style={LEGAL_MODAL_CONSENT_LABEL_STYLE}>
                        <input
                            type="checkbox"
                            checked={hasAllDocs}
                            onChange={toggleRequiredDocs}
                            data-testid="legal-consent-checkbox"
                        />
                        <span>
                            Jag godkänner{' '}
                            <a href={LEGAL_DOCS.terms.url} target="_blank" style={LEGAL_MODAL_LINK_STYLE}>
                                {LEGAL_DOCS.terms.label}
                            </a>
                            ,{' '}
                            <a href={LEGAL_DOCS.privacy.url} target="_blank" style={LEGAL_MODAL_LINK_STYLE}>
                                {LEGAL_DOCS.privacy.label}
                            </a>
                            {requiresDpa && (
                                <>
                                    {' '}samt{' '}
                                    <a href={LEGAL_DOCS.dpa.url} target="_blank" style={LEGAL_MODAL_LINK_STYLE}>
                                        {LEGAL_DOCS.dpa.label}
                                    </a>
                                    .
                                </>
                            )}
                            {!requiresDpa && '.'}
                        </span>
                    </label>
                    <div style={LEGAL_MODAL_CONSENT_HELP_STYLE}>
                        Läs även{' '}
                        <a href={LEGAL_DOCS.security.url} target="_blank" style={LEGAL_MODAL_LINK_STYLE}>
                            {LEGAL_DOCS.security.label}
                        </a>
                        {' '}för tekniska och organisatoriska skyddsåtgärder.
                    </div>
                </div>

                {/* Accept Button */}
                <button
                    onClick={handleAccept}
                    disabled={isAccepting || !isValid}
                    data-testid="legal-consent-accept-button"
                    style={getLegalAcceptButtonStyle(isAccepting || !isValid)}
                >
                    {isAccepting ? (
                        <span style={LEGAL_MODAL_ACCEPT_LOADING_ROW_STYLE}>
                            <span style={LEGAL_MODAL_ACCEPT_LOADING_SPINNER_STYLE} />
                            Godkänner...
                        </span>
                    ) : (
                        'Godkänn & Fortsätt'
                    )}
                </button>

                {/* Terms Links */}
                <p style={LEGAL_MODAL_FOOTER_LINKS_STYLE}>
                    Läs fullständiga{' '}
                    <a
                        href="/terms"
                        target="_blank"
                        style={LEGAL_MODAL_LINK_STYLE}
                    >
                        användarvillkor
                    </a>
                    {' '}och{' '}
                    <a
                        href="/privacy"
                        target="_blank"
                        style={LEGAL_MODAL_LINK_STYLE}
                    >
                        integritetspolicy
                    </a>
                    {requiresDpa && (
                        <>
                            {' '}och{' '}
                            <a
                                href="/dpa"
                                target="_blank"
                                style={LEGAL_MODAL_LINK_STYLE}
                            >
                                DPA
                            </a>
                        </>
                    )}
                    {'. Läs även '}
                    <a
                        href="/security"
                        target="_blank"
                        style={LEGAL_MODAL_LINK_STYLE}
                    >
                        säkerhetspolicy
                    </a>
                    .
                </p>

                {/* Error Message */}
                {error && (
                    <div style={LEGAL_MODAL_ERROR_BOX_STYLE}>
                        {error}
                    </div>
                )}
            </div>
        </div>
    );
}

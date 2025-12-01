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
                const { data: { user } } = await supabase.auth.getUser();

                if (!user) {
                    throw new Error('Ingen användare inloggad');
                }

                // Update profile
                const { error: updateError } = await supabase
                    .from('profiles')
                    .upsert({
                        id: user.id,
                        has_accepted_terms: true,
                        terms_accepted_at: new Date().toISOString(),
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
                            acceptedAt: new Date().toISOString()
                        }
                    });

                    if (emailError) {
                        console.error('Failed to send consent email:', emailError);
                        // Don't block user access - email failure is logged but not critical
                    } else {
                        console.log('Consent confirmation email sent successfully');
                    }
                } catch (emailException) {
                    console.error('Exception sending consent email:', emailException);
                    // Don't block user access
                }
            }

            // For 'local' mode, we just pass the name back
            // The parent component handles saving to localStorage
            onAccepted(fullName.trim());
        } catch (err: any) {
            console.error('Error accepting terms:', err);
            setError('Kunde inte spara ditt godkännande. Försök igen.');
        } finally {
            setIsAccepting(false);
        }
    };

    const handleDecline = async () => {
        if (mode === 'authenticated') {
            await supabase.auth.signOut();
            window.location.href = '/login';
        } else {
            // In local mode (login page), just reload to reset state
            window.location.reload();
        }
    };

    return (
        <div className="fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: 2147483647, backgroundColor: 'rgba(0,0,0,0.9)', position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}>
            <div className="bg-[#1A1A1A] border border-white/10 rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[90vh]" style={{ position: 'relative', zIndex: 2147483648 }}>

                {/* Header */}
                <div className="p-6 border-b border-white/10 bg-gradient-to-r from-purple-900/20 to-blue-900/20">
                    <h2 className="text-2xl font-bold text-white mb-2">Välkommen till Britta AI</h2>
                    <p className="text-gray-400 text-sm">
                        Innan du fortsätter måste du godkänna våra villkor och ange ditt namn.
                    </p>
                </div>

                {/* Content - Scrollable */}
                <div className="p-6 overflow-y-auto custom-scrollbar space-y-6 text-gray-300 text-sm leading-relaxed">

                    {/* Name Input Section */}
                    <section className="bg-white/5 rounded-lg p-4 border border-white/10">
                        <label htmlFor="fullName" className="block text-sm font-medium text-white mb-2">
                            Ditt fullständiga namn <span className="text-red-400">*</span>
                        </label>
                        <input
                            type="text"
                            id="fullName"
                            value={fullName}
                            onInput={(e) => setFullName((e.target as HTMLInputElement).value)}
                            onBlur={() => setTouched(true)}
                            placeholder="T.ex. Anna Andersson"
                            className={`w-full bg-black/50 border ${touched && !isValid ? 'border-red-500' : 'border-white/20'} rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors`}
                        />
                        {touched && !isValid && (
                            <p className="text-red-400 text-xs mt-1">Vänligen ange ditt namn.</p>
                        )}
                    </section>

                    <section>
                        <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                            <span className="text-blue-400">🤖</span> AI-Ansvarsfriskrivning
                        </h3>
                        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                            <p className="mb-2">
                                Britta AI använder avancerade språkmodeller för att analysera data och generera svar. Observera följande:
                            </p>
                            <ul className="list-disc pl-5 space-y-1">
                                <li>AI kan göra misstag ("hallucinera") och information bör verifieras.</li>
                                <li>Du är ytterst ansvarig för beslut som fattas baserat på AI:ns råd.</li>
                                <li>Känsliga personuppgifter ska hanteras med försiktighet.</li>
                            </ul>
                        </div>
                    </section>

                    <section>
                        <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                            <span className="text-purple-400">🔒</span> Dataskydd & GDPR
                        </h3>
                        <p className="mb-2">
                            Vi värnar om din integritet. Genom att använda tjänsten godkänner du att:
                        </p>
                        <ul className="list-disc pl-5 space-y-1">
                            <li>Vi lagrar din chatthistorik för att tillhandahålla tjänsten.</li>
                            <li>Vi delar viss data med våra AI-partners (t.ex. Google, Anthropic) för bearbetning, men vi säljer aldrig din data.</li>
                            <li>Du har rätt att begära utdrag eller radering av din data enligt GDPR.</li>
                        </ul>
                    </section>

                    <section>
                        <h3 className="text-lg font-semibold text-white mb-3">Användarvillkor</h3>
                        <p>
                            Genom att klicka på "Jag godkänner" bekräftar du att du har läst och förstått ovanstående information samt våra fullständiga <a href="/terms.html" target="_blank" className="text-blue-400 hover:text-blue-300 underline">användarvillkor</a> och <a href="/privacy.html" target="_blank" className="text-blue-400 hover:text-blue-300 underline">integritetspolicy</a>.
                        </p>
                    </section>

                    {error && (
                        <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-lg text-center">
                            {error}
                        </div>
                    )}

                </div>

                {/* Footer - Actions */}
                <div className="p-6 border-t border-white/10 bg-[#151515] flex flex-col sm:flex-row gap-3 justify-between items-center">
                    <div className="text-xs text-gray-500">
                        Villkorsversion: {CURRENT_TERMS_VERSION}
                    </div>
                    <div className="flex flex-col sm:flex-row gap-3">
                        <button
                            onClick={handleDecline}
                            className="px-6 py-2.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors font-medium text-sm"
                        >
                            {mode === 'authenticated' ? 'Avböj & Logga ut' : 'Avböj'}
                        </button>
                        <button
                            onClick={handleAccept}
                            disabled={isAccepting || !isValid}
                            className={`px-8 py-2.5 rounded-lg font-medium shadow-lg transition-all transform flex items-center justify-center gap-2 ${!isValid
                                ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                                : 'bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white shadow-blue-900/20 active:scale-95'
                                }`}
                        >
                            {isAccepting ? (
                                <>
                                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                    Bearbetar...
                                </>
                            ) : (
                                'Jag godkänner villkoren'
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

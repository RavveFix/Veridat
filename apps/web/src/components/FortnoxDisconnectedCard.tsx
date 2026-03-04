/**
 * FortnoxDisconnectedCard - Shared empty-state card for pages requiring Fortnox.
 *
 * Renders a consistent disconnected UI using the `.empty-state` CSS class.
 */

import { FunctionComponent } from 'preact';

type FortnoxContext = 'fakturor' | 'momsrapport' | 'resultat-balans' | 'kvitton' | 'bank';

interface FortnoxDisconnectedCardProps {
    context: FortnoxContext;
    onConnect: () => void;
    connecting?: boolean;
    error?: string;
}

const CONTEXT_TEXT: Record<FortnoxContext, string> = {
    'fakturor': 'Anslut ditt Fortnox-konto för att se fakturor, genomföra attest och synka bokföring.',
    'momsrapport': 'Anslut Fortnox för att generera momsrapport baserad på dina bokförda fakturor.',
    'resultat-balans': 'Anslut Fortnox för att visa resultat- och balansräkning.',
    'kvitton': 'Anslut Fortnox för att exportera granskade kvitton som verifikationer.',
    'bank': 'Anslut Fortnox för att matcha banktransaktioner mot bokföring.',
};

const ERROR_STYLE = {
    fontSize: '0.8rem',
    color: '#ef4444',
    padding: '0.5rem 0.75rem',
    background: 'rgba(239,68,68,0.08)',
    borderRadius: '6px',
    marginTop: '0.5rem',
    maxWidth: '320px',
} as const;

export const FortnoxDisconnectedCard: FunctionComponent<FortnoxDisconnectedCardProps> = ({
    context,
    onConnect,
    connecting = false,
    error,
}) => (
    <div className="panel-card panel-card--no-hover">
        <div className="empty-state">
            <div className="empty-state-icon">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
            </div>
            <h3>Fortnox är inte kopplat</h3>
            <p>{CONTEXT_TEXT[context]}</p>
            <button
                type="button"
                className="empty-state-btn"
                onClick={onConnect}
                disabled={connecting}
                style={connecting ? { opacity: 0.7, cursor: 'wait' } : undefined}
            >
                {connecting ? 'Ansluter...' : 'Anslut Fortnox'}
            </button>
            {error && <div style={ERROR_STYLE}>{error}</div>}
        </div>
    </div>
);

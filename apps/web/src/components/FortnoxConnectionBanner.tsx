/**
 * FortnoxConnectionBanner - Global banner shown when Fortnox is disconnected.
 *
 * Mounted between the top-bar and workspace-split in the app layout.
 * Dismissable per session (sessionStorage).
 */

import { FunctionComponent } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { fortnoxContextService, type FortnoxConnectionStatus } from '../services/FortnoxContextService';

const DISMISS_KEY = 'fortnox-banner-dismissed';

const BANNER_STYLE = {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '0.6rem 1rem',
    margin: '0 1rem 0.5rem',
    borderRadius: '8px',
    background: 'rgba(245, 158, 11, 0.1)',
    border: '1px solid rgba(245, 158, 11, 0.25)',
    fontSize: '0.85rem',
    color: 'var(--text-primary)',
} as const;

const ICON_STYLE = {
    flexShrink: 0,
    color: 'var(--status-warning, #f59e0b)',
} as const;

const TEXT_STYLE = {
    flex: 1,
} as const;

const CONNECT_BTN_STYLE = {
    flexShrink: 0,
    padding: '0.35rem 0.85rem',
    borderRadius: '6px',
    border: 'none',
    background: 'var(--accent-gradient, #3b82f6)',
    color: '#fff',
    fontSize: '0.8rem',
    fontWeight: 600,
    cursor: 'pointer',
} as const;

const DISMISS_BTN_STYLE = {
    flexShrink: 0,
    background: 'none',
    border: 'none',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    padding: '0.25rem',
    lineHeight: 1,
    fontSize: '1rem',
} as const;

export const FortnoxConnectionBanner: FunctionComponent = () => {
    const [status, setStatus] = useState<FortnoxConnectionStatus>(
        fortnoxContextService.getConnectionStatus()
    );
    const [dismissed, setDismissed] = useState(
        () => sessionStorage.getItem(DISMISS_KEY) === '1'
    );

    useEffect(() => {
        const handler = (e: Event) => {
            setStatus((e as CustomEvent<FortnoxConnectionStatus>).detail);
        };
        fortnoxContextService.addEventListener('connection-changed', handler);
        return () => fortnoxContextService.removeEventListener('connection-changed', handler);
    }, []);

    if (dismissed || status === 'connected' || status === 'checking') {
        return null;
    }

    const handleDismiss = () => {
        sessionStorage.setItem(DISMISS_KEY, '1');
        setDismissed(true);
    };

    const handleConnect = () => {
        window.dispatchEvent(new CustomEvent('open-integrations-modal'));
    };

    return (
        <div style={BANNER_STYLE} role="status">
            <svg style={ICON_STYLE} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span style={TEXT_STYLE}>Fortnox är inte kopplat</span>
            <button type="button" style={CONNECT_BTN_STYLE} onClick={handleConnect}>
                Anslut
            </button>
            <button type="button" style={DISMISS_BTN_STYLE} onClick={handleDismiss} aria-label="Stäng">
                &times;
            </button>
        </div>
    );
};

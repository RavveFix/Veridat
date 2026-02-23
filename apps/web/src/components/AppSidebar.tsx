/**
 * AppSidebar - Huvudnavigation med sidlänkar + konversationslista.
 *
 * Ersätter den gamla sidebar-footern med 5 primära sidlänkar,
 * konversationslista, och en kompakt footer (Sök, Inställningar, Tema).
 */

import { FunctionComponent } from 'preact';
import { ConversationList } from './Chat/ConversationList';

// =============================================================================
// TYPES
// =============================================================================

export type AppPage = 'overview' | 'chat' | 'invoices' | 'bank' | 'reports';

export interface AppSidebarProps {
    activePage: AppPage;
    onNavigate: (page: AppPage) => void;
    onNewChat: () => void;
    onSelectConversation: (id: string) => void;
    onOpenSettings: () => void;
    onOpenSearch: () => void;
    onOpenIntegrations: () => void;
    onToggleTheme: () => void;
    currentConversationId: string | null;
    companyId: string | null;
}

// =============================================================================
// NAV CONFIG
// =============================================================================

interface NavItem {
    page: AppPage;
    label: string;
    icon: string;
}

const NAV_ITEMS: NavItem[] = [
    { page: 'overview', label: 'Översikt', icon: 'overview' },
    { page: 'chat', label: 'Assistent', icon: 'chat' },
    { page: 'invoices', label: 'Fakturor', icon: 'invoices' },
    { page: 'bank', label: 'Bank', icon: 'bank' },
    { page: 'reports', label: 'Rapporter', icon: 'reports' },
];

// =============================================================================
// ICONS
// =============================================================================

function NavIcon({ type }: { type: string }) {
    const props = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round' as const, 'stroke-linejoin': 'round' as const };

    switch (type) {
        case 'overview':
            return (
                <svg {...props}>
                    <rect x="3" y="3" width="7" height="7" rx="1.5" />
                    <rect x="14" y="3" width="7" height="7" rx="1.5" />
                    <rect x="3" y="14" width="7" height="7" rx="1.5" />
                    <rect x="14" y="14" width="7" height="7" rx="1.5" />
                </svg>
            );
        case 'chat':
            return (
                <svg {...props}>
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
            );
        case 'invoices':
            return (
                <svg {...props}>
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                </svg>
            );
        case 'bank':
            return (
                <svg {...props}>
                    <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
                    <line x1="1" y1="10" x2="23" y2="10" />
                </svg>
            );
        case 'reports':
            return (
                <svg {...props}>
                    <line x1="18" y1="20" x2="18" y2="10" />
                    <line x1="12" y1="20" x2="12" y2="4" />
                    <line x1="6" y1="20" x2="6" y2="14" />
                </svg>
            );
        default:
            return null;
    }
}

// =============================================================================
// COMPONENT
// =============================================================================

export const AppSidebar: FunctionComponent<AppSidebarProps> = ({
    activePage,
    onNavigate,
    onNewChat,
    onSelectConversation,
    onOpenSettings,
    onOpenSearch,
    onOpenIntegrations,
    onToggleTheme,
    currentConversationId,
    companyId,
}) => {
    return (
        <div class="app-sidebar">
            {/* Primary Navigation */}
            <nav class="app-sidebar__nav" aria-label="Huvudnavigation">
                {NAV_ITEMS.map((item) => (
                    <button
                        key={item.page}
                        class={`app-sidebar__nav-btn${activePage === item.page ? ' app-sidebar__nav-btn--active' : ''}`}
                        onClick={() => onNavigate(item.page)}
                        aria-current={activePage === item.page ? 'page' : undefined}
                    >
                        <NavIcon type={item.icon} />
                        <span>{item.label}</span>
                    </button>
                ))}
            </nav>

            {/* New Conversation Button */}
            <button class="app-sidebar__new-chat" onClick={onNewChat}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                <span>Ny konversation</span>
            </button>

            {/* Conversation List */}
            <div class="app-sidebar__conversations">
                <ConversationList
                    currentConversationId={currentConversationId}
                    onSelectConversation={(id: string) => {
                        onNavigate('chat');
                        onSelectConversation(id);
                    }}
                    companyId={companyId}
                />
            </div>

            {/* Footer */}
            <div class="app-sidebar__footer">
                <button class="app-sidebar__footer-btn" onClick={onOpenSearch} title="Sök konversationer (Cmd+K)">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="11" cy="11" r="8" />
                        <path d="m21 21-4.35-4.35" />
                    </svg>
                </button>
                <button class="app-sidebar__footer-btn" onClick={onOpenSettings} title="Inställningar">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="3" />
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                    </svg>
                </button>
                <button class="app-sidebar__footer-btn" onClick={onOpenIntegrations} title="Integrationer (Fortnox)">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                    </svg>
                </button>
                <button class="app-sidebar__footer-btn" onClick={onToggleTheme} title="Byt tema">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                    </svg>
                </button>
            </div>
        </div>
    );
};

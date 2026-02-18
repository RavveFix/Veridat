/**
 * CopilotPanel 2.0 - Proactive bookkeeping assistant UI.
 *
 * Section-based layout: Varningar, Insikter, Forslag.
 * Notifications with actions dispatch events to open tools.
 * Refresh button forces a new check.
 */

import { useEffect, useMemo, useState } from 'preact/hooks';
import {
    copilotService,
    type CopilotNotification,
    type NotificationCategory,
    type NotificationSeverity,
} from '../services/CopilotService';

// =============================================================================
// ICON MAP
// =============================================================================

const TYPE_ICONS: Record<string, string> = {
    overdue_invoice: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    unbooked_invoice: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
    vat_reminder: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    cashflow_forecast: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
    bank_reconciliation: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><polyline points="7 16 12 11 15 14 21 8"/></svg>',
    invoice_inbox: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/></svg>',
    anomaly_amount: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    anomaly_duplicate: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="8" y="2" width="14" height="14" rx="2"/><rect x="2" y="8" width="14" height="14" rx="2"/></svg>',
    deadline_reminder: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    action_suggestion: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    guardian_alert: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l7 4v6c0 5-3.5 9-7 10-3.5-1-7-5-7-10V6l7-4z"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
};

const SEVERITY_COLORS: Record<NotificationSeverity, string> = {
    critical: '#ef4444',
    warning: '#f59e0b',
    info: '#3b82f6',
    success: '#10b981',
};

const CATEGORY_LABELS: Record<NotificationCategory, string> = {
    varning: 'Varningar',
    insikt: 'Insikter',
    forslag: 'Förslag',
};

const CATEGORY_ORDER: NotificationCategory[] = ['varning', 'insikt', 'forslag'];

const COPILOT_PANEL_STACK_STYLE = {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem'
};

const COPILOT_HEADER_ROW_STYLE = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.5rem'
};

const COPILOT_HEADER_BADGE_WRAP_STYLE = {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem'
};

const COPILOT_UNREAD_BADGE_STYLE = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '20px',
    height: '20px',
    borderRadius: '50%',
    background: '#ef4444',
    color: '#fff',
    fontSize: '0.7rem',
    fontWeight: 700
};

const COPILOT_ACTIONS_ROW_STYLE = {
    display: 'flex',
    gap: '0.4rem'
};

const COPILOT_MARK_ALL_READ_BUTTON_STYLE = {
    background: 'transparent',
    border: 'none',
    color: 'var(--text-secondary)',
    fontSize: '0.72rem',
    cursor: 'pointer',
    padding: '0.2rem 0.4rem'
};

const COPILOT_REFRESH_BUTTON_BASE_STYLE = {
    background: 'transparent',
    border: '1px solid var(--glass-border)',
    borderRadius: '6px',
    color: 'var(--text-secondary)',
    fontSize: '0.72rem',
    padding: '0.2rem 0.5rem'
};

const COPILOT_ALL_CLEAR_CARD_STYLE = {
    display: 'flex',
    gap: '0.75rem',
    alignItems: 'center'
};

const COPILOT_ALL_CLEAR_ICON_STYLE = {
    color: '#22c55e'
};

const COPILOT_ALL_CLEAR_TITLE_STYLE = {
    fontWeight: 600,
    color: 'var(--text-primary)'
};

const COPILOT_ALL_CLEAR_DESCRIPTION_STYLE = {
    fontSize: '0.8rem',
    color: 'var(--text-secondary)'
};

const COPILOT_SECTION_TITLE_STYLE = {
    marginBottom: '0.4rem'
};

const COPILOT_SECTION_ITEMS_STYLE = {
    display: 'grid',
    gap: '0.4rem'
};

const COPILOT_CARD_BASE_STYLE = {
    padding: '0.6rem 0.75rem',
    display: 'flex',
    gap: '0.6rem',
    alignItems: 'flex-start'
};

const COPILOT_CARD_ICON_BASE_STYLE = {
    flexShrink: 0,
    marginTop: '0.1rem'
};

const COPILOT_CARD_CONTENT_STYLE = {
    flex: 1,
    minWidth: 0
};

const COPILOT_CARD_HEADER_STYLE = {
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
    marginBottom: '0.1rem'
};

const COPILOT_CARD_TITLE_STYLE = {
    fontWeight: 600,
    color: 'var(--text-primary)',
    fontSize: '0.82rem'
};

const COPILOT_GUARDIAN_BADGE_STYLE = {
    fontSize: '0.62rem',
    fontWeight: 700,
    padding: '0.12rem 0.45rem',
    borderRadius: '999px',
    border: '1px solid var(--glass-border)',
    background: 'rgba(255,255,255,0.04)',
    color: 'var(--text-secondary)',
    flexShrink: 0
};

const COPILOT_CARD_DESCRIPTION_STYLE = {
    fontSize: '0.78rem',
    color: 'var(--text-secondary)',
    lineHeight: 1.35
};

const COPILOT_DISMISS_BUTTON_STYLE = {
    background: 'transparent',
    border: 'none',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    padding: '0.15rem',
    fontSize: '0.8rem',
    lineHeight: 1,
    opacity: 0.6
};

// =============================================================================
// HELPERS
// =============================================================================

function openPrompt(prompt: string) {
    const input = document.getElementById('message-input') as HTMLTextAreaElement | null;
    if (!input) return;
    input.value = prompt;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
}

function dispatchToolAction(action: string) {
    window.dispatchEvent(new CustomEvent('copilot-open-tool', { detail: { tool: action } }));
}

function getCopilotRefreshButtonStyle(refreshing: boolean) {
    return {
        ...COPILOT_REFRESH_BUTTON_BASE_STYLE,
        cursor: refreshing ? 'wait' : 'pointer'
    };
}

function getCopilotNotificationCardStyle(read: boolean, severityColor: string) {
    return {
        ...COPILOT_CARD_BASE_STYLE,
        border: `1px solid ${read ? 'var(--surface-border)' : `${severityColor}30`}`,
        background: read ? 'var(--surface-1)' : `${severityColor}08`
    };
}

function getCopilotNotificationIconStyle(severityColor: string) {
    return {
        ...COPILOT_CARD_ICON_BASE_STYLE,
        color: severityColor
    };
}

function getCopilotUnreadDotStyle(severityColor: string) {
    return {
        width: '6px',
        height: '6px',
        borderRadius: '50%',
        background: severityColor,
        flexShrink: 0
    };
}

function getCopilotActionTextStyle(severityColor: string) {
    return {
        fontSize: '0.7rem',
        color: severityColor,
        fontWeight: 600,
        marginTop: '0.25rem'
    };
}

// =============================================================================
// COMPONENT
// =============================================================================

export function CopilotPanel() {
    const [notifications, setNotifications] = useState<CopilotNotification[]>(copilotService.getNotifications());
    const [refreshing, setRefreshing] = useState(false);

    useEffect(() => {
        const handler = () => setNotifications([...copilotService.getNotifications()]);
        copilotService.addEventListener('copilot-updated', handler as EventListener);
        return () => copilotService.removeEventListener('copilot-updated', handler as EventListener);
    }, []);

    const grouped = useMemo(() => {
        const map: Record<NotificationCategory, CopilotNotification[]> = {
            varning: [], insikt: [], forslag: [],
        };
        for (const n of notifications) {
            const cat = n.category || 'insikt';
            if (map[cat]) map[cat].push(n);
        }
        return map;
    }, [notifications]);

    const handleRefresh = async () => {
        setRefreshing(true);
        await copilotService.forceCheck();
        setRefreshing(false);
    };

    const hasAny = notifications.length > 0;
    const unreadCount = notifications.filter(n => !n.read).length;

    return (
        <div className="panel-stagger" style={COPILOT_PANEL_STACK_STYLE}>
            {/* Header row */}
            <div style={COPILOT_HEADER_ROW_STYLE}>
                <div style={COPILOT_HEADER_BADGE_WRAP_STYLE}>
                    {unreadCount > 0 && (
                        <span style={COPILOT_UNREAD_BADGE_STYLE}>
                            {unreadCount}
                        </span>
                    )}
                </div>
                <div style={COPILOT_ACTIONS_ROW_STYLE}>
                    {unreadCount > 0 && (
                        <button
                            type="button"
                            onClick={() => copilotService.markAllRead()}
                            style={COPILOT_MARK_ALL_READ_BUTTON_STYLE}
                        >
                            Markera alla lästa
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => void handleRefresh()}
                        disabled={refreshing}
                        style={getCopilotRefreshButtonStyle(refreshing)}
                    >
                        {refreshing ? '...' : 'Uppdatera'}
                    </button>
                </div>
            </div>

            {/* All clear */}
            {!hasAny && (
                <div className="panel-card panel-card--no-hover" style={COPILOT_ALL_CLEAR_CARD_STYLE}>
                    <div style={COPILOT_ALL_CLEAR_ICON_STYLE} dangerouslySetInnerHTML={{
                        __html: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
                    }} />
                    <div>
                        <div style={COPILOT_ALL_CLEAR_TITLE_STYLE}>Allt ser bra ut</div>
                        <div style={COPILOT_ALL_CLEAR_DESCRIPTION_STYLE}>Inga aktiva påminnelser just nu.</div>
                    </div>
                </div>
            )}

            {/* Sections */}
            {hasAny && CATEGORY_ORDER.map(cat => {
                const items = grouped[cat];
                if (items.length === 0) return null;

                return (
                    <div key={cat}>
                        <div className="panel-section-title" style={COPILOT_SECTION_TITLE_STYLE}>
                            {CATEGORY_LABELS[cat]} ({items.length})
                        </div>
                        <div className="panel-stagger" style={COPILOT_SECTION_ITEMS_STYLE}>
                            {items.map(notif => (
                                <NotificationCard key={notif.id} notif={notif} />
                            ))}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

// =============================================================================
// NOTIFICATION CARD
// =============================================================================

function NotificationCard({ notif }: { notif: CopilotNotification }) {
    const iconSvg = TYPE_ICONS[notif.type] || TYPE_ICONS.action_suggestion;
    const severityColor = SEVERITY_COLORS[notif.severity] || SEVERITY_COLORS.info;
    const isGuardian = notif.id.startsWith('guardian-');

    const handleClick = () => {
        copilotService.markAsRead(notif.id);
        if (notif.action) {
            dispatchToolAction(notif.action);
        } else {
            openPrompt(notif.prompt);
        }
    };

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={handleClick}
            onKeyDown={e => { if (e.key === 'Enter') handleClick(); }}
            className="panel-card panel-card--interactive"
            style={getCopilotNotificationCardStyle(notif.read, severityColor)}
        >
            {/* Icon */}
            <div
                style={getCopilotNotificationIconStyle(severityColor)}
                dangerouslySetInnerHTML={{ __html: iconSvg }}
            />

            {/* Content */}
            <div style={COPILOT_CARD_CONTENT_STYLE}>
                <div style={COPILOT_CARD_HEADER_STYLE}>
                    <span style={COPILOT_CARD_TITLE_STYLE}>
                        {notif.title}
                    </span>
                    {isGuardian && (
                        <span style={COPILOT_GUARDIAN_BADGE_STYLE}>
                            Guardian
                        </span>
                    )}
                    {!notif.read && (
                        <span style={getCopilotUnreadDotStyle(severityColor)} />
                    )}
                </div>
                <div style={COPILOT_CARD_DESCRIPTION_STYLE}>
                    {notif.description}
                </div>
                {notif.action && (
                    <div style={getCopilotActionTextStyle(severityColor)}>
                        Öppna →
                    </div>
                )}
            </div>

            {/* Dismiss */}
            <button
                type="button"
                onClick={event => {
                    event.stopPropagation();
                    if (isGuardian) {
                        void copilotService.resolveGuardianNotification(notif.id);
                        return;
                    }
                    copilotService.dismiss(notif.id);
                }}
                style={COPILOT_DISMISS_BUTTON_STYLE}
                aria-label="Avfärda"
            >
                x
            </button>
        </div>
    );
}

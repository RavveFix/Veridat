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
        <div className="panel-stagger" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {/* Header row */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '0.5rem',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {unreadCount > 0 && (
                        <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: '20px',
                            height: '20px',
                            borderRadius: '50%',
                            background: '#ef4444',
                            color: '#fff',
                            fontSize: '0.7rem',
                            fontWeight: 700,
                        }}>
                            {unreadCount}
                        </span>
                    )}
                </div>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                    {unreadCount > 0 && (
                        <button
                            type="button"
                            onClick={() => copilotService.markAllRead()}
                            style={{
                                background: 'transparent',
                                border: 'none',
                                color: 'var(--text-secondary)',
                                fontSize: '0.72rem',
                                cursor: 'pointer',
                                padding: '0.2rem 0.4rem',
                            }}
                        >
                            Markera alla lästa
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => void handleRefresh()}
                        disabled={refreshing}
                        style={{
                            background: 'transparent',
                            border: '1px solid var(--glass-border)',
                            borderRadius: '6px',
                            color: 'var(--text-secondary)',
                            fontSize: '0.72rem',
                            cursor: refreshing ? 'wait' : 'pointer',
                            padding: '0.2rem 0.5rem',
                        }}
                    >
                        {refreshing ? '...' : 'Uppdatera'}
                    </button>
                </div>
            </div>

            {/* All clear */}
            {!hasAny && (
                <div className="panel-card panel-card--no-hover" style={{
                    display: 'flex',
                    gap: '0.75rem',
                    alignItems: 'center',
                }}>
                    <div style={{ color: '#22c55e' }} dangerouslySetInnerHTML={{
                        __html: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
                    }} />
                    <div>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Allt ser bra ut</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Inga aktiva påminnelser just nu.</div>
                    </div>
                </div>
            )}

            {/* Sections */}
            {hasAny && CATEGORY_ORDER.map(cat => {
                const items = grouped[cat];
                if (items.length === 0) return null;

                return (
                    <div key={cat}>
                        <div className="panel-section-title" style={{ marginBottom: '0.4rem' }}>
                            {CATEGORY_LABELS[cat]} ({items.length})
                        </div>
                        <div className="panel-stagger" style={{ display: 'grid', gap: '0.4rem' }}>
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
            style={{
                padding: '0.6rem 0.75rem',
                border: `1px solid ${notif.read ? 'var(--surface-border)' : `${severityColor}30`}`,
                background: notif.read ? 'var(--surface-1)' : `${severityColor}08`,
                display: 'flex',
                gap: '0.6rem',
                alignItems: 'flex-start',
            }}
        >
            {/* Icon */}
            <div
                style={{ color: severityColor, flexShrink: 0, marginTop: '0.1rem' }}
                dangerouslySetInnerHTML={{ __html: iconSvg }}
            />

            {/* Content */}
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    marginBottom: '0.1rem',
                }}>
                    <span style={{
                        fontWeight: 600,
                        color: 'var(--text-primary)',
                        fontSize: '0.82rem',
                    }}>
                        {notif.title}
                    </span>
                    {!notif.read && (
                        <span style={{
                            width: '6px',
                            height: '6px',
                            borderRadius: '50%',
                            background: severityColor,
                            flexShrink: 0,
                        }} />
                    )}
                </div>
                <div style={{
                    fontSize: '0.78rem',
                    color: 'var(--text-secondary)',
                    lineHeight: 1.35,
                }}>
                    {notif.description}
                </div>
                {notif.action && (
                    <div style={{
                        fontSize: '0.7rem',
                        color: severityColor,
                        fontWeight: 600,
                        marginTop: '0.25rem',
                    }}>
                        Öppna →
                    </div>
                )}
            </div>

            {/* Dismiss */}
            <button
                type="button"
                onClick={event => {
                    event.stopPropagation();
                    copilotService.dismiss(notif.id);
                }}
                style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    padding: '0.15rem',
                    fontSize: '0.8rem',
                    lineHeight: 1,
                    opacity: 0.6,
                }}
                aria-label="Avfärda"
            >
                x
            </button>
        </div>
    );
}

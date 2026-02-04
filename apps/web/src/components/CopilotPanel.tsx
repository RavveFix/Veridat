import { useEffect, useState } from 'preact/hooks';
import { copilotService, type CopilotNotification } from '../services/CopilotService';

const ICONS: Record<string, { svg: string; color: string }> = {
    overdue_invoice: {
        svg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
        color: '#f59e0b'
    },
    unbooked_invoice: {
        svg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
        color: '#3b82f6'
    },
    vat_reminder: {
        svg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
        color: '#3b82f6'
    }
};

function openPrompt(prompt: string) {
    const input = document.getElementById('message-input') as HTMLTextAreaElement | null;
    if (!input) return;
    input.value = prompt;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
}

export function CopilotPanel() {
    const [notifications, setNotifications] = useState<CopilotNotification[]>(copilotService.getNotifications());

    useEffect(() => {
        const handler = () => setNotifications(copilotService.getNotifications());
        copilotService.addEventListener('copilot-updated', handler as EventListener);
        return () => copilotService.removeEventListener('copilot-updated', handler as EventListener);
    }, []);

    if (notifications.length === 0) {
        return (
            <div style={{
                padding: '0.8rem 1rem',
                borderRadius: '10px',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                background: 'rgba(255, 255, 255, 0.03)',
                display: 'flex',
                gap: '0.75rem',
                alignItems: 'center'
            }}>
                <div style={{ color: '#22c55e' }} dangerouslySetInnerHTML={{
                    __html: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
                }} />
                <div>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Allt ser bra ut</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Inga aktiva påminnelser just nu.</div>
                </div>
            </div>
        );
    }

    return (
        <div style={{ display: 'grid', gap: '0.6rem' }}>
            {notifications.map((notif) => {
                const icon = ICONS[notif.type] || ICONS.unbooked_invoice;
                return (
                    <div
                        key={notif.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                            copilotService.markAsRead(notif.id);
                            openPrompt(notif.prompt);
                        }}
                        style={{
                            padding: '0.75rem 0.9rem',
                            borderRadius: '10px',
                            border: '1px solid rgba(255, 255, 255, 0.08)',
                            background: notif.read ? 'rgba(255, 255, 255, 0.02)' : 'rgba(59, 130, 246, 0.1)',
                            display: 'flex',
                            gap: '0.75rem',
                            alignItems: 'flex-start',
                            cursor: 'pointer'
                        }}
                    >
                        <div style={{ color: icon.color }} dangerouslySetInnerHTML={{ __html: icon.svg }} />
                        <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{notif.title}</div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{notif.description}</div>
                        </div>
                        <button
                            type="button"
                            onClick={(event) => {
                                event.stopPropagation();
                                copilotService.dismiss(notif.id);
                            }}
                            style={{
                                background: 'transparent',
                                border: 'none',
                                color: 'var(--text-secondary)',
                                cursor: 'pointer'
                            }}
                            aria-label="Avfärda"
                        >
                            x
                        </button>
                    </div>
                );
            })}
        </div>
    );
}

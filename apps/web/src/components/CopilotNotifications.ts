/**
 * CopilotNotifications - Renders copilot notifications in the Fortnox sidebar
 *
 * Manages:
 * - Badge count on the sidebar toggle button
 * - Notification list in the copilot section
 * - Click handlers to populate chat input with prompts
 */

import { copilotService, type CopilotNotification } from '../services/CopilotService';

// SVG icons for notification types
const ICONS: Record<string, { svg: string; class: string }> = {
    overdue_invoice: {
        svg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
        class: 'warning'
    },
    unbooked_invoice: {
        svg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
        class: 'info'
    },
    vat_reminder: {
        svg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
        class: 'info'
    }
};

export class CopilotNotificationsRenderer {
    private container: HTMLElement | null = null;
    private toggleBtn: HTMLButtonElement | null = null;

    init(container: HTMLElement, toggleBtn: HTMLButtonElement | null): void {
        this.container = container;
        this.toggleBtn = toggleBtn;

        // Listen for copilot updates
        copilotService.addEventListener('copilot-updated', () => {
            this.render();
            this.updateBadge();
        });

        // Initial render
        this.render();
        this.updateBadge();
    }

    /** Re-render the notification list. */
    render(): void {
        if (!this.container) return;

        const notifications = copilotService.getNotifications();

        if (notifications.length === 0) {
            this.container.innerHTML = `
                <div class="fortnox-notification">
                    <div class="fortnox-notification-icon info">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2">
                            <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
                            <polyline points="22 4 12 14.01 9 11.01"/>
                        </svg>
                    </div>
                    <div class="fortnox-notification-text">
                        <div class="fortnox-notification-title">Allt ser bra ut</div>
                        <div class="fortnox-notification-desc">Inga aktiva påminnelser just nu.</div>
                    </div>
                </div>
            `;
            return;
        }

        this.container.innerHTML = notifications.map(n => this.renderNotification(n)).join('');

        // Bind click handlers
        this.container.querySelectorAll('[data-notif-id]').forEach(el => {
            el.addEventListener('click', () => {
                const id = (el as HTMLElement).dataset.notifId!;
                const notif = notifications.find(n => n.id === id);
                if (notif) {
                    this.handleClick(notif);
                }
            });
        });

        // Bind dismiss buttons
        this.container.querySelectorAll('[data-dismiss-id]').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = (el as HTMLElement).dataset.dismissId!;
                copilotService.dismiss(id);
            });
        });
    }

    /** Update the badge count on the toggle button. */
    updateBadge(): void {
        if (!this.toggleBtn) return;

        const count = copilotService.getUnreadCount();
        let badge = this.toggleBtn.querySelector('.fortnox-toggle-badge') as HTMLElement;

        if (count === 0) {
            badge?.remove();
            return;
        }

        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'fortnox-toggle-badge';
            this.toggleBtn.appendChild(badge);
        }
        badge.textContent = String(count > 9 ? '9+' : count);
    }

    // --- Rendering helpers ---

    private renderNotification(notif: CopilotNotification): string {
        const icon = ICONS[notif.type] || ICONS.unbooked_invoice;
        const unreadClass = notif.read ? '' : ' copilot-unread';

        return `
            <div class="fortnox-notification${unreadClass}" data-notif-id="${notif.id}" role="button" tabindex="0">
                <div class="fortnox-notification-icon ${icon.class}">
                    ${icon.svg}
                </div>
                <div class="fortnox-notification-text">
                    <div class="fortnox-notification-title">${this.escapeHtml(notif.title)}</div>
                    <div class="fortnox-notification-desc">${this.escapeHtml(notif.description)}</div>
                </div>
                <button class="copilot-dismiss-btn" data-dismiss-id="${notif.id}" aria-label="Avfärda" title="Avfärda">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M18 6L6 18M6 6l12 12"/>
                    </svg>
                </button>
            </div>
        `;
    }

    private handleClick(notif: CopilotNotification): void {
        // Mark as read
        copilotService.markAsRead(notif.id);

        // Populate chat input
        const input = document.getElementById('message-input') as HTMLTextAreaElement;
        if (input) {
            input.value = notif.prompt;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.focus();
        }
    }

    private escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

/**
 * FortnoxSidebar - Contextual Fortnox panel
 *
 * Shows relevant Fortnox data based on chat context:
 * - Active entity (customer/supplier/invoice/account)
 * - Quick actions relevant to current context
 * - Copilot notifications (placeholder for Fas 4)
 */

import { fortnoxContextService, type FortnoxEntity, type FortnoxConnectionStatus } from '../services/FortnoxContextService';
import { skillDetectionService } from '../services/SkillDetectionService';
import { CopilotNotificationsRenderer } from './CopilotNotifications';
import { logger } from '../services/LoggerService';

// BAS account name lookup for common accounts
const BAS_ACCOUNTS: Record<string, string> = {
    '1510': 'Kundfordringar', '1910': 'Kassa', '1920': 'PlusGiro', '1930': 'Företagskonto',
    '2440': 'Leverantörsskulder', '2610': 'Utgående moms 25%', '2620': 'Utgående moms 12%',
    '2630': 'Utgående moms 6%', '2640': 'Ingående moms', '2641': 'Ingående moms 25%',
    '2650': 'Redovisningskonto moms', '2710': 'Personalskatt', '2510': 'Skatteskuld',
    '3010': 'Försäljning varor 25%', '3011': 'Försäljning tjänster', '3040': 'Försäljning 0%',
    '4010': 'Inköp varor', '5010': 'Lokalhyra', '5410': 'Förbrukningsinventarier',
    '5460': 'Förbrukningsmaterial', '6110': 'Kontorsmaterial', '6540': 'IT-tjänster',
    '6570': 'Bankkostnader', '6580': 'Konsultarvoden', '6590': 'Övriga externa tjänster',
    '6970': 'Representation', '1630': 'Skattefordran',
};

export class FortnoxSidebar {
    private container: HTMLElement | null = null;
    private isOpen = false;
    private toggleBtn: HTMLButtonElement | null = null;
    private copilotRenderer = new CopilotNotificationsRenderer();

    init(containerId: string): void {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            logger.warn('FortnoxSidebar: container not found', { containerId });
            return;
        }

        this.render();
        this.bindEvents();
        this.initCopilot();
    }

    // --- Public API ---

    toggle(): void {
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    }

    open(): void {
        if (this.isOpen) return;
        this.isOpen = true;
        this.container?.classList.add('open');
        document.querySelector('.app-layout')?.classList.add('fortnox-sidebar-open');
        this.toggleBtn?.classList.add('active');
        this.showBackdrop();
    }

    close(): void {
        if (!this.isOpen) return;
        this.isOpen = false;
        this.container?.classList.remove('open');
        document.querySelector('.app-layout')?.classList.remove('fortnox-sidebar-open');
        this.toggleBtn?.classList.remove('active');
        this.hideBackdrop();
    }

    setToggleButton(btn: HTMLButtonElement): void {
        this.toggleBtn = btn;
    }

    updateEntity(entity: FortnoxEntity | null): void {
        const body = this.container?.querySelector('.fortnox-sidebar-body');
        if (!body) return;

        if (!entity) {
            this.renderEmptyState(body as HTMLElement);
            return;
        }

        this.renderEntityContext(body as HTMLElement, entity);
    }

    updateConnectionStatus(status: FortnoxConnectionStatus): void {
        const badge = this.container?.querySelector('.fortnox-sidebar-status');
        if (!badge) return;

        badge.className = `fortnox-sidebar-status ${status}`;
        badge.textContent = status === 'connected' ? 'Ansluten' : status === 'checking' ? '...' : 'Ej ansluten';

        const body = this.container?.querySelector('.fortnox-sidebar-body') as HTMLElement | null;
        if (body && !fortnoxContextService.getActiveEntity()) {
            this.renderEmptyState(body);
        }
    }

    // --- Copilot ---

    private initCopilot(): void {
        const copilotContainer = this.container?.querySelector('.fortnox-copilot-container') as HTMLElement;
        this.copilotRenderer.init(copilotContainer, this.toggleBtn);
    }

    // --- Rendering ---

    private render(): void {
        if (!this.container) return;

        this.container.className = 'fortnox-sidebar';
        this.container.innerHTML = `
            <div class="fortnox-sidebar-header">
                <div class="fortnox-sidebar-title">
                    <div class="fortnox-logo">FX</div>
                    <span>Fortnox</span>
                    <span class="fortnox-sidebar-status disconnected">Ej ansluten</span>
                </div>
                <button class="fortnox-sidebar-close" aria-label="Stäng panel">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M18 6L6 18M6 6l12 12"/>
                    </svg>
                </button>
            </div>
            <div class="fortnox-sidebar-body"></div>
            <div class="fortnox-sidebar-section fortnox-copilot-section">
                <div class="fortnox-sidebar-section-label">Copilot</div>
                <div class="fortnox-copilot-container"></div>
            </div>
        `;

        // Initial empty state
        const body = this.container.querySelector('.fortnox-sidebar-body') as HTMLElement;
        if (body) this.renderEmptyState(body);
    }

    private renderEmptyState(body: HTMLElement): void {
        const isConnected = fortnoxContextService.isConnected();

        if (!isConnected) {
            body.innerHTML = `
                <div class="fortnox-sidebar-empty">
                    <div class="fortnox-sidebar-empty-icon">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#6b8de3" stroke-width="1.5">
                            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                        </svg>
                    </div>
                    <h3>Anslut Fortnox</h3>
                    <p>Koppla ditt Fortnox-konto för att se kunddata, leverantörer och snabbåtgärder här.</p>
                </div>
            `;
            return;
        }

        body.innerHTML = `
            <div class="fortnox-sidebar-empty">
                <div class="fortnox-sidebar-empty-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#6b8de3" stroke-width="1.5">
                        <circle cx="11" cy="11" r="8"/>
                        <path d="m21 21-4.35-4.35"/>
                    </svg>
                </div>
                <h3>Väntar på kontext</h3>
                <p>Börja chatta så visar jag relevant Fortnox-data automatiskt.</p>
            </div>
        `;
    }

    private renderEntityContext(body: HTMLElement, entity: FortnoxEntity): void {
        const showExplanation = skillDetectionService.shouldShowExplanation(
            entity.type === 'account' ? 'account' : 'general'
        );

        body.innerHTML = `
            <div class="fortnox-sidebar-section">
                <div class="fortnox-sidebar-section-label">Aktiv kontext</div>
                ${this.renderEntityCard(entity, showExplanation)}
            </div>
            <div class="fortnox-sidebar-section">
                <div class="fortnox-sidebar-section-label">Snabbåtgärder</div>
                <div class="fortnox-quick-actions">
                    ${this.renderQuickActions(entity)}
                </div>
            </div>
        `;

        // Bind quick action buttons
        body.querySelectorAll('.fortnox-action-btn[data-action]').forEach(btn => {
            btn.addEventListener('click', () => {
                const action = (btn as HTMLElement).dataset.action;
                this.handleQuickAction(action || '', entity);
            });
        });
    }

    private renderEntityCard(entity: FortnoxEntity, showExplanation: boolean): string {
        const typeLabels: Record<string, string> = {
            customer: 'Kund', supplier: 'Leverantör', invoice: 'Faktura',
            voucher: 'Verifikat', article: 'Artikel', account: 'Konto',
        };

        let details = '';
        const data = entity.data;

        switch (entity.type) {
            case 'customer':
                details = this.renderDetail('Kundnr', entity.id)
                    + this.renderDetail('E-post', data.Email as string || '—')
                    + this.renderDetail('Org.nr', data.OrganisationNumber as string || '—');
                break;
            case 'supplier':
                details = this.renderDetail('Lev.nr', entity.id)
                    + this.renderDetail('E-post', data.Email as string || '—')
                    + this.renderDetail('Org.nr', data.OrganisationNumber as string || '—');
                break;
            case 'account':
                {
                    const accountName = BAS_ACCOUNTS[entity.id] || 'Okänt konto';
                    details = this.renderDetail('Kontonr', entity.id)
                        + this.renderDetail('Namn', accountName);
                    break;
                }
            case 'voucher':
                details = this.renderDetail('Verifikat', entity.id);
                break;
            default:
                details = this.renderDetail('ID', entity.id);
        }

        let explanationHtml = '';
        if (showExplanation && entity.type === 'account') {
            const name = BAS_ACCOUNTS[entity.id];
            if (name) {
                explanationHtml = `<div class="fortnox-entity-explanation">Konto ${entity.id} (${name}) används i BAS-kontoplanen för svensk bokföring.</div>`;
            }
        }

        return `
            <div class="fortnox-entity-card">
                <div class="fortnox-entity-header">
                    <span class="fortnox-entity-type-badge">${typeLabels[entity.type] || entity.type}</span>
                    <span class="fortnox-entity-name">${this.escapeHtml(entity.name)}</span>
                </div>
                <div class="fortnox-entity-details">${details}</div>
                ${explanationHtml}
            </div>
        `;
    }

    private renderDetail(label: string, value: string): string {
        return `
            <div class="fortnox-entity-detail">
                <span class="fortnox-entity-detail-label">${label}</span>
                <span class="fortnox-entity-detail-value">${this.escapeHtml(value)}</span>
            </div>
        `;
    }

    private renderQuickActions(entity: FortnoxEntity): string {
        const actions: Array<{ icon: string; label: string; action: string }> = [];

        switch (entity.type) {
            case 'customer':
                actions.push(
                    { icon: '📄', label: 'Skapa faktura', action: 'create_invoice' },
                    { icon: '🔗', label: 'Visa i Fortnox', action: 'open_fortnox' },
                );
                break;
            case 'supplier':
                actions.push(
                    { icon: '📋', label: 'Skapa leverantörsfaktura', action: 'create_supplier_invoice' },
                    { icon: '🔗', label: 'Visa i Fortnox', action: 'open_fortnox' },
                );
                break;
            case 'account':
                actions.push(
                    { icon: '📊', label: 'Visa transaktioner', action: 'show_transactions' },
                );
                break;
            case 'voucher':
                actions.push(
                    { icon: '🔗', label: 'Visa i Fortnox', action: 'open_fortnox' },
                );
                break;
        }

        // Always available
        actions.push(
            { icon: '🔄', label: 'Uppdatera data', action: 'refresh' },
        );

        return actions.map(a => `
            <button class="fortnox-action-btn" data-action="${a.action}">
                <span>${a.icon}</span>
                <span>${a.label}</span>
            </button>
        `).join('');
    }

    // --- Event Handling ---

    private bindEvents(): void {
        // Close button
        this.container?.querySelector('.fortnox-sidebar-close')?.addEventListener('click', () => this.close());

        // Listen for entity changes
        fortnoxContextService.addEventListener('entity-changed', ((e: Event) => {
            const entity = (e as CustomEvent<FortnoxEntity | null>).detail;
            this.updateEntity(entity);
            if (entity && !this.isOpen) this.open();
        }) as EventListener);

        // Listen for connection changes
        fortnoxContextService.addEventListener('connection-changed', ((e: Event) => {
            const status = (e as CustomEvent<FortnoxConnectionStatus>).detail;
            this.updateConnectionStatus(status);
        }) as EventListener);

        // Escape key closes sidebar
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen) this.close();
        });
    }

    private handleQuickAction(action: string, entity: FortnoxEntity): void {
        switch (action) {
            case 'create_invoice': {
                const input = document.getElementById('user-input') as HTMLInputElement;
                if (input) {
                    input.value = `Skapa en faktura till ${entity.name}`;
                    input.focus();
                }
                break;
            }
            case 'create_supplier_invoice': {
                const input = document.getElementById('user-input') as HTMLInputElement;
                if (input) {
                    input.value = `Skapa en leverantörsfaktura från ${entity.name}`;
                    input.focus();
                }
                break;
            }
            case 'open_fortnox':
                window.open('https://apps.fortnox.se', '_blank');
                break;
            case 'show_transactions': {
                const input = document.getElementById('user-input') as HTMLInputElement;
                if (input) {
                    input.value = `Visa transaktioner för konto ${entity.id}`;
                    input.focus();
                }
                break;
            }
            case 'refresh':
                fortnoxContextService.preloadData();
                break;
        }
    }

    // --- Mobile Backdrop ---

    private showBackdrop(): void {
        if (window.innerWidth > 768) return;
        let backdrop = document.querySelector('.fortnox-sidebar-backdrop');
        if (!backdrop) {
            backdrop = document.createElement('div');
            backdrop.className = 'fortnox-sidebar-backdrop';
            backdrop.addEventListener('click', () => this.close());
            document.body.appendChild(backdrop);
        }
        requestAnimationFrame(() => backdrop!.classList.add('visible'));
    }

    private hideBackdrop(): void {
        const backdrop = document.querySelector('.fortnox-sidebar-backdrop');
        if (backdrop) {
            backdrop.classList.remove('visible');
        }
    }

    private escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    destroy(): void {
        this.close();
        if (this.container) this.container.innerHTML = '';
    }
}

/**
 * CopilotService - Proactive Fortnox notifications
 *
 * Periodically checks Fortnox data and generates actionable notifications:
 * - Overdue supplier invoices (due_date < today, balance > 0)
 * - Unbooked supplier invoices
 * - VAT period reminders
 *
 * Stores notifications in localStorage with read/unread state.
 * Dispatches events for the sidebar to update.
 */

import { supabase } from '../lib/supabase';
import { logger } from './LoggerService';
import { fortnoxContextService } from './FortnoxContextService';

// --- Types ---

export type NotificationType = 'overdue_invoice' | 'unbooked_invoice' | 'vat_reminder';
export type NotificationSeverity = 'warning' | 'info';

export interface CopilotNotification {
    id: string;
    type: NotificationType;
    title: string;
    description: string;
    severity: NotificationSeverity;
    prompt: string; // Chat prompt when clicked
    createdAt: string;
    read: boolean;
}

interface SupplierInvoiceSummary {
    GivenNumber: number;
    SupplierNumber: string;
    InvoiceNumber: string;
    DueDate: string;
    Total: number;
    Balance: number;
    Booked: boolean;
}

// --- Constants ---

const STORAGE_KEY = 'veridat_copilot_notifications';
const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_NOTIFICATIONS = 10;

// --- Service ---

class CopilotServiceClass extends EventTarget {
    private intervalId: number | null = null;
    private notifications: CopilotNotification[] = [];
    private lastCheckAt = 0;
    private supabaseUrl: string;

    constructor() {
        super();
        this.supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        this.loadFromStorage();
    }

    /** Start periodic checks. Call after Fortnox connection confirmed. */
    start(): void {
        if (this.intervalId) return;

        // Initial check (debounced to avoid blocking app init)
        setTimeout(() => this.check(), 2000);

        this.intervalId = window.setInterval(() => this.check(), CHECK_INTERVAL_MS);
        logger.debug('CopilotService started');
    }

    stop(): void {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    /** Run all notification checks now. */
    async check(): Promise<void> {
        if (!fortnoxContextService.isConnected()) return;

        // Throttle: don't check more than once per 5 minutes
        if (Date.now() - this.lastCheckAt < 5 * 60 * 1000) return;
        this.lastCheckAt = Date.now();

        logger.debug('CopilotService: running checks');

        try {
            const invoices = await this.fetchSupplierInvoices();
            const newNotifications: CopilotNotification[] = [];

            // Rule 1: Overdue invoices
            const overdue = this.findOverdueInvoices(invoices);
            if (overdue.length > 0) {
                newNotifications.push({
                    id: `overdue-${this.today()}`,
                    type: 'overdue_invoice',
                    title: `${overdue.length} förfallen${overdue.length === 1 ? '' : 'a'} fakturor`,
                    description: this.formatOverdueSummary(overdue),
                    severity: 'warning',
                    prompt: `Vilka leverantörsfakturor har förfallit? Visa detaljer och belopp.`,
                    createdAt: new Date().toISOString(),
                    read: false,
                });
            }

            // Rule 2: Unbooked invoices
            const unbooked = invoices.filter(inv => !inv.Booked && inv.Balance > 0);
            if (unbooked.length > 0) {
                newNotifications.push({
                    id: `unbooked-${this.today()}`,
                    type: 'unbooked_invoice',
                    title: `${unbooked.length} obokförd${unbooked.length === 1 ? '' : 'a'} fakturor`,
                    description: `Totalt ${this.formatSEK(unbooked.reduce((sum, inv) => sum + inv.Total, 0))} att bokföra`,
                    severity: 'info',
                    prompt: `Visa alla obokförda leverantörsfakturor och hjälp mig bokföra dem.`,
                    createdAt: new Date().toISOString(),
                    read: false,
                });
            }

            // Rule 3: VAT period reminder (5th of every month)
            const vatReminder = this.checkVATReminder();
            if (vatReminder) {
                newNotifications.push(vatReminder);
            }

            // Merge with existing: keep read state, add new, remove stale
            this.mergeNotifications(newNotifications);
            this.saveToStorage();
            this.dispatchUpdate();

        } catch (err) {
            logger.warn('CopilotService: check failed', err);
        }
    }

    // --- Notification access ---

    getNotifications(): CopilotNotification[] {
        return this.notifications;
    }

    getUnreadCount(): number {
        return this.notifications.filter(n => !n.read).length;
    }

    markAsRead(id: string): void {
        const notif = this.notifications.find(n => n.id === id);
        if (notif && !notif.read) {
            notif.read = true;
            this.saveToStorage();
            this.dispatchUpdate();
        }
    }

    markAllRead(): void {
        let changed = false;
        for (const n of this.notifications) {
            if (!n.read) {
                n.read = true;
                changed = true;
            }
        }
        if (changed) {
            this.saveToStorage();
            this.dispatchUpdate();
        }
    }

    dismiss(id: string): void {
        const before = this.notifications.length;
        this.notifications = this.notifications.filter(n => n.id !== id);
        if (this.notifications.length !== before) {
            this.saveToStorage();
            this.dispatchUpdate();
        }
    }

    // --- Data fetching ---

    private async fetchSupplierInvoices(): Promise<SupplierInvoiceSummary[]> {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) return [];

            const response = await fetch(`${this.supabaseUrl}/functions/v1/fortnox`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.access_token}`
                },
                body: JSON.stringify({ action: 'getSupplierInvoices' })
            });

            if (!response.ok) return [];

            const result = await response.json();
            return (result.data?.SupplierInvoices || []) as SupplierInvoiceSummary[];
        } catch {
            return [];
        }
    }

    // --- Rules ---

    private findOverdueInvoices(invoices: SupplierInvoiceSummary[]): SupplierInvoiceSummary[] {
        const today = this.today();
        return invoices.filter(inv => inv.DueDate < today && inv.Balance > 0);
    }

    private checkVATReminder(): CopilotNotification | null {
        const now = new Date();
        const day = now.getDate();
        // Remind between 1st and 12th of each month (VAT declaration deadline is usually 12th)
        if (day > 12) return null;

        const month = now.toLocaleString('sv-SE', { month: 'long' });
        const year = now.getFullYear();

        return {
            id: `vat-${year}-${String(now.getMonth() + 1).padStart(2, '0')}`,
            type: 'vat_reminder',
            title: 'Dags att deklarera moms',
            description: `Momsdeklaration för ${month} ska lämnas senast den 12:e.`,
            severity: 'info',
            prompt: `Hjälp mig förbereda momsdeklarationen för denna period.`,
            createdAt: new Date().toISOString(),
            read: false,
        };
    }

    // --- Notification management ---

    private mergeNotifications(incoming: CopilotNotification[]): void {
        const existing = new Map(this.notifications.map(n => [n.id, n]));

        for (const newNotif of incoming) {
            const prev = existing.get(newNotif.id);
            if (prev) {
                // Keep read state, update content
                newNotif.read = prev.read;
            }
            existing.set(newNotif.id, newNotif);
        }

        // Remove stale notifications (type no longer present in incoming)
        const activeTypes = new Set(incoming.map(n => n.type));
        for (const [id, notif] of existing) {
            // Only remove if it's a type that should be refreshed and is no longer present
            if (activeTypes.size > 0 && !incoming.some(n => n.id === id) && !notif.read) {
                existing.delete(id);
            }
        }

        this.notifications = Array.from(existing.values())
            .sort((a, b) => {
                // Warnings first, then by date
                if (a.severity !== b.severity) return a.severity === 'warning' ? -1 : 1;
                return b.createdAt.localeCompare(a.createdAt);
            })
            .slice(0, MAX_NOTIFICATIONS);
    }

    // --- Storage ---

    private loadFromStorage(): void {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                this.notifications = JSON.parse(raw) as CopilotNotification[];
            }
        } catch {
            this.notifications = [];
        }
    }

    private saveToStorage(): void {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.notifications));
        } catch {
            // Storage full or unavailable
        }
    }

    // --- Events ---

    private dispatchUpdate(): void {
        this.dispatchEvent(new CustomEvent('copilot-updated', {
            detail: {
                notifications: this.notifications,
                unreadCount: this.getUnreadCount()
            }
        }));
    }

    // --- Helpers ---

    private today(): string {
        return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    }

    private formatSEK(amount: number): string {
        return new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK', maximumFractionDigits: 0 }).format(amount);
    }

    private formatOverdueSummary(invoices: SupplierInvoiceSummary[]): string {
        const total = invoices.reduce((sum, inv) => sum + inv.Balance, 0);
        const oldest = invoices.reduce((min, inv) => inv.DueDate < min ? inv.DueDate : min, invoices[0].DueDate);
        const daysOverdue = Math.floor((Date.now() - new Date(oldest).getTime()) / (1000 * 60 * 60 * 24));
        return `${this.formatSEK(total)} totalt, äldsta ${daysOverdue} dagar sen`;
    }
}

export const copilotService = new CopilotServiceClass();

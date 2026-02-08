/**
 * CopilotService 2.0 - Proactive bookkeeping assistant
 *
 * Periodically checks Fortnox + local data and generates actionable notifications:
 * - Overdue/unbooked supplier invoices
 * - Cash flow forecast (incoming vs outgoing)
 * - VAT + employer contribution deadline reminders
 * - Bank reconciliation status
 * - Invoice inbox pending items
 * - Anomaly detection (unusual amounts, potential duplicates)
 * - Actionable suggestions linking to specific tools
 *
 * Stores notifications in localStorage with read/unread state.
 * Dispatches events for the UI to update.
 */

import { supabase } from '../lib/supabase';
import { logger } from './LoggerService';
import { fortnoxContextService } from './FortnoxContextService';
import { companyService } from './CompanyService';

// =============================================================================
// TYPES
// =============================================================================

export type NotificationType =
    | 'overdue_invoice'
    | 'unbooked_invoice'
    | 'vat_reminder'
    | 'cashflow_forecast'
    | 'bank_reconciliation'
    | 'invoice_inbox'
    | 'anomaly_amount'
    | 'anomaly_duplicate'
    | 'deadline_reminder'
    | 'action_suggestion';

export type NotificationSeverity = 'critical' | 'warning' | 'info' | 'success';
export type NotificationCategory = 'varning' | 'insikt' | 'forslag';

export interface CopilotNotification {
    id: string;
    type: NotificationType;
    category: NotificationCategory;
    title: string;
    description: string;
    severity: NotificationSeverity;
    prompt: string;
    /** If set, clicking will dispatch an event to open this tool */
    action?: string;
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

interface CustomerInvoiceSummary {
    InvoiceNumber: number;
    CustomerNumber: string;
    DueDate?: string;
    Total?: number;
    Balance?: number;
    Booked?: boolean;
    Cancelled?: boolean;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const STORAGE_KEY = 'veridat_copilot_notifications';
const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_NOTIFICATIONS = 20;

const SEVERITY_ORDER: Record<NotificationSeverity, number> = {
    critical: 0, warning: 1, info: 2, success: 3,
};

const CATEGORY_ORDER: Record<NotificationCategory, number> = {
    varning: 0, insikt: 1, forslag: 2,
};

// =============================================================================
// SERVICE
// =============================================================================

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

    start(): void {
        if (this.intervalId) return;
        setTimeout(() => this.check(), 2000);
        this.intervalId = window.setInterval(() => this.check(), CHECK_INTERVAL_MS);
        logger.debug('CopilotService 2.0 started');
    }

    stop(): void {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    /** Force a fresh check now (called from UI refresh button) */
    async forceCheck(): Promise<void> {
        this.lastCheckAt = 0;
        await this.check();
    }

    async check(): Promise<void> {
        // Throttle: don't check more than once per 5 minutes
        if (Date.now() - this.lastCheckAt < 5 * 60 * 1000) return;
        this.lastCheckAt = Date.now();

        logger.debug('CopilotService: running checks');

        const newNotifications: CopilotNotification[] = [];

        try {
            // ---- Fortnox-based checks (only if connected) ----
            if (fortnoxContextService.isConnected()) {
                const [supplierInvoices, customerInvoices] = await Promise.all([
                    this.fetchSupplierInvoices(),
                    this.fetchCustomerInvoices(),
                ]);

                // 1. Overdue supplier invoices
                this.checkOverdueInvoices(supplierInvoices, newNotifications);

                // 2. Unbooked supplier invoices
                this.checkUnbookedInvoices(supplierInvoices, newNotifications);

                // 3. Cash flow forecast
                this.checkCashFlow(supplierInvoices, customerInvoices, newNotifications);

                // 4. Anomaly detection (unusual amounts)
                this.checkAmountAnomalies(supplierInvoices, newNotifications);

                // 5. Duplicate detection
                this.checkDuplicates(supplierInvoices, newNotifications);
            }

            // ---- Local checks (always run) ----

            // 6. VAT reminder
            this.checkVATReminder(newNotifications);

            // 7. Employer contribution deadline
            this.checkEmployerContributionDeadline(newNotifications);

            // 8. Bank reconciliation status
            this.checkBankReconciliation(newNotifications);

            // 9. Invoice inbox pending
            this.checkInvoiceInbox(newNotifications);

            // 10. Action suggestions
            this.generateActionSuggestions(newNotifications);

        } catch (err) {
            logger.warn('CopilotService: check failed', err);
        }

        this.mergeNotifications(newNotifications);
        this.saveToStorage();
        this.dispatchUpdate();
    }

    // =========================================================================
    // NOTIFICATION ACCESS
    // =========================================================================

    getNotifications(): CopilotNotification[] {
        return this.notifications;
    }

    getByCategory(category: NotificationCategory): CopilotNotification[] {
        return this.notifications.filter(n => n.category === category);
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
            if (!n.read) { n.read = true; changed = true; }
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

    // =========================================================================
    // FORTNOX-BASED CHECKS
    // =========================================================================

    private checkOverdueInvoices(invoices: SupplierInvoiceSummary[], out: CopilotNotification[]): void {
        const today = this.today();
        const overdue = invoices.filter(inv => inv.DueDate < today && this.toNumber(inv.Balance) > 0);
        if (overdue.length === 0) return;

        const total = overdue.reduce((sum, inv) => sum + this.toNumber(inv.Balance), 0);
        const datedInvoices = overdue.filter(inv => Boolean(inv.DueDate));
        let desc = `${this.formatSEK(total)} totalt`;
        if (datedInvoices.length > 0) {
            const oldest = datedInvoices.reduce((min, inv) => inv.DueDate < min ? inv.DueDate : min, datedInvoices[0].DueDate);
            const daysOverdue = Math.floor((Date.now() - new Date(oldest).getTime()) / (1000 * 60 * 60 * 24));
            desc = `${this.formatSEK(total)} totalt, äldsta ${daysOverdue} dagar sen`;
        }

        out.push({
            id: `overdue-${today}`,
            type: 'overdue_invoice',
            category: 'varning',
            title: `${overdue.length} förfallen${overdue.length === 1 ? '' : 'a'} fakturor`,
            description: desc,
            severity: 'critical',
            prompt: 'Vilka leverantörsfakturor har förfallit? Visa detaljer och belopp.',
            action: 'fortnox-panel',
            createdAt: new Date().toISOString(),
            read: false,
        });
    }

    private checkUnbookedInvoices(invoices: SupplierInvoiceSummary[], out: CopilotNotification[]): void {
        const unbooked = invoices.filter(inv => !inv.Booked && this.toNumber(inv.Balance) > 0);
        if (unbooked.length === 0) return;

        const total = unbooked.reduce((sum, inv) => sum + this.toNumber(inv.Total), 0);
        out.push({
            id: `unbooked-${this.today()}`,
            type: 'unbooked_invoice',
            category: 'varning',
            title: `${unbooked.length} obokförd${unbooked.length === 1 ? '' : 'a'} fakturor`,
            description: `Totalt ${this.formatSEK(total)} att bokföra`,
            severity: 'warning',
            prompt: 'Visa alla obokförda leverantörsfakturor och hjälp mig bokföra dem.',
            action: 'fortnox-panel',
            createdAt: new Date().toISOString(),
            read: false,
        });
    }

    private checkCashFlow(
        supplierInvoices: SupplierInvoiceSummary[],
        customerInvoices: CustomerInvoiceSummary[],
        out: CopilotNotification[]
    ): void {
        const today = this.today();
        const in30Days = this.dateOffsetDays(30);

        // Incoming: customer invoices with balance > 0, due within 30 days
        const incoming = customerInvoices
            .filter(inv => !inv.Cancelled && this.toNumber(inv.Balance) > 0)
            .reduce((sum, inv) => sum + this.toNumber(inv.Balance), 0);

        // Outgoing: supplier invoices with balance > 0, due within 30 days
        const outgoing = supplierInvoices
            .filter(inv => this.toNumber(inv.Balance) > 0 && inv.DueDate <= in30Days)
            .reduce((sum, inv) => sum + this.toNumber(inv.Balance), 0);

        if (incoming === 0 && outgoing === 0) return;

        const net = incoming - outgoing;
        const isNegative = net < 0;

        out.push({
            id: `cashflow-${today}`,
            type: 'cashflow_forecast',
            category: 'insikt',
            title: 'Kassaflödesprognos 30 dagar',
            description: `In: ${this.formatSEK(incoming)} | Ut: ${this.formatSEK(outgoing)} | Netto: ${this.formatSEK(net)}`,
            severity: isNegative ? 'warning' : 'info',
            prompt: `Visa min kassaflödesprognos för de närmaste 30 dagarna. Inkommande: ${this.formatSEK(incoming)}, utgående: ${this.formatSEK(outgoing)}.`,
            createdAt: new Date().toISOString(),
            read: false,
        });
    }

    private checkAmountAnomalies(invoices: SupplierInvoiceSummary[], out: CopilotNotification[]): void {
        // Group by supplier, check if latest invoice deviates significantly from average
        const bySupplier = new Map<string, SupplierInvoiceSummary[]>();
        for (const inv of invoices) {
            const key = inv.SupplierNumber;
            const arr = bySupplier.get(key) || [];
            arr.push(inv);
            bySupplier.set(key, arr);
        }

        for (const [supplierNr, supplierInvs] of bySupplier) {
            if (supplierInvs.length < 3) continue;

            const amounts = supplierInvs.map(inv => this.toNumber(inv.Total));
            const avg = amounts.reduce((a, b) => a + b, 0) / amounts.length;
            if (avg === 0) continue;

            // Check the most recent invoice
            const sorted = [...supplierInvs].sort((a, b) => (b.DueDate || '').localeCompare(a.DueDate || ''));
            const latest = sorted[0];
            const latestAmount = this.toNumber(latest.Total);
            const ratio = latestAmount / avg;

            if (ratio > 3) {
                out.push({
                    id: `anomaly-${supplierNr}-${latest.GivenNumber}`,
                    type: 'anomaly_amount',
                    category: 'varning',
                    title: `Ovanligt hög faktura från leverantör ${supplierNr}`,
                    description: `${this.formatSEK(latestAmount)} är ${ratio.toFixed(1)}x högre än genomsnittet (${this.formatSEK(avg)})`,
                    severity: 'warning',
                    prompt: `Faktura ${latest.InvoiceNumber} från leverantör ${supplierNr} är ovanligt hög (${this.formatSEK(latestAmount)} vs genomsnitt ${this.formatSEK(avg)}). Bör jag kontrollera den?`,
                    action: 'fortnox-panel',
                    createdAt: new Date().toISOString(),
                    read: false,
                });
            }
        }
    }

    private checkDuplicates(invoices: SupplierInvoiceSummary[], out: CopilotNotification[]): void {
        const seen = new Map<string, SupplierInvoiceSummary>();
        for (const inv of invoices) {
            if (!inv.InvoiceNumber) continue;
            const key = `${inv.SupplierNumber}|${inv.InvoiceNumber}`;
            const existing = seen.get(key);
            if (existing && existing.GivenNumber !== inv.GivenNumber) {
                const amount1 = this.toNumber(existing.Total);
                const amount2 = this.toNumber(inv.Total);
                // Only flag if amounts are similar (within 5%)
                if (amount1 > 0 && Math.abs(amount1 - amount2) / amount1 < 0.05) {
                    out.push({
                        id: `dup-${inv.SupplierNumber}-${inv.InvoiceNumber}`,
                        type: 'anomaly_duplicate',
                        category: 'varning',
                        title: 'Möjlig dubblettfaktura',
                        description: `Faktura ${inv.InvoiceNumber} från leverantör ${inv.SupplierNumber} finns två gånger (${this.formatSEK(amount1)})`,
                        severity: 'critical',
                        prompt: `Faktura ${inv.InvoiceNumber} från leverantör ${inv.SupplierNumber} verkar finnas som dubblett. Kan du visa båda och hjälpa mig avgöra?`,
                        action: 'fortnox-panel',
                        createdAt: new Date().toISOString(),
                        read: false,
                    });
                }
            }
            seen.set(key, inv);
        }
    }

    // =========================================================================
    // LOCAL CHECKS
    // =========================================================================

    private checkVATReminder(out: CopilotNotification[]): void {
        const now = new Date();
        const day = now.getDate();
        if (day > 12) return;

        const month = now.toLocaleString('sv-SE', { month: 'long' });
        const year = now.getFullYear();
        const daysLeft = 12 - day;

        out.push({
            id: `vat-${year}-${String(now.getMonth() + 1).padStart(2, '0')}`,
            type: 'vat_reminder',
            category: 'varning',
            title: 'Momsdeklaration',
            description: daysLeft <= 3
                ? `Deadline om ${daysLeft} dag${daysLeft === 1 ? '' : 'ar'}! Momsdeklaration för ${month} ska lämnas senast den 12:e.`
                : `Momsdeklaration för ${month} ska lämnas senast den 12:e (${daysLeft} dagar kvar).`,
            severity: daysLeft <= 3 ? 'critical' : 'warning',
            prompt: 'Hjälp mig förbereda momsdeklarationen för denna period.',
            createdAt: new Date().toISOString(),
            read: false,
        });
    }

    private checkEmployerContributionDeadline(out: CopilotNotification[]): void {
        const now = new Date();
        const day = now.getDate();
        // Arbetsgivaravgifter due on 12th each month (same as VAT for small businesses)
        if (day > 12) return;

        const daysLeft = 12 - day;
        if (daysLeft > 5) return; // Only remind within 5 days

        out.push({
            id: `agavg-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
            type: 'deadline_reminder',
            category: 'insikt',
            title: 'Arbetsgivaravgifter',
            description: `Deklaration och betalning ska ske senast den 12:e (${daysLeft} dag${daysLeft === 1 ? '' : 'ar'} kvar).`,
            severity: daysLeft <= 2 ? 'warning' : 'info',
            prompt: 'Påminn mig om arbetsgivaravgifter och sociala avgifter för denna månad.',
            createdAt: new Date().toISOString(),
            read: false,
        });
    }

    private checkBankReconciliation(out: CopilotNotification[]): void {
        try {
            const companyId = companyService.getCurrentId();
            const raw = localStorage.getItem('veridat_reconciled_periods');
            const reconciledStore = raw ? JSON.parse(raw) as Record<string, string[]> : {};
            const reconciledPeriods = new Set(reconciledStore[companyId] || []);

            // Check bank imports for unreconciled months
            const importsRaw = localStorage.getItem('veridat_bank_imports');
            if (!importsRaw) return;

            const importsStore = JSON.parse(importsRaw) as Record<string, Array<{ transactions: Array<{ date: string }> }>>;
            const imports = importsStore[companyId];
            if (!imports || imports.length === 0) return;

            const allPeriods = new Set<string>();
            for (const imp of imports) {
                for (const tx of imp.transactions || []) {
                    if (tx.date) allPeriods.add(tx.date.substring(0, 7));
                }
            }

            const unreconciledCount = [...allPeriods].filter(p => !reconciledPeriods.has(p)).length;
            if (unreconciledCount === 0) return;

            out.push({
                id: `bankrec-${this.today()}`,
                type: 'bank_reconciliation',
                category: 'forslag',
                title: `${unreconciledCount} period${unreconciledCount === 1 ? '' : 'er'} ej avstämda`,
                description: 'Öppna bankavstämning för att granska och markera perioder som klara.',
                severity: unreconciledCount >= 3 ? 'warning' : 'info',
                prompt: 'Visa bankavstämning för alla perioder.',
                action: 'reconciliation',
                createdAt: new Date().toISOString(),
                read: false,
            });
        } catch {
            // localStorage read failed
        }
    }

    private checkInvoiceInbox(out: CopilotNotification[]): void {
        try {
            const companyId = companyService.getCurrentId();
            const raw = localStorage.getItem('veridat_invoice_inbox');
            if (!raw) return;

            const store = JSON.parse(raw) as Record<string, Array<{ status: string; dueDate?: string; totalAmount?: number }>>;
            const items = store[companyId];
            if (!items || items.length === 0) return;

            const pending = items.filter(i => i.status === 'ny' || i.status === 'granskad');
            if (pending.length === 0) return;

            const totalAmount = pending.reduce((sum, i) => sum + (i.totalAmount || 0), 0);
            const today = this.today();
            const overdueCount = pending.filter(i => i.dueDate && i.dueDate < today).length;

            let desc = `${pending.length} faktura${pending.length === 1 ? '' : 'r'} väntar på behandling`;
            if (totalAmount > 0) desc += ` (${this.formatSEK(totalAmount)})`;
            if (overdueCount > 0) desc += ` - ${overdueCount} förfallna!`;

            out.push({
                id: `inbox-${this.today()}`,
                type: 'invoice_inbox',
                category: 'forslag',
                title: 'Fakturor i inkorgen',
                description: desc,
                severity: overdueCount > 0 ? 'warning' : 'info',
                prompt: 'Visa fakturainkorgen med väntande fakturor.',
                action: 'invoice-inbox',
                createdAt: new Date().toISOString(),
                read: false,
            });
        } catch {
            // localStorage read failed
        }
    }

    private generateActionSuggestions(out: CopilotNotification[]): void {
        // Check if user has no bank imports yet
        try {
            const companyId = companyService.getCurrentId();
            const importsRaw = localStorage.getItem('veridat_bank_imports');
            const importsStore = importsRaw ? JSON.parse(importsRaw) as Record<string, unknown[]> : {};
            const imports = importsStore[companyId] || [];

            if (imports.length === 0 && fortnoxContextService.isConnected()) {
                out.push({
                    id: 'suggest-bank-import',
                    type: 'action_suggestion',
                    category: 'forslag',
                    title: 'Importera kontoutdrag',
                    description: 'Du har inte importerat några bankfiler än. Börja med att importera ett kontoutdrag för att matcha mot fakturor.',
                    severity: 'info',
                    prompt: 'Hjälp mig importera mitt kontoutdrag.',
                    action: 'bank-import',
                    createdAt: new Date().toISOString(),
                    read: false,
                });
            }
        } catch {
            // Skip
        }
    }

    // =========================================================================
    // DATA FETCHING
    // =========================================================================

    private async fetchSupplierInvoices(): Promise<SupplierInvoiceSummary[]> {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) return [];

            const response = await fetch(`${this.supabaseUrl}/functions/v1/fortnox`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${session.access_token}`,
                },
                body: JSON.stringify({ action: 'getSupplierInvoices' }),
            });

            if (!response.ok) return [];
            const result = await response.json();
            return ((result.data?.SupplierInvoices ?? result.SupplierInvoices) || []) as SupplierInvoiceSummary[];
        } catch {
            return [];
        }
    }

    private async fetchCustomerInvoices(): Promise<CustomerInvoiceSummary[]> {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) return [];

            const response = await fetch(`${this.supabaseUrl}/functions/v1/fortnox`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${session.access_token}`,
                },
                body: JSON.stringify({ action: 'getInvoices' }),
            });

            if (!response.ok) return [];
            const result = await response.json();
            return ((result.data?.Invoices ?? result.Invoices) || []) as CustomerInvoiceSummary[];
        } catch {
            return [];
        }
    }

    // =========================================================================
    // NOTIFICATION MANAGEMENT
    // =========================================================================

    private mergeNotifications(incoming: CopilotNotification[]): void {
        const existing = new Map(this.notifications.map(n => [n.id, n]));

        for (const newNotif of incoming) {
            const prev = existing.get(newNotif.id);
            if (prev) {
                newNotif.read = prev.read;
            }
            existing.set(newNotif.id, newNotif);
        }

        // Remove stale: if a type appeared in incoming but an old notification of that type is gone
        const incomingIds = new Set(incoming.map(n => n.id));
        const incomingTypes = new Set(incoming.map(n => n.type));
        for (const [id, notif] of existing) {
            if (incomingTypes.has(notif.type) && !incomingIds.has(id) && !notif.read) {
                existing.delete(id);
            }
        }

        this.notifications = Array.from(existing.values())
            .sort((a, b) => {
                // Category first, then severity, then date
                const catDiff = CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category];
                if (catDiff !== 0) return catDiff;
                const sevDiff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
                if (sevDiff !== 0) return sevDiff;
                return b.createdAt.localeCompare(a.createdAt);
            })
            .slice(0, MAX_NOTIFICATIONS);
    }

    // =========================================================================
    // STORAGE
    // =========================================================================

    private loadFromStorage(): void {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) this.notifications = JSON.parse(raw) as CopilotNotification[];
        } catch {
            this.notifications = [];
        }
    }

    private saveToStorage(): void {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.notifications));
        } catch { /* noop */ }
    }

    // =========================================================================
    // EVENTS
    // =========================================================================

    private dispatchUpdate(): void {
        this.dispatchEvent(new CustomEvent('copilot-updated', {
            detail: {
                notifications: this.notifications,
                unreadCount: this.getUnreadCount(),
            },
        }));
    }

    // =========================================================================
    // HELPERS
    // =========================================================================

    private today(): string {
        return new Date().toISOString().slice(0, 10);
    }

    private dateOffsetDays(days: number): string {
        const d = new Date();
        d.setDate(d.getDate() + days);
        return d.toISOString().slice(0, 10);
    }

    private toNumber(value: number | string | null | undefined): number {
        if (typeof value === 'number') return value;
        if (value === null || value === undefined) return 0;
        const normalized = String(value).replace(/\s+/g, '').replace(',', '.');
        const parsed = Number(normalized);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    private formatSEK(amount: number): string {
        return new Intl.NumberFormat('sv-SE', {
            style: 'currency', currency: 'SEK', maximumFractionDigits: 0,
        }).format(amount);
    }
}

export const copilotService = new CopilotServiceClass();

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
import { bankImportService } from './BankImportService';
import { financeAgentService } from './FinanceAgentService';
import { STORAGE_KEYS } from '../constants/storageKeys';
import { getFortnoxList } from '../utils/fortnoxResponse';

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
    | 'action_suggestion'
    | 'guardian_alert';

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

interface GuardianAlert {
    id: string;
    title: string;
    description: string;
    severity: NotificationSeverity;
    status: 'open' | 'acknowledged' | 'resolved';
    action_target?: string | null;
    payload?: Record<string, unknown> | null;
    created_at: string;
}

interface ReconciliationSnapshotEntry {
    period: string;
    status?: string | null;
}

interface InvoiceInboxSnapshotItem {
    status?: string;
    dueDate?: string;
    totalAmount?: number | null;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const STORAGE_KEY = STORAGE_KEYS.copilotNotifications;
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
        if (typeof window !== 'undefined') {
            window.addEventListener('company-changed', () => {
                this.lastCheckAt = 0;
                this.notifications = [];
                this.saveToStorage();
                this.dispatchUpdate();
            });
        }
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
            const activeCompanyId = companyService.getCurrentId();
            await financeAgentService.preloadCompany(activeCompanyId);
            await bankImportService.refreshImports(activeCompanyId);

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

            // 10. Server-side guardian alerts
            const guardianMappedTypes = await this.checkGuardianAlerts(newNotifications);
            if (guardianMappedTypes.size > 0) {
                // Guardian already provides these signals; remove local duplicates.
                for (let i = newNotifications.length - 1; i >= 0; i--) {
                    const n = newNotifications[i];
                    if (!n) continue;
                    if (!this.isGuardianNotificationId(n.id) && guardianMappedTypes.has(n.type)) {
                        newNotifications.splice(i, 1);
                    }
                }
            }

            // 11. Compliance alerts from finance-agent
            await this.checkComplianceAlerts(newNotifications);

            // 12. Action suggestions
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

    private isGuardianNotificationId(id: string): boolean {
        return id.startsWith('guardian-');
    }

    private extractGuardianAlertId(notificationId: string): string | null {
        if (!this.isGuardianNotificationId(notificationId)) return null;
        const raw = notificationId.slice('guardian-'.length).trim();
        return raw.length > 0 ? raw : null;
    }

    /**
     * Persistently resolve a Guardian alert server-side and remove it from Copilot.
     * Falls back to a local dismiss if the network call fails.
     */
    async resolveGuardianNotification(notificationId: string): Promise<void> {
        const alertId = this.extractGuardianAlertId(notificationId);
        if (!alertId) {
            this.dismiss(notificationId);
            return;
        }

        try {
            const response = await this.callAuthedFunction('fortnox-guardian', {
                action: 'resolve_alert',
                payload: { alertId },
            });

            if (!response) {
                this.dismiss(notificationId);
                return;
            }

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                logger.warn('Failed to resolve guardian alert (falling back to local dismiss)', {
                    status: response.status,
                    err,
                    alertId,
                });
            }
        } catch (err) {
            logger.warn('Failed to resolve guardian alert (falling back to local dismiss)', err);
        }

        this.dismiss(notificationId);
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
            action: 'vat-report',
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
            const reconciledPeriods = this.getReconciledPeriodsSet(companyId);

            const imports = bankImportService.getImports(companyId);
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
            const items = this.getInvoiceInboxItems(companyId);
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
            const imports = bankImportService.getImports(companyId);

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

    private async checkGuardianAlerts(out: CopilotNotification[]): Promise<Set<NotificationType>> {
        const alerts = await this.fetchGuardianAlerts();
        if (alerts.length === 0) return new Set();

        const mappedTypes = new Set<NotificationType>();

        for (const alert of alerts) {
            if (alert.status !== 'open') continue;
            const checkKey = typeof alert.payload?.check === 'string' ? alert.payload.check : '';
            const mappedType = checkKey ? this.mapGuardianCheckToNotificationType(checkKey) : null;
            if (mappedType) {
                mappedTypes.add(mappedType);
            }

            out.push({
                id: `guardian-${alert.id}`,
                type: mappedType ?? 'guardian_alert',
                category: this.mapSeverityToCategory(alert.severity),
                title: alert.title,
                description: alert.description,
                severity: alert.severity,
                prompt: `${alert.title}\n${alert.description}`,
                action: alert.action_target || undefined,
                createdAt: alert.created_at || new Date().toISOString(),
                read: false,
            });
        }

        return mappedTypes;
    }

    private async checkComplianceAlerts(out: CopilotNotification[]): Promise<void> {
        try {
            const companyId = companyService.getCurrentId();
            const alerts = await financeAgentService.listComplianceAlerts(companyId);
            for (const alert of alerts) {
                const code = typeof alert.code === 'string' ? alert.code : 'compliance_alert';
                const severity = (typeof alert.severity === 'string' ? alert.severity : 'warning') as NotificationSeverity;
                const title = typeof alert.title === 'string' ? alert.title : 'Compliance-alert';
                const description = typeof alert.description === 'string' ? alert.description : 'Kontroll kräver uppmärksamhet.';
                const actionTarget = typeof alert.actionTarget === 'string' ? alert.actionTarget : undefined;

                out.push({
                    id: `compliance-${code}`,
                    type: 'guardian_alert',
                    category: this.mapSeverityToCategory(severity),
                    title,
                    description,
                    severity,
                    prompt: `${title}\n${description}`,
                    action: actionTarget,
                    createdAt: new Date().toISOString(),
                    read: false,
                });
            }
        } catch (error) {
            logger.warn('Failed to fetch finance compliance alerts', error);
        }
    }

    // =========================================================================
    // DATA FETCHING
    // =========================================================================

    private async fetchSupplierInvoices(): Promise<SupplierInvoiceSummary[]> {
        return this.fetchFortnoxList<SupplierInvoiceSummary>('getSupplierInvoices', 'SupplierInvoices');
    }

    private async fetchCustomerInvoices(): Promise<CustomerInvoiceSummary[]> {
        return this.fetchFortnoxList<CustomerInvoiceSummary>('getInvoices', 'Invoices');
    }

    private async fetchGuardianAlerts(): Promise<GuardianAlert[]> {
        try {
            const response = await this.callAuthedFunction('fortnox-guardian', {
                action: 'list_alerts',
                payload: {
                    limit: 10,
                    companyId: companyService.getCurrentId(),
                },
            });

            if (!response?.ok) return [];
            const result = await response.json().catch(() => ({}));
            return Array.isArray(result?.alerts) ? (result.alerts as GuardianAlert[]) : [];
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

    private async getSessionAccessToken(): Promise<string | null> {
        const { data: { session } } = await supabase.auth.getSession();
        return session?.access_token ?? null;
    }

    private async callAuthedFunction(
        functionName: 'fortnox' | 'fortnox-guardian',
        body: Record<string, unknown>
    ): Promise<Response | null> {
        const accessToken = await this.getSessionAccessToken();
        if (!accessToken) return null;

        return fetch(`${this.supabaseUrl}/functions/v1/${functionName}`, {
            method: 'POST',
            headers: this.buildAuthHeaders(accessToken),
            body: JSON.stringify(body),
        });
    }

    private async fetchFortnoxList<T>(action: string, key: string): Promise<T[]> {
        try {
            const companyId = companyService.getCurrentId();
            const response = await this.callAuthedFunction('fortnox', { action, companyId });
            if (!response?.ok) return [];
            const result = await response.json().catch(() => ({}));
            return getFortnoxList<T>(result, key);
        } catch {
            return [];
        }
    }

    private buildAuthHeaders(accessToken: string): Record<string, string> {
        return {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
        };
    }

    private mapGuardianCheckToNotificationType(check: string): NotificationType | null {
        switch (check) {
            case 'overdue_supplier_invoices':
                return 'overdue_invoice';
            case 'unbooked_supplier_invoices':
                return 'unbooked_invoice';
            case 'duplicate_supplier_invoices':
                return 'anomaly_duplicate';
            case 'unusual_supplier_amounts':
                return 'anomaly_amount';
            default:
                return null;
        }
    }

    private mapSeverityToCategory(severity: NotificationSeverity): NotificationCategory {
        return severity === 'critical' || severity === 'warning' ? 'varning' : 'insikt';
    }

    private getReconciledPeriodsSet(companyId: string): Set<string> {
        const cachedPeriods = financeAgentService.getCachedReconciliation(companyId) as ReconciliationSnapshotEntry[];
        if (cachedPeriods.length > 0) {
            return new Set(
                cachedPeriods
                    .filter((entry) => entry.status === 'reconciled' || entry.status === 'locked')
                    .map((entry) => entry.period)
            );
        }

        const raw = localStorage.getItem(STORAGE_KEYS.reconciledPeriods);
        const reconciledStore = raw ? JSON.parse(raw) as Record<string, string[]> : {};
        return new Set(reconciledStore[companyId] || []);
    }

    private getInvoiceInboxItems(companyId: string): InvoiceInboxSnapshotItem[] {
        const cachedItems = financeAgentService.getCachedInvoiceInbox(companyId);
        if (cachedItems.length > 0) {
            return cachedItems;
        }

        const raw = localStorage.getItem(STORAGE_KEYS.invoiceInbox);
        if (!raw) return [];
        const store = JSON.parse(raw) as Record<string, InvoiceInboxSnapshotItem[]>;
        return store[companyId] || [];
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

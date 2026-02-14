/**
 * DashboardPanel - Ekonomisk översikt + admin-gated plattformspuls
 *
 * Aggregerar data från Veridat-verktyg:
 * - VAT-rapport (resultat, momssaldo)
 * - Bankimporter (banksaldo, perioder)
 * - Fakturainkorg (väntande fakturor)
 * - Copilot-notiser (förfallna, obokförda)
 * - Avstämning (oavstämda perioder)
 * - Fortnox (anslutningsstatus)
 */

import { FunctionComponent } from 'preact';
import { useState, useEffect, useMemo, useCallback } from 'preact/hooks';
import { supabase } from '../lib/supabase';
import { bankImportService } from '../services/BankImportService';
import { copilotService } from '../services/CopilotService';
import { fortnoxContextService, type FortnoxConnectionStatus } from '../services/FortnoxContextService';
import { financeAgentService } from '../services/FinanceAgentService';
import { companyService } from '../services/CompanyService';
import { logger } from '../services/LoggerService';
import { STORAGE_KEYS } from '../constants/storageKeys';
import { withTimeout } from '../utils/asyncTimeout';
import { runDashboardSync, type DashboardSyncResult, type DashboardSyncSteps } from '../utils/dashboardSync';
import {
    buildTimeWindows,
    calcTrendDelta,
    classifyTriageBucket,
    computeAdoptionScore,
    computeOperationalScore,
    computePlatformScore,
    countIsoTimestampsInRange,
    type TrendDelta as PlatformTrendDelta,
    type TriageBucket as PlatformTriageBucket,
} from '../utils/platformDashboard';

// =============================================================================
// TYPES
// =============================================================================

interface DashboardPanelProps {
    onBack: () => void;
    onNavigate: (tool: string) => void;
    isAdmin: boolean;
    userId: string | null;
    timeWindowDays?: number;
}

interface DashboardData {
    resultat: number | null;
    momssaldo: number | null;
    banksaldo: number;
    fortnoxStatus: FortnoxConnectionStatus;
    overdueCount: number;
    unbookedCount: number;
    pendingInvoices: number;
    unreconciledCount: number;
    guardianAlertCount: number;
    monthStatuses: MonthBadge[];
    deadlines: Deadline[];
}

interface MonthBadge {
    period: string;
    label: string;
    status: 'reconciled' | 'pending' | 'empty';
    txCount: number;
}

interface Deadline {
    id: string;
    title: string;
    date: Date;
    daysUntil: number;
    severity: 'critical' | 'warning' | 'info';
}

interface ApiUsageSnapshot {
    hourlyUsed: number;
    dailyUsed: number;
    ratio: number;
}

type TrendDelta = PlatformTrendDelta;
type TriageBucket = PlatformTriageBucket;

interface PlatformMetric {
    id: string;
    title: string;
    value: string;
    details: string;
    score: number;
    trend: TrendDelta;
    trendPositiveDirection: 'up' | 'down';
    bucket: TriageBucket;
    actionTool?: string;
    actionLabel?: string;
}

interface PlatformSummary {
    platformScore: number;
    operationalScore: number;
    adoptionScore: number;
    quotaDataAvailable: boolean;
    metrics: PlatformMetric[];
}

interface InvoiceInboxEntry {
    uploadedAt?: string;
    status?: string;
}

interface ReconciliationSnapshotEntry {
    period: string;
    status?: string | null;
}

// =============================================================================
// STORAGE HELPERS
// =============================================================================

const storageWarningKeys = new Set<string>();

function logStorageWarningOnce(key: string, error: unknown): void {
    if (storageWarningKeys.has(key)) return;
    storageWarningKeys.add(key);
    logger.warn(`Dashboard: kunde inte läsa localStorage (${key})`, error);
}

function readStoredJson<T>(key: string): T | null {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        return JSON.parse(raw) as T;
    } catch (error) {
        logStorageWarningOnce(key, error);
        return null;
    }
}

function parseDateMs(value: string | undefined | null): number | null {
    if (!value) return null;
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : null;
}

function isTimestampInRange(value: string | undefined, start: Date, end: Date): boolean {
    const ms = parseDateMs(value);
    if (ms === null) return false;
    return ms >= start.getTime() && ms < end.getTime();
}

function extractVatTimestamp(report: Record<string, unknown> | null): string | null {
    if (!report) return null;
    const candidates = ['analyzedAt', 'updatedAt', 'createdAt', 'timestamp'];
    for (const key of candidates) {
        const value = report[key];
        if (typeof value === 'string' && value.trim()) {
            return value;
        }
    }
    return null;
}

function getAgeDays(timestamp: string | null, now: Date): number | null {
    if (!timestamp) return null;
    const parsedMs = parseDateMs(timestamp);
    if (parsedMs === null) return null;
    const delta = now.getTime() - parsedMs;
    if (!Number.isFinite(delta)) return null;
    return Math.max(0, Math.floor(delta / (24 * 60 * 60 * 1000)));
}

function scoreFromQuotaRatio(ratio: number): number {
    if (ratio >= 0.95) return 20;
    if (ratio >= 0.8) return 55;
    return 90;
}

function formatSyncTime(timestamp: string | null): string | null {
    if (!timestamp) return null;
    const parsed = new Date(timestamp);
    if (!Number.isFinite(parsed.getTime())) return null;
    return parsed.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
}

function syncLevelColor(level: DashboardSyncResult['level']): string {
    if (level === 'success') return '#10b981';
    if (level === 'partial') return '#f59e0b';
    return '#ef4444';
}

function isPendingInvoiceStatus(status: string | undefined | null): boolean {
    return status === 'ny' || status === 'granskad';
}

function isCompletedInvoiceStatus(status: string | undefined | null): boolean {
    return status === 'bokford' || status === 'betald';
}

function getCachedOrStoredInvoiceItems<T extends { status?: string }>(companyId: string): T[] {
    const cachedItems = financeAgentService.getCachedInvoiceInbox(companyId) as unknown as T[];
    if (cachedItems.length > 0) return cachedItems;
    return readStoredJson<Record<string, T[]>>(STORAGE_KEYS.invoiceInbox)?.[companyId] || [];
}

function getReconciledPeriodsSet(companyId: string): Set<string> {
    const cachedReconciliation = financeAgentService.getCachedReconciliation(companyId) as ReconciliationSnapshotEntry[];
    if (cachedReconciliation.length > 0) {
        return new Set(
            cachedReconciliation
                .filter((entry) => entry.status === 'reconciled' || entry.status === 'locked')
                .map((entry) => entry.period)
        );
    }
    return new Set(readStoredJson<Record<string, string[]>>(STORAGE_KEYS.reconciledPeriods)?.[companyId] || []);
}

function daysUntilDate(targetDate: Date, now: Date): number {
    return Math.ceil((targetDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function resolveDeadlineSeverity(daysUntil: number, criticalThreshold = 3): Deadline['severity'] {
    if (daysUntil <= criticalThreshold) return 'critical';
    if (daysUntil <= 7) return 'warning';
    return 'info';
}

function getNextMonthlyDeadlineDate(now: Date, dayOfMonth: number): Date {
    const month = now.getDate() <= dayOfMonth ? now.getMonth() : now.getMonth() + 1;
    return new Date(now.getFullYear(), month, dayOfMonth);
}

function createMonthlyDeadline(id: string, titlePrefix: string, now: Date, dayOfMonth: number): Deadline {
    const date = getNextMonthlyDeadlineDate(now, dayOfMonth);
    const daysUntil = daysUntilDate(date, now);
    return {
        id,
        title: `${titlePrefix} ${date.toLocaleDateString('sv-SE', { month: 'long' })}`,
        date,
        daysUntil,
        severity: resolveDeadlineSeverity(daysUntil),
    };
}

// =============================================================================
// DATA AGGREGATION (existing economy logic)
// =============================================================================

function aggregateDashboardData(companyId: string): DashboardData {
    let resultat: number | null = null;
    let momssaldo: number | null = null;

    const vatReport = readStoredJson<Record<string, unknown>>(`latest_vat_report_${companyId}`);
    if (vatReport) {
        const summary = vatReport.summary as { result?: number } | undefined;
        const vat = vatReport.vat as { net_vat?: number } | undefined;
        resultat = typeof summary?.result === 'number' ? summary.result : null;
        momssaldo = typeof vat?.net_vat === 'number' ? vat.net_vat : null;
    }

    const imports = bankImportService.getImports(companyId);
    const allTx = imports.flatMap(i => i.transactions);
    const banksaldo = allTx.reduce((sum, tx) => sum + tx.amount, 0);

    const notifications = copilotService.getNotifications();
    const overdueCount = notifications.filter(n => n.type === 'overdue_invoice').length;
    const unbookedCount = notifications.filter(n => n.type === 'unbooked_invoice').length;
    const guardianAlertCount = notifications.filter(n =>
        n.id.startsWith('guardian-') && (n.severity === 'critical' || n.severity === 'warning')
    ).length;

    const inboxItems = getCachedOrStoredInvoiceItems<InvoiceInboxEntry>(companyId);
    const pendingInvoices = inboxItems.filter(i => isPendingInvoiceStatus(i.status)).length;

    const reconciledSet = getReconciledPeriodsSet(companyId);

    const periodTxMap = new Map<string, number>();
    for (const tx of allTx) {
        if (tx.date) {
            const period = tx.date.substring(0, 7);
            periodTxMap.set(period, (periodTxMap.get(period) || 0) + 1);
        }
    }

    const allPeriods = [...periodTxMap.keys()].sort((a, b) => b.localeCompare(a));
    const unreconciledCount = allPeriods.filter(p => !reconciledSet.has(p)).length;

    const now = new Date();
    const monthStatuses: MonthBadge[] = [];
    for (let i = 0; i < 6; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const label = d.toLocaleDateString('sv-SE', { month: 'short' }).replace('.', '');
        const txCount = periodTxMap.get(period) || 0;
        const status: MonthBadge['status'] = reconciledSet.has(period) ? 'reconciled' : txCount > 0 ? 'pending' : 'empty';
        monthStatuses.push({ period, label, status, txCount });
    }

    const fortnoxStatus = fortnoxContextService.getConnectionStatus();
    const deadlines = computeDeadlines(companyId);

    return {
        resultat,
        momssaldo,
        banksaldo,
        fortnoxStatus,
        overdueCount,
        unbookedCount,
        pendingInvoices,
        unreconciledCount,
        guardianAlertCount,
        monthStatuses,
        deadlines
    };
}

function computeDeadlines(companyId: string): Deadline[] {
    const now = new Date();
    const deadlines: Deadline[] = [];

    deadlines.push(createMonthlyDeadline('vat-deadline', 'Momsdeklaration', now, 12));
    deadlines.push(createMonthlyDeadline('employer-deadline', 'Arbetsgivaravgifter', now, 12));

    const invoices = getCachedOrStoredInvoiceItems<{ dueDate?: string; supplierName?: string; status?: string }>(companyId);
    for (const inv of invoices) {
        if (inv.dueDate && inv.status !== 'betald') {
            const due = new Date(inv.dueDate);
            const days = daysUntilDate(due, now);
            if (days >= -7 && days <= 30) {
                deadlines.push({
                    id: `inv-${inv.dueDate}-${inv.supplierName}`,
                    title: `Faktura ${inv.supplierName || 'okänd'}`,
                    date: due, daysUntil: days,
                    severity: resolveDeadlineSeverity(days, 0),
                });
            }
        }
    }

    deadlines.sort((a, b) => a.date.getTime() - b.date.getTime());
    return deadlines.slice(0, 5);
}

// =============================================================================
// HELPERS
// =============================================================================

const formatAmount = (value: number) =>
    value.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' kr';

const SEVERITY_COLORS: Record<string, { color: string; bg: string; border: string }> = {
    critical: { color: '#ef4444', bg: 'rgba(239, 68, 68, 0.12)', border: '#ef4444' },
    warning: { color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.12)', border: '#f59e0b' },
    info: { color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.12)', border: '#3b82f6' },
};

const MONTH_COLORS: Record<string, { dot: string; bg: string; border: string }> = {
    reconciled: { dot: '#10b981', bg: 'rgba(16, 185, 129, 0.1)', border: 'rgba(16, 185, 129, 0.3)' },
    pending: { dot: '#f59e0b', bg: 'rgba(245, 158, 11, 0.1)', border: 'rgba(245, 158, 11, 0.3)' },
    empty: { dot: '#475569', bg: 'rgba(71, 85, 105, 0.06)', border: 'var(--surface-border)' },
};

const STATUS_CONFIGS = [
    { key: 'overdue', icon: 'alert-circle', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.1)', label: 'Förfallna fakturor', nav: 'fortnox-panel' },
    { key: 'unbooked', icon: 'file-text', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.1)', label: 'Obokförda fakturor', nav: 'fortnox-panel' },
    { key: 'guardian', icon: 'shield-alert', color: '#f97316', bg: 'rgba(249, 115, 22, 0.1)', label: 'Guardian-larm', nav: 'fortnox-panel' },
    { key: 'inbox', icon: 'inbox', color: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.1)', label: 'Väntande i inkorgen', nav: 'invoice-inbox' },
    { key: 'unrecon', icon: 'check-circle', color: '#0ea5e9', bg: 'rgba(14, 165, 233, 0.1)', label: 'Ej avstämda perioder', nav: 'reconciliation' },
] as const;

const QUICK_ACTIONS = [
    { label: 'Importera bank', desc: 'CSV-kontoutdrag', color: '#0ea5e9', nav: 'bank-import', iconPath: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12' },
    { label: 'Fakturainkorg', desc: 'Ladda upp PDF', color: '#8b5cf6', nav: 'invoice-inbox', iconPath: 'M22 12l-6 0-2 3-4 0-2-3-6 0M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z' },
    { label: 'Bankavstämning', desc: 'Per period', color: '#10b981', nav: 'reconciliation', iconPath: 'M22 11.08V12a10 10 0 11-5.93-9.14M22 4L12 14.01l-3-3' },
    { label: 'Fortnoxpanel', desc: 'Fakturor & Copilot', color: '#2563eb', nav: 'fortnox-panel', iconPath: 'M2 3h20v14H2zM8 21h8M12 17v4' },
];

const TRIAGE_META: Record<TriageBucket, { title: string; border: string; bg: string }> = {
    working: {
        title: 'Fungerar',
        border: 'rgba(16, 185, 129, 0.3)',
        bg: 'rgba(16, 185, 129, 0.08)',
    },
    improve: {
        title: 'Bör förbättras',
        border: 'rgba(245, 158, 11, 0.3)',
        bg: 'rgba(245, 158, 11, 0.08)',
    },
    add: {
        title: 'Behöver läggas till',
        border: 'rgba(59, 130, 246, 0.3)',
        bg: 'rgba(59, 130, 246, 0.08)',
    },
};

// =============================================================================
// COMPONENT
// =============================================================================

export const DashboardPanel: FunctionComponent<DashboardPanelProps> = ({ onNavigate, isAdmin, userId, timeWindowDays = 7 }) => {
    const [refreshKey, setRefreshKey] = useState(0);
    const [apiUsage, setApiUsage] = useState<ApiUsageSnapshot | null>(null);
    const [apiUsageUnavailable, setApiUsageUnavailable] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [syncResult, setSyncResult] = useState<DashboardSyncResult | null>(null);
    const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
    const [complianceStats, setComplianceStats] = useState<{ totalAlerts: number; blockingAlerts: number; latestAgiStatus: string | null }>({
        totalAlerts: 0,
        blockingAlerts: 0,
        latestAgiStatus: null,
    });

    const companyId = useMemo(() => companyService.getCurrentId(), []);
    const company = useMemo(() => companyService.getCurrent(), []);
    const data = useMemo(() => aggregateDashboardData(companyId), [companyId, refreshKey]);

    const refresh = useCallback(() => setRefreshKey(k => k + 1), []);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            await financeAgentService.preloadCompany(companyId);
            await bankImportService.refreshImports(companyId);
            if (!cancelled) refresh();
        })();
        return () => {
            cancelled = true;
        };
    }, [companyId, refresh]);

    const reloadApiUsage = useCallback(async (options?: { cancelled?: () => boolean }): Promise<void> => {
        const cancelled = options?.cancelled ?? (() => false);

        if (!isAdmin || !userId) {
            if (cancelled()) return;
            setApiUsage(null);
            setApiUsageUnavailable(false);
            return;
        }

        try {
            const { data: usage, error } = await supabase
                .from('api_usage')
                .select('hourly_count, daily_count')
                .eq('user_id', userId)
                .eq('endpoint', 'ai')
                .maybeSingle();

            if (cancelled()) return;
            if (error) throw error;

            const hourlyUsed = usage?.hourly_count ?? 0;
            const dailyUsed = usage?.daily_count ?? 0;
            const ratio = Math.max(hourlyUsed / 40, dailyUsed / 200);

            setApiUsage({
                hourlyUsed,
                dailyUsed,
                ratio,
            });
            setApiUsageUnavailable(false);
        } catch (error) {
            if (cancelled()) return;
            logger.warn('Dashboard: kunde inte hämta api_usage', error);
            setApiUsage(null);
            setApiUsageUnavailable(true);
            throw error;
        }
    }, [isAdmin, userId]);

    useEffect(() => {
        const handler = () => refresh();
        copilotService.addEventListener('copilot-updated', handler as EventListener);
        return () => copilotService.removeEventListener('copilot-updated', handler as EventListener);
    }, [refresh]);

    useEffect(() => {
        let cancelled = false;

        void reloadApiUsage({ cancelled: () => cancelled }).catch(() => {
            // Error is already logged in reloadApiUsage.
        });

        return () => {
            cancelled = true;
        };
    }, [reloadApiUsage, refreshKey]);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const [alerts, agiResult] = await Promise.all([
                    financeAgentService.listComplianceAlerts(companyId),
                    supabase
                        .from('agi_runs')
                        .select('status')
                        .eq('company_id', companyId)
                        .order('updated_at', { ascending: false })
                        .limit(1)
                        .maybeSingle(),
                ]);

                if (cancelled) return;
                const blockingAlerts = alerts.filter((alert) => alert.severity === 'critical' || alert.severity === 'warning').length;
                setComplianceStats({
                    totalAlerts: alerts.length,
                    blockingAlerts,
                    latestAgiStatus: agiResult.data?.status || null,
                });
            } catch (error) {
                if (cancelled) return;
                logger.warn('Dashboard: kunde inte hämta compliance-status', error);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [companyId, refreshKey]);

    const handleSyncNow = useCallback(async (): Promise<void> => {
        if (isSyncing) return;

        setIsSyncing(true);
        setSyncResult(null);

        const fallbackSteps: DashboardSyncSteps = {
            quickRefresh: 'failed',
            connectionCheck: 'failed',
            fortnoxPreload: 'failed',
            copilotCheck: 'failed',
            apiUsageReload: 'failed',
            finalRefresh: 'failed',
        };

        try {
            const result = await runDashboardSync({
                refreshLocal: refresh,
                checkConnection: () => fortnoxContextService.checkConnection(),
                preloadFortnoxData: () => fortnoxContextService.preloadData(),
                forceCopilotCheck: () => copilotService.forceCheck(),
                reloadApiUsage: () => reloadApiUsage(),
                withTimeout,
                logger,
            });

            setSyncResult(result);
            setLastSyncedAt(result.at);
        } catch (error) {
            logger.warn('Dashboard: synk misslyckades oväntat', error);
            const at = new Date().toISOString();
            setSyncResult({
                level: 'error',
                message: 'Synk misslyckades',
                at,
                steps: fallbackSteps,
            });
            setLastSyncedAt(at);
        } finally {
            setIsSyncing(false);
        }
    }, [isSyncing, refresh, reloadApiUsage]);

    useEffect(() => {
        if (!syncResult) return;
        const timeoutId = window.setTimeout(() => {
            setSyncResult(null);
        }, 6000);

        return () => window.clearTimeout(timeoutId);
    }, [syncResult]);

    const platformSummary = useMemo<PlatformSummary | null>(() => {
        if (!isAdmin || !userId) return null;

        const now = new Date();
        const windows = buildTimeWindows(now, timeWindowDays);

        const imports = bankImportService.getImports(companyId);
        const bankImportTimestamps = imports.map(i => i.importedAt);
        const bankImportsCurrent = countIsoTimestampsInRange(bankImportTimestamps, windows.currentStart, windows.now);
        const bankImportsPrevious = countIsoTimestampsInRange(bankImportTimestamps, windows.previousStart, windows.previousEnd);

        const allPeriods = new Set<string>();
        const currentPeriods = new Set<string>();
        const previousPeriods = new Set<string>();

        for (const imported of imports) {
            for (const tx of imported.transactions) {
                if (!tx.date) continue;
                const period = tx.date.substring(0, 7);
                if (period.length !== 7) continue;

                const txDate = tx.date.length <= 10 ? `${tx.date}T12:00:00` : tx.date;
                const txMs = parseDateMs(txDate);
                if (txMs === null) continue;

                allPeriods.add(period);
                if (txMs >= windows.currentStart.getTime() && txMs < windows.now.getTime()) {
                    currentPeriods.add(period);
                } else if (txMs >= windows.previousStart.getTime() && txMs < windows.previousEnd.getTime()) {
                    previousPeriods.add(period);
                }
            }
        }

        const reconciledSet = getReconciledPeriodsSet(companyId);

        const activePeriods = allPeriods.size;
        const reconciledPeriods = [...allPeriods].filter(period => reconciledSet.has(period)).length;

        const currentReconciledPeriods = [...currentPeriods].filter(period => reconciledSet.has(period)).length;
        const previousReconciledPeriods = [...previousPeriods].filter(period => reconciledSet.has(period)).length;

        const currentReconciliationCoverage = currentPeriods.size === 0
            ? 40
            : Math.round((currentReconciledPeriods / currentPeriods.size) * 100);
        const previousReconciliationCoverage = previousPeriods.size === 0
            ? 40
            : Math.round((previousReconciledPeriods / previousPeriods.size) * 100);

        const invoiceItems = getCachedOrStoredInvoiceItems<InvoiceInboxEntry>(companyId);

        let invoiceItemsCurrent = 0;
        let invoiceItemsPrevious = 0;
        let invoiceCompletedCurrent = 0;
        let invoiceCompletedPrevious = 0;

        for (const item of invoiceItems) {
            const status = item.status || '';
            const completed = isCompletedInvoiceStatus(status);

            if (isTimestampInRange(item.uploadedAt, windows.currentStart, windows.now)) {
                invoiceItemsCurrent += 1;
                if (completed) invoiceCompletedCurrent += 1;
            }

            if (isTimestampInRange(item.uploadedAt, windows.previousStart, windows.previousEnd)) {
                invoiceItemsPrevious += 1;
                if (completed) invoiceCompletedPrevious += 1;
            }
        }

        const invoiceFlowCurrentScore = invoiceItemsCurrent === 0
            ? 20
            : Math.round((invoiceCompletedCurrent / invoiceItemsCurrent) * 100);
        const invoiceFlowPreviousScore = invoiceItemsPrevious === 0
            ? 20
            : Math.round((invoiceCompletedPrevious / invoiceItemsPrevious) * 100);

        const latestVatReport = readStoredJson<Record<string, unknown>>(`latest_vat_report_${companyId}`);
        const latestVatTimestamp = extractVatTimestamp(latestVatReport);
        const vatAgeDays = getAgeDays(latestVatTimestamp, now);
        const previousVatAgeDays = vatAgeDays === null
            ? null
            : Math.max(0, vatAgeDays - Math.max(1, Math.floor(timeWindowDays)));

        const notifications = copilotService.getNotifications();
        const criticalAlerts = notifications.filter(n => n.severity === 'critical').length;
        const warningAlerts = notifications.filter(n => n.severity === 'warning').length;

        const riskTimestamps = notifications
            .filter(n => n.severity === 'critical' || n.severity === 'warning')
            .map(n => n.createdAt);

        const riskCurrentCount = countIsoTimestampsInRange(riskTimestamps, windows.currentStart, windows.now);
        const riskPreviousCount = countIsoTimestampsInRange(riskTimestamps, windows.previousStart, windows.previousEnd);

        const riskScoreCurrent = Math.max(0, 100 - Math.min(100, riskCurrentCount * 15));
        const riskScorePrevious = Math.max(0, 100 - Math.min(100, riskPreviousCount * 15));

        const quotaRatio = apiUsage ? apiUsage.ratio : null;
        const operational = computeOperationalScore({
            fortnoxConnected: data.fortnoxStatus === 'connected',
            criticalAlerts,
            warningAlerts,
            overdueInvoices: data.overdueCount,
            unbookedInvoices: data.unbookedCount,
            quotaRatio: apiUsageUnavailable ? null : quotaRatio,
        });

        const adoption = computeAdoptionScore({
            importsLast7: bankImportsCurrent,
            invoiceItemsLast7: invoiceItemsCurrent,
            invoiceCompletedLast7: invoiceCompletedCurrent,
            activePeriods,
            reconciledPeriods,
            vatReportAgeDays: vatAgeDays,
        });

        const platformScore = computePlatformScore(operational.score, adoption.score);

        const quotaMetricScore = apiUsage
            ? scoreFromQuotaRatio(apiUsage.ratio)
            : 70;

        const quotaTrend = apiUsage
            ? calcTrendDelta(Math.round(apiUsage.ratio * 100), Math.round(apiUsage.ratio * 100))
            : calcTrendDelta(0, 0);

        const metricsBase: Array<Omit<PlatformMetric, 'bucket'>> = [
            {
                id: 'risk-alerts',
                title: 'Larm & risk',
                value: `${criticalAlerts} kritiska · ${warningAlerts} varningar`,
                details: 'Guardian och Copilot-risker i aktuell vy.',
                score: Math.max(0, 100 - Math.min(100, criticalAlerts * 20 + warningAlerts * 10)),
                trend: calcTrendDelta(riskScoreCurrent, riskScorePrevious),
                trendPositiveDirection: 'up',
                actionTool: 'fortnox-panel',
                actionLabel: 'Öppna Fortnoxpanel',
            },
            {
                id: 'quota-pressure',
                title: 'Kvottryck',
                value: apiUsage
                    ? `${Math.round(apiUsage.ratio * 100)}% av gräns`
                    : 'Data saknas',
                details: apiUsage
                    ? `Timme ${apiUsage.hourlyUsed}/40 · Dag ${apiUsage.dailyUsed}/200`
                    : 'Kunde inte läsa api_usage. Neutral vikt i score.',
                score: quotaMetricScore,
                trend: quotaTrend,
                trendPositiveDirection: 'down',
            },
            {
                id: 'bank-activity',
                title: 'Bankaktivitet',
                value: `${bankImportsCurrent} importer`,
                details: `Bankimporter senaste ${timeWindowDays} dagar.`,
                score: adoption.bankCadenceScore,
                trend: calcTrendDelta(bankImportsCurrent, bankImportsPrevious),
                trendPositiveDirection: 'up',
                actionTool: 'bank-import',
                actionLabel: 'Öppna bankimport',
            },
            {
                id: 'invoice-flow',
                title: 'Fakturaflöde',
                value: invoiceItemsCurrent === 0
                    ? '0 fakturor'
                    : `${invoiceCompletedCurrent}/${invoiceItemsCurrent} bokförda/betalda`,
                details: `Flödesgrad ${invoiceFlowCurrentScore}% senaste ${timeWindowDays} dagar.`,
                score: adoption.invoiceFlowScore,
                trend: calcTrendDelta(invoiceFlowCurrentScore, invoiceFlowPreviousScore),
                trendPositiveDirection: 'up',
                actionTool: 'invoice-inbox',
                actionLabel: 'Öppna fakturainkorg',
            },
            {
                id: 'reconciliation-coverage',
                title: 'Avstämningsgrad',
                value: activePeriods === 0
                    ? 'Inga perioder'
                    : `${reconciledPeriods}/${activePeriods} avstämda`,
                details: 'Täckning mellan importerade perioder och markerade avstämningar.',
                score: adoption.reconciliationScore,
                trend: calcTrendDelta(currentReconciliationCoverage, previousReconciliationCoverage),
                trendPositiveDirection: 'up',
                actionTool: 'reconciliation',
                actionLabel: 'Öppna avstämning',
            },
            {
                id: 'vat-freshness',
                title: 'Momsaktualitet',
                value: vatAgeDays === null
                    ? 'Ingen rapport'
                    : `${vatAgeDays} dagar sedan`,
                details: 'Tid sedan senaste sparade momsrapport.',
                score: adoption.vatFreshnessScore,
                trend: calcTrendDelta(
                    adoption.vatFreshnessScore,
                    computeAdoptionScore({
                        importsLast7: bankImportsCurrent,
                        invoiceItemsLast7: invoiceItemsCurrent,
                        invoiceCompletedLast7: invoiceCompletedCurrent,
                        activePeriods,
                        reconciledPeriods,
                        vatReportAgeDays: previousVatAgeDays,
                    }).vatFreshnessScore
                ),
                trendPositiveDirection: 'up',
                actionTool: 'vat-report',
                actionLabel: 'Öppna momsrapport',
            },
        ];

        const metrics: PlatformMetric[] = metricsBase.map(metric => {
            const isRiskMetric = metric.id === 'risk-alerts';
            const isQuotaMetric = metric.id === 'quota-pressure';
            const isBankMetric = metric.id === 'bank-activity';
            const isInvoiceMetric = metric.id === 'invoice-flow';
            const isVatMetric = metric.id === 'vat-freshness';

            const hasBlocker = isRiskMetric
                ? criticalAlerts > 0
                : false;

            const hasWarning = isRiskMetric
                ? warningAlerts > 0
                : isQuotaMetric
                    ? (apiUsage ? apiUsage.ratio >= 0.8 : true)
                    : metric.score < 75;

            const missingCapability = isBankMetric
                ? bankImportsCurrent === 0
                : isInvoiceMetric
                    ? invoiceItemsCurrent === 0
                    : isVatMetric
                        ? !latestVatTimestamp
                        : isRiskMetric
                            ? data.fortnoxStatus !== 'connected'
                            : false;

            return {
                ...metric,
                bucket: classifyTriageBucket({
                    score: metric.score,
                    hasBlocker,
                    hasWarning,
                    missingCapability,
                }),
            };
        });

        return {
            platformScore,
            operationalScore: operational.score,
            adoptionScore: adoption.score,
            quotaDataAvailable: apiUsage !== null,
            metrics,
        };
    }, [
        apiUsage,
        apiUsageUnavailable,
        companyId,
        data.fortnoxStatus,
        data.overdueCount,
        data.unbookedCount,
        isAdmin,
        userId,
        refreshKey,
        timeWindowDays,
    ]);

    const triageBuckets = useMemo(() => {
        const empty: Record<TriageBucket, PlatformMetric[]> = {
            working: [],
            improve: [],
            add: [],
        };

        if (!platformSummary) return empty;
        for (const metric of platformSummary.metrics) {
            empty[metric.bucket].push(metric);
        }
        return empty;
    }, [platformSummary]);

    const hasAnyData = data.resultat !== null || data.banksaldo !== 0 || data.pendingInvoices > 0 || data.overdueCount > 0 || data.guardianAlertCount > 0;
    const allClear = hasAnyData && data.overdueCount === 0 && data.unbookedCount === 0 && data.pendingInvoices === 0 && data.unreconciledCount === 0 && data.guardianAlertCount === 0;

    const statusCounts: Record<string, number> = {
        overdue: data.overdueCount,
        unbooked: data.unbookedCount,
        guardian: data.guardianAlertCount,
        inbox: data.pendingInvoices,
        unrecon: data.unreconciledCount,
    };
    const formattedLastSyncedAt = useMemo(
        () => formatSyncTime(lastSyncedAt),
        [lastSyncedAt]
    );

    return (
        <div className="panel-stagger" style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', letterSpacing: '0.02em' }}>
                        {company.name || 'Mitt Företag'}
                        {company.orgNumber ? ` \u00b7 ${company.orgNumber}` : ''}
                    </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.35rem' }}>
                    <button
                        onClick={() => void handleSyncNow()}
                        disabled={isSyncing}
                        data-testid="dashboard-sync-button"
                        className="panel-card panel-card--no-hover"
                        style={{
                            padding: '0.4rem 0.75rem',
                            borderRadius: '10px',
                            fontSize: '0.78rem',
                            cursor: isSyncing ? 'wait' : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.4rem',
                            color: 'var(--text-secondary)',
                            fontWeight: 600,
                            opacity: isSyncing ? 0.85 : 1,
                        }}
                    >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M23 4v6h-6" /><path d="M1 20v-6h6" />
                            <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                        </svg>
                        {isSyncing ? 'Synkar...' : 'Synka nu'}
                    </button>

                    {(syncResult || lastSyncedAt) && (
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'flex-end',
                            gap: '0.4rem',
                            flexWrap: 'wrap',
                        }}
                        data-testid="dashboard-sync-status-row"
                        >
                            {syncResult && (
                                <span style={{
                                    fontSize: '0.72rem',
                                    fontWeight: 700,
                                    color: syncLevelColor(syncResult.level),
                                }}
                                data-testid="dashboard-sync-status-message"
                                >
                                    {syncResult.message}
                                </span>
                            )}
                            {formattedLastSyncedAt && (
                                <span
                                    style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}
                                    data-testid="dashboard-sync-last-synced"
                                >
                                    Senast synkad {formattedLastSyncedAt}
                                </span>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Admin-only Platform Pulse */}
            {isAdmin && userId && platformSummary && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div className="panel-section-title">Plattformspuls ({timeWindowDays} dagar)</div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
                        <ScoreCard
                            title="Total"
                            value={platformSummary.platformScore}
                            subtitle="Samlat plattformsbetyg"
                            color="#2563eb"
                        />
                        <ScoreCard
                            title="Stabilitet"
                            value={platformSummary.operationalScore}
                            subtitle="Drift, larm och kvot"
                            color="#10b981"
                        />
                        <ScoreCard
                            title="Användning"
                            value={platformSummary.adoptionScore}
                            subtitle="Användning i arbetsflöden"
                            color="#8b5cf6"
                        />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '0.75rem' }}>
                        {platformSummary.metrics.map(metric => (
                            <div key={metric.id} className="panel-card panel-card--gradient" style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center' }}>
                                    <span className="panel-label" style={{ fontSize: '0.72rem' }}>{metric.title}</span>
                                    <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                                        {metric.score}/100
                                    </span>
                                </div>
                                <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                                    {metric.value}
                                </div>
                                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', lineHeight: 1.35 }}>
                                    {metric.details}
                                </div>
                                <TrendPill trend={metric.trend} positiveDirection={metric.trendPositiveDirection} />
                            </div>
                        ))}
                    </div>

                    {!platformSummary.quotaDataAvailable && (
                        <div className="panel-card panel-card--no-hover" style={{
                            border: '1px solid rgba(245, 158, 11, 0.35)',
                            background: 'rgba(245, 158, 11, 0.08)',
                            color: '#f59e0b',
                            fontSize: '0.82rem',
                            lineHeight: 1.45,
                        }}>
                            Kvotmätning saknas just nu (`api_usage`). Plattformsscore använder neutral vikt utan kvotstraff.
                        </div>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.75rem' }}>
                        {(['working', 'improve', 'add'] as TriageBucket[]).map(bucket => (
                            <div
                                key={bucket}
                                className="panel-card panel-card--no-hover"
                                style={{
                                    background: TRIAGE_META[bucket].bg,
                                    border: `1px solid ${TRIAGE_META[bucket].border}`,
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '0.55rem',
                                }}
                            >
                                <div style={{
                                    fontSize: '0.78rem',
                                    fontWeight: 800,
                                    letterSpacing: '0.03em',
                                    textTransform: 'uppercase',
                                    color: 'var(--text-primary)',
                                }}>
                                    {TRIAGE_META[bucket].title}
                                </div>

                                {triageBuckets[bucket].length === 0 ? (
                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                        Inga punkter just nu.
                                    </div>
                                ) : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                                        {triageBuckets[bucket].map(metric => (
                                            <div key={metric.id} style={{
                                                padding: '0.65rem',
                                                borderRadius: '10px',
                                                border: '1px solid var(--surface-border)',
                                                background: 'var(--surface-1)',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                gap: '0.35rem',
                                            }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.6rem', alignItems: 'center' }}>
                                                    <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                                                        {metric.title}
                                                    </span>
                                                    <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 700 }}>
                                                        {metric.score}/100
                                                    </span>
                                                </div>
                                                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                                    {metric.value}
                                                </span>
                                                {metric.actionTool && (
                                                    <button
                                                        type="button"
                                                        className="panel-card panel-card--interactive"
                                                        onClick={() => onNavigate(metric.actionTool || '')}
                                                        style={{
                                                            marginTop: '0.2rem',
                                                            padding: '0.4rem 0.6rem',
                                                            borderRadius: '8px',
                                                            fontSize: '0.74rem',
                                                            fontWeight: 700,
                                                            color: 'var(--text-primary)',
                                                            textAlign: 'left',
                                                        }}
                                                    >
                                                        {metric.actionLabel || 'Öppna'}
                                                    </button>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* All-clear banner */}
            {allClear && (
                <div className="panel-card" style={{
                    background: 'rgba(16, 185, 129, 0.08)',
                    border: '1px solid rgba(16, 185, 129, 0.2)',
                    color: '#10b981',
                    fontSize: '0.88rem',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.6rem',
                }}>
                    <div className="panel-icon" style={{ background: 'rgba(16, 185, 129, 0.15)', width: '32px', height: '32px', borderRadius: '8px' }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
                        </svg>
                    </div>
                    Allt ser bra ut! Inga åtgärder behövs just nu.
                </div>
            )}

            {/* A. Financial Snapshot */}
            <div>
                <div className="panel-section-title">Ekonomisk översikt</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
                    <KPICard label="Resultat" value={data.resultat} color="#10b981" emptyText="Ingen momsrapport"
                        iconPath="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
                    <KPICard label="Momssaldo" value={data.momssaldo} color="#3b82f6" emptyText="Ingen momsrapport"
                        iconPath="M1 4h22v16H1zM1 10h22" />
                    <KPICard label="Banksaldo" value={data.banksaldo} color="#0ea5e9" emptyText="Inga kontoutdrag" alwaysShow
                        iconPath="M2 17l10 5 10-5M2 12l10 5 10-5M12 2L2 7l10 5 10-5L12 2z" />
                    {/* Fortnox Status */}
                    <div className="panel-card panel-card--gradient" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                            <div className="panel-icon" style={{
                                background: data.fortnoxStatus === 'connected' ? 'var(--accent-gradient)' : 'var(--surface-3)',
                                color: data.fortnoxStatus === 'connected' ? '#fff' : 'var(--text-secondary)',
                                fontSize: '0.9rem', fontWeight: 800,
                            }}>
                                F
                            </div>
                            <span className="panel-label">Fortnox</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <div style={{
                                width: '8px', height: '8px', borderRadius: '50%',
                                background: data.fortnoxStatus === 'connected' ? '#10b981' : '#64748b',
                            }} />
                            <span style={{
                                fontSize: '0.9rem', fontWeight: 700,
                                color: data.fortnoxStatus === 'connected' ? '#10b981' : 'var(--text-secondary)',
                            }}>
                                {data.fortnoxStatus === 'connected' ? 'Ansluten' : data.fortnoxStatus === 'checking' ? 'Kontrollerar...' : 'Ej ansluten'}
                            </span>
                        </div>
                    </div>
                    <div className="panel-card panel-card--gradient" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                            <div className="panel-icon" style={{
                                background: complianceStats.blockingAlerts > 0 ? 'rgba(239,68,68,0.15)' : 'rgba(16,185,129,0.15)',
                                color: complianceStats.blockingAlerts > 0 ? '#ef4444' : '#10b981',
                            }}>
                                !
                            </div>
                            <span className="panel-label">Compliance / AGI</span>
                        </div>
                        <div style={{ fontSize: '0.9rem', fontWeight: 700, color: complianceStats.blockingAlerts > 0 ? '#ef4444' : '#10b981' }}>
                            {complianceStats.blockingAlerts > 0
                                ? `${complianceStats.blockingAlerts} blockerande varningar`
                                : 'Inga blockerande varningar'}
                        </div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                            AGI status: {complianceStats.latestAgiStatus || 'ingen körning'}
                        </div>
                    </div>
                </div>
            </div>

            {/* B. Status Overview */}
            <div>
                <div className="panel-section-title">Status</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
                    {STATUS_CONFIGS.map(cfg => {
                        const count = statusCounts[cfg.key];
                        const isOk = count === 0;
                        return (
                            <button
                                key={cfg.key}
                                type="button"
                                className="panel-card panel-card--interactive"
                                onClick={() => onNavigate(cfg.nav)}
                                style={{
                                    border: `1px solid ${isOk ? 'rgba(16,185,129,0.2)' : `${cfg.color}30`}`,
                                    background: isOk ? 'rgba(16,185,129,0.04)' : cfg.bg,
                                    display: 'flex', alignItems: 'center', gap: '0.75rem', textAlign: 'left',
                                    ...(count > 0 ? { animation: 'urgentPulse 2.5s ease-in-out infinite' } : {}),
                                }}
                            >
                                <div className="panel-icon" style={{
                                    background: isOk ? 'rgba(16,185,129,0.12)' : `${cfg.color}18`,
                                    color: isOk ? '#10b981' : cfg.color,
                                }}>
                                    <StatusIcon type={cfg.icon} />
                                </div>
                                <div>
                                    <div className={`panel-stat ${isOk ? 'panel-stat--positive' : 'panel-stat--neutral'}`}
                                        style={{ fontSize: '1.5rem', color: isOk ? '#10b981' : cfg.color }}>
                                        {count}
                                    </div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                                        {cfg.label}
                                    </div>
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* C. Reconciliation Overview */}
            {data.monthStatuses.some(m => m.status !== 'empty') && (
                <div>
                    <div className="panel-section-title">Avstämning per månad</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '0.5rem' }}>
                        {data.monthStatuses.map(m => {
                            const c = MONTH_COLORS[m.status];
                            return (
                                <div key={m.period} className="panel-card panel-card--no-hover" style={{
                                    padding: '0.75rem 0.5rem',
                                    background: c.bg, border: `1px solid ${c.border}`,
                                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.35rem',
                                    textAlign: 'center',
                                }}>
                                    <div style={{
                                        width: '10px', height: '10px', borderRadius: '50%',
                                        background: m.status === 'reconciled' ? c.dot : 'transparent',
                                        border: `2px solid ${c.dot}`,
                                    }} />
                                    <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)', textTransform: 'capitalize' }}>
                                        {m.label}
                                    </div>
                                    <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>
                                        {m.txCount} trans.
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* D. Deadlines */}
            <div>
                <div className="panel-section-title">Kommande deadlines</div>
                {data.deadlines.length === 0 ? (
                    <div className="panel-card panel-card--no-hover" style={{
                        fontSize: '0.85rem', color: 'var(--text-secondary)', textAlign: 'center', padding: '1.5rem',
                    }}>
                        Inga kommande deadlines de närmaste 30 dagarna.
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {data.deadlines.map(dl => {
                            const c = SEVERITY_COLORS[dl.severity];
                            return (
                                <div key={dl.id} className="panel-card panel-card--no-hover" style={{
                                    display: 'flex', alignItems: 'center', gap: '0.75rem',
                                    borderLeft: `3px solid ${c.border}`,
                                    borderRadius: '0 16px 16px 0',
                                }}>
                                    <span style={{
                                        padding: '0.3rem 0.8rem', borderRadius: '999px',
                                        background: c.bg, color: c.color,
                                        fontSize: '0.78rem', fontWeight: 700,
                                        whiteSpace: 'nowrap', minWidth: '70px', textAlign: 'center',
                                    }}>
                                        {dl.daysUntil <= 0 ? 'Förfallen' : dl.daysUntil === 1 ? 'Imorgon' : `${dl.daysUntil} dagar`}
                                    </span>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                                            {dl.title}
                                        </div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '1px' }}>
                                            {dl.date.toLocaleDateString('sv-SE', { day: 'numeric', month: 'long', year: 'numeric' })}
                                        </div>
                                    </div>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4, flexShrink: 0 }}>
                                        <polyline points="9 18 15 12 9 6" />
                                    </svg>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* E. Quick Actions */}
            <div>
                <div className="panel-section-title">Snabbåtgärder</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem' }}>
                    {QUICK_ACTIONS.map(qa => (
                        <button
                            key={qa.nav}
                            type="button"
                            className="panel-card panel-card--interactive"
                            onClick={() => onNavigate(qa.nav)}
                            style={{
                                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem',
                                padding: '1.25rem 1rem', textAlign: 'center',
                            }}
                        >
                            <div style={{
                                width: '48px', height: '48px', borderRadius: '14px',
                                background: qa.color, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                boxShadow: `0 4px 14px ${qa.color}40`,
                            }}>
                                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d={qa.iconPath} />
                                </svg>
                            </div>
                            <div>
                                <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                                    {qa.label}
                                </div>
                                <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                                    {qa.desc}
                                </div>
                            </div>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

interface KPICardProps {
    label: string;
    value: number | null;
    color: string;
    iconPath: string;
    emptyText: string;
    alwaysShow?: boolean;
}

const KPICard: FunctionComponent<KPICardProps> = ({ label, value, color, iconPath, emptyText, alwaysShow }) => {
    const showValue = value !== null || alwaysShow;
    const displayValue = value ?? 0;
    const isPositive = displayValue >= 0;

    return (
        <div className="panel-card panel-card--gradient" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <div className="panel-icon" style={{ background: `${color}15`, color }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d={iconPath} />
                    </svg>
                </div>
                <span className="panel-label">{label}</span>
            </div>
            {showValue ? (
                <span className={`panel-stat ${isPositive ? 'panel-stat--positive' : 'panel-stat--negative'}`}>
                    {formatAmount(displayValue)}
                </span>
            ) : (
                <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                    {emptyText}
                </span>
            )}
        </div>
    );
};

const ScoreCard: FunctionComponent<{
    title: string;
    value: number;
    subtitle: string;
    color: string;
}> = ({ title, value, subtitle, color }) => {
    return (
        <div className="panel-card panel-card--gradient" style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
            <span className="panel-label">{title}</span>
            <span className="panel-stat" style={{ color, fontSize: '2rem' }}>{value}</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{subtitle}</span>
        </div>
    );
};

const TrendPill: FunctionComponent<{
    trend: TrendDelta;
    positiveDirection: 'up' | 'down';
}> = ({ trend, positiveDirection }) => {
    const isFlat = trend.direction === 'flat';
    const isPositive = trend.direction === positiveDirection;

    const color = isFlat
        ? 'var(--text-secondary)'
        : isPositive
            ? '#10b981'
            : '#ef4444';

    const bg = isFlat
        ? 'rgba(148, 163, 184, 0.16)'
        : isPositive
            ? 'rgba(16, 185, 129, 0.16)'
            : 'rgba(239, 68, 68, 0.16)';

    const label = isFlat
        ? 'Oförändrat vs föregående 7 dagar'
        : trend.percentChange === null
            ? 'Ny signal vs föregående 7 dagar'
            : `${trend.delta > 0 ? '+' : ''}${Math.round(trend.delta)} (${trend.percentChange > 0 ? '+' : ''}${trend.percentChange}%) vs föregående 7 dagar`;

    return (
        <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            alignSelf: 'flex-start',
            padding: '0.2rem 0.5rem',
            borderRadius: '999px',
            background: bg,
            color,
            fontSize: '0.67rem',
            fontWeight: 700,
            lineHeight: 1.2,
        }}>
            {label}
        </span>
    );
};

const StatusIcon: FunctionComponent<{ type: string }> = ({ type }) => {
    const props = { width: '16', height: '16', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '2', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
    switch (type) {
        case 'alert-circle': return <svg {...props}><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>;
        case 'file-text': return <svg {...props}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>;
        case 'shield-alert': return <svg {...props}><path d="M12 2l7 4v6c0 5-3.5 9-7 10-3.5-1-7-5-7-10V6l7-4z" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>;
        case 'inbox': return <svg {...props}><polyline points="22 12 16 12 14 15 10 15 8 12 2 12" /><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" /></svg>;
        case 'check-circle': return <svg {...props}><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>;
        default: return null;
    }
};

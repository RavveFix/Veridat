export type DashboardConnectionStatus = 'connected' | 'disconnected' | 'checking' | 'error';
export type DashboardSyncStepStatus = 'ok' | 'skipped' | 'failed';
export type DashboardSyncLevel = 'success' | 'partial' | 'error';

export interface DashboardSyncSteps {
    quickRefresh: DashboardSyncStepStatus;
    connectionCheck: DashboardSyncStepStatus;
    fortnoxPreload: DashboardSyncStepStatus;
    copilotCheck: DashboardSyncStepStatus;
    apiUsageReload: DashboardSyncStepStatus;
    finalRefresh: DashboardSyncStepStatus;
}

export interface DashboardSyncResult {
    level: DashboardSyncLevel;
    message: string;
    at: string;
    steps: DashboardSyncSteps;
}

interface DashboardSyncTimeouts {
    connectionMs?: number;
    preloadMs?: number;
    copilotMs?: number;
    apiUsageMs?: number;
}

interface DashboardSyncLogger {
    info: (message: string, ...args: unknown[]) => void;
    warn: (message: string, ...args: unknown[]) => void;
}

export interface DashboardSyncDeps {
    refreshLocal: () => void;
    checkConnection: () => Promise<DashboardConnectionStatus>;
    preloadFortnoxData: () => Promise<void>;
    forceCopilotCheck: () => Promise<void>;
    reloadApiUsage: () => Promise<void>;
    withTimeout: <T>(promise: PromiseLike<T>, timeoutMs?: number, errorMessage?: string) => Promise<T>;
    logger: DashboardSyncLogger;
    timeouts?: DashboardSyncTimeouts;
}

const DEFAULT_TIMEOUTS = {
    connectionMs: 8000,
    preloadMs: 12000,
    copilotMs: 12000,
    apiUsageMs: 8000,
} as const;

function resolveLevel(steps: DashboardSyncSteps): DashboardSyncLevel {
    const failedSteps = Object.values(steps).filter(status => status === 'failed').length;
    const bothRefreshesFailed = steps.quickRefresh === 'failed' && steps.finalRefresh === 'failed';

    if (bothRefreshesFailed) return 'error';
    if (failedSteps > 0) return 'partial';
    return 'success';
}

function levelMessage(level: DashboardSyncLevel): string {
    if (level === 'success') return 'Synk klar';
    if (level === 'partial') return 'Synk klar med varningar';
    return 'Synk misslyckades';
}

function failedStepNames(steps: DashboardSyncSteps): string[] {
    return Object.entries(steps)
        .filter(([, status]) => status === 'failed')
        .map(([name]) => name);
}

export async function runDashboardSync(deps: DashboardSyncDeps): Promise<DashboardSyncResult> {
    const timeouts = {
        connectionMs: deps.timeouts?.connectionMs ?? DEFAULT_TIMEOUTS.connectionMs,
        preloadMs: deps.timeouts?.preloadMs ?? DEFAULT_TIMEOUTS.preloadMs,
        copilotMs: deps.timeouts?.copilotMs ?? DEFAULT_TIMEOUTS.copilotMs,
        apiUsageMs: deps.timeouts?.apiUsageMs ?? DEFAULT_TIMEOUTS.apiUsageMs,
    };

    const steps: DashboardSyncSteps = {
        quickRefresh: 'skipped',
        connectionCheck: 'skipped',
        fortnoxPreload: 'skipped',
        copilotCheck: 'skipped',
        apiUsageReload: 'skipped',
        finalRefresh: 'skipped',
    };

    let connectionStatus: DashboardConnectionStatus = 'error';

    try {
        deps.refreshLocal();
        steps.quickRefresh = 'ok';
    } catch (error) {
        steps.quickRefresh = 'failed';
        deps.logger.warn('Dashboard sync: snabb uppdatering misslyckades', error);
    }

    try {
        connectionStatus = await deps.withTimeout(
            deps.checkConnection(),
            timeouts.connectionMs,
            'Dashboard sync: timeout vid Fortnox-anslutning'
        );
        steps.connectionCheck = 'ok';
    } catch (error) {
        steps.connectionCheck = 'failed';
        connectionStatus = 'error';
        deps.logger.warn('Dashboard sync: kunde inte verifiera Fortnox-anslutning', error);
    }

    if (connectionStatus === 'connected') {
        const [preloadResult, copilotResult] = await Promise.allSettled([
            deps.withTimeout(
                deps.preloadFortnoxData(),
                timeouts.preloadMs,
                'Dashboard sync: timeout vid Fortnox-förladdning'
            ),
            deps.withTimeout(
                deps.forceCopilotCheck(),
                timeouts.copilotMs,
                'Dashboard sync: timeout vid Copilot-kontroll'
            ),
        ]);

        if (preloadResult.status === 'fulfilled') {
            steps.fortnoxPreload = 'ok';
        } else {
            steps.fortnoxPreload = 'failed';
            deps.logger.warn('Dashboard sync: Fortnox-förladdning misslyckades', preloadResult.reason);
        }

        if (copilotResult.status === 'fulfilled') {
            steps.copilotCheck = 'ok';
        } else {
            steps.copilotCheck = 'failed';
            deps.logger.warn('Dashboard sync: Copilot-kontroll misslyckades', copilotResult.reason);
        }
    } else {
        steps.fortnoxPreload = 'skipped';
        try {
            await deps.withTimeout(
                deps.forceCopilotCheck(),
                timeouts.copilotMs,
                'Dashboard sync: timeout vid Copilot-kontroll'
            );
            steps.copilotCheck = 'ok';
        } catch (error) {
            steps.copilotCheck = 'failed';
            deps.logger.warn('Dashboard sync: Copilot-kontroll misslyckades', error);
        }
    }

    try {
        await deps.withTimeout(
            deps.reloadApiUsage(),
            timeouts.apiUsageMs,
            'Dashboard sync: timeout vid omladdning av api_usage'
        );
        steps.apiUsageReload = 'ok';
    } catch (error) {
        steps.apiUsageReload = 'failed';
        deps.logger.warn('Dashboard sync: omladdning av api_usage misslyckades', error);
    }

    try {
        deps.refreshLocal();
        steps.finalRefresh = 'ok';
    } catch (error) {
        steps.finalRefresh = 'failed';
        deps.logger.warn('Dashboard sync: avslutande uppdatering misslyckades', error);
    }

    const at = new Date().toISOString();
    const level = resolveLevel(steps);
    const message = levelMessage(level);

    deps.logger.info('Dashboard sync: slutförd', {
        level,
        connectionStatus,
        failedSteps: failedStepNames(steps),
        at,
    });

    return {
        level,
        message,
        at,
        steps,
    };
}

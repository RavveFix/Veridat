import { describe, expect, it, vi } from 'vitest';
import { runDashboardSync, type DashboardSyncDeps } from './dashboardSync';

const passthroughTimeout: DashboardSyncDeps['withTimeout'] = async <T>(
    promise: PromiseLike<T>
): Promise<T> => await promise;

function createDeps(overrides?: Partial<DashboardSyncDeps>): DashboardSyncDeps {
    return {
        refreshLocal: vi.fn(),
        checkConnection: vi.fn(async (): Promise<'connected'> => 'connected'),
        preloadFortnoxData: vi.fn(async () => undefined),
        forceCopilotCheck: vi.fn(async () => undefined),
        reloadApiUsage: vi.fn(async () => undefined),
        withTimeout: passthroughTimeout,
        logger: {
            info: vi.fn(),
            warn: vi.fn(),
        },
        ...overrides,
    };
}

describe('dashboardSync', () => {
    it('returns success when connected flow succeeds', async () => {
        const deps = createDeps();
        const result = await runDashboardSync(deps);

        expect(result.level).toBe('success');
        expect(result.steps.quickRefresh).toBe('ok');
        expect(result.steps.connectionCheck).toBe('ok');
        expect(result.steps.fortnoxPreload).toBe('ok');
        expect(result.steps.copilotCheck).toBe('ok');
        expect(result.steps.apiUsageReload).toBe('ok');
        expect(result.steps.finalRefresh).toBe('ok');
        expect(deps.refreshLocal).toHaveBeenCalledTimes(2);
    });

    it('skips preload when Fortnox is disconnected and still succeeds', async () => {
        const deps = createDeps({
            checkConnection: vi.fn(async (): Promise<'disconnected'> => 'disconnected'),
        });
        const result = await runDashboardSync(deps);

        expect(result.level).toBe('success');
        expect(result.steps.connectionCheck).toBe('ok');
        expect(result.steps.fortnoxPreload).toBe('skipped');
        expect(result.steps.copilotCheck).toBe('ok');
        expect(deps.refreshLocal).toHaveBeenCalledTimes(2);
    });

    it('returns partial when one deep step fails and still performs final refresh', async () => {
        const deps = createDeps({
            preloadFortnoxData: vi.fn(async () => {
                throw new Error('preload failed');
            }),
        });
        const result = await runDashboardSync(deps);

        expect(result.level).toBe('partial');
        expect(result.steps.fortnoxPreload).toBe('failed');
        expect(result.steps.finalRefresh).toBe('ok');
        expect(deps.refreshLocal).toHaveBeenCalledTimes(2);
    });

    it('handles timeout during connection check without crashing', async () => {
        let timeoutCall = 0;
        const deps = createDeps({
            withTimeout: async <T>(promise: PromiseLike<T>, timeoutMs?: number, errorMessage?: string): Promise<T> => {
                timeoutCall += 1;
                if (timeoutCall === 1) {
                    throw new Error(errorMessage || `timeout after ${timeoutMs || 0}ms`);
                }
                return await promise;
            },
        });

        const result = await runDashboardSync(deps);
        expect(['partial', 'error']).toContain(result.level);
        expect(result.steps.connectionCheck).toBe('failed');
        expect(deps.refreshLocal).toHaveBeenCalledTimes(2);
    });

    it('returns partial when api usage reload fails but keeps other steps', async () => {
        const deps = createDeps({
            reloadApiUsage: vi.fn(async () => {
                throw new Error('api usage failed');
            }),
        });

        const result = await runDashboardSync(deps);
        expect(result.level).toBe('partial');
        expect(result.steps.apiUsageReload).toBe('failed');
        expect(result.steps.finalRefresh).toBe('ok');
    });
});

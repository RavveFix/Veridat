import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fortnoxContextService } from './FortnoxContextService';

const {
    getSessionMock,
    fromMock,
    getCurrentIdMock,
    state,
    loggerMock,
} = vi.hoisted(() => ({
    getSessionMock: vi.fn(),
    fromMock: vi.fn(),
    getCurrentIdMock: vi.fn(),
    state: {
        currentCompanyId: 'company-a',
        tokenEnabledByCompany: new Map<string, boolean>(),
    },
    loggerMock: {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
    },
}));

function createQuery(table: string) {
    const filters: Record<string, string> = {};
    const query = {
        select: vi.fn(() => query),
        eq: vi.fn((column: string, value: unknown) => {
            filters[column] = String(value);
            return query;
        }),
        maybeSingle: vi.fn(async () => {
            if (table === 'profiles') {
                return { data: { plan: 'trial' }, error: null };
            }
            if (table === 'fortnox_tokens') {
                const companyId = filters.company_id || '';
                const hasToken = state.tokenEnabledByCompany.get(companyId) === true;
                return hasToken
                    ? { data: { id: 'token-id' }, error: null }
                    : { data: null, error: null };
            }
            return { data: null, error: null };
        }),
    };
    return query;
}

vi.mock('../lib/supabase', () => ({
    supabase: {
        auth: {
            getSession: getSessionMock,
        },
        from: fromMock,
    },
}));

vi.mock('./CompanyService', () => ({
    companyService: {
        getCurrentId: getCurrentIdMock,
    },
}));

vi.mock('./LoggerService', () => ({
    logger: loggerMock,
}));

function createJsonResponse(body: unknown, ok = true): Response {
    return {
        ok,
        json: async () => body,
    } as Response;
}

async function waitForAssertion(assertion: () => void, timeoutMs = 3000): Promise<void> {
    const startedAt = Date.now();
    // eslint-disable-next-line no-constant-condition
    while (true) {
        try {
            assertion();
            return;
        } catch (error) {
            if (Date.now() - startedAt >= timeoutMs) {
                throw error;
            }
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
    }
}

describe('FortnoxContextService', () => {
    beforeEach(() => {
        state.currentCompanyId = 'company-a';
        state.tokenEnabledByCompany.clear();
        state.tokenEnabledByCompany.set('company-a', true);
        state.tokenEnabledByCompany.set('company-b', true);

        getCurrentIdMock.mockImplementation(() => state.currentCompanyId);
        fromMock.mockImplementation((table: string) => createQuery(table));
        getSessionMock.mockResolvedValue({
            data: { session: { access_token: 'session-token', user: { id: 'user-1' } } },
        });
    });

    afterEach(() => {
        fortnoxContextService.clearCache();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        state.tokenEnabledByCompany.clear();
    });

    it('clears scoped cache and reloads data on company-changed without leaking previous company data', async () => {
        const requestedCompanyIds: string[] = [];
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body || '{}')) as { action?: string; companyId?: string };
            requestedCompanyIds.push(String(body.companyId || ''));

            if (body.action === 'getCustomers') {
                if (body.companyId === 'company-a') {
                    return createJsonResponse({ Customers: [{ CustomerNumber: 'A-1', Name: 'Kund A' }] });
                }
                if (body.companyId === 'company-b') {
                    return createJsonResponse({ Customers: [{ CustomerNumber: 'B-1', Name: 'Kund B' }] });
                }
            }

            if (body.action === 'getSuppliers') {
                return createJsonResponse({ Suppliers: [] });
            }

            if (body.action === 'getArticles') {
                return createJsonResponse({ Articles: [] });
            }

            return createJsonResponse({});
        });
        vi.stubGlobal('fetch', fetchMock);

        const initialStatus = await fortnoxContextService.checkConnection();
        expect(initialStatus).toBe('connected');

        const customersA = await fortnoxContextService.fetchCustomers(true);
        expect(customersA).toHaveLength(1);
        expect(customersA[0]?.CustomerNumber).toBe('A-1');
        expect(fortnoxContextService.getCachedCustomers()[0]?.CustomerNumber).toBe('A-1');

        state.currentCompanyId = 'company-b';
        window.dispatchEvent(new CustomEvent('company-changed', { detail: { companyId: 'company-b' } }));

        expect(fortnoxContextService.getCachedCustomers()).toEqual([]);
        expect(fortnoxContextService.getConnectionStatus()).toBe('checking');

        await waitForAssertion(() => {
            expect(fortnoxContextService.getConnectionStatus()).toBe('connected');
        });

        await waitForAssertion(() => {
            expect(requestedCompanyIds).toContain('company-b');
            const cachedCustomers = fortnoxContextService.getCachedCustomers();
            expect(cachedCustomers).toHaveLength(1);
            expect(cachedCustomers[0]?.CustomerNumber).toBe('B-1');
        });

        state.currentCompanyId = 'company-a';
        expect(fortnoxContextService.getCachedCustomers()).toEqual([]);
    });
});


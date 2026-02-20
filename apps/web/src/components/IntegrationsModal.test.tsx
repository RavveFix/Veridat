import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IntegrationsModal } from './IntegrationsModal';

const {
    getUserMock,
    getSessionMock,
    fromMock,
    getCurrentIdMock,
    getAllMock,
    state,
    listComplianceAlertsMock,
    preloadCompanyMock,
    getNotificationsMock,
    loggerMock,
} = vi.hoisted(() => ({
    getUserMock: vi.fn(),
    getSessionMock: vi.fn(),
    fromMock: vi.fn(),
    getCurrentIdMock: vi.fn(),
    getAllMock: vi.fn(),
    state: {
        currentCompanyId: 'company-a',
        fortnoxTokensByCompany: new Map<string, { created_at: string; expires_at: string | null }>(),
        companies: [{ id: 'company-a' }],
        plan: 'trial',
        isAdmin: false,
    },
    listComplianceAlertsMock: vi.fn(async () => []),
    preloadCompanyMock: vi.fn(async () => undefined),
    getNotificationsMock: vi.fn(() => []),
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
                return {
                    data: {
                        plan: state.plan,
                        is_admin: state.isAdmin,
                    },
                    error: null,
                };
            }

            if (table === 'fortnox_tokens') {
                const companyId = filters.company_id || '';
                const row = state.fortnoxTokensByCompany.get(companyId) || null;
                return { data: row, error: null };
            }

            return { data: null, error: null };
        }),
    };

    return query;
}

vi.mock('../lib/supabase', () => ({
    supabase: {
        auth: {
            getUser: getUserMock,
            getSession: getSessionMock,
        },
        from: fromMock,
    },
}));

vi.mock('../services/CompanyService', () => ({
    companyService: {
        getCurrentId: getCurrentIdMock,
        getAll: getAllMock,
    },
}));

vi.mock('../services/CopilotService', () => ({
    copilotService: {
        getNotifications: getNotificationsMock,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    },
}));

vi.mock('../services/FinanceAgentService', () => ({
    financeAgentService: {
        listComplianceAlerts: listComplianceAlertsMock,
        preloadCompany: preloadCompanyMock,
    },
}));

vi.mock('../services/LoggerService', () => ({
    logger: loggerMock,
}));

vi.mock('./ModalWrapper', () => ({
    ModalWrapper: ({
        children,
        title,
        variant = 'default',
    }: {
        children: unknown;
        title: string;
        variant?: 'default' | 'fullscreen';
    }) => (
        <div data-testid="modal-wrapper" data-variant={variant}>
            <h2>{title}</h2>
            {children}
        </div>
    ),
}));

vi.mock('./BankImportPanel', () => ({ BankImportPanel: () => <div /> }));
vi.mock('./AgencyPanel', () => ({ AgencyPanel: () => <div /> }));
vi.mock('./FortnoxPanel', () => ({ FortnoxPanel: () => <div /> }));
vi.mock('./BookkeepingRulesPanel', () => ({ BookkeepingRulesPanel: () => <div /> }));
vi.mock('./ReconciliationView', () => ({ ReconciliationView: () => <div /> }));
vi.mock('./InvoiceInboxPanel', () => ({ InvoiceInboxPanel: () => <div /> }));
vi.mock('./DashboardPanel', () => ({ DashboardPanel: () => <div /> }));
vi.mock('./VATReportFromFortnoxPanel', () => ({ VATReportFromFortnoxPanel: () => <div /> }));

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
            await act(async () => {
                await new Promise((resolve) => setTimeout(resolve, 0));
            });
        }
    }
}

let container: HTMLDivElement;
let originalIaFlag: string | undefined;
const envVars = import.meta.env as Record<string, string | undefined>;

function setIaV2Flag(value: string | undefined): void {
    if (typeof value === 'undefined') {
        delete envVars.VITE_INTEGRATIONS_IA_V2_ENABLED;
        return;
    }
    envVars.VITE_INTEGRATIONS_IA_V2_ENABLED = value;
}

function getByTestId(testId: string): HTMLElement {
    const node = container.querySelector(`[data-testid="${testId}"]`);
    expect(node).not.toBeNull();
    return node as HTMLElement;
}

function queryByTestId(testId: string): HTMLElement | null {
    return container.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;
}

describe('IntegrationsModal', () => {
    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        originalIaFlag = envVars.VITE_INTEGRATIONS_IA_V2_ENABLED;
        setIaV2Flag(undefined);

        state.currentCompanyId = 'company-a';
        state.fortnoxTokensByCompany.clear();
        state.fortnoxTokensByCompany.set('company-a', {
            created_at: '2026-02-17T10:00:00.000Z',
            expires_at: '2026-02-17T11:00:00.000Z',
        });
        state.companies = [{ id: 'company-a' }];
        state.plan = 'trial';
        state.isAdmin = false;

        getCurrentIdMock.mockImplementation(() => state.currentCompanyId);
        getAllMock.mockImplementation(() => state.companies);
        fromMock.mockImplementation((table: string) => createQuery(table));
        getUserMock.mockResolvedValue({
            data: { user: { id: 'user-1' } },
        });
        getSessionMock.mockResolvedValue({
            data: { session: { access_token: 'access-token', user: { id: 'user-1' } } },
        });

        const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body || '{}')) as { action?: string };
            if (body.action === 'sync_profile') {
                return createJsonResponse({ synced: true });
            }
            return createJsonResponse({});
        });
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        act(() => {
            render(null, container);
        });
        container.remove();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        state.fortnoxTokensByCompany.clear();
        setIaV2Flag(originalIaFlag);
    });

    it('loads Fortnox status per active company and reloads on company-changed', async () => {
        await act(async () => {
            render(<IntegrationsModal onClose={vi.fn()} />, container);
        });

        await waitForAssertion(() => {
            expect(getByTestId('integration-card-fortnox').textContent).toContain('Ansluten');
        });
        expect(queryByTestId('fortnox-reconnect-banner')).toBeNull();

        state.currentCompanyId = 'company-b';
        await act(async () => {
            window.dispatchEvent(new CustomEvent('company-changed', { detail: { companyId: 'company-b' } }));
        });

        await waitForAssertion(() => {
            expect(getByTestId('integration-card-fortnox').textContent).toContain('Ej ansluten');
        });
        await waitForAssertion(() => {
            expect(queryByTestId('fortnox-reconnect-banner')).not.toBeNull();
        });
    });

    it('renders legacy tool groups when IA v2 flag is disabled', async () => {
        await act(async () => {
            render(<IntegrationsModal onClose={vi.fn()} />, container);
        });

        await waitForAssertion(() => {
            expect(container.textContent).toContain('Fortnox-verktyg');
            expect(container.textContent).toContain('Bokföring och Bank');
            expect(container.textContent).toContain('Administration');
        });
        expect(queryByTestId('integration-advanced-toggle')).toBeNull();
    });

    it('renders exactly four primary sections when IA v2 flag is enabled', async () => {
        setIaV2Flag('true');

        await act(async () => {
            render(<IntegrationsModal onClose={vi.fn()} />, container);
        });

        await waitForAssertion(() => {
            expect(getByTestId('integration-primary-section-today')).not.toBeNull();
            expect(getByTestId('integration-primary-section-invoices')).not.toBeNull();
            expect(getByTestId('integration-primary-section-bank')).not.toBeNull();
            expect(getByTestId('integration-primary-section-vat')).not.toBeNull();
        });

        const sectionCount = container.querySelectorAll('[data-testid^="integration-primary-section-"]').length;
        expect(sectionCount).toBe(4);
        expect(container.textContent).not.toContain('Fortnox-verktyg');
        expect(getByTestId('integration-advanced-toggle')).not.toBeNull();
        expect(queryByTestId('integration-primary-open-dashboard')).toBeNull();
    });

    it('keeps advanced tools collapsed by default and expands on toggle', async () => {
        setIaV2Flag('true');

        await act(async () => {
            render(<IntegrationsModal onClose={vi.fn()} />, container);
        });

        await waitForAssertion(() => {
            expect(getByTestId('integration-advanced-toggle')).not.toBeNull();
        });
        expect(queryByTestId('integration-advanced-panel')).toBeNull();
        expect(queryByTestId('integration-tool-bookkeeping-rules')).toBeNull();

        await act(async () => {
            getByTestId('integration-advanced-toggle').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        await waitForAssertion(() => {
            expect(getByTestId('integration-advanced-panel')).not.toBeNull();
            expect(getByTestId('integration-tool-bookkeeping-rules')).not.toBeNull();
            expect(getByTestId('integration-tool-fortnox-panel')).not.toBeNull();
        });
        expect(queryByTestId('integration-tool-agency')).toBeNull();
    });

    it('shows agency tool in advanced section only when multiple companies exist', async () => {
        setIaV2Flag('true');
        state.companies = [{ id: 'company-a' }, { id: 'company-b' }];

        await act(async () => {
            render(<IntegrationsModal onClose={vi.fn()} />, container);
        });

        await waitForAssertion(() => {
            expect(getByTestId('integration-advanced-toggle')).not.toBeNull();
        });

        await act(async () => {
            getByTestId('integration-advanced-toggle').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        await waitForAssertion(() => {
            expect(getByTestId('integration-tool-agency')).not.toBeNull();
        });
    });

    it('keeps Fakturor and Moms primary actions locked when user is not Pro-eligible', async () => {
        setIaV2Flag('true');
        state.plan = 'free';

        await act(async () => {
            render(<IntegrationsModal onClose={vi.fn()} />, container);
        });

        await waitForAssertion(() => {
            const invoicesCard = getByTestId('integration-primary-section-invoices');
            const vatCard = getByTestId('integration-primary-section-vat');
            expect(invoicesCard.getAttribute('data-disabled')).toBe('true');
            expect(vatCard.getAttribute('data-disabled')).toBe('true');
        });
    });

    it('opens primary tool when clicking a primary section card', async () => {
        setIaV2Flag('true');

        await act(async () => {
            render(<IntegrationsModal onClose={vi.fn()} />, container);
        });

        await waitForAssertion(() => {
            expect(getByTestId('integration-primary-section-today')).not.toBeNull();
        });

        await act(async () => {
            getByTestId('integration-primary-section-today').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        await waitForAssertion(() => {
            const heading = container.querySelector('h2');
            expect(heading?.textContent).toBe('Översikt');
        });
    });

    it('opens Fortnox panel in fullscreen modal variant', async () => {
        setIaV2Flag('true');

        await act(async () => {
            render(<IntegrationsModal onClose={vi.fn()} />, container);
        });

        await waitForAssertion(() => {
            expect(getByTestId('integration-advanced-toggle')).not.toBeNull();
        });

        await act(async () => {
            getByTestId('integration-advanced-toggle').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        await waitForAssertion(() => {
            expect(getByTestId('integration-tool-fortnox-panel')).not.toBeNull();
        });

        await act(async () => {
            getByTestId('integration-tool-fortnox-panel').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        await waitForAssertion(() => {
            const heading = container.querySelector('h2');
            expect(heading?.textContent).toBe('Fortnoxpanel');
            expect(getByTestId('modal-wrapper').getAttribute('data-variant')).toBe('fullscreen');
        });
    });
});

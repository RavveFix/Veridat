import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IntegrationsModal } from './IntegrationsModal';

const {
    getUserMock,
    getSessionMock,
    fromMock,
    getCurrentIdMock,
    state,
    loggerMock,
} = vi.hoisted(() => ({
    getUserMock: vi.fn(),
    getSessionMock: vi.fn(),
    fromMock: vi.fn(),
    getCurrentIdMock: vi.fn(),
    state: {
        currentCompanyId: 'company-a',
        fortnoxTokensByCompany: new Map<string, { created_at: string; expires_at: string | null }>(),
        plan: 'trial',
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
                return {
                    data: { plan: state.plan },
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
    },
}));

vi.mock('../services/LoggerService', () => ({
    logger: loggerMock,
}));

vi.mock('./ModalWrapper', () => ({
    ModalWrapper: ({
        children,
        title,
    }: {
        children: unknown;
        title: string;
    }) => (
        <div data-testid="modal-wrapper">
            <h2>{title}</h2>
            {children}
        </div>
    ),
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
            await act(async () => {
                await new Promise((resolve) => setTimeout(resolve, 0));
            });
        }
    }
}

let container: HTMLDivElement;

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

        state.currentCompanyId = 'company-a';
        state.fortnoxTokensByCompany.clear();
        state.fortnoxTokensByCompany.set('company-a', {
            created_at: '2026-02-17T10:00:00.000Z',
            expires_at: '2026-02-17T11:00:00.000Z',
        });
        state.plan = 'trial';

        getCurrentIdMock.mockImplementation(() => state.currentCompanyId);
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
    });

    it('renders all three integration cards', async () => {
        await act(async () => {
            render(<IntegrationsModal onClose={vi.fn()} />, container);
        });

        await waitForAssertion(() => {
            expect(getByTestId('integration-card-fortnox')).not.toBeNull();
            expect(getByTestId('integration-card-visma')).not.toBeNull();
            expect(getByTestId('integration-card-bankid')).not.toBeNull();
        });
    });

    it('shows Ansluten badge when Fortnox is connected', async () => {
        await act(async () => {
            render(<IntegrationsModal onClose={vi.fn()} />, container);
        });

        await waitForAssertion(() => {
            expect(getByTestId('integration-card-fortnox').textContent).toContain('Ansluten');
        });
    });

    it('shows Kommer snart for Visma and BankID', async () => {
        await act(async () => {
            render(<IntegrationsModal onClose={vi.fn()} />, container);
        });

        await waitForAssertion(() => {
            expect(getByTestId('integration-card-visma').textContent).toContain('Kommer snart');
            expect(getByTestId('integration-card-bankid').textContent).toContain('Kommer snart');
        });
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

    it('shows Kräver Pro badge for Fortnox when user is on free plan', async () => {
        state.plan = 'free';

        await act(async () => {
            render(<IntegrationsModal onClose={vi.fn()} />, container);
        });

        await waitForAssertion(() => {
            expect(getByTestId('integration-card-fortnox').textContent).toContain('Kräver Pro');
        });
    });

    it('shows disconnect button for connected Fortnox', async () => {
        await act(async () => {
            render(<IntegrationsModal onClose={vi.fn()} />, container);
        });

        await waitForAssertion(() => {
            expect(getByTestId('integration-disconnect-fortnox')).not.toBeNull();
        });
    });

    it('shows connect button for disconnected Fortnox with Pro plan', async () => {
        state.fortnoxTokensByCompany.clear();

        await act(async () => {
            render(<IntegrationsModal onClose={vi.fn()} />, container);
        });

        await waitForAssertion(() => {
            expect(getByTestId('integration-connect-fortnox')).not.toBeNull();
        });
    });

    it('does not render any tool groups or primary sections', async () => {
        await act(async () => {
            render(<IntegrationsModal onClose={vi.fn()} />, container);
        });

        await waitForAssertion(() => {
            expect(getByTestId('integration-card-fortnox')).not.toBeNull();
        });

        expect(container.textContent).not.toContain('Fortnox-verktyg');
        expect(container.textContent).not.toContain('Bokföring och Bank');
        expect(container.textContent).not.toContain('Administration');
        expect(queryByTestId('integration-advanced-toggle')).toBeNull();
        expect(queryByTestId('integration-primary-section-today')).toBeNull();
    });
});

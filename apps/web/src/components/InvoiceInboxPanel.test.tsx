import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InvoiceInboxPanel } from './InvoiceInboxPanel';

const {
    getSessionMock,
    getCurrentIdMock,
    refreshInvoiceInboxMock,
    getCachedInvoiceInboxMock,
    upsertInvoiceInboxItemMock,
    deleteInvoiceInboxItemMock,
    loggerMock,
} = vi.hoisted(() => ({
    getSessionMock: vi.fn(),
    getCurrentIdMock: vi.fn(() => 'company-test'),
    refreshInvoiceInboxMock: vi.fn(async (): Promise<Array<Record<string, unknown>>> => []),
    getCachedInvoiceInboxMock: vi.fn((): Array<Record<string, unknown>> => []),
    upsertInvoiceInboxItemMock: vi.fn(async () => undefined),
    deleteInvoiceInboxItemMock: vi.fn(async () => undefined),
    loggerMock: {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
    },
}));

vi.mock('../lib/supabase', () => ({
    supabase: {
        auth: {
            getSession: getSessionMock,
        },
    },
}));

vi.mock('../services/CompanyService', () => ({
    companyService: {
        getCurrentId: getCurrentIdMock,
    },
}));

vi.mock('../services/FileService', () => ({
    fileService: {
        validate: vi.fn(() => ({ valid: true })),
        uploadToStorage: vi.fn(),
        createSignedUrl: vi.fn(),
    },
}));

vi.mock('../services/FinanceAgentService', () => ({
    financeAgentService: {
        refreshInvoiceInbox: refreshInvoiceInboxMock,
        getCachedInvoiceInbox: getCachedInvoiceInboxMock,
        upsertInvoiceInboxItem: upsertInvoiceInboxItemMock,
        deleteInvoiceInboxItem: deleteInvoiceInboxItemMock,
    },
}));

vi.mock('../services/LoggerService', () => ({
    logger: loggerMock,
}));

function createJsonResponse(body: unknown, ok = true): Response {
    return {
        ok,
        json: async () => body,
    } as Response;
}

async function waitForAssertion(assertion: () => void, timeoutMs = 2500): Promise<void> {
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
let originalPostingFlag: string | undefined;
const envVars = import.meta.env as Record<string, string | undefined>;

function setPostingReviewFlag(value: string | undefined): void {
    if (typeof value === 'undefined') {
        delete envVars.VITE_INVOICE_POSTING_REVIEW_ENABLED;
        return;
    }
    envVars.VITE_INVOICE_POSTING_REVIEW_ENABLED = value;
}

function getByTestId(testId: string): HTMLElement {
    const node = container.querySelector(`[data-testid="${testId}"]`);
    expect(node).not.toBeNull();
    return node as HTMLElement;
}

function queryByTestId(testId: string): HTMLElement | null {
    return container.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;
}

describe('InvoiceInboxPanel', () => {
    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        originalPostingFlag = envVars.VITE_INVOICE_POSTING_REVIEW_ENABLED;
        setPostingReviewFlag('true');

        getSessionMock.mockResolvedValue({
            data: { session: { access_token: 'token-1' } },
        });
        getCurrentIdMock.mockReturnValue('company-test');
    });

    afterEach(() => {
        act(() => {
            render(null, container);
        });
        container.remove();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        getSessionMock.mockReset();
        getCurrentIdMock.mockReset();
        refreshInvoiceInboxMock.mockReset();
        getCachedInvoiceInboxMock.mockReset();
        upsertInvoiceInboxItemMock.mockReset();
        deleteInvoiceInboxItemMock.mockReset();
        setPostingReviewFlag(originalPostingFlag);
    });

    it('shows posting review action for Fortnox-linked invoice and opens drawer', async () => {
        refreshInvoiceInboxMock.mockResolvedValue([
            {
                id: 'item-1',
                source: 'fortnox',
                status: 'bokford',
                supplierName: 'One Group AB',
                invoiceNumber: 'INV-100',
                invoiceDate: '2026-01-10',
                dueDate: '2026-02-09',
                totalAmount: 625,
                vatAmount: 125,
                currency: 'SEK',
                fortnoxSyncStatus: 'booked',
                fortnoxGivenNumber: 987,
                fortnoxBooked: true,
                fileName: '',
            },
        ]);

        const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body || '{}')) as {
                action?: string;
                payload?: { invoiceType?: string; invoiceId?: number };
                companyId?: string;
            };
            if (body.action === 'getInvoicePostingTrace') {
                expect(body.companyId).toBe('company-test');
                expect(body.payload?.invoiceType).toBe('supplier');
                expect(body.payload?.invoiceId).toBe(987);
                return createJsonResponse({
                    invoice: {
                        type: 'supplier',
                        id: '987',
                        invoiceNumber: 'INV-100',
                        counterpartyNumber: '1',
                        counterpartyName: 'One Group AB',
                        invoiceDate: '2026-01-10',
                        dueDate: '2026-02-09',
                        total: 625,
                        vat: 125,
                        balance: 625,
                        currency: 'SEK',
                        booked: true
                    },
                    expectedPosting: {
                        rows: [{ account: 6540, debit: 500, credit: 0, description: 'IT-tjanster' }],
                        totals: { debit: 625, credit: 625, balanced: true }
                    },
                    posting: {
                        status: 'booked',
                        source: 'explicit',
                        confidence: 0.99,
                        voucherRef: { series: 'A', number: 44, year: 2026 },
                        rows: [{ account: 2440, debit: 0, credit: 625, description: 'Leverantorsskuld' }],
                        totals: { debit: 625, credit: 625, balanced: true }
                    },
                    checks: {
                        balanced: true,
                        total_match: true,
                        vat_match: true,
                        control_account_present: true,
                        row_account_consistency: true
                    },
                    issues: []
                });
            }
            throw new Error(`Unexpected action: ${body.action}`);
        });
        vi.stubGlobal('fetch', fetchMock);

        await act(async () => {
            render(<InvoiceInboxPanel onBack={vi.fn()} />, container);
        });

        await waitForAssertion(() => {
            expect(queryByTestId('invoice-card-item-1')).not.toBeNull();
            expect(queryByTestId('invoice-view-posting-item-1')).not.toBeNull();
        });

        await act(async () => {
            getByTestId('invoice-view-posting-item-1').click();
        });

        await waitForAssertion(() => {
            expect(queryByTestId('invoice-posting-drawer')).not.toBeNull();
            expect(queryByTestId('invoice-posting-drawer')?.getAttribute('data-presentation')).toBe('drawer');
            expect(container.textContent).toContain('Konteringskontroll');
        });
    });
});

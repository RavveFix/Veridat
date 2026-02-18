import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FortnoxPanel } from './FortnoxPanel';

const { getSessionMock, getCurrentIdMock, loggerMock } = vi.hoisted(() => ({
    getSessionMock: vi.fn(),
    getCurrentIdMock: vi.fn(() => 'company-test'),
    loggerMock: {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn()
    }
}));

vi.mock('../lib/supabase', () => ({
    supabase: {
        auth: {
            getSession: getSessionMock
        }
    }
}));

vi.mock('../services/CompanyService', () => ({
    companyService: {
        getCurrentId: getCurrentIdMock
    }
}));

vi.mock('../services/LoggerService', () => ({
    logger: loggerMock
}));

vi.mock('./CopilotPanel', () => ({
    CopilotPanel: () => <div data-testid="copilot-panel-mock">Copilot mock</div>
}));

interface Deferred<T> {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (reason?: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function createJsonResponse(body: unknown, ok = true): Response {
    return {
        ok,
        json: async () => body
    } as Response;
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
    const element = container.querySelector(`[data-testid="${testId}"]`);
    expect(element).not.toBeNull();
    return element as HTMLElement;
}

function queryByTestId(testId: string): HTMLElement | null {
    return container.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;
}

async function renderPanel(): Promise<void> {
    await act(async () => {
        render(<FortnoxPanel onBack={vi.fn()} />, container);
    });
}

async function click(element: HTMLElement): Promise<void> {
    await act(async () => {
        element.click();
    });
}

async function waitForAssertion(assertion: () => void, timeoutMs = 2000): Promise<void> {
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

describe('FortnoxPanel', () => {
    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        originalPostingFlag = envVars.VITE_INVOICE_POSTING_REVIEW_ENABLED;
        setPostingReviewFlag(undefined);
        getSessionMock.mockResolvedValue({
            data: { session: { access_token: 'test-token' } }
        });
        getCurrentIdMock.mockReturnValue('company-test');
        vi.spyOn(window, 'confirm').mockReturnValue(true);
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
        setPostingReviewFlag(originalPostingFlag);
    });

    it('switches between supplier and customer view', async () => {
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body ?? '{}')) as { action?: string; companyId?: string };
            if (body.action === 'getSupplierInvoices') {
                expect(body.companyId).toBe('company-test');
                return createJsonResponse({
                    SupplierInvoices: [{
                        GivenNumber: 101,
                        SupplierNumber: 'LEV-1',
                        InvoiceNumber: 'S-101',
                        DueDate: '2025-01-15',
                        Total: 100,
                        Balance: 100,
                        Booked: false
                    }]
                });
            }
            if (body.action === 'getInvoices') {
                expect(body.companyId).toBe('company-test');
                return createJsonResponse({
                    Invoices: [{
                        InvoiceNumber: 201,
                        CustomerNumber: 'KUND-1',
                        DueDate: '2025-01-20',
                        Total: 200,
                        Balance: 50,
                        Booked: true
                    }]
                });
            }
            throw new Error(`Unexpected action: ${body.action}`);
        });
        vi.stubGlobal('fetch', fetchMock);

        await renderPanel();

        await waitForAssertion(() => {
            expect(queryByTestId('fortnox-supplier-row-101')).not.toBeNull();
            expect(container.textContent).toContain('Leverantörsfakturor');
        });

        await click(getByTestId('fortnox-view-customer'));

        await waitForAssertion(() => {
            expect(queryByTestId('fortnox-customer-row-201')).not.toBeNull();
            expect(container.textContent).toContain('Kundfakturor');
        });
    });

    it('applies supplier filters and shows empty state for authorizepending', async () => {
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body ?? '{}')) as {
                action?: string;
                companyId?: string;
                payload?: { filter?: string };
            };
            if (body.action === 'getSupplierInvoices') {
                expect(body.companyId).toBe('company-test');
                if (body.payload?.filter === 'authorizepending') {
                    return createJsonResponse({ SupplierInvoices: [] });
                }
                return createJsonResponse({
                    SupplierInvoices: [
                        {
                            GivenNumber: 111,
                            SupplierNumber: 'LEV-A',
                            InvoiceNumber: 'S-111',
                            DueDate: '2025-01-10',
                            Total: 120,
                            Balance: 120,
                            Booked: false
                        },
                        {
                            GivenNumber: 112,
                            SupplierNumber: 'LEV-B',
                            InvoiceNumber: 'S-112',
                            DueDate: '2025-01-11',
                            Total: 130,
                            Balance: 130,
                            Booked: true
                        }
                    ]
                });
            }
            throw new Error(`Unexpected action: ${body.action}`);
        });
        vi.stubGlobal('fetch', fetchMock);

        await renderPanel();

        await waitForAssertion(() => {
            expect(queryByTestId('fortnox-supplier-row-111')).not.toBeNull();
            expect(queryByTestId('fortnox-supplier-row-112')).not.toBeNull();
        });

        await click(getByTestId('fortnox-filter-unbooked'));

        await waitForAssertion(() => {
            expect(queryByTestId('fortnox-supplier-row-111')).not.toBeNull();
            expect(queryByTestId('fortnox-supplier-row-112')).toBeNull();
        });

        await click(getByTestId('fortnox-filter-authorizepending'));

        await waitForAssertion(() => {
            expect(container.textContent).toContain('Inga fakturor att visa.');
        });
    });

    it('renders action column only when authorizepending filter is active', async () => {
        const pendingInvoice = {
            GivenNumber: 121,
            SupplierNumber: 'LEV-P',
            InvoiceNumber: 'S-121',
            DueDate: '2025-01-12',
            Total: 300,
            Balance: 300,
            Booked: true,
            PaymentPending: true
        };
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body ?? '{}')) as {
                action?: string;
                companyId?: string;
                payload?: { filter?: string };
            };
            if (body.action === 'getSupplierInvoices') {
                expect(body.companyId).toBe('company-test');
                if (body.payload?.filter === 'authorizepending') {
                    return createJsonResponse({ SupplierInvoices: [pendingInvoice] });
                }
                return createJsonResponse({ SupplierInvoices: [pendingInvoice] });
            }
            throw new Error(`Unexpected action: ${body.action}`);
        });
        vi.stubGlobal('fetch', fetchMock);

        await renderPanel();

        await waitForAssertion(() => {
            const headers = Array.from(container.querySelectorAll('th')).map((header) => header.textContent?.trim());
            expect(headers.includes('Åtgärd')).toBe(false);
            expect(queryByTestId('fortnox-approve-bookkeep-121')).toBeNull();
        });

        await click(getByTestId('fortnox-filter-authorizepending'));

        await waitForAssertion(() => {
            const headers = Array.from(container.querySelectorAll('th')).map((header) => header.textContent?.trim());
            expect(headers.includes('Åtgärd')).toBe(true);
            expect(queryByTestId('fortnox-approve-bookkeep-121')).not.toBeNull();
            expect(queryByTestId('fortnox-approve-payment-121')).not.toBeNull();
        });
    });

    it('shows loading label while approve action is pending', async () => {
        const pendingInvoice = {
            GivenNumber: 131,
            SupplierNumber: 'LEV-L',
            InvoiceNumber: 'S-131',
            DueDate: '2025-01-12',
            Total: 450,
            Balance: 450,
            Booked: true,
            PaymentPending: true
        };
        const approveDeferred = createDeferred<Response>();

        const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body ?? '{}')) as {
                action?: string;
                companyId?: string;
                payload?: { filter?: string };
            };
            if (body.action === 'getSupplierInvoices') {
                expect(body.companyId).toBe('company-test');
                return createJsonResponse({ SupplierInvoices: [pendingInvoice] });
            }
            if (body.action === 'approveSupplierInvoiceBookkeep') {
                expect(body.companyId).toBe('company-test');
                return approveDeferred.promise;
            }
            throw new Error(`Unexpected action: ${body.action}`);
        });
        vi.stubGlobal('fetch', fetchMock);

        await renderPanel();
        await click(getByTestId('fortnox-filter-authorizepending'));

        await waitForAssertion(() => {
            expect(queryByTestId('fortnox-approve-bookkeep-131')).not.toBeNull();
        });

        await click(getByTestId('fortnox-approve-bookkeep-131'));

        await waitForAssertion(() => {
            const button = getByTestId('fortnox-approve-bookkeep-131');
            expect(button.textContent).toContain('Attesterar...');
        });

        approveDeferred.resolve(createJsonResponse({ ok: true }));

        await waitForAssertion(() => {
            const button = getByTestId('fortnox-approve-bookkeep-131');
            expect(button.textContent).toContain('Godkänn bokföring');
        });
    });

    it('opens posting review drawer when view posting is clicked and flag is enabled', async () => {
        setPostingReviewFlag('true');

        const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body ?? '{}')) as {
                action?: string;
                companyId?: string;
                payload?: { invoiceType?: string; invoiceId?: number };
            };
            if (body.action === 'getSupplierInvoices') {
                return createJsonResponse({
                    SupplierInvoices: [{
                        GivenNumber: 151,
                        SupplierNumber: 'LEV-TRACE',
                        InvoiceNumber: 'S-151',
                        DueDate: '2026-01-15',
                        Total: 1250,
                        Balance: 1250,
                        Booked: true
                    }]
                });
            }
            if (body.action === 'getInvoicePostingTrace') {
                expect(body.companyId).toBe('company-test');
                expect(body.payload?.invoiceType).toBe('supplier');
                expect(body.payload?.invoiceId).toBe(151);
                return createJsonResponse({
                    invoice: {
                        type: 'supplier',
                        id: '151',
                        invoiceNumber: 'S-151',
                        counterpartyNumber: 'LEV-TRACE',
                        counterpartyName: 'Lev Trace AB',
                        invoiceDate: '2026-01-15',
                        dueDate: '2026-02-14',
                        total: 1250,
                        vat: 250,
                        balance: 1250,
                        currency: 'SEK',
                        booked: true
                    },
                    expectedPosting: {
                        rows: [{ account: 6540, debit: 1000, credit: 0, description: 'IT' }],
                        totals: { debit: 1250, credit: 1250, balanced: true }
                    },
                    posting: {
                        status: 'booked',
                        source: 'explicit',
                        confidence: 0.99,
                        voucherRef: { series: 'A', number: 10, year: 2026 },
                        rows: [{ account: 2440, debit: 0, credit: 1250, description: 'Skuld' }],
                        totals: { debit: 1250, credit: 1250, balanced: true }
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

        await renderPanel();

        await waitForAssertion(() => {
            expect(queryByTestId('fortnox-view-posting-supplier-151')).not.toBeNull();
        });

        await click(getByTestId('fortnox-view-posting-supplier-151'));

        await waitForAssertion(() => {
            expect(queryByTestId('invoice-posting-drawer')).not.toBeNull();
            expect(container.textContent).toContain('Konteringskontroll');
        });
    });

    it('uses DocumentNumber fallback for customer posting trace when InvoiceNumber is missing', async () => {
        setPostingReviewFlag('true');

        const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body ?? '{}')) as {
                action?: string;
                companyId?: string;
                payload?: { invoiceType?: string; invoiceId?: number };
            };
            if (body.action === 'getSupplierInvoices') {
                return createJsonResponse({ SupplierInvoices: [] });
            }
            if (body.action === 'getInvoices') {
                expect(body.companyId).toBe('company-test');
                return createJsonResponse({
                    Invoices: [{
                        DocumentNumber: 302,
                        CustomerNumber: 'KUND-302',
                        DueDate: '2026-02-18',
                        Total: 3020,
                        Balance: 0,
                        Booked: true,
                    }],
                });
            }
            if (body.action === 'getInvoicePostingTrace') {
                expect(body.companyId).toBe('company-test');
                expect(body.payload?.invoiceType).toBe('customer');
                expect(body.payload?.invoiceId).toBe(302);
                return createJsonResponse({
                    invoice: {
                        type: 'customer',
                        id: '302',
                        invoiceNumber: '302',
                        counterpartyNumber: 'KUND-302',
                        counterpartyName: 'Kund 302 AB',
                        invoiceDate: '2026-02-18',
                        dueDate: '2026-03-20',
                        total: 3020,
                        vat: 604,
                        balance: 0,
                        currency: 'SEK',
                        booked: true
                    },
                    expectedPosting: {
                        rows: [{ account: 1510, debit: 3020, credit: 0, description: 'Kundfordran' }],
                        totals: { debit: 3020, credit: 3020, balanced: true }
                    },
                    posting: {
                        status: 'booked',
                        source: 'explicit',
                        confidence: 0.98,
                        voucherRef: { series: 'A', number: 302, year: 2026 },
                        rows: [{ account: 1510, debit: 3020, credit: 0, description: 'Kundfordran' }],
                        totals: { debit: 3020, credit: 3020, balanced: true }
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

        await renderPanel();
        await click(getByTestId('fortnox-view-customer'));

        await waitForAssertion(() => {
            expect(queryByTestId('fortnox-customer-row-302')).not.toBeNull();
        });

        await click(getByTestId('fortnox-view-posting-customer-302'));

        await waitForAssertion(() => {
            expect(queryByTestId('invoice-posting-drawer')).not.toBeNull();
        });
    });

    it('disables customer posting trace when both InvoiceNumber and DocumentNumber are missing', async () => {
        setPostingReviewFlag('true');

        const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body ?? '{}')) as {
                action?: string;
                companyId?: string;
            };
            if (body.action === 'getSupplierInvoices') {
                return createJsonResponse({ SupplierInvoices: [] });
            }
            if (body.action === 'getInvoices') {
                expect(body.companyId).toBe('company-test');
                return createJsonResponse({
                    Invoices: [{
                        CustomerNumber: 'KUND-404',
                        DueDate: '2026-02-20',
                        Total: 4040,
                        Balance: 4040,
                        Booked: true,
                    }],
                });
            }
            if (body.action === 'getInvoicePostingTrace') {
                throw new Error('Posting trace should not be called without customer invoice id');
            }
            throw new Error(`Unexpected action: ${body.action}`);
        });
        vi.stubGlobal('fetch', fetchMock);

        await renderPanel();
        await click(getByTestId('fortnox-view-customer'));

        await waitForAssertion(() => {
            const button = getByTestId('fortnox-view-posting-customer-missing-id-0') as HTMLButtonElement;
            expect(button.disabled).toBe(true);
            expect(button.textContent).toContain('ID saknas för kontering');
        });

        const row = getByTestId('fortnox-customer-row-missing-id-0');
        const firstCell = row.querySelector('td');
        expect(firstCell?.textContent?.trim()).toBe('—');

        const traceCalls = fetchMock.mock.calls.filter(([_input, init]) => {
            const body = JSON.parse(String(init?.body ?? '{}')) as { action?: string };
            return body.action === 'getInvoicePostingTrace';
        });
        expect(traceCalls.length).toBe(0);
    });
});

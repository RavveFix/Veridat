import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReconciliationView } from './ReconciliationView';
import type { BankImport, BankTransaction } from '../types/bank';

const {
    refreshImportsMock,
    getImportsMock,
    refreshReconciliationMock,
    setReconciliationStatusMock,
    getCurrentIdMock,
    loggerMock
} = vi.hoisted(() => ({
    refreshImportsMock: vi.fn(),
    getImportsMock: vi.fn(),
    refreshReconciliationMock: vi.fn(),
    setReconciliationStatusMock: vi.fn(),
    getCurrentIdMock: vi.fn(() => 'company-test'),
    loggerMock: {
        warn: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        debug: vi.fn()
    }
}));

vi.mock('../services/BankImportService', () => ({
    bankImportService: {
        refreshImports: refreshImportsMock,
        getImports: getImportsMock
    }
}));

vi.mock('../services/FinanceAgentService', () => ({
    financeAgentService: {
        refreshReconciliation: refreshReconciliationMock,
        setReconciliationStatus: setReconciliationStatusMock
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

let container: HTMLDivElement;

function createImport(id: string, transactions: BankTransaction[]): BankImport {
    return {
        id,
        companyId: 'company-test',
        filename: `${id}.csv`,
        importedAt: '2025-01-01T00:00:00.000Z',
        rowCount: transactions.length,
        mapping: {},
        transactions
    };
}

function getToggle(period: string): HTMLButtonElement {
    const element = container.querySelector(`[data-testid="reconciliation-toggle-${period}"]`);
    expect(element).not.toBeNull();
    return element as HTMLButtonElement;
}

function getButtonByText(text: string): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll('button')).find((candidate) => candidate.textContent?.includes(text));
    expect(button).not.toBeUndefined();
    return button as HTMLButtonElement;
}

async function click(element: HTMLElement): Promise<void> {
    await act(async () => {
        element.click();
    });
}

async function renderView(props?: { onOpenBankImport?: () => void }): Promise<void> {
    await act(async () => {
        render(
            <ReconciliationView
                onBack={vi.fn()}
                onOpenBankImport={props?.onOpenBankImport}
            />,
            container
        );
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

describe('ReconciliationView', () => {
    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);

        getCurrentIdMock.mockReturnValue('company-test');
        refreshImportsMock.mockResolvedValue([]);
        getImportsMock.mockReturnValue([]);
        refreshReconciliationMock.mockResolvedValue([]);
        setReconciliationStatusMock.mockResolvedValue(undefined);
    });

    afterEach(() => {
        act(() => {
            render(null, container);
        });
        container.remove();
        vi.clearAllMocks();
    });

    it('renders empty state and allows opening bank import', async () => {
        const onOpenBankImport = vi.fn();

        await renderView({ onOpenBankImport });

        await waitForAssertion(() => {
            expect(container.textContent).toContain('Inga bankimporter hittades');
            expect(container.querySelectorAll('[data-testid^="reconciliation-toggle-"]').length).toBe(0);
        });

        await click(getButtonByText('Importera bankfil'));
        expect(onOpenBankImport).toHaveBeenCalledTimes(1);
    });

    it('renders period rows sorted newest first with reconciliation status', async () => {
        refreshImportsMock.mockResolvedValue([
            createImport('jan', [
                { id: 'tx-1', date: '2025-01-12', description: 'Inbetalning', amount: 1000 },
                { id: 'tx-2', date: '2025-01-08', description: 'Utbetalning', amount: -200 }
            ]),
            createImport('dec', [
                { id: 'tx-3', date: '2024-12-15', description: 'Utbetalning', amount: -75 }
            ])
        ]);
        refreshReconciliationMock.mockResolvedValue([
            { period: '2025-01', status: 'reconciled' },
            { period: '2024-12', status: 'open' }
        ]);

        await renderView();

        await waitForAssertion(() => {
            const toggles = Array.from(container.querySelectorAll('[data-testid^="reconciliation-toggle-"]')) as HTMLButtonElement[];
            expect(toggles.length).toBe(2);
            expect(toggles[0].dataset.period).toBe('2025-01');
            expect(toggles[1].dataset.period).toBe('2024-12');
            expect(getToggle('2025-01').textContent).toContain('Avstämd');
            expect(getToggle('2024-12').textContent).toContain('Markera som avstämd');
            expect(container.textContent).toContain('Januari 2025');
            expect(container.textContent).toContain('December 2024');
        });
    });

    it('toggles reconciliation status and calls setReconciliationStatus', async () => {
        refreshImportsMock.mockResolvedValue([
            createImport('jan', [
                { id: 'tx-1', date: '2025-01-12', description: 'Inbetalning', amount: 1000 }
            ])
        ]);

        await renderView();

        await waitForAssertion(() => {
            expect(getToggle('2025-01').textContent).toContain('Markera som avstämd');
        });

        await click(getToggle('2025-01'));

        await waitForAssertion(() => {
            expect(getToggle('2025-01').textContent).toContain('Avstämd');
            expect(setReconciliationStatusMock).toHaveBeenCalledWith('company-test', '2025-01', 'reconciled');
        });

        await click(getToggle('2025-01'));

        await waitForAssertion(() => {
            expect(getToggle('2025-01').textContent).toContain('Markera som avstämd');
            expect(setReconciliationStatusMock).toHaveBeenCalledWith('company-test', '2025-01', 'open');
        });
    });

    it('rolls back optimistic toggle when persist fails', async () => {
        refreshImportsMock.mockResolvedValue([
            createImport('jan', [
                { id: 'tx-1', date: '2025-01-12', description: 'Inbetalning', amount: 1000 }
            ])
        ]);
        setReconciliationStatusMock.mockRejectedValueOnce(new Error('persist failed'));
        refreshReconciliationMock.mockResolvedValue([]);

        await renderView();

        await waitForAssertion(() => {
            expect(getToggle('2025-01').textContent).toContain('Markera som avstämd');
        });

        await click(getToggle('2025-01'));

        await waitForAssertion(() => {
            expect(getToggle('2025-01').textContent).toContain('Markera som avstämd');
            expect(loggerMock.error).toHaveBeenCalled();
        });
    });

    it('falls back to cached imports when initial loading fails', async () => {
        refreshImportsMock.mockRejectedValueOnce(new Error('load failed'));
        getImportsMock.mockReturnValue([
            createImport('fallback', [
                { id: 'tx-fallback', date: '2025-01-05', description: 'Fallback', amount: 250 }
            ])
        ]);
        refreshReconciliationMock.mockResolvedValue([]);

        await renderView();

        await waitForAssertion(() => {
            expect(container.querySelector('[data-testid="reconciliation-toggle-2025-01"]')).not.toBeNull();
            expect(getImportsMock).toHaveBeenCalledWith('company-test');
            expect(loggerMock.warn).toHaveBeenCalled();
        });
    });
});

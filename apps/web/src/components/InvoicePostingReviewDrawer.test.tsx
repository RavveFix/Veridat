import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PostingCorrectionResult } from '../services/InvoicePostingReviewService';

vi.mock('../services/InvoicePostingReviewService', () => ({
    getCheckBadges: (checks: Record<string, boolean>) => ([
        { key: 'balanced', label: 'Balanskontroll', status: checks.balanced ? 'ok' : 'critical' },
        { key: 'total_match', label: 'Totalmatch', status: checks.total_match ? 'ok' : 'warning' },
        { key: 'vat_match', label: 'Momsmatch', status: checks.vat_match ? 'ok' : 'warning' },
        { key: 'control_account_present', label: 'Kontrollkonto', status: checks.control_account_present ? 'ok' : 'warning' },
        { key: 'row_account_consistency', label: 'Kontokonsistens', status: checks.row_account_consistency ? 'ok' : 'warning' },
    ]),
    getHighestIssueSeverity: (issues: Array<{ severity: string }>) => {
        if (issues.some((issue) => issue.severity === 'critical')) return 'critical';
        if (issues.some((issue) => issue.severity === 'warning')) return 'warning';
        return 'info';
    },
}));

import { InvoicePostingReviewDrawer } from './InvoicePostingReviewDrawer';

type PostingCorrectionPayload = {
    invoiceType: 'customer';
    invoiceId: number;
    correction: {
        side: 'debit' | 'credit';
        fromAccount: number;
        toAccount: number;
        amount: number;
        voucherSeries: string;
        transactionDate: string;
        reason: string;
    };
};

const TRACE_BOOKED_WITHOUT_VOUCHER = {
    invoice: {
        type: 'supplier',
        id: '29',
        invoiceNumber: '49173621',
        counterpartyNumber: '50207042',
        counterpartyName: 'Tele2 Sverige Aktiebolag',
        invoiceDate: '2025-11-27',
        dueDate: '2025-12-27',
        total: 2959,
        vat: 591.8,
        balance: 0,
        currency: 'SEK',
        booked: true,
    },
    expectedPosting: {
        rows: [
            { account: 2440, debit: 0, credit: 2959, description: '' },
            { account: 2641, debit: 591.8, credit: 0, description: '' },
            { account: 6212, debit: 2367.2, credit: 0, description: '' },
        ],
        totals: { debit: 2959, credit: 2959, balanced: true },
    },
    posting: {
        status: 'booked',
        source: 'none',
        matchPath: 'none',
        confidence: 0,
        voucherRef: null,
        rows: [],
        totals: { debit: 0, credit: 0, balanced: true },
    },
    checks: {
        balanced: true,
        total_match: true,
        vat_match: true,
        control_account_present: true,
        row_account_consistency: true,
    },
    issues: [
        {
            code: 'VOUCHER_LINK_MISSING',
            severity: 'warning',
            message: 'Fakturan är bokförd men verifikationen kunde inte kopplas automatiskt.',
            suggestion: 'Öppna fakturan i Fortnox och verifiera serie/nummer manuellt.',
        },
    ],
} as const;

const TRACE_MATCHED_EXPLICIT = {
    ...TRACE_BOOKED_WITHOUT_VOUCHER,
    posting: {
        status: 'booked',
        source: 'explicit',
        matchPath: 'explicit_vouchers',
        confidence: 0.99,
        voucherRef: { series: 'A', number: 10, year: 2026 },
        rows: [
            { account: 2440, debit: 0, credit: 2959, description: '' },
            { account: 2641, debit: 591.8, credit: 0, description: '' },
            { account: 6212, debit: 2367.2, credit: 0, description: '' },
        ],
        totals: { debit: 2959, credit: 2959, balanced: true },
    },
    issues: [],
} as const;

const TRACE_CUSTOMER_ACCOUNT_MISMATCH = {
    invoice: {
        type: 'customer',
        id: '1024',
        invoiceNumber: '1024',
        counterpartyNumber: 'K-1',
        counterpartyName: 'Kund 1 AB',
        invoiceDate: '2026-02-10',
        dueDate: '2026-03-10',
        total: 1250,
        vat: 250,
        balance: 0,
        currency: 'SEK',
        booked: true,
    },
    expectedPosting: {
        rows: [
            { account: 1510, debit: 1250, credit: 0, description: 'Kundfordran' },
            { account: 3041, debit: 0, credit: 1000, description: 'Försäljning tjänst' },
            { account: 2611, debit: 0, credit: 250, description: 'Utgående moms 25%' },
        ],
        totals: { debit: 1250, credit: 1250, balanced: true },
    },
    posting: {
        status: 'booked',
        source: 'explicit',
        matchPath: 'explicit_single',
        confidence: 0.94,
        voucherRef: { series: 'A', number: 88, year: 2026 },
        rows: [
            { account: 1510, debit: 1250, credit: 0, description: 'Kundfordran' },
            { account: 3001, debit: 0, credit: 1000, description: 'Fel konto' },
            { account: 2611, debit: 0, credit: 250, description: 'Moms' },
        ],
        totals: { debit: 1250, credit: 1250, balanced: true },
    },
    checks: {
        balanced: true,
        total_match: true,
        vat_match: true,
        control_account_present: true,
        row_account_consistency: false,
    },
    issues: [
        {
            code: 'ROW_ACCOUNT_CONSISTENCY',
            severity: 'warning',
            message: 'Kontona avviker från fakturans förväntade rader.',
            suggestion: 'Granska kontoval på raderna och justera vid behov.',
        },
    ],
} as const;

let container: HTMLDivElement;

describe('InvoicePostingReviewDrawer', () => {
    afterEach(() => {
        if (container) {
            act(() => {
                render(null, container);
            });
            container.remove();
        }
        const chatForm = document.getElementById('chat-form');
        if (chatForm) {
            chatForm.remove();
        }
    });

    it('shows business status text and keeps technical code collapsed by default', async () => {
        container = document.createElement('div');
        document.body.appendChild(container);

        await act(async () => {
            render(
                <InvoicePostingReviewDrawer
                    open
                    loading={false}
                    error={null}
                    trace={TRACE_BOOKED_WITHOUT_VOUCHER as any}
                    onClose={() => undefined}
                />,
                container
            );
        });

        const status = container.querySelector('[data-testid="invoice-posting-status-value"]');
        expect(status?.textContent).toBe('Bokförd, verifikation ej hittad automatiskt');

        const actualMessage = container.querySelector('[data-testid="invoice-posting-actual-message"]');
        expect(actualMessage?.textContent).toBe('Bokförd i Fortnox men verifikation kunde inte kopplas automatiskt.');
        expect(container.textContent).toContain('Träffsäkerhet');
        expect(container.textContent).toContain('Kontroller baseras på förväntad kontering när faktisk kontering saknas.');
        expect(container.textContent).toContain('—');

        const debugDetails = container.querySelector('[data-testid="invoice-posting-issue-debug-VOUCHER_LINK_MISSING"]') as HTMLDetailsElement | null;
        expect(debugDetails).not.toBeNull();
        expect(debugDetails?.open).toBe(false);

        const summary = debugDetails?.querySelector('summary') as HTMLElement | null;
        expect(summary).not.toBeNull();
        await act(async () => {
            summary?.click();
        });

        expect(debugDetails?.open).toBe(true);

        const code = container.querySelector('[data-testid="invoice-posting-issue-code-VOUCHER_LINK_MISSING"]');
        expect(code?.textContent).toBe('VOUCHER_LINK_MISSING');
    });

    it('shows match path and voucher reference for explicit voucher matches', async () => {
        container = document.createElement('div');
        document.body.appendChild(container);

        await act(async () => {
            render(
                <InvoicePostingReviewDrawer
                    open
                    loading={false}
                    error={null}
                    trace={TRACE_MATCHED_EXPLICIT as any}
                    onClose={() => undefined}
                />,
                container
            );
        });

        const matchPath = container.querySelector('[data-testid="invoice-posting-match-path-value"]');
        expect(matchPath?.textContent).toBe('Explicit (Vouchers[])');
        expect(container.textContent).toContain('Verifikation A/10/2026');
    });

    it('sends posting trace prompt to chat when clicking AI-economist action', async () => {
        const chatForm = document.createElement('form');
        chatForm.id = 'chat-form';
        const chatInput = document.createElement('input');
        chatInput.id = 'user-input';
        chatForm.appendChild(chatInput);
        document.body.appendChild(chatForm);

        let submitted = false;
        chatForm.addEventListener('submit', (event) => {
            submitted = true;
            event.preventDefault();
        });

        container = document.createElement('div');
        document.body.appendChild(container);

        await act(async () => {
            render(
                <InvoicePostingReviewDrawer
                    open
                    loading={false}
                    error={null}
                    trace={TRACE_BOOKED_WITHOUT_VOUCHER as any}
                    onClose={() => undefined}
                />,
                container
            );
        });

        const sendButton = container.querySelector('[data-testid="invoice-posting-send-ai-button"]') as HTMLButtonElement | null;
        expect(sendButton).not.toBeNull();

        await act(async () => {
            sendButton?.click();
        });

        expect(submitted).toBe(true);
        expect(chatInput.value).toContain('Fakturanummer: 49173621');
        expect(chatInput.value).toContain('VOUCHER_LINK_MISSING');
    });

    it('renders correction CTA only for customer account-mismatch scope', async () => {
        container = document.createElement('div');
        document.body.appendChild(container);

        await act(async () => {
            render(
                <InvoicePostingReviewDrawer
                    open
                    loading={false}
                    error={null}
                    trace={TRACE_BOOKED_WITHOUT_VOUCHER as any}
                    onClose={() => undefined}
                />,
                container
            );
        });

        expect(container.querySelector('[data-testid="invoice-posting-correct-issue-button"]')).toBeNull();

        await act(async () => {
            render(
                <InvoicePostingReviewDrawer
                    open
                    loading={false}
                    error={null}
                    trace={TRACE_CUSTOMER_ACCOUNT_MISMATCH as any}
                    onClose={() => undefined}
                    onCreateCorrection={vi.fn(async (_payload: PostingCorrectionPayload): Promise<PostingCorrectionResult> => ({
                        Voucher: null,
                        correction: {
                            invoiceType: 'customer',
                            invoiceId: 1024,
                            side: 'debit',
                            fromAccount: 3001,
                            toAccount: 3041,
                            amount: 1000,
                        },
                    }))}
                />,
                container
            );
        });

        expect(container.querySelector('[data-testid="invoice-posting-correct-issue-button"]')).not.toBeNull();
    });

    it('opens correction preview and submits payload to callback', async () => {
        const onCreateCorrection = vi.fn(
            async (_payload: PostingCorrectionPayload): Promise<PostingCorrectionResult> => ({
                Voucher: {
                    VoucherSeries: 'A',
                    VoucherNumber: 120,
                    Year: 2026,
                },
                correction: {
                    invoiceType: 'customer',
                    invoiceId: 1024,
                    side: 'credit',
                    fromAccount: 3001,
                    toAccount: 3041,
                    amount: 1000,
                },
            })
        );

        container = document.createElement('div');
        document.body.appendChild(container);

        await act(async () => {
            render(
                <InvoicePostingReviewDrawer
                    open
                    loading={false}
                    error={null}
                    trace={TRACE_CUSTOMER_ACCOUNT_MISMATCH as any}
                    onClose={() => undefined}
                    onCreateCorrection={onCreateCorrection}
                />,
                container
            );
        });

        const openButton = container.querySelector('[data-testid="invoice-posting-correct-issue-button"]') as HTMLButtonElement | null;
        expect(openButton).not.toBeNull();
        await act(async () => {
            openButton?.click();
        });

        const modal = container.querySelector('[data-testid="invoice-posting-correction-modal"]');
        expect(modal).not.toBeNull();

        const toAccountInput = container.querySelector('#posting-correction-to-account') as HTMLInputElement | null;
        expect(toAccountInput).not.toBeNull();
        await act(async () => {
            if (toAccountInput) {
                toAccountInput.value = '3041';
                toAccountInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
        });

        const sideSelect = container.querySelector('#posting-correction-side') as HTMLSelectElement | null;
        await act(async () => {
            if (sideSelect) {
                sideSelect.value = 'credit';
                sideSelect.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });

        const confirmButton = container.querySelector('[data-testid="invoice-posting-correction-confirm-button"]') as HTMLButtonElement | null;
        expect(confirmButton).not.toBeNull();
        await act(async () => {
            confirmButton?.click();
        });

        expect(onCreateCorrection).toHaveBeenCalledTimes(1);
        expect(onCreateCorrection.mock.calls[0][0]).toEqual({
            invoiceType: 'customer',
            invoiceId: 1024,
            correction: {
                side: 'credit',
                fromAccount: 3001,
                toAccount: 3041,
                amount: 1000,
                voucherSeries: 'A',
                transactionDate: '2026-02-10',
                reason: 'Korrigering avvikelse kundfaktura 1024',
            },
        });

        const successBox = container.querySelector('[data-testid="invoice-posting-correction-success"]');
        expect(successBox?.textContent).toContain('A/120/2026');
        expect(successBox?.textContent).toContain('Konteringsspåret har uppdaterats');
    });

    it('shows user-friendly permission feedback when correction export gets 403-like error', async () => {
        const onCreateCorrection = vi.fn(async (_payload: PostingCorrectionPayload): Promise<PostingCorrectionResult> => {
            throw new Error('Åtkomst nekad (403). Kontrollera Fortnox-behörighet.');
        });

        container = document.createElement('div');
        document.body.appendChild(container);

        await act(async () => {
            render(
                <InvoicePostingReviewDrawer
                    open
                    loading={false}
                    error={null}
                    trace={TRACE_CUSTOMER_ACCOUNT_MISMATCH as any}
                    onClose={() => undefined}
                    onCreateCorrection={onCreateCorrection}
                />,
                container
            );
        });

        const openButton = container.querySelector('[data-testid="invoice-posting-correct-issue-button"]') as HTMLButtonElement | null;
        await act(async () => {
            openButton?.click();
        });

        const toAccountInput = container.querySelector('#posting-correction-to-account') as HTMLInputElement | null;
        await act(async () => {
            if (toAccountInput) {
                toAccountInput.value = '3041';
                toAccountInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
        });

        const confirmButton = container.querySelector('[data-testid="invoice-posting-correction-confirm-button"]') as HTMLButtonElement | null;
        await act(async () => {
            confirmButton?.click();
        });

        const errorBox = container.querySelector('[data-testid="invoice-posting-correction-error"]');
        expect(errorBox?.textContent).toContain('Fortnox-behörighet saknas för att skapa korrigeringsverifikation');
    });
});

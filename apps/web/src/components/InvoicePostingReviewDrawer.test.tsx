import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

let container: HTMLDivElement;

describe('InvoicePostingReviewDrawer', () => {
    afterEach(() => {
        if (container) {
            act(() => {
                render(null, container);
            });
            container.remove();
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
});

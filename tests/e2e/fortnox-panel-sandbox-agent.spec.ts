import { test, expect } from '@playwright/test';
import { loginWithMagicLink } from './helpers/auth';
import { openTool } from './helpers/navigation';
import { setProfileFlags } from './helpers/profile';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const useSandbox = process.env.FORTNOX_SANDBOX_MODE === 'true';

test('fortnox-panel-sandbox-agent verifierar filter + scope/attest-status', async ({ page }) => {
    const fullName = 'Fortnox Panel Agent';
    const email = `fortnox-panel-agent+${Date.now()}@example.com`;
    const { userId } = await loginWithMagicLink(page, email, fullName);
    await setProfileFlags(userId, { plan: 'trial' });
    await sleep(400);

    if (!useSandbox) {
        page.on('dialog', (dialog) => dialog.accept());

        await page.route('**/functions/v1/fortnox', async (route) => {
            if (route.request().method() !== 'POST') {
                await route.continue();
                return;
            }

            let payload: Record<string, unknown> = {};
            try {
                payload = JSON.parse(route.request().postData() || '{}') as Record<string, unknown>;
            } catch {
                payload = {};
            }

            const action = payload.action;
            const filter = (payload.payload as { filter?: string } | undefined)?.filter;

            if (action === 'getSupplierInvoices' && filter === 'authorizepending') {
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        SupplierInvoices: [
                            {
                                GivenNumber: 9001,
                                SupplierNumber: 'L9001',
                                InvoiceNumber: 'AP-9001',
                                DueDate: '2026-02-20',
                                Total: 1000,
                                Balance: 1000,
                                Booked: false,
                                PaymentPending: true,
                            },
                        ],
                    }),
                });
                return;
            }

            if (action === 'getSupplierInvoices') {
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        SupplierInvoices: [
                            {
                                GivenNumber: 1001,
                                SupplierNumber: 'L1001',
                                InvoiceNumber: 'INV-1001',
                                DueDate: '2025-12-31',
                                Total: 3200,
                                Balance: 3200,
                                Booked: true,
                            },
                            {
                                GivenNumber: 1002,
                                SupplierNumber: 'L1002',
                                InvoiceNumber: 'INV-1002',
                                DueDate: '2026-12-31',
                                Total: 900,
                                Balance: 900,
                                Booked: false,
                            },
                            {
                                GivenNumber: 1003,
                                SupplierNumber: 'L1003',
                                InvoiceNumber: 'INV-1003',
                                DueDate: '2026-12-31',
                                Total: 500,
                                Balance: 0,
                                Booked: true,
                            },
                        ],
                    }),
                });
                return;
            }

            if (action === 'approveSupplierInvoiceBookkeep' || action === 'approveSupplierInvoicePayment') {
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({ ok: true }),
                });
                return;
            }

            if (action === 'getInvoices') {
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        Invoices: [
                            {
                                InvoiceNumber: 3001,
                                CustomerNumber: 'K3001',
                                DueDate: '2026-03-15',
                                Total: 2400,
                                Balance: 2400,
                                Booked: true,
                            },
                        ],
                    }),
                });
                return;
            }

            await route.continue();
        });
    }

    await openTool(page, 'fortnox-panel');
    await expect(page.getByTestId('fortnox-panel-root')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('fortnox-scope-message')).toBeVisible();
    await expect(page.getByTestId('fortnox-scope-status')).toBeVisible();
    await expect(page.getByTestId('fortnox-attest-message')).toBeVisible();
    await expect(page.getByTestId('fortnox-attest-status')).toBeVisible();

    if (useSandbox) {
        await page.getByTestId('fortnox-filter-all').click();
        await page.getByTestId('fortnox-filter-unbooked').click();
        await page.getByTestId('fortnox-filter-overdue').click();
        await page.getByTestId('fortnox-filter-authorizepending').click();
        await page.getByTestId('fortnox-refresh-button').click();
        return;
    }

    await expect(page.getByTestId('fortnox-supplier-row-1001')).toBeVisible();
    await expect(page.getByTestId('fortnox-supplier-row-1002')).toBeVisible();

    await page.getByTestId('fortnox-filter-unbooked').click();
    await expect(page.getByTestId('fortnox-supplier-row-1002')).toBeVisible();
    await expect(page.getByTestId('fortnox-supplier-row-1001')).toHaveCount(0);

    await page.getByTestId('fortnox-filter-overdue').click();
    await expect(page.getByTestId('fortnox-supplier-row-1001')).toBeVisible();
    await expect(page.getByTestId('fortnox-supplier-row-1002')).toHaveCount(0);

    await page.getByTestId('fortnox-filter-authorizepending').click();
    await expect(page.getByTestId('fortnox-supplier-row-9001')).toBeVisible({ timeout: 15_000 });

    await page.getByTestId('fortnox-approve-bookkeep-9001').click();
    await expect(page.getByTestId('fortnox-attest-status')).toContainText('OK', { timeout: 15_000 });
    await expect(page.getByTestId('fortnox-scope-status')).toContainText('OK');
});

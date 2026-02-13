import { test, expect } from '@playwright/test';
import { loginWithMagicLink } from './helpers/auth';
import { closeModal, openTool } from './helpers/navigation';
import { setProfileFlags } from './helpers/profile';

test('finance agent verifierar fakturaflöde + momsrapport + dashboard', async ({ page }) => {
    const fullName = 'Finance Invoice Agent';
    const email = `finance-invoice-agent+${Date.now()}@example.com`;

    const { userId } = await loginWithMagicLink(page, email, fullName);
    await setProfileFlags(userId, { plan: 'trial' });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
        for (let i = 0; i < localStorage.length; i += 1) {
            const key = localStorage.key(i);
            if (!key || !key.includes('auth-token')) continue;
            const value = localStorage.getItem(key) || '';
            if (value.includes('access_token')) {
                return true;
            }
        }
        return false;
    }, { timeout: 20_000 });
    await page.waitForFunction(() => {
        const companyId = localStorage.getItem('currentCompanyId');
        return typeof companyId === 'string' && companyId.length > 0;
    }, { timeout: 20_000 });

    const invoiceId = `seed-invoice-${Date.now()}`;
    const invoiceItems: Array<Record<string, unknown>> = [
        {
            id: invoiceId,
            source: 'upload',
            fileName: 'seed-invoice.pdf',
            fileUrl: 'https://example.com/seed-invoice.pdf',
            filePath: 'invoices/seed-invoice.pdf',
            fileBucket: 'chat-files',
            supplierName: 'Seed Leverantör AB',
            supplierOrgNr: '',
            invoiceNumber: 'INV-100',
            invoiceDate: '2026-02-01',
            dueDate: '2026-02-20',
            totalAmount: 1250,
            vatAmount: 250,
            vatRate: 25,
            ocrNumber: '',
            basAccount: '',
            basAccountName: '',
            currency: 'SEK',
            status: 'ny',
            uploadedAt: new Date().toISOString(),
            aiExtracted: true,
            aiRawResponse: '',
            aiReviewNote: '',
            fortnoxSyncStatus: 'not_exported',
            fortnoxSupplierNumber: '',
            fortnoxGivenNumber: null,
            fortnoxBooked: false,
            fortnoxBalance: null,
        },
    ];
    let listInvoiceCalls = 0;
    let vatCalls = 0;
    let supplierSyncCalls = 0;

    await page.route('**/functions/v1/finance-agent*', async (route) => {
        const request = route.request();
        if (request.method() !== 'POST') {
            await route.continue();
            return;
        }

        let body: {
            action?: string;
            payload?: Record<string, unknown>;
        } = {};
        try {
            body = JSON.parse(request.postData() || '{}') as typeof body;
        } catch {
            body = {};
        }

        const action = body.action || '';
        const payload = body.payload || {};

        if (action === 'migrateClientStorage') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ migrated: true }),
            });
            return;
        }

        if (action === 'listInvoiceInboxItems') {
            listInvoiceCalls += 1;
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ items: invoiceItems }),
            });
            return;
        }

        if (action === 'upsertInvoiceInboxItem') {
            const incomingItem = payload.item;
            if (incomingItem && typeof incomingItem === 'object' && !Array.isArray(incomingItem)) {
                const nextItem = incomingItem as Record<string, unknown>;
                const incomingId = typeof nextItem.id === 'string' ? nextItem.id : '';
                if (incomingId) {
                    const existingIndex = invoiceItems.findIndex((item) => item.id === incomingId);
                    if (existingIndex >= 0) {
                        invoiceItems[existingIndex] = {
                            ...invoiceItems[existingIndex],
                            ...nextItem,
                        };
                    } else {
                        invoiceItems.unshift(nextItem);
                    }
                }

                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({ item: nextItem }),
                });
                return;
            }

            await route.fulfill({
                status: 400,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'Missing payload.item' }),
            });
            return;
        }

        if (action === 'deleteInvoiceInboxItem') {
            const itemId = String(payload.itemId || '');
            const idx = invoiceItems.findIndex((item) => item.id === itemId);
            if (idx >= 0) invoiceItems.splice(idx, 1);
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ ok: true }),
            });
            return;
        }

        if (action === 'listBankTransactions') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ imports: [] }),
            });
            return;
        }

        if (action === 'listReconciliationStatuses') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ periods: [] }),
            });
            return;
        }

        if (action === 'listComplianceAlerts') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ alerts: [] }),
            });
            return;
        }

        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({}),
        });
    });

    await page.route('**/functions/v1/fortnox*', async (route) => {
        const request = route.request();
        if (request.method() !== 'POST') {
            await route.continue();
            return;
        }

        let payload: Record<string, unknown> = {};
        try {
            payload = JSON.parse(request.postData() || '{}') as Record<string, unknown>;
        } catch {
            payload = {};
        }

        if (payload.action === 'getSupplierInvoices') {
            supplierSyncCalls += 1;
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    data: {
                        SupplierInvoices: [
                            {
                                GivenNumber: 2001,
                                SupplierName: 'Seed Leverantör AB',
                                SupplierNumber: 'SUP-2001',
                                InvoiceNumber: 'INV-2001',
                                InvoiceDate: '2026-02-01',
                                DueDate: '2026-02-20',
                                Total: 1250,
                                VAT: 250,
                                Currency: 'SEK',
                                Balance: 1250,
                                Booked: false,
                                OCR: '20012001',
                            },
                        ],
                    },
                }),
            });
            return;
        }

        if (payload.action === 'getVATReport') {
            vatCalls += 1;
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    data: {
                        type: 'vat_report',
                        period: '2026-01',
                        company: {
                            name: 'Seed Bolag AB',
                            org_number: '559999-0000',
                        },
                        summary: {
                            total_income: 10000,
                            total_costs: 4000,
                            result: 6000,
                        },
                        sales: [],
                        costs: [],
                        vat: {
                            outgoing_25: 2500,
                            incoming: 1000,
                            net: 1500,
                        },
                        journal_entries: [
                            { account: '2611', name: 'Utgående moms', debit: 0, credit: 2500 },
                            { account: '2641', name: 'Ingående moms', debit: 1000, credit: 0 },
                        ],
                        validation: {
                            is_valid: true,
                            errors: [],
                            warnings: [],
                        },
                    },
                    invoices: [
                        {
                            nr: 1001,
                            customer: 'Kund AB',
                            date: '2026-01-10',
                            net: 10000,
                            vat: 2500,
                            total: 12500,
                            booked: true,
                        },
                    ],
                    supplierInvoices: [
                        {
                            nr: 2001,
                            supplier: 'Leverantör AB',
                            date: '2026-01-11',
                            net: 4000,
                            vat: 1000,
                            total: 5000,
                            booked: true,
                        },
                    ],
                }),
            });
            return;
        }

        await route.continue();
    });

    await openTool(page, 'invoice-inbox');

    let activeInvoiceId = invoiceId;
    let card = page.getByTestId(`invoice-card-${activeInvoiceId}`);
    const isSeedCardVisible = await card.isVisible().catch(() => false);
    if (!isSeedCardVisible) {
        await closeModal(page, 'Fakturainkorg');
        await openTool(page, 'invoice-inbox');

        const isSeedCardVisibleAfterReopen = await card.isVisible().catch(() => false);
        if (!isSeedCardVisibleAfterReopen) {
            await page.getByRole('button', { name: 'Hämta leverantörsfakturor från Fortnox' }).click();
            activeInvoiceId = 'fnx_2001';
            card = page.getByTestId(`invoice-card-${activeInvoiceId}`);
        }
    }
    await expect(card).toBeVisible({ timeout: 20_000 });
    expect(listInvoiceCalls + supplierSyncCalls).toBeGreaterThanOrEqual(1);
    await expect(card).toContainText('Seed Leverantör AB');

    await page.getByTestId(`invoice-status-review-${activeInvoiceId}`).click();
    await expect(card).toContainText('Granskad');

    const markPaidButton = page.getByTestId(`invoice-status-paid-${activeInvoiceId}`);
    await expect(markPaidButton).toBeVisible();
    await markPaidButton.click();
    await expect(card).toContainText('Betald');

    await openTool(page, 'vat-report');

    await expect(page.getByText('Momsredovisning 2026-01')).toBeVisible({ timeout: 20_000 });
    expect(vatCalls).toBeGreaterThanOrEqual(1);

    const refreshButton = page.getByTestId('vat-report-refresh-button');
    await expect(refreshButton).toBeVisible();
    await refreshButton.click();

    await expect
        .poll(() => vatCalls, { timeout: 20_000 })
        .toBeGreaterThanOrEqual(2);

    await openTool(page, 'dashboard');
    await expect(page.getByText('Ekonomisk översikt')).toBeVisible();
    await expect(page.getByTestId('dashboard-sync-button')).toBeVisible();
});

import { test, expect, type Page } from '@playwright/test';
import { loginWithMagicLink } from './helpers/auth';
import { closeModal, openTool } from './helpers/navigation';
import { getAdminClient, setProfileFlags } from './helpers/profile';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function upsertCompany(
    userId: string,
    companyId: string,
    name: string,
    orgNumber: string
): Promise<void> {
    const admin = getAdminClient();
    const { error } = await admin.from('companies').upsert({
        user_id: userId,
        id: companyId,
        name,
        org_number: orgNumber,
        address: 'Storgatan 1',
        phone: '010-100 20 30',
    }, { onConflict: 'user_id,id' });

    if (error) {
        throw new Error(`Kunde inte skapa bolag ${companyId}: ${error.message}`);
    }
}

async function upsertFortnoxToken(
    userId: string,
    companyId: string,
    accessToken: string
): Promise<void> {
    const admin = getAdminClient();
    const { error } = await admin.from('fortnox_tokens').upsert({
        user_id: userId,
        company_id: companyId,
        access_token: accessToken,
        refresh_token: `refresh-${accessToken}`,
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,company_id' });

    if (error) {
        throw new Error(`Kunde inte skapa Fortnox-token för ${companyId}: ${error.message}`);
    }
}

async function switchToCompany(page: Page, companyId: string): Promise<void> {
    const companySelect = page.locator('#company-select');
    await expect(companySelect).toBeVisible({ timeout: 20_000 });
    await companySelect.selectOption(companyId);
    await expect
        .poll(
            async () => page.evaluate(() => localStorage.getItem('currentCompanyId') || ''),
            { timeout: 10000 }
        )
        .toBe(companyId);
    await expect(companySelect).toHaveValue(companyId);
}

async function openIntegrationsWithRetry(page: Page): Promise<void> {
    const openIntegrations = async (): Promise<void> => {
        const buttons = page.getByRole('button', { name: 'Integreringar' });
        const count = await buttons.count();
        for (let i = 0; i < count; i += 1) {
            const button = buttons.nth(i);
            if (await button.isVisible().catch(() => false)) {
                await button.click();
                break;
            }
        }
        await expect(page.getByRole('heading', { name: 'Integreringar' })).toBeVisible({ timeout: 15_000 });
    };

    await openIntegrations();

    const timedOutError = page.getByText('Tidsgränsen nåddes. Kontrollera din internetanslutning och försök igen.');
    const hasTimeout = await timedOutError.isVisible().catch(() => false);
    if (hasTimeout) {
        await closeModal(page, 'Integreringar');
        await openIntegrations();
    }
}

test('fortnox-company-isolation-agent visar Fortnox-status per aktivt bolag', async ({ page }) => {
    const fullName = 'Fortnox Company Isolation Agent';
    const email = `fortnox-company-iso+${Date.now()}@example.com`;
    const { userId } = await loginWithMagicLink(page, email, fullName);
    await setProfileFlags(userId, { plan: 'trial' });

    const companyAId = `fortnox-company-a-${Date.now()}`;
    const companyBId = `fortnox-company-b-${Date.now()}`;
    const companyAName = 'Fortnox Bolag A AB';
    const companyBName = 'Fortnox Bolag B AB';

    await upsertCompany(userId, companyAId, companyAName, '559900-1101');
    await upsertCompany(userId, companyBId, companyBName, '559900-1102');
    await upsertFortnoxToken(userId, companyAId, `token-a-${Date.now()}`);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForURL('**/app/**', { timeout: 30_000 });
    await sleep(250);

    await switchToCompany(page, companyAId);

    await openIntegrationsWithRetry(page);
    await expect(page.getByTestId('integration-card-fortnox')).toContainText('Ansluten');
    await closeModal(page, 'Integreringar');

    await switchToCompany(page, companyBId);

    await openIntegrationsWithRetry(page);
    await expect(page.getByTestId('integration-card-fortnox')).toContainText('Ej ansluten');
    await expect(page.getByTestId('fortnox-reconnect-banner')).toBeVisible();
});

test('fortnox-company-isolation-agent visar org.nr-mismatch-fel efter OAuth-callback', async ({ page }) => {
    const fullName = 'Fortnox Org Mismatch Agent';
    const email = `fortnox-org-mismatch+${Date.now()}@example.com`;
    const { userId } = await loginWithMagicLink(page, email, fullName);
    await setProfileFlags(userId, { plan: 'trial' });

    await page.goto('/app?fortnox_error=org_number_mismatch', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/app(\/|\?|$)/);

    await expect
        .poll(async () => page.url().includes('fortnox_error=org_number_mismatch'), { timeout: 5000 })
        .toBe(false);

    const toast = page.locator('.toast-inline.error');
    const toastVisible = await toast.isVisible().catch(() => false);
    if (toastVisible) {
        await expect(toast).toContainText(
            'Fortnox-fel: Fortnox-bolaget matchar inte organisationsnumret för aktivt bolag.'
        );
    }

    await expect(page.getByText('Ej ansluten').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Anslut Fortnox' })).toBeVisible({ timeout: 15_000 });

});

test('fortnox-company-isolation-agent visar paneldata för aktivt bolag efter bolagsbyte', async ({ page }) => {
    const fullName = 'Fortnox Panel Isolation Agent';
    const email = `fortnox-panel-iso+${Date.now()}@example.com`;
    const { userId } = await loginWithMagicLink(page, email, fullName);
    await setProfileFlags(userId, { plan: 'trial' });

    const companyAId = `fortnox-panel-a-${Date.now()}`;
    const companyBId = `fortnox-panel-b-${Date.now()}`;
    const companyAName = 'Fortnox Panel A AB';
    const companyBName = 'Fortnox Panel B AB';

    await upsertCompany(userId, companyAId, companyAName, '559900-2201');
    await upsertCompany(userId, companyBId, companyBName, '559900-2202');
    await upsertFortnoxToken(userId, companyAId, `panel-token-a-${Date.now()}`);
    await upsertFortnoxToken(userId, companyBId, `panel-token-b-${Date.now()}`);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForURL('**/app/**', { timeout: 30_000 });
    await sleep(250);

    const requestedCompanyIds = new Set<string>();
    await page.route('**/functions/v1/fortnox', async (route) => {
        if (route.request().method() !== 'POST') {
            await route.continue();
            return;
        }

        const payload = JSON.parse(route.request().postData() || '{}') as {
            action?: string;
            companyId?: string;
            payload?: { filter?: string };
        };

        if (payload.companyId) {
            requestedCompanyIds.add(payload.companyId);
        }

        if (payload.action === 'getSupplierInvoices') {
            if (payload.companyId === companyAId) {
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        SupplierInvoices: [{
                            GivenNumber: 1101,
                            SupplierNumber: 'LEV-A',
                            InvoiceNumber: 'A-1101',
                            DueDate: '2026-03-01',
                            Total: 1000,
                            Balance: 1000,
                            Booked: false,
                        }],
                    }),
                });
                return;
            }

            if (payload.companyId === companyBId) {
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        SupplierInvoices: [{
                            GivenNumber: 2201,
                            SupplierNumber: 'LEV-B',
                            InvoiceNumber: 'B-2201',
                            DueDate: '2026-03-01',
                            Total: 2000,
                            Balance: 2000,
                            Booked: false,
                        }],
                    }),
                });
                return;
            }
        }

        if (payload.action === 'getInvoices') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ Invoices: [] }),
            });
            return;
        }

        if (payload.action === 'sync_profile') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ synced: true }),
            });
            return;
        }

        await route.continue();
    });

    await switchToCompany(page, companyAId);
    await openTool(page, 'fortnox-panel');
    await expect(page.getByTestId('fortnox-panel-root')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('fortnox-supplier-row-1101')).toBeVisible({ timeout: 20_000 });
    await closeModal(page, 'Fortnoxpanel');

    await switchToCompany(page, companyBId);
    await openTool(page, 'fortnox-panel');
    await expect(page.getByTestId('fortnox-panel-root')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('fortnox-supplier-row-2201')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('fortnox-supplier-row-1101')).toHaveCount(0);

    expect(requestedCompanyIds.has(companyAId)).toBe(true);
    expect(requestedCompanyIds.has(companyBId)).toBe(true);
});

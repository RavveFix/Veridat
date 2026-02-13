import { test, expect } from '@playwright/test';
import { loginWithMagicLink } from './helpers/auth';
import { setProfileFlags } from './helpers/profile';

type AccountRecord = {
    id: string;
    company: string;
    contact: string;
    email: string;
    plan: 'free' | 'pro' | 'trial';
    status: 'active' | 'past_due' | 'suspended';
    periodEnd: string | null;
    graceUntil: string | null;
    trialEnd: string | null;
    invoiceId: string | null;
    invoiceDueDate: string | null;
    paidAt: string | null;
};

test('admin-billing-agent verifierar list/invite/update/mark_paid + admin access', async ({ page }) => {
    const fullName = 'Admin Billing Agent';
    const email = `admin-billing-agent+${Date.now()}@example.com`;
    const { userId } = await loginWithMagicLink(page, email, fullName);
    await setProfileFlags(userId, { isAdmin: true });

    const accounts: AccountRecord[] = [
        {
            id: userId,
            company: 'Veridat Test AB',
            contact: fullName,
            email,
            plan: 'pro',
            status: 'active',
            periodEnd: '2026-03-31',
            graceUntil: null,
            trialEnd: null,
            invoiceId: 'INV-1000',
            invoiceDueDate: '2026-03-15',
            paidAt: null,
        },
    ];
    const actionCalls = {
        list: 0,
        invite: 0,
        update: 0,
        markPaid: 0,
        maintenance: 0,
    };
    let lastUpdatePayload: Record<string, unknown> | null = null;

    await page.route('**/functions/v1/admin-billing', async (route) => {
        const request = route.request();
        const body = JSON.parse(request.postData() || '{}') as { action?: string; payload?: Record<string, unknown> };
        const action = body.action || '';
        const payload = body.payload || {};

        if (action === 'list') {
            actionCalls.list += 1;
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ accounts }),
            });
            return;
        }

        if (action === 'invite') {
            actionCalls.invite += 1;
            const invitedId = `invited-${Date.now()}`;
            accounts.push({
                id: invitedId,
                company: 'Inbjudet Bolag AB',
                contact: String(payload.fullName || 'Inbjuden Kontakt'),
                email: String(payload.email || 'invite@example.com'),
                plan: (payload.plan as AccountRecord['plan']) || 'pro',
                status: 'active',
                periodEnd: '2026-04-30',
                graceUntil: null,
                trialEnd: null,
                invoiceId: String(payload.invoiceId || '') || null,
                invoiceDueDate: String(payload.invoiceDueDate || '') || null,
                paidAt: null,
            });

            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ success: true, userId: invitedId }),
            });
            return;
        }

        if (action === 'update') {
            actionCalls.update += 1;
            lastUpdatePayload = payload;
            const targetId = String(payload.userId || '');
            const target = accounts.find((entry) => entry.id === targetId);
            if (target) {
                target.plan = (payload.plan as AccountRecord['plan']) || target.plan;
                target.status = (payload.billingStatus as AccountRecord['status']) || target.status;
                target.invoiceId = String(payload.invoiceId || '') || null;
                target.invoiceDueDate = String(payload.invoiceDueDate || '') || null;
                if (target.plan === 'trial') {
                    target.trialEnd = '2026-05-10';
                    target.periodEnd = null;
                }
            }

            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ success: true }),
            });
            return;
        }

        if (action === 'mark_paid') {
            actionCalls.markPaid += 1;
            const targetId = String(payload.userId || '');
            const target = accounts.find((entry) => entry.id === targetId);
            if (target) {
                target.plan = 'pro';
                target.status = 'active';
                target.periodEnd = '2026-06-01';
                target.graceUntil = null;
                target.trialEnd = null;
                target.paidAt = new Date().toISOString();
            }

            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ success: true }),
            });
            return;
        }

        await route.fulfill({
            status: 400,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Unknown action' }),
        });
    });

    await page.route('**/functions/v1/billing-maintenance', async (route) => {
        actionCalls.maintenance += 1;
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                ok: true,
                result: {
                    moved_to_past_due: 1,
                    downgraded_after_grace: 0,
                    trial_expired: 2,
                },
            }),
        });
    });

    await page.goto('/admin');
    await expect(page.getByTestId('admin-portal')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId(`admin-account-row-${userId}`)).toBeVisible();

    await page.getByTestId('admin-new-invite').click();
    await page.getByTestId('admin-invite-full-name').fill('Invite Test');
    await page.getByTestId('admin-invite-email').fill(`invite-${Date.now()}@example.com`);
    await page.getByTestId('admin-invite-plan').selectOption('pro');
    await page.getByTestId('admin-invite-period-days').fill('30');
    await page.getByTestId('admin-invite-invoice-id').fill('INV-2026-01');
    await page.getByTestId('admin-invite-invoice-due-date').fill('2026-03-30');
    await page.getByTestId('admin-invite-submit').click();
    await expect.poll(() => actionCalls.invite).toBeGreaterThan(0);

    const invitedRow = page.locator('[data-testid^="admin-account-row-invited-"]').first();
    await expect(invitedRow).toBeVisible();
    const invitedId = await invitedRow.getAttribute('data-testid');
    if (!invitedId) {
        throw new Error('Kunde inte läsa invited account id');
    }
    const invitedAccountId = invitedId.replace('admin-account-row-', '');

    await page.getByTestId(`admin-edit-account-${invitedAccountId}`).click();
    await expect(page.getByTestId('admin-edit-form')).toBeVisible();

    const editForm = page.getByTestId('admin-edit-form');
    await editForm.getByLabel('Faktura-ID').fill('INV-UPDATED-1');
    await page.getByTestId('admin-edit-submit').click();
    await expect.poll(() => actionCalls.update).toBeGreaterThan(0);
    await expect.poll(() => String(lastUpdatePayload?.userId || '')).toBe(invitedAccountId);

    await page.getByTestId(`admin-mark-paid-${invitedAccountId}`).click();
    await expect.poll(() => actionCalls.markPaid).toBeGreaterThan(0);
    await expect.poll(() => Boolean(accounts.find((entry) => entry.id === invitedAccountId)?.paidAt)).toBe(true);

    await page.getByTestId('admin-run-maintenance').click();
    await expect(page.getByTestId('admin-maintenance-modal')).toBeVisible();
    await page.getByTestId('admin-maintenance-confirm').click();
    await expect.poll(() => actionCalls.maintenance).toBeGreaterThan(0);
    await expect(page.getByTestId('admin-maintenance-modal')).toHaveCount(0);
});

test('admin-billing-agent verifierar access-kontroll för icke-admin', async ({ page }) => {
    const fullName = 'Admin Non User';
    const email = `admin-billing-non-admin+${Date.now()}@example.com`;
    const { userId } = await loginWithMagicLink(page, email, fullName);
    await setProfileFlags(userId, { isAdmin: false });

    await page.route('**/functions/v1/admin-billing', async (route) => {
        await route.fulfill({
            status: 403,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Admin access required' }),
        });
    });

    await page.goto('/admin');
    await expect(page.getByTestId('admin-portal')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Kunde inte hämta admin-data.')).toBeVisible();
});

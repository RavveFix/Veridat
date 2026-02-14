import { test, expect } from '@playwright/test';
import { loginWithMagicLink } from './helpers/auth';
import { openTool } from './helpers/navigation';
import { getAdminClient } from './helpers/profile';

test('agency-switch-agent verifierar bolagsbyte + company-changed + uppdaterad context', async ({ page }) => {
    const fullName = 'Agency Switch Agent';
    const email = `agency-switch-agent+${Date.now()}@example.com`;
    const { userId } = await loginWithMagicLink(page, email, fullName);

    const admin = getAdminClient();
    const secondCompanyId = `agency-company-${Date.now()}`;
    const { error } = await admin.from('companies').upsert({
        user_id: userId,
        id: secondCompanyId,
        name: 'Agentbolag AB',
        org_number: '559900-1122',
        address: 'Storgatan 1',
        phone: '010-100 20 30',
    }, { onConflict: 'user_id,id' });

    if (error) {
        throw new Error(`Kunde inte skapa bolag för agency-test: ${error.message}`);
    }

    await page.reload();
    await page.waitForURL('**/app/**', { timeout: 30_000 });

    await page.evaluate(() => {
        (window as unknown as { __lastCompanyChanged?: string }).__lastCompanyChanged = '';
        window.addEventListener('company-changed', (event) => {
            const detail = (event as CustomEvent<{ companyId?: string }>).detail;
            (window as unknown as { __lastCompanyChanged?: string }).__lastCompanyChanged = detail?.companyId || '';
        });
    });

    await openTool(page, 'agency');
    await expect(page.getByTestId('agency-panel')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId(`agency-company-row-${secondCompanyId}`)).toBeVisible();

    await page.getByTestId(`agency-open-company-${secondCompanyId}`).click();
    await expect(page.getByText('Aktivt bolag: Agentbolag AB')).toBeVisible({ timeout: 15_000 });

    await expect
        .poll(
            async () => page.evaluate(() => (window as unknown as { __lastCompanyChanged?: string }).__lastCompanyChanged || ''),
            { timeout: 5000 }
        )
        .toBe(secondCompanyId);

    await expect
        .poll(
            async () => page.evaluate(() => localStorage.getItem('currentCompanyId') || ''),
            { timeout: 5000 }
        )
        .toBe(secondCompanyId);
});

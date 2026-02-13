import { test, expect } from '@playwright/test';
import { loginWithMagicLink } from './helpers/auth';
import { closeModal } from './helpers/navigation';
import { setProfileFlags } from './helpers/profile';

test('fortnox plan-gating-agent verifierar free/blockerad och trial/pro/åtkomst', async ({ page }) => {
    const fullName = 'Fortnox Plan Agent';
    const email = `fortnox-plan-agent+${Date.now()}@example.com`;

    const { userId } = await loginWithMagicLink(page, email, fullName);

    await setProfileFlags(userId, { plan: 'free' });
    await page.reload({ waitUntil: 'domcontentloaded' });

    await page.click('#integrations-btn');
    await expect(page.getByRole('heading', { name: 'Integreringar' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('integration-card-fortnox')).toContainText('Kräver Pro');
    await expect(page.getByTestId('integration-tool-fortnox-panel')).toBeDisabled();
    await closeModal(page, 'Integreringar');

    await setProfileFlags(userId, { plan: 'trial' });
    await page.reload({ waitUntil: 'domcontentloaded' });

    await page.click('#integrations-btn');
    await expect(page.getByRole('heading', { name: 'Integreringar' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('integration-tool-fortnox-panel')).toBeEnabled();
    await page.getByTestId('integration-tool-fortnox-panel').click();
    await expect(page.getByRole('heading', { name: 'Fortnoxpanel' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('fortnox-panel-root')).toBeVisible();
});

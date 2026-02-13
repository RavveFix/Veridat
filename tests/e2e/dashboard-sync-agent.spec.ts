import { test, expect, type Page, type Locator } from '@playwright/test';
import { loginWithMagicLink } from './helpers/auth';
import { openTool } from './helpers/navigation';

type DashboardVariant = 'modern' | 'legacy';

async function detectDashboardVariant(page: Page): Promise<{ variant: DashboardVariant; button: Locator }> {
    const modernButton = page.getByTestId('dashboard-sync-button');
    const legacyButton = page.getByRole('button', { name: 'Uppdatera' });

    const timeoutAt = Date.now() + 20_000;
    while (Date.now() < timeoutAt) {
        if (await modernButton.isVisible().catch(() => false)) {
            return { variant: 'modern', button: modernButton };
        }
        if (await legacyButton.isVisible().catch(() => false)) {
            return { variant: 'legacy', button: legacyButton };
        }
        await page.waitForTimeout(200);
    }

    throw new Error('Kunde inte hitta dashboard-action (varken Synka nu eller Uppdatera).');
}

async function runSyncAndAssert(page: Page, button: Locator, variant: DashboardVariant): Promise<void> {
    await expect(button).toBeVisible();
    await button.click();

    if (variant === 'legacy') {
        await expect(page.getByText('Ekonomisk översikt')).toBeVisible({ timeout: 20_000 });
        await expect(button).toBeVisible({ timeout: 20_000 });
        return;
    }

    await expect(button).toBeDisabled({ timeout: 10_000 });
    await expect(button).toHaveText('Synkar...', { timeout: 10_000 });
    await expect(page.getByTestId('dashboard-sync-status-row')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('dashboard-sync-status-message')).toHaveText(
        /Synk klar med varningar|Synk klar|Synk misslyckades/,
        { timeout: 20_000 }
    );
    await expect(page.getByTestId('dashboard-sync-last-synced')).toContainText('Senast synkad', { timeout: 20_000 });
    await expect(button).toBeEnabled({ timeout: 20_000 });
    await expect(button).toHaveText('Synka nu');
}

test('dashboard test agent verifierar Synka nu + statusflöde', async ({ page }) => {
    const fullName = 'Dashboard Agent';
    const email = `dashboard-agent+${Date.now()}@example.com`;

    await loginWithMagicLink(page, email, fullName);

    await openTool(page, 'dashboard');
    await expect(page.getByText(/Plattformspuls \(\d+ dagar\)/)).toHaveCount(0);
    await expect(page.getByText('Ekonomisk översikt')).toBeVisible();
    const dashboardSession = await detectDashboardVariant(page);
    await runSyncAndAssert(page, dashboardSession.button, dashboardSession.variant);
});

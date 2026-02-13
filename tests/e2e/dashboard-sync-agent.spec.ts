import { test, expect, type Page } from '@playwright/test';
import { loginWithMagicLink } from './helpers/auth';
import { openTool, closeModal } from './helpers/navigation';
import { setProfileFlags } from './helpers/profile';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runSyncAndAssert(page: Page): Promise<void> {
    const syncButton = page.getByTestId('dashboard-sync-button');
    await expect(syncButton).toBeVisible();

    await syncButton.click();

    await expect(syncButton).toBeDisabled({ timeout: 10_000 });
    await expect(syncButton).toHaveText('Synkar...', { timeout: 10_000 });

    await expect(page.getByTestId('dashboard-sync-status-row')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('dashboard-sync-status-message')).toHaveText(
        /Synk klar med varningar|Synk klar|Synk misslyckades/,
        { timeout: 20_000 }
    );
    await expect(page.getByTestId('dashboard-sync-last-synced')).toContainText('Senast synkad', { timeout: 20_000 });

    await expect(syncButton).toBeEnabled({ timeout: 20_000 });
    await expect(syncButton).toHaveText('Synka nu');
}

test('dashboard test agent verifierar Synka nu + admin-gating automatiskt', async ({ page }) => {
    const fullName = 'Dashboard Agent';
    const email = `dashboard-agent+${Date.now()}@example.com`;

    const { userId } = await loginWithMagicLink(page, email, fullName);

    // --- Admin scenario ---
    await setProfileFlags(userId, { isAdmin: true });
    await sleep(500);

    await openTool(page, 'dashboard');
    await expect(page.getByText('Plattformspuls (7 dagar)')).toBeVisible();
    await runSyncAndAssert(page);
    await closeModal(page, 'Översikt');

    // --- Non-admin scenario ---
    await setProfileFlags(userId, { isAdmin: false });
    await sleep(500);

    await openTool(page, 'dashboard');
    await expect(page.getByText('Plattformspuls (7 dagar)')).toHaveCount(0);
    await expect(page.getByText('Ekonomisk översikt')).toBeVisible();
    await runSyncAndAssert(page);
});

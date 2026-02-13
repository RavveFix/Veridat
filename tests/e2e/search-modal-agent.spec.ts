import { test, expect } from '@playwright/test';
import { loginWithMagicLink } from './helpers/auth';

test('search-modal-agent verifierar debounce + resultatrendering', async ({ page }) => {
    const fullName = 'Search Agent';
    const email = `search-agent+${Date.now()}@example.com`;
    await loginWithMagicLink(page, email, fullName);

    let searchCalls = 0;
    await page.route('**/functions/v1/memory-service', async (route) => {
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

        if (payload.action === 'search_conversations') {
            searchCalls += 1;
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    results: [
                        {
                            conversation_id: '00000000-0000-0000-0000-000000000001',
                            conversation_title: 'Momsfråga',
                            snippet: 'Svar om momsregler',
                            created_at: new Date().toISOString(),
                            match_type: 'title',
                        },
                    ],
                }),
            });
            return;
        }

        await route.continue();
    });

    await page.click('#search-btn');
    const input = page.locator('.search-modal__input');
    await expect(input).toBeVisible();
    await input.click();
    await input.pressSequentially('moms', { delay: 15 });
    await expect(input).toHaveValue('moms');

    await page.waitForResponse((resp) =>
        resp.request().method() === 'POST' && resp.url().includes('/functions/v1/memory-service')
    );

    await expect
        .poll(() => searchCalls, { timeout: 5000, message: 'Debounce gav fler backend-anrop än väntat' })
        .toBe(1);

    await expect(page.locator('.search-modal__result-title')).toContainText('Momsfråga');
});

test('search-modal-agent verifierar felhantering från memory-service', async ({ page }) => {
    const fullName = 'Search Agent Error';
    const email = `search-agent-error+${Date.now()}@example.com`;
    await loginWithMagicLink(page, email, fullName);

    let failedSearchCalls = 0;
    await page.route('**/functions/v1/memory-service', async (route) => {
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

        if (payload.action === 'search_conversations') {
            failedSearchCalls += 1;
            await route.fulfill({
                status: 500,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'Simulerat fel i memory-service' }),
            });
            return;
        }

        await route.continue();
    });

    await page.click('#search-btn');
    const input = page.locator('.search-modal__input');
    await expect(input).toBeVisible();
    await input.click();
    await input.pressSequentially('moms', { delay: 15 });
    await expect(input).toHaveValue('moms');

    await expect
        .poll(() => failedSearchCalls, { timeout: 5000, message: 'Felanrop till memory-service uteblev' })
        .toBeGreaterThanOrEqual(1);

    await expect(page.getByText('Sökningen misslyckades. Försök igen.')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.search-modal__result')).toHaveCount(0);
});

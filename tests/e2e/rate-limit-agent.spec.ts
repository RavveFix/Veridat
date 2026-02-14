import { test, expect } from '@playwright/test';
import { loginWithMagicLink } from './helpers/auth';

test('rate-limit-agent verifierar limitering + recover i Skills Hub', async ({ page }) => {
    const fullName = 'Rate Limit Agent';
    const email = `rate-limit-agent+${Date.now()}@example.com`;
    await loginWithMagicLink(page, email, fullName);

    await page.route('**/functions/v1/skills-service', async (route) => {
        const body = JSON.parse(route.request().postData() || '{}') as { action?: string };
        if (body.action === 'list_hub') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    skills: [],
                    runs: [],
                    approvals: [],
                }),
            });
            return;
        }

        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({}),
        });
    });

    let runSuiteCalls = 0;
    await page.route('**/functions/v1/test-orchestrator', async (route) => {
        const body = JSON.parse(route.request().postData() || '{}') as { action?: string };

        if (body.action === 'list_suites') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    ok: true,
                    suites: [
                        { id: 'core_ui', label: 'Core UI', description: 'Core-flöden' },
                        { id: 'guardian', label: 'Guardian', description: 'Guardian-checkar' },
                    ],
                }),
            });
            return;
        }

        if (body.action === 'run_suite') {
            runSuiteCalls += 1;
            if (runSuiteCalls === 1) {
                await route.fulfill({
                    status: 429,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        error: 'rate_limit_exceeded',
                        message: 'Too many requests',
                    }),
                });
                return;
            }

            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    ok: true,
                    run_id: 'run-rate-limit-1',
                    status: 'succeeded',
                    summary: {
                        passed: 4,
                        failed: 0,
                        duration_ms: 1200,
                    },
                    checks: [],
                }),
            });
            return;
        }

        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                ok: true,
                run_id: 'noop',
                status: 'succeeded',
                summary: { passed: 0, failed: 0, duration_ms: 0 },
                checks: [],
            }),
        });
    });

    await page.click('#settings-btn');
    await expect(page.getByRole('heading', { name: 'Inställningar' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('settings-test-agents-section')).toBeVisible();
    await expect(page.getByTestId('skills-hub-suite-select')).toBeVisible({ timeout: 15_000 });

    await page.getByTestId('skills-hub-run-suite').click();
    await expect(page.getByTestId('skills-hub-suite-error')).toContainText('Kunde inte köra testsviten.');

    await page.getByTestId('skills-hub-run-suite').click();
    await expect(page.getByTestId('skills-hub-last-suite-result')).toContainText('Klar', { timeout: 15_000 });
    await expect(page.getByTestId('skills-hub-last-summary')).toContainText('Passerade: 4');
});

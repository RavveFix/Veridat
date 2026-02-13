import path from 'node:path';
import { test, expect } from '@playwright/test';
import { loginWithMagicLink } from './helpers/auth';
import { closeModal, openTool } from './helpers/navigation';

test('finance agent verifierar bankimport + avstämning med persistens', async ({ page }) => {
    const fullName = 'Finance Bank Agent';
    const email = `finance-bank-agent+${Date.now()}@example.com`;

    await loginWithMagicLink(page, email, fullName);

    const imports: Array<Record<string, unknown>> = [];
    const reconciliation = new Map<string, { period: string; status: 'open' | 'reconciled' | 'locked'; notes?: string | null }>();

    await page.route('**/functions/v1/finance-agent', async (route) => {
        const request = route.request();
        if (request.method() !== 'POST') {
            await route.continue();
            return;
        }

        let body: {
            action?: string;
            companyId?: string;
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

        if (action === 'importBankTransactions') {
            const imported = payload.import as { transactions?: Array<{ date?: string }> } | undefined;
            imports.push((imported || {}) as Record<string, unknown>);
            for (const tx of imported?.transactions || []) {
                const period = typeof tx.date === 'string' ? tx.date.slice(0, 7) : '';
                if (!period || reconciliation.has(period)) continue;
                reconciliation.set(period, { period, status: 'open', notes: null });
            }

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
                body: JSON.stringify({ imports }),
            });
            return;
        }

        if (action === 'listReconciliationStatuses') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ periods: Array.from(reconciliation.values()) }),
            });
            return;
        }

        if (action === 'setReconciliationStatus') {
            const period = String(payload.period || '');
            const status = (payload.status as 'open' | 'reconciled' | 'locked') || 'open';
            const notes = typeof payload.notes === 'string' ? payload.notes : null;
            if (period) {
                reconciliation.set(period, { period, status, notes });
            }

            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ period, status }),
            });
            return;
        }

        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({}),
        });
    });

    await openTool(page, 'bank-import');

    const csvPath = path.join(process.cwd(), 'tests/fixtures/bank/seb-sample.csv');
    await page.getByTestId('bank-import-file-input').setInputFiles(csvPath);

    await expect(page.getByText('Förhandsvisning')).toBeVisible({ timeout: 15_000 });
    const saveButton = page.getByTestId('bank-import-save-button');
    await expect(saveButton).toBeEnabled({ timeout: 10_000 });

    await saveButton.click();
    await expect(page.getByText(/Import sparad/)).toBeVisible({ timeout: 15_000 });

    await openTool(page, 'reconciliation');

    const firstToggle = page.locator('[data-testid^="reconciliation-toggle-"]').first();
    await expect(firstToggle).toBeVisible({ timeout: 10_000 });

    const period = await firstToggle.getAttribute('data-period');
    if (!period) {
        throw new Error('Kunde inte läsa period från reconciliation-toggle.');
    }

    await firstToggle.click();
    await expect(firstToggle).toContainText('Avstämd');

    await closeModal(page, 'Bankavstämning');
    await openTool(page, 'reconciliation');

    const persistedToggle = page.getByTestId(`reconciliation-toggle-${period}`);
    await expect(persistedToggle).toContainText('Avstämd');
    expect(reconciliation.get(period)?.status).toBe('reconciled');
});

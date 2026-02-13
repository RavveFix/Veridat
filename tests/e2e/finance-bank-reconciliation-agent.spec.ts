import path from 'node:path';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { loginWithMagicLink } from './helpers/auth';
import { closeModal, openTool } from './helpers/navigation';

async function resolveBankImportFileInput(page: Page): Promise<Locator> {
    const modernInput = page.getByTestId('bank-import-file-input');
    const legacyInput = page.locator('input[type="file"]').first();

    const timeoutAt = Date.now() + 20_000;
    while (Date.now() < timeoutAt) {
        if (await modernInput.isVisible().catch(() => false)) return modernInput.first();
        if (await legacyInput.isVisible().catch(() => false)) return legacyInput;
        await page.waitForTimeout(200);
    }

    throw new Error('Kunde inte hitta filinput för bankimport.');
}

async function resolveBankImportSaveButton(page: Page): Promise<Locator> {
    const modernButton = page.getByTestId('bank-import-save-button');
    const legacyButton = page.getByRole('button', { name: 'Spara import' });

    const timeoutAt = Date.now() + 20_000;
    while (Date.now() < timeoutAt) {
        if (await modernButton.isVisible().catch(() => false)) return modernButton.first();
        if (await legacyButton.isVisible().catch(() => false)) return legacyButton.first();
        await page.waitForTimeout(200);
    }

    throw new Error('Kunde inte hitta knappen Spara import.');
}

async function resolveReconciliationToggle(page: Page): Promise<{ mode: 'modern' | 'legacy'; toggle: Locator; period: string | null }> {
    const modernToggle = page.locator('[data-testid^="reconciliation-toggle-"]').first();
    const legacyToggle = page.getByRole('button', { name: /Markera som avstämd|Avstämd/i }).first();

    const timeoutAt = Date.now() + 20_000;
    while (Date.now() < timeoutAt) {
        if (await modernToggle.isVisible().catch(() => false)) {
            const period = await modernToggle.getAttribute('data-period');
            return { mode: 'modern', toggle: modernToggle, period: period || null };
        }
        if (await legacyToggle.isVisible().catch(() => false)) {
            return { mode: 'legacy', toggle: legacyToggle, period: null };
        }
        await page.waitForTimeout(200);
    }

    throw new Error('Kunde inte hitta avstämningsknapp.');
}

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
    const fileInput = await resolveBankImportFileInput(page);
    await fileInput.setInputFiles(csvPath);

    await expect(page.getByText('Förhandsvisning')).toBeVisible({ timeout: 15_000 });
    const saveButton = await resolveBankImportSaveButton(page);
    await expect(saveButton).toBeEnabled({ timeout: 10_000 });

    await saveButton.click();
    await expect(page.getByText(/Import sparad/i)).toBeVisible({ timeout: 15_000 });

    await openTool(page, 'reconciliation');

    const toggleInfo = await resolveReconciliationToggle(page);
    await toggleInfo.toggle.click();
    await expect(toggleInfo.toggle).toContainText('Avstämd');

    await closeModal(page, 'Bankavstämning');
    await openTool(page, 'reconciliation');

    if (toggleInfo.mode === 'modern' && toggleInfo.period) {
        const persistedToggle = page.getByTestId(`reconciliation-toggle-${toggleInfo.period}`);
        await expect(persistedToggle).toContainText('Avstämd');
        expect(reconciliation.get(toggleInfo.period)?.status).toBe('reconciled');
        return;
    }

    const legacyPersistedToggle = page.getByRole('button', { name: /Avstämd/i }).first();
    await expect(legacyPersistedToggle).toBeVisible({ timeout: 10_000 });
    expect(Array.from(reconciliation.values()).some((entry) => entry.status === 'reconciled')).toBeTruthy();
});

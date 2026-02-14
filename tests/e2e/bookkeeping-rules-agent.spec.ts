import { test, expect } from '@playwright/test';
import { loginWithMagicLink } from './helpers/auth';
import { openTool } from './helpers/navigation';

type PatternRow = {
    id: string;
    supplier_name: string;
    bas_account: string;
    bas_account_name: string;
    vat_rate: number;
    expense_type: 'cost' | 'sale';
    category: string | null;
    usage_count: number;
    avg_amount: number;
    confirmation_count: number;
    rejection_count: number;
    last_used_at: string;
    description_keywords: string[];
};

test('bookkeeping-rules-agent verifierar listning/filter/sök + delete med confirm', async ({ page }) => {
    const fullName = 'Bookkeeping Rules Agent';
    const email = `bookkeeping-rules-agent+${Date.now()}@example.com`;
    await loginWithMagicLink(page, email, fullName);

    const now = new Date().toISOString();
    const rows: PatternRow[] = [
        {
            id: 'rule-100',
            supplier_name: 'Kontorsbolaget AB',
            bas_account: '6110',
            bas_account_name: 'Kontorsmaterial',
            vat_rate: 25,
            expense_type: 'cost',
            category: 'office',
            usage_count: 8,
            avg_amount: 450,
            confirmation_count: 6,
            rejection_count: 0,
            last_used_at: now,
            description_keywords: ['papper', 'toner'],
        },
        {
            id: 'rule-200',
            supplier_name: 'SaaS Revenue AB',
            bas_account: '3011',
            bas_account_name: 'Försäljning tjänster',
            vat_rate: 25,
            expense_type: 'sale',
            category: 'sale',
            usage_count: 3,
            avg_amount: 12500,
            confirmation_count: 2,
            rejection_count: 1,
            last_used_at: now,
            description_keywords: ['abonnemang'],
        },
    ];

    page.on('dialog', (dialog) => dialog.accept());

    await page.route('**/rest/v1/expense_patterns**', async (route) => {
        const request = route.request();
        const url = new URL(request.url());

        if (request.method() === 'GET') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                headers: {
                    'Content-Range': `0-${Math.max(rows.length - 1, 0)}/${rows.length}`,
                },
                body: JSON.stringify(rows),
            });
            return;
        }

        if (request.method() === 'DELETE') {
            const idFilter = url.searchParams.get('id');
            const id = idFilter?.startsWith('eq.') ? idFilter.slice(3) : '';
            const index = rows.findIndex((row) => row.id === id);
            const deleted = index >= 0 ? rows.splice(index, 1) : [];

            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(deleted),
            });
            return;
        }

        await route.continue();
    });

    await openTool(page, 'bookkeeping-rules');
    await expect(page.getByTestId('bookkeeping-rules-panel')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('bookkeeping-rules-row-rule-100')).toBeVisible();
    await expect(page.getByTestId('bookkeeping-rules-row-rule-200')).toBeVisible();

    await page.getByTestId('bookkeeping-rules-filter-cost').click();
    await expect(page.getByTestId('bookkeeping-rules-row-rule-100')).toBeVisible();
    await expect(page.getByTestId('bookkeeping-rules-row-rule-200')).toHaveCount(0);

    await page.getByTestId('bookkeeping-rules-filter-all').click();
    await page.getByTestId('bookkeeping-rules-search').fill('SaaS');
    await expect(page.getByTestId('bookkeeping-rules-row-rule-200')).toBeVisible();
    await expect(page.getByTestId('bookkeeping-rules-row-rule-100')).toHaveCount(0);

    await page.getByTestId('bookkeeping-rules-search').fill('');
    await expect(page.getByTestId('bookkeeping-rules-row-rule-100')).toBeVisible();
    await expect(page.getByTestId('bookkeeping-rules-row-rule-200')).toBeVisible();

    await page.getByTestId('bookkeeping-rules-delete-rule-200').click();
    await expect(page.getByTestId('bookkeeping-rules-row-rule-200')).toHaveCount(0);
});

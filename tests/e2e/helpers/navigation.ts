import { expect, type Page } from '@playwright/test';

export type IntegrationTool =
    | 'bank-import'
    | 'agency'
    | 'fortnox-panel'
    | 'bookkeeping-rules'
    | 'reconciliation'
    | 'invoice-inbox'
    | 'dashboard'
    | 'vat-report';

const TOOL_HEADING: Record<IntegrationTool, string> = {
    dashboard: 'Översikt',
    'bank-import': 'Bankimport (CSV)',
    agency: 'Byråvy (beta)',
    reconciliation: 'Bankavstämning',
    'bookkeeping-rules': 'Bokföringsregler',
    'invoice-inbox': 'Fakturainkorg',
    'vat-report': 'Momsdeklaration',
    'fortnox-panel': 'Fortnoxpanel',
};

export async function openTool(page: Page, tool: IntegrationTool): Promise<void> {
    const isToolVisible = async (): Promise<boolean> => {
        return await page.getByRole('heading', { name: TOOL_HEADING[tool] })
            .waitFor({ state: 'visible', timeout: 7000 })
            .then(() => true)
            .catch(() => false);
    };

    for (let attempt = 0; attempt < 3; attempt += 1) {
        await page.evaluate((nextTool) => {
            window.dispatchEvent(new CustomEvent('copilot-open-tool', { detail: { tool: nextTool } }));
        }, tool);

        if (await isToolVisible()) return;
    }

    const toolButtonTestId: Record<IntegrationTool, string> = {
        dashboard: 'integration-tool-dashboard',
        'bank-import': 'integration-tool-bank-import',
        agency: 'integration-tool-agency',
        'fortnox-panel': 'integration-tool-fortnox-panel',
        'bookkeeping-rules': 'integration-tool-bookkeeping-rules',
        reconciliation: 'integration-tool-reconciliation',
        'invoice-inbox': 'integration-tool-invoice-inbox',
        'vat-report': 'integration-tool-vat-report',
    };

    const integrationsButtons = page.getByRole('button', { name: 'Integreringar' });
    const integrationsButtonCount = await integrationsButtons.count();
    let clickedIntegrations = false;
    for (let i = 0; i < integrationsButtonCount; i += 1) {
        const button = integrationsButtons.nth(i);
        const visible = await button.isVisible().catch(() => false);
        if (!visible) continue;
        await button.click();
        clickedIntegrations = true;
        break;
    }

    if (clickedIntegrations) {
        await expect(page.getByRole('heading', { name: 'Integreringar' })).toBeVisible({ timeout: 10_000 });
        await page.getByTestId(toolButtonTestId[tool]).click();

        if (await isToolVisible()) return;
    }

    throw new Error(`Kunde inte öppna verktyget ${tool}.`);
}

export async function closeModal(page: Page, title: string): Promise<void> {
    const modal = page.locator('.modal-content').filter({
        has: page.getByRole('heading', { name: title }),
    });

    await expect(modal).toBeVisible({ timeout: 10_000 });
    await modal.getByRole('button', { name: 'Stäng' }).click();
    await expect(page.getByRole('heading', { name: title })).toHaveCount(0);
}

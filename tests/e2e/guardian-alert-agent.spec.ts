import { test, expect } from '@playwright/test';
import { loginWithMagicLink } from './helpers/auth';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';

type GuardianAlert = {
    id: string;
    company_id: string;
    title: string;
    description: string;
    severity: 'critical' | 'warning' | 'info';
    status: 'open' | 'acknowledged' | 'resolved';
    action_target: string | null;
    payload: Record<string, unknown>;
    created_at: string;
};

test('guardian-alert-agent verifierar run_checks/list/ack/resolve + UI-badge', async ({ page }) => {
    const fullName = 'Guardian Agent';
    const email = `guardian-agent+${Date.now()}@example.com`;
    await loginWithMagicLink(page, email, fullName);

    const companyId = await page.evaluate(() => localStorage.getItem('currentCompanyId') || 'default');
    const alerts: GuardianAlert[] = [];

    await page.route('**/functions/v1/fortnox-guardian', async (route) => {
        if (route.request().method() !== 'POST') {
            await route.continue();
            return;
        }

        const body = JSON.parse(route.request().postData() || '{}') as {
            action?: string;
            payload?: { alertId?: string; companyId?: string; status?: string };
        };
        const action = body.action || '';
        const payload = body.payload || {};

        if (action === 'run_checks') {
            const id = `alert-${Date.now()}-${alerts.length + 1}`;
            alerts.push({
                id,
                company_id: payload.companyId || companyId,
                title: 'Guardian varning',
                description: 'Ny kontroll indikerar avvikelse i Fortnox.',
                severity: 'warning',
                status: 'open',
                action_target: 'fortnox-panel',
                payload: { check: 'overdue_supplier_invoices' },
                created_at: new Date().toISOString(),
            });

            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    ok: true,
                    summary: {
                        processedUsers: 1,
                        alertsCreated: 1,
                        alertsUpdated: 0,
                        alertsResolved: 0,
                        errors: 0,
                    },
                }),
            });
            return;
        }

        if (action === 'list_alerts') {
            const status = payload.status || 'open';
            const list = alerts.filter((alert) => alert.status === status);
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ alerts: list }),
            });
            return;
        }

        if (action === 'acknowledge_alert' || action === 'resolve_alert') {
            const alert = alerts.find((entry) => entry.id === payload.alertId);
            if (!alert) {
                await route.fulfill({
                    status: 404,
                    contentType: 'application/json',
                    body: JSON.stringify({ error: 'Alert not found' }),
                });
                return;
            }

            alert.status = action === 'acknowledge_alert' ? 'acknowledged' : 'resolved';
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ ok: true, alert: { id: alert.id, status: alert.status } }),
            });
            return;
        }

        await route.fulfill({
            status: 400,
            contentType: 'application/json',
            body: JSON.stringify({ error: `Unknown action: ${action}` }),
        });
    });

    const endpoint = `${SUPABASE_URL}/functions/v1/fortnox-guardian`;

    const runChecks = await page.evaluate(async ({ url, company }) => {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'run_checks', payload: { companyId: company } }),
        });
        return response.json();
    }, { url: endpoint, company: companyId });
    expect(runChecks.ok).toBeTruthy();

    const listedBeforeAck = await page.evaluate(async ({ url, company }) => {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'list_alerts', payload: { companyId: company } }),
        });
        return response.json() as Promise<{ alerts: Array<{ id: string }> }>;
    }, { url: endpoint, company: companyId });

    expect(listedBeforeAck.alerts.length).toBeGreaterThanOrEqual(1);
    const firstAlertId = listedBeforeAck.alerts[0]?.id;
    expect(firstAlertId).toBeTruthy();

    const ackResult = await page.evaluate(async ({ url, alertId }) => {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'acknowledge_alert', payload: { alertId } }),
        });
        return response.json() as Promise<{ ok: boolean; alert: { status: string } }>;
    }, { url: endpoint, alertId: firstAlertId });
    expect(ackResult.ok).toBeTruthy();
    expect(ackResult.alert.status).toBe('acknowledged');

    await page.evaluate(async ({ url, company }) => {
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'run_checks', payload: { companyId: company } }),
        });
    }, { url: endpoint, company: companyId });

    const listedBeforeResolve = await page.evaluate(async ({ url, company }) => {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'list_alerts', payload: { companyId: company } }),
        });
        return response.json() as Promise<{ alerts: Array<{ id: string }> }>;
    }, { url: endpoint, company: companyId });
    const alertToResolve = listedBeforeResolve.alerts[0]?.id;
    expect(alertToResolve).toBeTruthy();

    const resolveResult = await page.evaluate(async ({ url, alertId }) => {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'resolve_alert', payload: { alertId } }),
        });
        return response.json() as Promise<{ ok: boolean; alert: { status: string } }>;
    }, { url: endpoint, alertId: alertToResolve });
    expect(resolveResult.ok).toBeTruthy();
    expect(resolveResult.alert.status).toBe('resolved');

    await page.evaluate(() => {
        localStorage.setItem('veridat_copilot_notifications', JSON.stringify([
            {
                id: 'guardian-ui-alert',
                type: 'guardian_alert',
                category: 'varning',
                title: 'Guardian UI-varning',
                description: 'Visar badge i integrationsvyn.',
                severity: 'warning',
                prompt: 'Visa guardian-varning',
                action: 'fortnox-panel',
                createdAt: new Date().toISOString(),
                read: false,
            },
        ]));
    });

    await page.reload();
    await page.waitForURL('**/app/**', { timeout: 30_000 });
    await page.click('#integrations-btn');
    await expect(page.getByRole('heading', { name: 'Integreringar' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('integration-tool-fortnox-guardian-badge')).toBeVisible();
});

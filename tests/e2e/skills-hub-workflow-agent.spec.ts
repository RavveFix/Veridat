import { test, expect } from '@playwright/test';
import { loginWithMagicLink } from './helpers/auth';

type SkillEntry = {
    id: string;
    company_id: string;
    name: string;
    description: string;
    kind: 'skill' | 'automation';
    status: 'draft' | 'active' | 'deprecated' | 'archived';
    requires_approval: boolean;
    created_at: string;
    updated_at: string;
};

type RunEntry = {
    id: string;
    company_id: string;
    skill_id: string;
    status: 'preview' | 'pending_approval' | 'running' | 'succeeded' | 'failed' | 'cancelled';
    triggered_by: 'user' | 'system';
    input_payload: Record<string, unknown>;
    created_at: string;
};

type ApprovalEntry = {
    id: string;
    company_id: string;
    run_id: string;
    status: 'pending' | 'approved' | 'rejected';
    required_role: string;
    created_at: string;
};

test('skills-hub-workflow-agent verifierar automation -> run -> approval -> approve/reject', async ({ page }) => {
    const fullName = 'Skills Hub Agent';
    const email = `skills-hub-agent+${Date.now()}@example.com`;
    await loginWithMagicLink(page, email, fullName);

    const companyId = await page.evaluate(() => localStorage.getItem('currentCompanyId') || 'default');
    const nowIso = () => new Date().toISOString();
    const skills: SkillEntry[] = [];
    const runs: RunEntry[] = [];
    const approvals: ApprovalEntry[] = [];

    await page.route('**/functions/v1/test-orchestrator', async (route) => {
        const body = JSON.parse(route.request().postData() || '{}') as { action?: string };
        if (body.action === 'list_suites') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    ok: true,
                    suites: [
                        { id: 'core_ui', label: 'Core UI', description: 'Core testflöden' },
                    ],
                }),
            });
            return;
        }

        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                ok: true,
                run_id: 'orchestrator-noop',
                status: 'succeeded',
                summary: { passed: 0, failed: 0, duration_ms: 0 },
                checks: [],
            }),
        });
    });

    await page.route('**/functions/v1/skills-service', async (route) => {
        const body = JSON.parse(route.request().postData() || '{}') as {
            action?: string;
            skill_id?: string;
            run_id?: string;
            approval_id?: string;
            payload?: Record<string, unknown>;
        };

        const action = body.action || '';
        const payload = body.payload || {};

        if (action === 'list_hub') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ skills, runs, approvals }),
            });
            return;
        }

        if (action === 'create_skill') {
            const nextSkill: SkillEntry = {
                id: `skill-${skills.length + 1}`,
                company_id: companyId,
                name: String(payload.name || 'Namnlös skill'),
                description: String(payload.description || ''),
                kind: (payload.kind as SkillEntry['kind']) || 'automation',
                status: (payload.status as SkillEntry['status']) || 'active',
                requires_approval: Boolean(payload.requires_approval),
                created_at: nowIso(),
                updated_at: nowIso(),
            };
            skills.unshift(nextSkill);

            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ skill: nextSkill }),
            });
            return;
        }

        if (action === 'create_run') {
            const nextRun: RunEntry = {
                id: `run-${runs.length + 1}`,
                company_id: companyId,
                skill_id: String(body.skill_id || ''),
                status: (payload.status as RunEntry['status']) || 'preview',
                triggered_by: (payload.triggered_by as RunEntry['triggered_by']) || 'user',
                input_payload: (payload.input_payload as Record<string, unknown>) || {},
                created_at: nowIso(),
            };
            runs.unshift(nextRun);

            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ run: nextRun }),
            });
            return;
        }

        if (action === 'request_approval') {
            const targetRunId = String(body.run_id || '');
            const targetRun = runs.find((run) => run.id === targetRunId);
            if (targetRun) {
                targetRun.status = 'pending_approval';
            }

            const approval: ApprovalEntry = {
                id: `approval-${approvals.length + 1}`,
                company_id: companyId,
                run_id: targetRunId,
                status: 'pending',
                required_role: 'owner',
                created_at: nowIso(),
            };
            approvals.unshift(approval);

            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ approval }),
            });
            return;
        }

        if (action === 'approve_run' || action === 'reject_run') {
            const approvalId = String(body.approval_id || '');
            const approval = approvals.find((entry) => entry.id === approvalId);
            if (approval) {
                approval.status = action === 'approve_run' ? 'approved' : 'rejected';
                const run = runs.find((entry) => entry.id === approval.run_id);
                if (run) {
                    run.status = action === 'approve_run' ? 'succeeded' : 'failed';
                }
            }

            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ approval }),
            });
            return;
        }

        await route.fulfill({
            status: 400,
            contentType: 'application/json',
            body: JSON.stringify({ error: `Unknown action: ${action}` }),
        });
    });

    await page.click('#settings-btn');
    await expect(page.getByRole('heading', { name: 'Inställningar' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('skills-hub-create-automation-name')).toBeVisible({ timeout: 15_000 });

    await page.getByTestId('skills-hub-create-automation-name').fill('Agent Automation 1');
    await page.getByTestId('skills-hub-create-automation-description').fill('Skapas av workflow-agent-testet');
    await page.getByTestId('skills-hub-create-automation-submit').click();
    await expect(page.getByTestId('skills-hub-run-select')).toContainText('Agent Automation 1', { timeout: 10_000 });

    await page.getByTestId('skills-hub-run-select').selectOption({ label: 'Agent Automation 1' });
    await page.getByTestId('skills-hub-create-run').click();
    await page.getByTestId('skills-hub-request-approval').click();
    await expect(page.locator('[data-testid^="skills-hub-approve-"]').first()).toBeVisible({ timeout: 10_000 });

    await page.locator('[data-testid^="skills-hub-approve-"]').first().click();
    await expect(page.getByText('Godkännanden (0)')).toBeVisible({ timeout: 10_000 });

    await page.getByTestId('skills-hub-run-select').selectOption({ label: 'Agent Automation 1' });
    await page.getByTestId('skills-hub-create-run').click();
    await page.getByTestId('skills-hub-request-approval').click();
    await expect(page.locator('[data-testid^="skills-hub-reject-"]').first()).toBeVisible({ timeout: 10_000 });
    await page.locator('[data-testid^="skills-hub-reject-"]').first().click();

    await expect(page.getByText('Godkännanden (0)')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.skills-hub__badge--succeeded').first()).toBeVisible();
    await expect(page.locator('.skills-hub__badge--failed').first()).toBeVisible();
});

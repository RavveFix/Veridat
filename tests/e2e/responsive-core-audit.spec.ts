import { test, expect, type Page } from '@playwright/test';
import { loginWithMagicLink } from './helpers/auth';
import {
    assertCriticalControlsInViewport,
    assertNoHorizontalOverflow,
    assertTapTargetMinimum
} from './helpers/layout';

const HAS_SUPABASE_ADMIN = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
const getViewportWidth = (page: Page): number => page.viewportSize()?.width ?? 1440;

const isMobileViewport = (page: Page): boolean => getViewportWidth(page) <= 768;
const isOverlaySidebarViewport = (page: Page): boolean => getViewportWidth(page) < 1024;

async function mockSearchRoute(page: Page): Promise<void> {
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
                            match_type: 'title'
                        }
                    ]
                })
            });
            return;
        }

        await route.continue();
    });
}

test('responsive core audit: landing -> login fungerar utan horisontell overflow', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('a[href="/login"]').first()).toBeVisible({ timeout: 15_000 });

    await assertNoHorizontalOverflow(page, ['html', 'body']);
    await assertCriticalControlsInViewport(page, ['a[href="/login"]']);
    await assertTapTargetMinimum(page, ['a[href="/login"]']);

    await page.locator('a[href="/login"]').first().click();
    await page.waitForURL('**/login', { timeout: 15_000 });
    await expect(page.locator('#login-form')).toBeVisible();

    await assertNoHorizontalOverflow(page, ['html', 'body', '.container', '.glass-card']);
    await assertCriticalControlsInViewport(page, ['#full-name', '#email', '#submit-btn']);
    await assertTapTargetMinimum(page, ['#submit-btn']);
});

test('responsive core audit: app-shell + search modal + sidebar fungerar per viewport', async ({ page }) => {
    test.skip(!HAS_SUPABASE_ADMIN, 'Kräver SUPABASE_SERVICE_ROLE_KEY (lokal Supabase setup).');

    const email = `responsive-shell+${Date.now()}@example.com`;
    const fullName = 'Responsive Shell Audit';
    await loginWithMagicLink(page, email, fullName);
    await mockSearchRoute(page);

    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 20_000 });

    const overlayViewport = isOverlaySidebarViewport(page);
    const sidebarToggleTopbar = page.locator('#sidebar-toggle');
    const sidebarToggleSidebar = page.locator('#sidebar-toggle-sidebar');
    const searchTopbar = page.locator('#search-btn');
    const searchSidebar = page.locator('#search-btn-sidebar');

    if (overlayViewport) {
        await expect(sidebarToggleTopbar).toBeVisible();
        await expect(searchTopbar).toBeVisible();
    } else {
        await expect(sidebarToggleTopbar).toBeHidden();
        await expect(searchTopbar).toBeHidden();
        await expect(sidebarToggleSidebar).toBeVisible();
        await expect(searchSidebar).toBeVisible();
    }

    const sidebarToggleSelector = overlayViewport ? '#sidebar-toggle' : '#sidebar-toggle-sidebar';
    const searchSelector = overlayViewport ? '#search-btn' : '#search-btn-sidebar';

    await assertNoHorizontalOverflow(page, ['html', 'body', '.app-layout', '.main-content']);
    await assertCriticalControlsInViewport(page, [sidebarToggleSelector, searchSelector]);
    await assertTapTargetMinimum(page, [sidebarToggleSelector, searchSelector, '#new-chat-btn']);

    await page.click(sidebarToggleSelector);
    if (overlayViewport) {
        await expect(page.locator('.sidebar.overlay.open')).toBeVisible();
        await expect(page.locator('.sidebar-backdrop.visible')).toBeVisible();
        await page.locator('.sidebar-backdrop').click({ force: true });
        await expect(page.locator('.sidebar.overlay.open')).toHaveCount(0);
    } else {
        await expect(page.locator('.app-layout')).toHaveClass(/sidebar-collapsed/);
        await page.click(sidebarToggleSelector);
        await expect(page.locator('.app-layout')).not.toHaveClass(/sidebar-collapsed/);
    }

    await page.click(searchSelector);
    await expect(page.locator('.search-modal')).toBeVisible();
    await assertCriticalControlsInViewport(page, ['.search-modal__input', '.search-modal__action']);
    await assertTapTargetMinimum(page, ['.search-modal__action']);

    const searchInput = page.locator('.search-modal__input');
    await searchInput.click();
    await searchInput.pressSequentially('moms', { delay: 20 });
    await expect(searchInput).toHaveValue('moms');
    await page.waitForResponse((resp) =>
        resp.request().method() === 'POST' && resp.url().includes('/functions/v1/memory-service')
    );
    await expect(page.locator('.search-modal__result-title')).toContainText('Momsfråga');

    await page.keyboard.press('Escape');
    await expect(page.locator('.search-modal')).toHaveCount(0);
});

test('responsive core audit: fortnox-sidebar renderar desktop-panel vs mobile bottom-sheet', async ({ page }) => {
    test.skip(!HAS_SUPABASE_ADMIN, 'Kräver SUPABASE_SERVICE_ROLE_KEY (lokal Supabase setup).');

    const email = `responsive-fortnox+${Date.now()}@example.com`;
    const fullName = 'Responsive Fortnox Audit';
    await loginWithMagicLink(page, email, fullName);

    const sidebarExists = await page.evaluate(() => {
        const sidebar = document.getElementById('fortnox-sidebar');
        if (!sidebar) return false;

        sidebar.classList.add('open');
        document.querySelector('.app-layout')?.classList.add('fortnox-sidebar-open');
        return true;
    });

    expect(sidebarExists, 'Saknar #fortnox-sidebar i app-shell').toBe(true);
    await expect(page.locator('#fortnox-sidebar')).toBeVisible();

    const metrics = await page.evaluate(() => {
        const sidebar = document.getElementById('fortnox-sidebar');
        if (!sidebar) return null;

        const rect = sidebar.getBoundingClientRect();
        const style = window.getComputedStyle(sidebar);

        return {
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            top: Math.round(rect.top),
            left: Math.round(rect.left),
            rightGap: Math.round(window.innerWidth - rect.right),
            bottomGap: Math.round(window.innerHeight - rect.bottom),
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            position: style.position
        };
    });

    expect(metrics).not.toBeNull();
    if (!metrics) return;

    expect(metrics.position).toBe('fixed');

    if (isMobileViewport(page)) {
        expect(metrics.left).toBeGreaterThanOrEqual(0);
        expect(metrics.rightGap).toBeLessThanOrEqual(2);
        expect(metrics.bottomGap).toBeLessThanOrEqual(2);
        expect(metrics.width).toBeGreaterThanOrEqual(metrics.viewportWidth - 2);
        expect(metrics.height).toBeLessThanOrEqual(metrics.viewportHeight);
        expect(metrics.top).toBeGreaterThan(0);
    } else {
        expect(metrics.top).toBeLessThanOrEqual(2);
        expect(metrics.rightGap).toBeLessThanOrEqual(2);
        expect(metrics.bottomGap).toBeLessThanOrEqual(2);
        expect(metrics.width).toBeGreaterThanOrEqual(300);
        expect(metrics.width).toBeLessThanOrEqual(340);
    }
});

test('responsive core audit: PWA metadata är konsekvent för Web + PWA', async ({ request, page }) => {
    const appResponse = await request.get('/app/');
    expect(appResponse.ok()).toBeTruthy();
    const appHtml = await appResponse.text();

    expect(appHtml).toContain('<link rel="manifest" href="/manifest.json">');
    expect(appHtml).toContain('viewport-fit=cover');
    expect(appHtml).toContain('apple-mobile-web-app-status-bar-style');

    const manifestResponse = await request.get('/manifest.json');
    expect(manifestResponse.ok()).toBeTruthy();
    const manifest = await manifestResponse.json() as {
        display?: string;
        start_url?: string;
        icons?: Array<{ src?: string }>;
        orientation?: string;
    };

    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/app/');
    expect(manifest.orientation).toBe('portrait-primary');
    expect(Array.isArray(manifest.icons)).toBeTruthy();
    expect((manifest.icons || []).length).toBeGreaterThan(0);
    expect((manifest.icons || []).every((icon) => Boolean(icon.src))).toBeTruthy();

    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('domcontentloaded');
    const serviceWorkerSummary = await page.evaluate(async () => {
        if (!('serviceWorker' in navigator)) {
            return { supported: false, registrations: 0, error: null as string | null };
        }

        try {
            const registrations = await navigator.serviceWorker.getRegistrations();
            return {
                supported: true,
                registrations: registrations.length,
                error: null as string | null
            };
        } catch (error) {
            return {
                supported: true,
                registrations: -1,
                error: String(error)
            };
        }
    });

    if (serviceWorkerSummary.supported && serviceWorkerSummary.registrations >= 0) {
        expect(serviceWorkerSummary.registrations).toBe(0);
    }
});

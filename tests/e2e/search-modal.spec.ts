import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const MAILPIT_URL = process.env.MAILPIT_URL || 'http://127.0.0.1:54324';
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MAILPIT_TIMEOUT_MS = Number(process.env.MAILPIT_TIMEOUT_MS || 15_000);
const USE_MAILPIT = process.env.USE_MAILPIT === 'true';
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const hasEmail = (message: Record<string, unknown>, email: string): boolean => {
    const candidate = message.To ?? message.to ?? message.Recipients ?? message.recipients ?? '';
    return JSON.stringify(candidate).toLowerCase().includes(email.toLowerCase());
};

const fetchMessagePayload = async (request: APIRequestContext, id: string): Promise<string> => {
    const urls = [
        `${MAILPIT_URL}/api/v1/messages/${id}`,
        `${MAILPIT_URL}/api/v1/message/${id}`
    ];

    for (const url of urls) {
        const response = await request.get(url);
        if (!response.ok()) continue;
        const text = await response.text();
        return text;
    }

    throw new Error(`Could not fetch Mailpit message payload for ${id}`);
};

const extractMagicLink = (payloadText: string): string | null => {
    let combined = payloadText;
    try {
        const payload = JSON.parse(payloadText) as Record<string, unknown>;
        const html = payload.HTML ?? payload.html ?? (payload as { Body?: { HTML?: string } }).Body?.HTML;
        const text = payload.Text ?? payload.text ?? (payload as { Body?: { Text?: string } }).Body?.Text;
        combined = `${JSON.stringify(html)}\n${JSON.stringify(text)}`;
    } catch {
        // Non-JSON payload; fall back to raw text
    }

    const links = (combined.match(/https?:\/\/[^\s"'()]+/g) || []).map((link) =>
        link.replace(/&amp;/g, '&')
    );

    return (
        links.find((link) => link.includes('/auth/v1/verify') || link.includes('type=magiclink')) ||
        links.find((link) => link.includes('/login')) ||
        null
    );
};

const generateMagicLink = async (email: string): Promise<string> => {
    if (!SUPABASE_SERVICE_ROLE_KEY) {
        throw new Error('SUPABASE_SERVICE_ROLE_KEY missing for admin magic link generation');
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
        type: 'magiclink',
        email,
        options: {
            redirectTo: `${BASE_URL}/login`
        }
    });

    if (error || !data?.properties?.action_link) {
        throw error || new Error('Failed to generate magic link');
    }

    return data.properties.action_link;
};

const waitForMagicLink = async (request: APIRequestContext, email: string, timeoutMs = 60_000): Promise<string> => {
    if (SUPABASE_SERVICE_ROLE_KEY && !USE_MAILPIT) {
        return generateMagicLink(email);
    }

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const response = await request.get(`${MAILPIT_URL}/api/v1/messages`);
        if (response.ok()) {
            const data = await response.json() as { messages?: Record<string, unknown>[] };
            const messages = data.messages || [];
            const match = messages.find((message) => hasEmail(message, email));
            if (match) {
                const id = String(match.ID ?? match.id ?? '');
                if (id) {
                    const payload = await fetchMessagePayload(request, id);
                    const link = extractMagicLink(payload);
                    if (link) return link;
                }
            }
        }

        if (Date.now() - start > MAILPIT_TIMEOUT_MS && SUPABASE_SERVICE_ROLE_KEY) {
            return generateMagicLink(email);
        }

        await sleep(1000);
    }

    throw new Error(`Timed out waiting for magic link to ${email}`);
};

const acceptLegalConsentModalIfVisible = async (page: Page, fullName: string): Promise<void> => {
    const continueButton = page.getByRole('button', { name: 'Godkänn & Fortsätt' });
    const visibleNow = await continueButton.isVisible().catch(() => false);
    if (!visibleNow) {
        const appeared = await continueButton
            .waitFor({ state: 'visible', timeout: 5_000 })
            .then(() => true)
            .catch(() => false);
        if (!appeared) return;
    }

    const nameInput = page.getByPlaceholder('T.ex. Anna Andersson');
    if (await nameInput.isVisible().catch(() => false)) {
        await nameInput.fill(fullName);
    }

    const consentCheckbox = page.getByRole('checkbox', {
        name: 'Jag godkänner Användarvillkor och Integritetspolicy.',
    });
    await expect(consentCheckbox).toBeVisible({ timeout: 10_000 });
    await consentCheckbox.check();
    await expect(continueButton).toBeEnabled({ timeout: 10_000 });
    await continueButton.click();
    await expect(continueButton).toBeHidden({ timeout: 15_000 });
};

test('search modal shows results from memory-service', async ({ page, request }) => {
    const email = `e2e+${Date.now()}@example.com`;
    const fullName = 'E2E Test';

    await page.goto('/login');
    const shouldUseAdminMagicLink = Boolean(SUPABASE_SERVICE_ROLE_KEY) && !USE_MAILPIT;

    let loginLink: string;
    if (shouldUseAdminMagicLink) {
        // Avoid double user creation (UI /otp + admin generateLink), which can break on newer GoTrue.
        loginLink = await generateMagicLink(email);
    } else {
        await page.fill('#full-name', fullName);
        await page.fill('#email', email);
        await page.check('#consent-terms');
        await page.click('#submit-btn');
        loginLink = await waitForMagicLink(request, email);
    }

    await page.goto(loginLink);
    await page.waitForURL('**/app/**', { timeout: 30_000 });
    await acceptLegalConsentModalIfVisible(page, fullName);

    await page.route('**/functions/v1/memory-service', async (route) => {
        const requestData = route.request();
        if (requestData.method() !== 'POST') {
            await route.continue();
            return;
        }

        let payload: Record<string, unknown> = {};
        try {
            payload = JSON.parse(requestData.postData() || '{}') as Record<string, unknown>;
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

    await expect(page.locator('#search-btn')).toBeVisible();
    await page.click('#search-btn');
    const input = page.locator('.search-modal__input');
    await expect(input).toBeVisible();

    // More reliable than `.fill()` here (preact controlled input + debounce)
    await input.click();
    await input.pressSequentially('moms', { delay: 30 });
    await expect(input).toHaveValue('moms');

    // Wait for the debounced backend call to complete (mocked via route below).
    await page.waitForResponse((resp) =>
        resp.request().method() === 'POST' && resp.url().includes('/functions/v1/memory-service')
    );
    await expect(page.locator('.search-modal__result-title')).toContainText('Momsfråga');
});

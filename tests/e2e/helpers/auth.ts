import { expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { CURRENT_TERMS_VERSION } from '../../../apps/web/src/constants/termsVersion';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173';
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const AUTH_HEALTH_URL = `${SUPABASE_URL}/auth/v1/health`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isTransientNetworkError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    return /(fetch failed|failed to fetch|econnrefused|enotfound|network|authretryablefetcherror)/i.test(error.message);
}

async function waitForAuthHealth(timeoutMs = 30_000): Promise<void> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        const ok = await fetch(AUTH_HEALTH_URL, { method: 'GET' })
            .then((response) => response.ok)
            .catch(() => false);
        if (ok) return;
        await sleep(500);
    }

    throw new Error(`Supabase auth health-check timed out: ${AUTH_HEALTH_URL}`);
}

function getAdminClient(): SupabaseClient {
    if (!SUPABASE_SERVICE_ROLE_KEY) {
        throw new Error(
            'SUPABASE_SERVICE_ROLE_KEY saknas. Kör "npm run supabase:setup" och försök igen.'
        );
    }

    return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
        },
    });
}

export async function generateMagicLinkWithUser(email: string): Promise<{ actionLink: string; userId: string }> {
    const admin = getAdminClient();
    await waitForAuthHealth();

    const maxAttempts = 4;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            const { data, error } = await admin.auth.admin.generateLink({
                type: 'magiclink',
                email,
                options: {
                    redirectTo: `${BASE_URL}/login`,
                },
            });

            if (error || !data?.properties?.action_link) {
                throw error || new Error('Kunde inte generera magic link.');
            }

            const userId = data.user?.id;
            if (!userId) {
                throw new Error('Kunde inte läsa userId från generateLink-svar.');
            }

            return {
                actionLink: data.properties.action_link,
                userId,
            };
        } catch (error) {
            if (!isTransientNetworkError(error) || attempt === maxAttempts) {
                throw error;
            }
            await sleep(700 * attempt);
        }
    }

    throw new Error('Kunde inte generera magic link efter retries.');
}

export async function acceptLegalConsentModalIfVisible(page: Page, fullName: string): Promise<void> {
    const continueButton = page.getByRole('button', { name: 'Godkänn & Fortsätt' });
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
        const visible = await continueButton.isVisible().catch(() => false);
        if (!visible) {
            await sleep(300);
            continue;
        }

        const nameInput = page.getByPlaceholder('T.ex. Anna Andersson');
        if (await nameInput.isVisible().catch(() => false)) {
            await nameInput.fill(fullName);
        }

        const consentCheckboxes = page.getByRole('checkbox', { name: /Jag godkänner Användarvillkor/i });
        const checkboxCount = await consentCheckboxes.count();
        let checked = false;
        for (let i = 0; i < checkboxCount; i += 1) {
            const checkbox = consentCheckboxes.nth(i);
            const checkboxVisible = await checkbox.isVisible().catch(() => false);
            if (!checkboxVisible) continue;
            await checkbox.check({ force: true });
            checked = true;
            break;
        }

        if (!checked) {
            throw new Error('Kunde inte hitta synlig checkbox för legal consent.');
        }

        for (let attempt = 0; attempt < 3; attempt += 1) {
            await expect(continueButton).toBeEnabled({ timeout: 10_000 });
            await continueButton.click();

            const hidden = await continueButton
                .waitFor({ state: 'hidden', timeout: 7000 })
                .then(() => true)
                .catch(() => false);

            if (hidden) return;

            const hasSaveError = await page
                .getByText('Kunde inte spara ditt godkännande. Försök igen.')
                .isVisible()
                .catch(() => false);
            if (!hasSaveError) {
                break;
            }
        }

        await sleep(300);
    }
}

async function seedLocalConsent(page: Page, fullName: string): Promise<void> {
    const acceptedAt = new Date().toISOString();
    await page.evaluate(({ fullNameValue, acceptedAtValue, versionValue }) => {
        localStorage.setItem('has_accepted_terms_local', 'true');
        localStorage.setItem('user_full_name_local', fullNameValue);
        localStorage.setItem('terms_accepted_at_local', acceptedAtValue);
        localStorage.setItem('terms_version_local', versionValue);
        localStorage.setItem('legal_acceptances_local', JSON.stringify({
            acceptedAt: acceptedAtValue,
            version: versionValue,
            docs: ['terms', 'privacy', 'dpa'],
            dpaAuthorized: true,
            userAgent: navigator.userAgent
        }));
    }, {
        fullNameValue: fullName,
        acceptedAtValue: acceptedAt,
        versionValue: CURRENT_TERMS_VERSION,
    });
}

export async function loginWithMagicLink(
    page: Page,
    email: string,
    fullName: string
): Promise<{ userId: string }> {
    const { actionLink, userId } = await generateMagicLinkWithUser(email);

    const maxAttempts = 3;
    let enteredApp = false;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            await page.goto('/login');
            await seedLocalConsent(page, fullName);
            await page.goto(actionLink);
            await page.waitForURL('**/app/**', { timeout: 30_000 });
            enteredApp = true;
            break;
        } catch (error) {
            if (attempt === maxAttempts || !isTransientNetworkError(error)) {
                throw error;
            }
            await sleep(600 * attempt);
        }
    }

    if (!enteredApp) {
        throw new Error('Kunde inte navigera till appen via magic link.');
    }

    await acceptLegalConsentModalIfVisible(page, fullName);

    return { userId };
}

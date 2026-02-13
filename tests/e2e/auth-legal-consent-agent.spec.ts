import { test, expect } from '@playwright/test';
import { CURRENT_TERMS_VERSION } from '../../apps/web/src/constants/termsVersion';
import { generateMagicLinkWithUser, loginWithMagicLink } from './helpers/auth';
import {
    countLegalAcceptances,
    deleteLegalAcceptancesForVersion,
    upsertProfile,
    waitForProfile,
} from './helpers/profile';

const REQUIRED_DOCS = ['terms', 'privacy'];

test('auth/legal consent-agent verifierar sync + re-consent vid utdaterad version', async ({ page }) => {
    const email = `auth-legal-agent+${Date.now()}@example.com`;
    const fullName = 'Auth Legal Agent';

    const { userId } = await loginWithMagicLink(page, email, fullName);

    await waitForProfile(
        userId,
        (profile) => profile?.has_accepted_terms === true && profile?.terms_version === CURRENT_TERMS_VERSION
    );

    await expect
        .poll(
            async () => countLegalAcceptances(userId, CURRENT_TERMS_VERSION, REQUIRED_DOCS),
            { timeout: 15_000, message: 'Saknar legal_acceptances för aktuell terms-version' }
        )
        .toBeGreaterThanOrEqual(2);

    await upsertProfile(userId, {
        has_accepted_terms: true,
        terms_version: '1.2.0',
        full_name: fullName,
    });
    await deleteLegalAcceptancesForVersion(userId, CURRENT_TERMS_VERSION);

    const { actionLink } = await generateMagicLinkWithUser(email);
    await page.goto('/login');
    await page.goto(actionLink);
    await page.waitForURL('**/app/**', { timeout: 30_000 });

    const modal = page.getByTestId('legal-consent-modal');
    await expect(modal).toBeVisible({ timeout: 20_000 });
    const fullNameInput = modal.getByTestId('legal-consent-full-name');
    if (await fullNameInput.count()) {
        await expect(fullNameInput).toHaveValue(fullName);
    } else {
        await expect(modal.getByText(fullName)).toBeVisible();
    }
    await modal.getByTestId('legal-consent-checkbox').check({ force: true });
    await modal.getByTestId('legal-consent-accept-button').click();
    await expect(modal).toBeHidden({ timeout: 20_000 });

    await waitForProfile(
        userId,
        (profile) => profile?.terms_version === CURRENT_TERMS_VERSION && profile?.has_accepted_terms === true
    );

    await expect
        .poll(
            async () => countLegalAcceptances(userId, CURRENT_TERMS_VERSION, REQUIRED_DOCS),
            { timeout: 15_000, message: 'Re-consent skapade inte legal_acceptances för aktuell version' }
        )
        .toBeGreaterThanOrEqual(2);
});

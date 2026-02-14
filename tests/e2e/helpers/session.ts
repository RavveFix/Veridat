import type { Page } from '@playwright/test';

export async function getAccessToken(page: Page): Promise<string> {
    const token = await page.evaluate(() => {
        const authKey = Object.keys(localStorage).find((key) =>
            key.startsWith('sb-') && key.endsWith('-auth-token')
        );

        if (!authKey) return null;
        const raw = localStorage.getItem(authKey);
        if (!raw) return null;

        try {
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            if (typeof parsed.access_token === 'string') {
                return parsed.access_token;
            }

            const currentSession = parsed.currentSession as Record<string, unknown> | undefined;
            if (currentSession && typeof currentSession.access_token === 'string') {
                return currentSession.access_token;
            }

            const session = parsed.session as Record<string, unknown> | undefined;
            if (session && typeof session.access_token === 'string') {
                return session.access_token;
            }
        } catch {
            return null;
        }

        return null;
    });

    if (!token) {
        throw new Error('Kunde inte läsa access token från localStorage.');
    }

    return token;
}

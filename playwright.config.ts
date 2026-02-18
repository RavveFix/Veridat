import { defineConfig, devices } from '@playwright/test';
import { existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT_DIR = dirname(fileURLToPath(import.meta.url));

const loadEnvFile = (fileName: string): void => {
    const filePath = resolve(ROOT_DIR, fileName);
    if (!existsSync(filePath)) return;

    const contents = readFileSync(filePath, 'utf8');
    for (const line of contents.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex === -1) continue;

        const key = trimmed.slice(0, eqIndex).trim();
        let value = trimmed.slice(eqIndex + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }

        if (!process.env[key]) {
            process.env[key] = value;
        }
    }
};

loadEnvFile('.env.local');
loadEnvFile('.env');

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173';

export default defineConfig({
    testDir: 'tests/e2e',
    timeout: 60_000,
    expect: {
        timeout: 10_000
    },
    workers: 1,
    retries: process.env.CI ? 2 : 0,
    reporter: 'list',
    use: {
        baseURL,
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure'
    },
    projects: [
        {
            name: 'desktop-chromium',
            use: {
                browserName: 'chromium',
                viewport: { width: 1440, height: 900 },
                isMobile: false,
                hasTouch: false
            }
        },
        {
            name: 'tablet-chromium',
            use: {
                browserName: 'chromium',
                viewport: { width: 1024, height: 1366 },
                isMobile: false,
                hasTouch: true
            }
        },
        {
            name: 'mobile-chromium',
            use: {
                browserName: 'chromium',
                viewport: { width: 412, height: 915 },
                screen: { width: 412, height: 915 },
                isMobile: true,
                hasTouch: true,
                deviceScaleFactor: 3
            }
        },
        {
            name: 'mobile-webkit',
            use: {
                ...devices['iPhone 12'],
                browserName: 'webkit'
            }
        }
    ]
});

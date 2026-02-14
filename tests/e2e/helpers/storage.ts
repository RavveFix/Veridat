import type { Page } from '@playwright/test';

const STORAGE_KEYS = {
    invoiceInbox: 'veridat_invoice_inbox',
    reconciledPeriods: 'veridat_reconciled_periods',
    currentCompanyId: 'currentCompanyId',
} as const;

export interface SeedInvoiceInboxItem {
    id: string;
    companyId: string;
    source: 'upload' | 'fortnox';
    fileName?: string;
    supplierName?: string;
    invoiceNumber?: string;
    invoiceDate?: string;
    dueDate?: string;
    totalAmount?: number;
    vatAmount?: number;
    vatRate?: number;
    status: 'ny' | 'granskad' | 'bokford' | 'betald';
    uploadedAt: string;
    aiExtracted?: boolean;
    fortnoxSyncStatus?: 'not_exported' | 'exported' | 'booked' | 'attested';
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function getCurrentCompanyId(page: Page): Promise<string> {
    for (let i = 0; i < 10; i += 1) {
        try {
            await page.waitForLoadState('domcontentloaded');
            const companyId = await page.evaluate(
                (key) => localStorage.getItem(key),
                STORAGE_KEYS.currentCompanyId
            );
            if (companyId) {
                return companyId;
            }
        } catch (err) {
            if (i === 9) {
                throw new Error(`getCurrentCompanyId failed after 10 attempts: ${String(err)}`);
            }
            // Retry on transient execution-context/navigation races.
        }

        await sleep(250);
    }

    throw new Error('Kunde inte läsa currentCompanyId från localStorage.');
}

export async function seedInvoiceInbox(
    page: Page,
    companyId: string,
    items: SeedInvoiceInboxItem[]
): Promise<void> {
    await page.evaluate(({ key, targetCompanyId, nextItems }) => {
        try {
            const raw = localStorage.getItem(key);
            const parsed = raw ? JSON.parse(raw) : {};
            const store = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown[]> : {};
            store[targetCompanyId] = nextItems;
            localStorage.setItem(key, JSON.stringify(store));
        } catch {
            localStorage.setItem(key, JSON.stringify({ [targetCompanyId]: nextItems }));
        }
    }, {
        key: STORAGE_KEYS.invoiceInbox,
        targetCompanyId: companyId,
        nextItems: items,
    });
}

export async function readReconciledPeriods(page: Page, companyId: string): Promise<string[]> {
    return await page.evaluate(({ key, targetCompanyId }) => {
        try {
            const raw = localStorage.getItem(key);
            const parsed = raw ? JSON.parse(raw) : {};
            if (!parsed || typeof parsed !== 'object') return [];
            const value = (parsed as Record<string, unknown>)[targetCompanyId];
            return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
        } catch {
            return [];
        }
    }, {
        key: STORAGE_KEYS.reconciledPeriods,
        targetCompanyId: companyId,
    });
}

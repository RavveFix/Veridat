import { expect, type Page } from '@playwright/test';

interface OverflowIssue {
    selector: string;
    scrollWidth: number;
    clientWidth: number;
}

interface ElementBox {
    selector: string;
    box: { x: number; y: number; width: number; height: number };
}

const DEFAULT_OVERFLOW_SELECTORS = ['html', 'body'];

async function getViewportSize(page: Page): Promise<{ width: number; height: number }> {
    const configured = page.viewportSize();
    if (configured) {
        return configured;
    }

    return await page.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
    }));
}

async function firstVisibleElementBox(page: Page, selector: string): Promise<ElementBox | null> {
    const locator = page.locator(selector);
    const count = await locator.count();

    for (let index = 0; index < count; index += 1) {
        const candidate = locator.nth(index);
        const isVisible = await candidate.isVisible().catch(() => false);
        if (!isVisible) continue;

        const box = await candidate.boundingBox();
        if (!box) continue;

        return {
            selector,
            box: {
                x: box.x,
                y: box.y,
                width: box.width,
                height: box.height,
            },
        };
    }

    return null;
}

export async function assertNoHorizontalOverflow(
    page: Page,
    selectors: string[] = DEFAULT_OVERFLOW_SELECTORS,
    allowedSlackPx = 1
): Promise<void> {
    const issues = await page.evaluate(({ targets, slack }) => {
        const results: OverflowIssue[] = [];
        for (const selector of targets) {
            const element = document.querySelector(selector);
            if (!element) continue;

            const scrollWidth = Math.ceil(element.scrollWidth);
            const clientWidth = Math.ceil((element as HTMLElement).clientWidth || 0);
            if (scrollWidth - clientWidth > slack) {
                results.push({ selector, scrollWidth, clientWidth });
            }
        }
        return results;
    }, {
        targets: selectors,
        slack: allowedSlackPx,
    });

    expect(
        issues,
        `Horisontell overflow upptäckt: ${JSON.stringify(issues)}`
    ).toEqual([]);
}

export async function assertCriticalControlsInViewport(
    page: Page,
    selectors: string[],
    marginPx = 0
): Promise<void> {
    const viewport = await getViewportSize(page);

    for (const selector of selectors) {
        const element = await firstVisibleElementBox(page, selector);
        expect(element, `Saknar synlig kontroll för selector: ${selector}`).not.toBeNull();
        if (!element) continue;

        const { box } = element;
        expect(box.x, `Kontroll utanför vänsterkant: ${selector}`).toBeGreaterThanOrEqual(0 - marginPx);
        expect(box.y, `Kontroll utanför överkant: ${selector}`).toBeGreaterThanOrEqual(0 - marginPx);
        expect(box.x + box.width, `Kontroll utanför högerkant: ${selector}`)
            .toBeLessThanOrEqual(viewport.width + marginPx);
        expect(box.y + box.height, `Kontroll utanför nederkant: ${selector}`)
            .toBeLessThanOrEqual(viewport.height + marginPx);
    }
}

export async function assertTapTargetMinimum(
    page: Page,
    selectors: string[],
    minimumPx = 44
): Promise<void> {
    for (const selector of selectors) {
        const element = await firstVisibleElementBox(page, selector);
        expect(element, `Saknar synlig tryckyta för selector: ${selector}`).not.toBeNull();
        if (!element) continue;

        const { width, height } = element.box;
        expect(
            width,
            `Tryckyta för smal (${width}px < ${minimumPx}px): ${selector}`
        ).toBeGreaterThanOrEqual(minimumPx);
        expect(
            height,
            `Tryckyta för låg (${height}px < ${minimumPx}px): ${selector}`
        ).toBeGreaterThanOrEqual(minimumPx);
    }
}

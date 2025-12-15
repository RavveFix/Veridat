/**
 * ThemeController - Handles theme toggle functionality
 *
 * Extracted from main.ts (lines 124-152)
 */

import { ThemeManager } from '../lib/theme';

export class ThemeController {
    private moonIcon: HTMLElement | null = null;
    private sunIcon: HTMLElement | null = null;

    init(): void {
        const themeToggle = document.getElementById('theme-toggle');
        this.moonIcon = document.querySelector('.moon-icon') as HTMLElement;
        this.sunIcon = document.querySelector('.sun-icon') as HTMLElement;

        // Initialize theme state
        ThemeManager.init();
        this.updateIcon(ThemeManager.getCurrentTheme());

        if (themeToggle) {
            themeToggle.addEventListener('click', () => this.toggle());
        }
    }

    toggle(): void {
        const newTheme = ThemeManager.toggle();
        this.updateIcon(newTheme);
    }

    private updateIcon(theme: string): void {
        if (!this.moonIcon || !this.sunIcon) return;

        if (theme === 'light') {
            this.moonIcon.style.display = 'none';
            this.sunIcon.style.display = 'block';
        } else {
            this.moonIcon.style.display = 'block';
            this.sunIcon.style.display = 'none';
        }
    }
}

export const themeController = new ThemeController();

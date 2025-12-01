export class ThemeManager {
    private static readonly THEME_KEY = 'theme';
    private static readonly DARK_THEME = 'dark';
    private static readonly LIGHT_THEME = 'light';

    static init() {
        // The inline script handles the initial paint, but we can double check here
        // or set up listeners if we want to react to system preference changes automatically
        const savedTheme = localStorage.getItem(this.THEME_KEY) || this.DARK_THEME;
        this.applyTheme(savedTheme);
    }

    static toggle(): string {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === this.DARK_THEME ? this.LIGHT_THEME : this.DARK_THEME;

        this.applyTheme(newTheme);
        return newTheme;
    }

    static getCurrentTheme(): string {
        return document.documentElement.getAttribute('data-theme') || this.DARK_THEME;
    }

    private static applyTheme(theme: string) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem(this.THEME_KEY, theme);

        // Dispatch event for other components to react (e.g. charts)
        window.dispatchEvent(new CustomEvent('theme-changed', { detail: { theme } }));
    }
}

/**
 * SidebarController - Handles responsive sidebar toggle functionality
 *
 * Features:
 * - Hamburger menu toggle for small windows (< 1024px)
 * - Collapsible sidebar for medium windows (1024-1280px)
 * - Keyboard shortcut (Cmd/Ctrl+B)
 * - LocalStorage persistence for collapsed state
 */

import { logger } from '../services/LoggerService';

class SidebarControllerService {
    private sidebar: HTMLElement | null = null;
    private appLayout: HTMLElement | null = null;
    private toggleBtn: HTMLElement | null = null;
    private backdrop: HTMLElement | null = null;
    private isCollapsed = false;
    private isOverlay = false;

    private readonly COLLAPSE_BREAKPOINT = 1024;
    private readonly STORAGE_KEY = 'britta-sidebar-collapsed';

    init(): void {
        this.sidebar = document.querySelector('.sidebar');
        this.appLayout = document.querySelector('.app-layout');
        this.toggleBtn = document.getElementById('sidebar-toggle');

        if (!this.sidebar || !this.appLayout) {
            logger.warn('SidebarController: Required elements not found');
            return;
        }

        // Create backdrop element for overlay mode
        this.createBackdrop();

        // Load saved collapsed state
        this.loadSavedState();

        // Set up event listeners
        this.setupEventListeners();

        // Initial viewport check
        this.checkViewport();

        logger.debug('SidebarController initialized');
    }

    private createBackdrop(): void {
        this.backdrop = document.createElement('div');
        this.backdrop.className = 'sidebar-backdrop';
        document.body.appendChild(this.backdrop);

        this.backdrop.addEventListener('click', () => this.closeSidebar());
    }

    private loadSavedState(): void {
        const saved = localStorage.getItem(this.STORAGE_KEY);
        if (saved === 'true') {
            this.isCollapsed = true;
        }
    }

    private setupEventListeners(): void {
        // Toggle button click
        this.toggleBtn?.addEventListener('click', () => this.toggleSidebar());

        // Responsive check on resize (debounced)
        let resizeTimeout: number;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = window.setTimeout(() => this.checkViewport(), 100);
        });

        // Keyboard shortcut (Cmd/Ctrl + B)
        document.addEventListener('keydown', (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
                e.preventDefault();
                this.toggleSidebar();
            }
        });
    }

    private checkViewport(): void {
        const width = window.innerWidth;

        if (width < this.COLLAPSE_BREAKPOINT) {
            // Switch to overlay mode
            this.setOverlayMode(true);
        } else {
            // Standard sidebar mode
            this.setOverlayMode(false);
            this.applyCollapsedState();
        }
    }

    private setOverlayMode(overlay: boolean): void {
        if (!this.sidebar || !this.appLayout) return;

        this.isOverlay = overlay;

        if (overlay) {
            this.appLayout.classList.add('sidebar-hidden');
            this.sidebar.classList.add('overlay');
            this.sidebar.classList.remove('collapsed');
            this.appLayout.classList.remove('sidebar-collapsed');
        } else {
            this.appLayout.classList.remove('sidebar-hidden');
            this.sidebar.classList.remove('overlay', 'open');
            this.backdrop?.classList.remove('visible');
        }
    }

    private applyCollapsedState(): void {
        if (!this.sidebar || !this.appLayout) return;

        if (this.isCollapsed) {
            this.sidebar.classList.add('collapsed');
            this.appLayout.classList.add('sidebar-collapsed');
        } else {
            this.sidebar.classList.remove('collapsed');
            this.appLayout.classList.remove('sidebar-collapsed');
        }
    }

    toggleSidebar(): void {
        if (this.isOverlay) {
            // In overlay mode, open/close the sidebar
            this.sidebar?.classList.toggle('open');
            this.backdrop?.classList.toggle('visible');
        } else {
            // In standard mode, collapse/expand
            this.isCollapsed = !this.isCollapsed;
            localStorage.setItem(this.STORAGE_KEY, String(this.isCollapsed));
            this.applyCollapsedState();
        }
    }

    closeSidebar(): void {
        if (this.isOverlay) {
            this.sidebar?.classList.remove('open');
            this.backdrop?.classList.remove('visible');
        }
    }

    openSidebar(): void {
        if (this.isOverlay) {
            this.sidebar?.classList.add('open');
            this.backdrop?.classList.add('visible');
        } else if (this.isCollapsed) {
            this.isCollapsed = false;
            localStorage.setItem(this.STORAGE_KEY, 'false');
            this.applyCollapsedState();
        }
    }

    isCurrentlyCollapsed(): boolean {
        return this.isCollapsed;
    }

    isCurrentlyOverlay(): boolean {
        return this.isOverlay;
    }
}

export const sidebarController = new SidebarControllerService();

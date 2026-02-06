/**
 * Veridat Application Entry Point
 *
 * This file bootstraps the application by initializing the AppController.
 * All business logic has been extracted to controllers in src/controllers/.
 */

import { appController } from './controllers/AppController';
import { logger } from './services/LoggerService';
import { companyManager } from './services/CompanyService';

// Styles
import './styles/main.css';
import './styles/components/vat-card.css';
import './styles/components/voice-input.css';
import './styles/components/ui.css';
import './styles/components/artifact-cards.css';
import './styles/components/memory.css';
import './styles/components/excel-artifact.css';
import './styles/components/thinking-steps.css';
import './styles/components/fortnox-sidebar.css';
import './styles/components/smart-actions.css';
import './styles/components/skills-hub.css';

logger.debug('main.ts module loading...');

const isEditableTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName.toLowerCase();
    if (['input', 'textarea', 'select'].includes(tag)) return true;
    return target.isContentEditable;
};

const updateDebugGridVars = () => {
    const workspace = document.querySelector('.workspace-split') as HTMLElement | null;
    if (!workspace) return;

    const rootStyles = getComputedStyle(document.documentElement);
    const maxWidthValue = parseFloat(rootStyles.getPropertyValue('--content-max-width')) || workspace.clientWidth;
    const gutterValue = parseFloat(rootStyles.getPropertyValue('--space-4')) || 16;
    const columns = 12;

    const width = workspace.clientWidth;
    const gridWidth = Math.min(width, maxWidthValue);
    const columnWidth = Math.max(1, (gridWidth - (columns - 1) * gutterValue) / columns);
    const offset = Math.max(0, (width - gridWidth) / 2);

    workspace.style.setProperty('--debug-grid-column-width', `${columnWidth}px`);
    workspace.style.setProperty('--debug-grid-gutter', `${gutterValue}px`);
    workspace.style.setProperty('--debug-grid-offset', `${offset}px`);
};

const setDebugGrid = (enabled: boolean) => {
    document.body.classList.toggle('debug-grid', enabled);
    localStorage.setItem('debug-grid', enabled ? '1' : '0');
    updateDebugGridVars();

    const gridButton = document.getElementById('grid-toggle-btn');
    if (gridButton) {
        gridButton.classList.toggle('active', enabled);
        gridButton.setAttribute('aria-pressed', enabled ? 'true' : 'false');
        gridButton.setAttribute('title', enabled ? 'Dölj rutnät' : 'Visa rutnät');
    }
};

const applyDebugGrid = () => {
    try {
        const params = new URLSearchParams(window.location.search);
        const queryValue = params.get('grid');
        const storedValue = localStorage.getItem('debug-grid');

        let enabled = false;
        if (queryValue !== null) {
            enabled = ['1', 'true', 'on'].includes(queryValue);
        } else if (storedValue !== null) {
            enabled = storedValue === '1';
        } else {
            enabled = import.meta.env.DEV;
        }

        setDebugGrid(enabled);
    } catch (error) {
        logger.debug('Debug grid setup skipped', error);
    }
};

const handleDebugGridToggle = (event: KeyboardEvent) => {
    if (event.repeat) return;
    if (isEditableTarget(event.target)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key.toLowerCase() !== 'g') return;

    event.preventDefault();
    const enabled = !document.body.classList.contains('debug-grid');
    setDebugGrid(enabled);
};

const initDebugGrid = () => {
    applyDebugGrid();
    window.addEventListener('resize', updateDebugGridVars);
    window.addEventListener('keydown', handleDebugGridToggle);

    const gridButton = document.getElementById('grid-toggle-btn');
    if (gridButton) {
        gridButton.addEventListener('click', () => {
            const enabled = !document.body.classList.contains('debug-grid');
            setDebugGrid(enabled);
        });
    }
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDebugGrid);
} else {
    initDebugGrid();
}

// Initialize company manager
companyManager.init();

// Execute initialization
logger.debug('main.ts module loaded', { readyState: document.readyState });

try {
    if (document.readyState !== 'complete') {
        logger.debug('Waiting for window.onload');
        window.addEventListener('load', () => {
            logger.debug('window.onload fired, calling appController.init');
            appController.init();
        });
    } else {
        logger.debug('DOM already complete, calling appController.init immediately');
        appController.init();
    }
} catch (error) {
    logger.error('Error in main.ts initialization', error);
}

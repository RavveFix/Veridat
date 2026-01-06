/**
 * Britta Application Entry Point
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

logger.debug('main.ts module loading...');

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

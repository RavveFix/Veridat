import { CURRENT_TERMS_VERSION, VERSION_HISTORY } from './constants/termsVersion';

function applyLegalMetadata(): void {
    const currentVersion = VERSION_HISTORY[CURRENT_TERMS_VERSION];
    const updatedDate = currentVersion?.date;

    if (updatedDate) {
        document.querySelectorAll<HTMLElement>('[data-legal-updated]').forEach((el) => {
            el.textContent = updatedDate;
        });
    }

    document.querySelectorAll<HTMLElement>('[data-legal-version]').forEach((el) => {
        el.textContent = CURRENT_TERMS_VERSION;
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyLegalMetadata);
} else {
    applyLegalMetadata();
}

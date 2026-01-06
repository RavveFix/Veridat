import { FunctionComponent } from 'preact';

interface UpgradeModalProps {
    onClose: () => void;
    resetTime: string | null;
}

export const UpgradeModal: FunctionComponent<UpgradeModalProps> = ({ onClose, resetTime }) => {
    const handleOverlayClick = (e: MouseEvent) => {
        if ((e.target as HTMLElement).classList.contains('upgrade-modal-overlay')) {
            onClose();
        }
    };

    const contactEmail = 'hej@britta.se';
    const emailSubject = encodeURIComponent('Intresserad av Britta Pro');
    const emailBody = encodeURIComponent('Hej!\n\nJag är intresserad av att uppgradera till Britta Pro.\n\nMitt företag:\nAntal anställda:\n\nTack!');

    return (
        <div class="upgrade-modal-overlay" onClick={handleOverlayClick}>
            <div class="upgrade-modal" role="dialog" aria-modal="true" aria-labelledby="upgrade-title">
                <div class="upgrade-modal__header">
                    <div class="upgrade-modal__icon">⚡</div>
                    <div>
                        <h2 id="upgrade-title" class="upgrade-modal__title">Uppgradera till Pro</h2>
                        <p class="upgrade-modal__subtitle">Få mer kraft för ditt företag</p>
                    </div>
                </div>

                {resetTime && (
                    <div class="upgrade-modal__reset-info">
                        <span>⏱️</span>
                        <span>Din gräns återställs kl {resetTime}</span>
                    </div>
                )}

                <div class="upgrade-modal__benefits">
                    <div class="upgrade-modal__benefits-title">Med Pro får du</div>

                    <div class="upgrade-modal__benefit">
                        <div class="upgrade-modal__benefit-icon">✓</div>
                        <div class="upgrade-modal__benefit-text">
                            <strong>40 förfrågningar</strong> per timme (vs 10 gratis)
                        </div>
                    </div>

                    <div class="upgrade-modal__benefit">
                        <div class="upgrade-modal__benefit-icon">✓</div>
                        <div class="upgrade-modal__benefit-text">
                            <strong>200 förfrågningar</strong> per dag (vs 50 gratis)
                        </div>
                    </div>

                    <div class="upgrade-modal__benefit">
                        <div class="upgrade-modal__benefit-icon">✓</div>
                        <div class="upgrade-modal__benefit-text">
                            <strong>Prioriterad support</strong> via e-post
                        </div>
                    </div>

                    <div class="upgrade-modal__benefit">
                        <div class="upgrade-modal__benefit-icon">✓</div>
                        <div class="upgrade-modal__benefit-text">
                            <strong>Avancerad filanalys</strong> för större filer
                        </div>
                    </div>
                </div>

                <div class="upgrade-modal__actions">
                    <button
                        type="button"
                        class="upgrade-modal__btn upgrade-modal__btn--secondary"
                        onClick={onClose}
                    >
                        Vänta
                    </button>
                    <a
                        href={`mailto:${contactEmail}?subject=${emailSubject}&body=${emailBody}`}
                        class="upgrade-modal__btn upgrade-modal__btn--primary"
                    >
                        Kontakta oss
                    </a>
                </div>
            </div>
        </div>
    );
};

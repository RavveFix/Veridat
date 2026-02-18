import type { ComponentChildren } from 'preact';

interface ModalWrapperProps {
    onClose: () => void;
    title: string;
    subtitle?: string;
    children: ComponentChildren;
    maxWidth?: string;
    variant?: 'default' | 'fullscreen';
}

const MODAL_OVERLAY_BASE_STYLE = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'var(--overlay-bg)',
    backdropFilter: 'blur(5px)',
    display: 'flex',
    justifyContent: 'center',
    zIndex: 1000,
    animation: 'fadeIn 0.3s ease-out'
};

const MODAL_CONTENT_BASE_STYLE = {
    background: 'var(--glass-gradient)',
    border: '1px solid var(--surface-border-strong)',
    borderRadius: '16px',
    padding: '2rem',
    width: '100%',
    overflowY: 'auto',
    boxShadow: 'var(--surface-shadow-strong)',
    position: 'relative'
};

const MODAL_CLOSE_BUTTON_STYLE = {
    position: 'absolute',
    top: '1rem',
    right: '1rem',
    background: 'none',
    border: 'none',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    fontSize: '1.5rem',
    padding: '0.5rem',
    lineHeight: 1,
    minWidth: '44px',
    minHeight: '44px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
};

const MODAL_TITLE_BASE_STYLE = {
    marginTop: 0,
    background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    fontSize: '1.8rem'
};

const MODAL_SUBTITLE_STYLE = {
    color: 'var(--text-secondary)',
    marginBottom: '1.5rem',
    fontSize: '0.9rem'
};

function getModalOverlayStyle(isFullscreen: boolean) {
    return {
        ...MODAL_OVERLAY_BASE_STYLE,
        alignItems: isFullscreen ? 'flex-start' : 'center',
        padding: isFullscreen ? '2rem 1.5rem' : '1rem'
    };
}

function getModalContentStyle(isFullscreen: boolean, maxWidth: string) {
    return {
        ...MODAL_CONTENT_BASE_STYLE,
        maxWidth: isFullscreen ? 'min(96vw, 1400px)' : `min(90vw, ${maxWidth})`,
        maxHeight: isFullscreen ? '90vh' : '85vh'
    };
}

function getModalTitleStyle(hasSubtitle: boolean) {
    return {
        ...MODAL_TITLE_BASE_STYLE,
        marginBottom: hasSubtitle ? '0.5rem' : '1.5rem'
    };
}

export function ModalWrapper({ onClose, title, subtitle, children, maxWidth = '500px', variant = 'default' }: ModalWrapperProps) {
    const isFullscreen = variant === 'fullscreen';
    return (
        <div
            className="modal-overlay"
            style={getModalOverlayStyle(isFullscreen)}
            onClick={(e) => {
                if (e.target === e.currentTarget) {
                    onClose();
                }
            }}
        >
            <div
                className="modal-content glass-panel"
                style={getModalContentStyle(isFullscreen, maxWidth)}
            >
                <button
                    onClick={onClose}
                    aria-label="Stäng"
                    style={MODAL_CLOSE_BUTTON_STYLE}
                >
                    &times;
                </button>

                <h2 style={getModalTitleStyle(Boolean(subtitle))}>
                    {title}
                </h2>

                {subtitle && (
                    <p style={MODAL_SUBTITLE_STYLE}>
                        {subtitle}
                    </p>
                )}

                {children}
            </div>
        </div>
    );
}

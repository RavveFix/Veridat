import { useEffect, useRef } from 'preact/hooks';
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
    if (isFullscreen) {
        return {
            ...MODAL_OVERLAY_BASE_STYLE,
            alignItems: 'stretch',
            justifyContent: 'stretch',
            padding: 0
        };
    }

    return {
        ...MODAL_OVERLAY_BASE_STYLE,
        alignItems: 'center',
        padding: 'max(1rem, env(safe-area-inset-top, 1rem)) 1rem max(1rem, env(safe-area-inset-bottom, 1rem))'
    };
}

function getModalContentStyle(isFullscreen: boolean, maxWidth: string) {
    if (isFullscreen) {
        return {
            ...MODAL_CONTENT_BASE_STYLE,
            width: '100vw',
            maxWidth: '100vw',
            height: '100dvh',
            maxHeight: '100dvh',
            borderRadius: 0,
            padding: '1.25rem 1rem 1rem'
        };
    }

    return {
        ...MODAL_CONTENT_BASE_STYLE,
        maxWidth: `min(90vw, ${maxWidth})`,
        maxHeight: 'calc(85vh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))'
    };
}

function getModalTitleStyle(hasSubtitle: boolean) {
    return {
        ...MODAL_TITLE_BASE_STYLE,
        marginBottom: hasSubtitle ? '0.5rem' : '1.5rem'
    };
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function ModalWrapper({ onClose, title, subtitle, children, maxWidth = '500px', variant = 'default' }: ModalWrapperProps) {
    const isFullscreen = variant === 'fullscreen';
    const contentRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const prev = document.activeElement as HTMLElement | null;
        // Auto-focus first focusable element in the modal
        const first = contentRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE)[0];
        first?.focus();

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
                return;
            }
            if (e.key !== 'Tab') return;

            const focusable = Array.from(contentRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
            if (focusable.length === 0) return;

            const firstEl = focusable[0];
            const lastEl = focusable[focusable.length - 1];

            if (e.shiftKey) {
                if (document.activeElement === firstEl) {
                    e.preventDefault();
                    lastEl.focus();
                }
            } else {
                if (document.activeElement === lastEl) {
                    e.preventDefault();
                    firstEl.focus();
                }
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            prev?.focus();
        };
    }, [onClose]);

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
                ref={contentRef}
                className="modal-content glass-panel"
                style={getModalContentStyle(isFullscreen, maxWidth)}
                role="dialog"
                aria-modal="true"
                aria-label={title}
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

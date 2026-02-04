import type { ComponentChildren } from 'preact';

interface ModalWrapperProps {
    onClose: () => void;
    title: string;
    subtitle?: string;
    children: ComponentChildren;
    maxWidth?: string;
    variant?: 'default' | 'fullscreen';
}

export function ModalWrapper({ onClose, title, subtitle, children, maxWidth = '500px', variant = 'default' }: ModalWrapperProps) {
    const isFullscreen = variant === 'fullscreen';
    return (
        <div
            className="modal-overlay"
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'var(--overlay-bg)',
                backdropFilter: 'blur(5px)',
                display: 'flex',
                alignItems: isFullscreen ? 'flex-start' : 'center',
                justifyContent: 'center',
                zIndex: 1000,
                animation: 'fadeIn 0.3s ease-out',
                padding: isFullscreen ? '2rem 1.5rem' : '1rem'
            }}
            onClick={(e) => {
                if (e.target === e.currentTarget) {
                    onClose();
                }
            }}
        >
            <div
                className="modal-content glass-panel"
                style={{
                    background: 'var(--glass-bg)',
                    border: '1px solid var(--glass-border)',
                    borderRadius: '16px',
                    padding: '2rem',
                    width: '100%',
                    maxWidth: isFullscreen ? 'min(96vw, 1400px)' : `min(90vw, ${maxWidth})`,
                    maxHeight: isFullscreen ? '90vh' : '85vh',
                    overflowY: 'auto',
                    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
                    position: 'relative'
                }}
            >
                <button
                    onClick={onClose}
                    aria-label="Stäng"
                    style={{
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
                    }}
                >
                    &times;
                </button>

                <h2 style={{
                    marginTop: 0,
                    marginBottom: subtitle ? '0.5rem' : '1.5rem',
                    background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    fontSize: '1.8rem'
                }}>
                    {title}
                </h2>

                {subtitle && (
                    <p style={{
                        color: 'var(--text-secondary)',
                        marginBottom: '1.5rem',
                        fontSize: '0.9rem'
                    }}>
                        {subtitle}
                    </p>
                )}

                {children}
            </div>
        </div>
    );
}

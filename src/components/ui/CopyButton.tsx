import { FunctionComponent } from 'preact';
import { useState } from 'preact/hooks';
import { showToast } from './Toast';

interface CopyButtonProps {
    text: string;
    className?: string;
}

export const CopyButton: FunctionComponent<CopyButtonProps> = ({ text, className = '' }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            showToast('Kopierat!', 'success');
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            showToast('Kunde inte kopiera', 'error');
        }
    };

    return (
        <button
            class={`copy-btn ${copied ? 'copied' : ''} ${className}`}
            onClick={handleCopy}
            title="Kopiera"
            aria-label="Kopiera kod"
        >
            {copied ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
            ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
            )}
        </button>
    );
};

import { FunctionComponent } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

interface StreamingTextProps {
    content: string;
}

/**
 * StreamingText - ChatGPT/Claude-style streaming text display
 *
 * Shows raw text with a blinking cursor during streaming.
 * Uses direct DOM manipulation to avoid React re-renders.
 * Markdown is NOT parsed here - that happens after streaming completes.
 */
export const StreamingText: FunctionComponent<StreamingTextProps> = ({ content }) => {
    const textRef = useRef<HTMLSpanElement>(null);
    const sanitizeStreamingText = (value: string): string => {
        // Hide markdown separator bursts (e.g., ***** or line-only ***)
        let cleaned = value.replace(/(^|\n)\s*\*{3,}\s*(?=\n|$)/g, '$1');
        // Hide horizontal rules (--- or ___) and code fence lines (```lang)
        cleaned = cleaned.replace(/(^|\n)\s*[-_]{3,}\s*(?=\n|$)/g, '$1');
        cleaned = cleaned.replace(/(^|\n)\s*```.*(?=\n|$)/g, '$1');
        cleaned = cleaned.replace(/(^|\n)\s*~~~.*(?=\n|$)/g, '$1');
        // Replace long asterisk runs inside lines
        cleaned = cleaned.replace(/\*{5,}/g, '—');
        return cleaned;
    };

    // Update text content directly in DOM (bypasses React re-render cycle)
    useEffect(() => {
        if (textRef.current) {
            textRef.current.textContent = sanitizeStreamingText(content);
        }
    }, [content]);

    return (
        <div class="streaming-text">
            <span ref={textRef} class="streaming-content" />
            <span class="streaming-cursor" />
        </div>
    );

};

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

    // Update text content directly in DOM (bypasses React re-render cycle)
    useEffect(() => {
        console.log('✍️ [StreamingText] Content updated:', content?.substring(0, 50));
        if (textRef.current) {
            textRef.current.textContent = content;
        }
    }, [content]);

    return (
        <div class="streaming-text">
            <span ref={textRef} class="streaming-content" />
            <span class="streaming-cursor">▌</span>
        </div>
    );
};

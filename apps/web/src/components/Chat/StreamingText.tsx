import { FunctionComponent } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { markdownInlineToHtml } from '../../utils/markdownParser';

interface StreamingTextProps {
    content: string;
}

/**
 * StreamingText - ChatGPT/Claude-style streaming text display
 *
 * Shows streaming text with a blinking cursor.
 * Uses direct DOM manipulation to avoid React re-renders.
 * Applies lightweight inline markdown formatting during streaming.
 */
export const StreamingText: FunctionComponent<StreamingTextProps> = ({ content }) => {
    const textRef = useRef<HTMLSpanElement>(null);

    const TABLE_ROW_REGEX = /^\s*\|.*\|\s*$/;
    const TABLE_SEPARATOR_REGEX = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;

    const collapseMarkdownTablesForStreaming = (value: string): string => {
        const lines = value.split('\n');
        const result: string[] = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const nextLine = i + 1 < lines.length ? lines[i + 1] : '';

            if (TABLE_ROW_REGEX.test(line) && TABLE_SEPARATOR_REGEX.test(nextLine)) {
                result.push('[Konteringstabell byggs...]');
                i += 1; // Skip separator

                // Skip table body rows while streaming
                while (i + 1 < lines.length && TABLE_ROW_REGEX.test(lines[i + 1])) {
                    i += 1;
                }
                continue;
            }

            if (TABLE_SEPARATOR_REGEX.test(line)) {
                continue;
            }

            result.push(line);
        }

        return result.join('\n');
    };

    const sanitizeStreamingText = (value: string): string => {
        let cleaned = collapseMarkdownTablesForStreaming(value);
        // Hide markdown heading markers (###) during streaming but keep the heading text.
        cleaned = cleaned.replace(/(^|\n)\s{0,3}#{1,6}\s+(?=\S)/g, '$1');
        // Hide markdown separator bursts (e.g., ***** or line-only ***)
        cleaned = cleaned.replace(/(^|\n)\s*\*{3,}\s*(?=\n|$)/g, '$1');
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
            textRef.current.innerHTML = markdownInlineToHtml(sanitizeStreamingText(content));
        }
    }, [content]);

    return (
        <div class="streaming-text">
            <span ref={textRef} class="streaming-content" />
            <span class="streaming-cursor" />
        </div>
    );

};

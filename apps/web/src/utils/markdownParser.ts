/**
 * Enhanced Markdown Parser for AI Responses
 *
 * Supports:
 * - Headers (h1-h6)
 * - Bold, italic, strikethrough
 * - Code (inline and blocks with language detection)
 * - Lists (ordered and unordered)
 * - Tables
 * - Links
 * - Block quotes
 * - Line breaks
 */

import DOMPurify from 'dompurify';
import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';

export interface ParsedContent {
    type: 'text' | 'code' | 'table';
    content: string;
    language?: string;
}

const ALLOWED_TAGS = [
    'strong', 'em', 'code', 'pre', 'br', 'p', 'a', 'ul', 'ol', 'li',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'del', 'hr',
    'table', 'thead', 'tbody', 'tr', 'th', 'td'
];

const ALLOWED_ATTR = ['href', 'target', 'rel', 'class'];

const markdownRenderer = new MarkdownIt({
    html: false,
    linkify: true,
    breaks: true,
    typographer: false
});

const TABLE_ROW_REGEX = /^\s*\|.*\|\s*$/;
const TABLE_SEPARATOR_REGEX = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;

const addClassToToken = (tokens: Token[], idx: number, className: string): void => {
    tokens[idx].attrSet('class', className);
};

const addClassRendererRule = (tokenType: string, className: string): void => {
    const fallback = markdownRenderer.renderer.rules[tokenType]
        || ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

    markdownRenderer.renderer.rules[tokenType] = (tokens, idx, options, env, self) => {
        addClassToToken(tokens, idx, className);
        return fallback(tokens, idx, options, env, self);
    };
};

addClassRendererRule('paragraph_open', 'md-p');
addClassRendererRule('blockquote_open', 'md-quote');
addClassRendererRule('bullet_list_open', 'md-ul');
addClassRendererRule('ordered_list_open', 'md-ol');
addClassRendererRule('table_open', 'md-table');

markdownRenderer.renderer.rules.heading_open = (tokens, idx, options, _env, self) => {
    const headingTag = tokens[idx].tag;
    addClassToToken(tokens, idx, `md-${headingTag}`);
    return self.renderToken(tokens, idx, options);
};

markdownRenderer.renderer.rules.list_item_open = (tokens, idx, options, _env, self) => {
    let className = 'md-li';
    for (let i = idx - 1; i >= 0; i--) {
        if (tokens[i].level < tokens[idx].level) {
            if (tokens[i].type === 'ordered_list_open') {
                className = 'md-li-ordered';
            }
            break;
        }
    }
    addClassToToken(tokens, idx, className);
    return self.renderToken(tokens, idx, options);
};

markdownRenderer.renderer.rules.link_open = (tokens, idx, options, _env, self) => {
    tokens[idx].attrSet('target', '_blank');
    tokens[idx].attrSet('rel', 'noopener noreferrer');
    tokens[idx].attrSet('class', 'md-link');
    return self.renderToken(tokens, idx, options);
};

markdownRenderer.renderer.rules.code_inline = (tokens, idx) => {
    const escaped = markdownRenderer.utils.escapeHtml(tokens[idx].content);
    return `<code class="md-code">${escaped}</code>`;
};

markdownRenderer.renderer.rules.hr = () => '<hr class="md-hr">\n';

function sanitizeHtml(html: string): string {
    return DOMPurify.sanitize(html, {
        ALLOWED_TAGS,
        ALLOWED_ATTR
    });
}

export function markdownInlineToHtml(text: string): string {
    return sanitizeHtml(markdownRenderer.renderInline(text));
}

/**
 * Parse AI response text and extract structured content blocks
 * Returns array of content blocks for special rendering
 */
export function parseAIResponse(text: string): ParsedContent[] {
    const blocks: ParsedContent[] = [];

    // 1. Identify all code blocks and tables with their indices
    const codeBlockRegex = /```(\w+)?\s?\n?([\s\S]*?)```/g;
    const tableRegex = /((?:^|\n)\s*\|.*\|(?:\n|$)\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*(?:\n|$)(?:\s*\|.*\|(?:\n|$))*)/g;

    interface FoundBlock {
        type: 'code' | 'table';
        start: number;
        end: number;
        content: string;
        language?: string;
    }

    const foundBlocks: FoundBlock[] = [];

    // Find code blocks
    let match;
    while ((match = codeBlockRegex.exec(text)) !== null) {
        foundBlocks.push({
            type: 'code',
            start: match.index,
            end: match.index + match[0].length,
            content: match[2].trim(),
            language: match[1] || 'text'
        });
    }

    // Find tables
    while ((match = tableRegex.exec(text)) !== null) {
        const tableContent = match[1].trim();
        if (containsMarkdownTable(tableContent)) {
            foundBlocks.push({
                type: 'table',
                start: match.index,
                end: match.index + match[0].length,
                content: tableContent
            });
        }
    }

    // Sort blocks by start index
    foundBlocks.sort((a, b) => a.start - b.start);

    // 2. Filter out overlapping blocks (e.g. table inside code block)
    const filteredBlocks: FoundBlock[] = [];
    let lastEnd = 0;

    for (const block of foundBlocks) {
        if (block.start >= lastEnd) {
            filteredBlocks.push(block);
            lastEnd = block.end;
        }
    }

    // 3. Construct the actual ParsedContent blocks
    let lastProcessedIndex = 0;

    for (const block of filteredBlocks) {
        // Add text before this block
        if (block.start > lastProcessedIndex) {
            const textBefore = text.slice(lastProcessedIndex, block.start).trim();
            if (textBefore) {
                blocks.push({ type: 'text', content: textBefore });
            }
        }

        // Add the structured block
        blocks.push({
            type: block.type,
            content: block.content,
            language: block.language
        });

        lastProcessedIndex = block.end;
    }

    // Add remaining text
    if (lastProcessedIndex < text.length) {
        const remaining = text.slice(lastProcessedIndex).trim();
        if (remaining) {
            blocks.push({ type: 'text', content: remaining });
        }
    }

    // If no blocks were found, treat entire text as single text block
    if (blocks.length === 0) {
        blocks.push({ type: 'text', content: text });
    }

    return blocks;
}

/**
 * Convert markdown text to sanitized HTML
 * This is an enhanced version with more markdown support
 */
export function markdownToHtml(text: string): string {
    if (!text) return '';

    return sanitizeHtml(markdownRenderer.render(text));
}

/**
 * Parse markdown table to HTML table
 */
export function parseMarkdownTable(text: string): string | null {
    const lines = text
        .trim()
        .split('\n')
        .map(line => line.trimEnd())
        .filter(line => line.trim().length > 0);
    if (lines.length < 2) return null;

    // Check if it looks like a table (has pipes)
    if (!TABLE_ROW_REGEX.test(lines[0])) return null;

    const parseRow = (line: string): string[] => {
        const trimmed = line.trim();
        const normalized = trimmed
            .replace(/^\|/, '')
            .replace(/\|$/, '');

        return normalized.split('|').map(cell => cell.trim());
    };

    // Check for separator row (|---|---|)
    const separatorIndex = lines.findIndex(line => TABLE_SEPARATOR_REGEX.test(line));
    if (separatorIndex === -1) return null;
    if (separatorIndex === 0) return null;

    const headerCells = parseRow(lines[separatorIndex - 1]);
    if (headerCells.length === 0) return null;
    const bodyRows = lines.slice(separatorIndex + 1).filter(line => TABLE_ROW_REGEX.test(line));

    let tableHtml = '<table class="md-table">';

    // Header
    tableHtml += '<thead><tr>';
    headerCells.forEach(cell => {
        tableHtml += `<th>${markdownInlineToHtml(cell)}</th>`;
    });
    tableHtml += '</tr></thead>';

    // Body
    if (bodyRows.length > 0) {
        tableHtml += '<tbody>';
        bodyRows.forEach(row => {
            const cells = parseRow(row);
            tableHtml += '<tr>';
            cells.forEach(cell => {
                tableHtml += `<td>${markdownInlineToHtml(cell)}</td>`;
            });
            tableHtml += '</tr>';
        });
        tableHtml += '</tbody>';
    }

    tableHtml += '</table>';

    return sanitizeHtml(tableHtml);
}

/**
 * Detect if text contains a markdown table
 */
export function containsMarkdownTable(text: string): boolean {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length - 1; i++) {
        if (TABLE_ROW_REGEX.test(lines[i]) && TABLE_SEPARATOR_REGEX.test(lines[i + 1])) {
            return true;
        }
    }
    return false;
}

/**
 * Detect if text contains a fenced code block
 */
export function containsCodeBlock(text: string): boolean {
    return /```[\s\S]*?```/.test(text);
}

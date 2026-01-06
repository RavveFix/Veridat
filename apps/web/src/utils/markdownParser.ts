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

export interface ParsedContent {
    type: 'text' | 'code' | 'table';
    content: string;
    language?: string;
}

/**
 * Parse AI response text and extract structured content blocks
 * Returns array of content blocks for special rendering
 */
export function parseAIResponse(text: string): ParsedContent[] {
    const blocks: ParsedContent[] = [];

    // 1. Identify all code blocks and tables with their indices
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
    const tableRegex = /((?:^|\n)\|.*\|(?:\n|$)(?:\|[-:| ]*\|(?:\n|$))(?:\|.*\|(?:\n|$))*)/g;

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

    let html = text;

    // Escape HTML first to prevent XSS
    html = html
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    // Headers (must come before other replacements)
    html = html.replace(/^###### (.+)$/gm, '<h6>$1</h6>');
    html = html.replace(/^##### (.+)$/gm, '<h5>$1</h5>');
    html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^### (.+)$/gm, '<h3 class="md-h3">$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2 class="md-h2">$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1 class="md-h1">$1</h1>');

    // Block quotes
    html = html.replace(/^> (.+)$/gm, '<blockquote class="md-quote">$1</blockquote>');

    // Unordered lists
    html = html.replace(/^\* (.+)$/gm, '<li class="md-li">$1</li>');
    html = html.replace(/^- (.+)$/gm, '<li class="md-li">$1</li>');

    // Ordered lists
    html = html.replace(/^\d+\. (.+)$/gm, '<li class="md-li-ordered">$1</li>');

    // Wrap consecutive list items
    html = html.replace(/(<li class="md-li">.*<\/li>\n?)+/g, (match) => `<ul class="md-ul">${match}</ul>`);
    html = html.replace(/(<li class="md-li-ordered">.*<\/li>\n?)+/g, (match) => `<ol class="md-ol">${match}</ol>`);

    // Inline code (before bold/italic to prevent conflicts)
    html = html.replace(/`([^`]+)`/g, '<code class="md-code">$1</code>');

    // Bold
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');

    // Italic
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    html = html.replace(/_([^_]+)_/g, '<em>$1</em>');

    // Strikethrough
    html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');

    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="md-link">$1</a>');

    // Horizontal rules
    html = html.replace(/^---$/gm, '<hr class="md-hr">');
    html = html.replace(/^\*\*\*$/gm, '<hr class="md-hr">');

    // Line breaks (convert double newlines to paragraphs, single to <br>)
    html = html.replace(/\n\n/g, '</p><p class="md-p">');
    html = html.replace(/\n/g, '<br>');

    // Wrap in paragraph if not already wrapped
    if (!html.startsWith('<')) {
        html = `<p class="md-p">${html}</p>`;
    }

    // Sanitize to prevent XSS attacks
    return DOMPurify.sanitize(html, {
        ALLOWED_TAGS: [
            'strong', 'em', 'code', 'br', 'p', 'a', 'ul', 'ol', 'li',
            'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'del', 'hr'
        ],
        ALLOWED_ATTR: ['href', 'target', 'rel', 'class'],
    });
}

/**
 * Parse markdown table to HTML table
 */
export function parseMarkdownTable(text: string): string | null {
    const lines = text.trim().split('\n');
    if (lines.length < 2) return null;

    // Check if it looks like a table (has pipes)
    if (!lines[0].includes('|')) return null;

    const parseRow = (line: string): string[] => {
        return line
            .split('|')
            .map(cell => cell.trim())
            .filter(cell => cell.length > 0);
    };

    // Check for separator row (|---|---|)
    const separatorIndex = lines.findIndex(line => /^\|?\s*[-:]+\s*\|/.test(line));
    if (separatorIndex === -1) return null;

    const headerCells = parseRow(lines[0]);
    const bodyRows = lines.slice(separatorIndex + 1).filter(line => line.includes('|'));

    let tableHtml = '<table class="md-table">';

    // Header
    tableHtml += '<thead><tr>';
    headerCells.forEach(cell => {
        tableHtml += `<th>${markdownToHtml(cell)}</th>`;
    });
    tableHtml += '</tr></thead>';

    // Body
    if (bodyRows.length > 0) {
        tableHtml += '<tbody>';
        bodyRows.forEach(row => {
            const cells = parseRow(row);
            tableHtml += '<tr>';
            cells.forEach(cell => {
                tableHtml += `<td>${markdownToHtml(cell)}</td>`;
            });
            tableHtml += '</tr>';
        });
        tableHtml += '</tbody>';
    }

    tableHtml += '</table>';

    return DOMPurify.sanitize(tableHtml, {
        ALLOWED_TAGS: ['table', 'thead', 'tbody', 'tr', 'th', 'td', 'strong', 'em', 'code', 'a'],
        ALLOWED_ATTR: ['href', 'target', 'rel', 'class'],
    });
}

/**
 * Detect if text contains a markdown table
 */
export function containsMarkdownTable(text: string): boolean {
    const lines = text.split('\n');
    return lines.some(line => /^\|?\s*[-:]+\s*\|/.test(line));
}

/**
 * Detect if text contains a fenced code block
 */
export function containsCodeBlock(text: string): boolean {
    return /```[\s\S]*?```/.test(text);
}

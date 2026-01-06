/**
 * Unit tests for Markdown Parser
 *
 * Britta's first unit test! 🎉
 * Tests the markdown parsing utilities used for AI responses.
 */

import { describe, it, expect } from 'vitest';
import {
    parseAIResponse,
    containsMarkdownTable,
    containsCodeBlock
} from './markdownParser';

describe('markdownParser', () => {
    describe('parseAIResponse', () => {
        it('should return single text block for plain text', () => {
            const result = parseAIResponse('Hello, this is plain text.');

            expect(result).toHaveLength(1);
            expect(result[0].type).toBe('text');
            expect(result[0].content).toBe('Hello, this is plain text.');
        });

        it('should extract code blocks with language', () => {
            const input = `Here is some code:

\`\`\`javascript
const x = 42;
console.log(x);
\`\`\`

And some text after.`;

            const result = parseAIResponse(input);

            expect(result).toHaveLength(3);
            expect(result[0].type).toBe('text');
            expect(result[1].type).toBe('code');
            expect(result[1].language).toBe('javascript');
            expect(result[1].content).toContain('const x = 42');
            expect(result[2].type).toBe('text');
        });

        it('should extract code blocks without language', () => {
            const input = `\`\`\`
plain code block
\`\`\``;

            const result = parseAIResponse(input);

            expect(result).toHaveLength(1);
            expect(result[0].type).toBe('code');
            expect(result[0].language).toBe('text');
            expect(result[0].content).toBe('plain code block');
        });

        it('should handle multiple code blocks', () => {
            const input = `First block:
\`\`\`python
print("hello")
\`\`\`

Second block:
\`\`\`typescript
const msg = "world";
\`\`\``;

            const result = parseAIResponse(input);

            const codeBlocks = result.filter(b => b.type === 'code');
            expect(codeBlocks).toHaveLength(2);
            expect(codeBlocks[0].language).toBe('python');
            expect(codeBlocks[1].language).toBe('typescript');
        });

        it('should extract markdown tables', () => {
            const input = `Here is a table:

| Konto | Belopp |
|-------|--------|
| 3000  | 1000   |
| 2610  | 200    |

And text after.`;

            const result = parseAIResponse(input);

            const tableBlocks = result.filter(b => b.type === 'table');
            expect(tableBlocks).toHaveLength(1);
            expect(tableBlocks[0].content).toContain('Konto');
            expect(tableBlocks[0].content).toContain('3000');
        });

        it('should handle empty input', () => {
            const result = parseAIResponse('');

            expect(result).toHaveLength(1);
            expect(result[0].type).toBe('text');
            expect(result[0].content).toBe('');
        });

        it('should preserve order of mixed content', () => {
            const input = `Intro text

\`\`\`sql
SELECT * FROM users;
\`\`\`

| Name | Age |
|------|-----|
| Anna | 30  |

Final text`;

            const result = parseAIResponse(input);
            const types = result.map(b => b.type);

            expect(types).toEqual(['text', 'code', 'table', 'text']);
        });
    });

    describe('containsMarkdownTable', () => {
        it('should return true for valid markdown table', () => {
            const table = `| Header1 | Header2 |
|---------|---------|
| Cell1   | Cell2   |`;

            expect(containsMarkdownTable(table)).toBe(true);
        });

        it('should return true for table with alignment', () => {
            const table = `| Left | Center | Right |
|:-----|:------:|------:|
| A    | B      | C     |`;

            expect(containsMarkdownTable(table)).toBe(true);
        });

        it('should return false for plain text', () => {
            expect(containsMarkdownTable('Just regular text')).toBe(false);
        });

        it('should return false for text with pipes but no separator', () => {
            expect(containsMarkdownTable('A | B | C')).toBe(false);
        });
    });

    describe('containsCodeBlock', () => {
        it('should return true for fenced code block', () => {
            const code = `\`\`\`javascript
const x = 1;
\`\`\``;

            expect(containsCodeBlock(code)).toBe(true);
        });

        it('should return true for code block without language', () => {
            const code = `\`\`\`
some code
\`\`\``;

            expect(containsCodeBlock(code)).toBe(true);
        });

        it('should return false for inline code', () => {
            expect(containsCodeBlock('Use `const` for constants')).toBe(false);
        });

        it('should return false for plain text', () => {
            expect(containsCodeBlock('No code here')).toBe(false);
        });

        it('should return true for multiline code block', () => {
            const code = `\`\`\`
line 1
line 2
line 3
\`\`\``;

            expect(containsCodeBlock(code)).toBe(true);
        });
    });
});

describe('Swedish accounting examples', () => {
    it('should parse VAT report response correctly', () => {
        const vatResponse = `## Momsredovisning Q4 2024

Här är din momsrapport:

| Konto | Beskrivning | Belopp |
|-------|-------------|--------|
| 2610  | Utgående moms 25% | 25 000 kr |
| 2640  | Ingående moms | -5 000 kr |

**Moms att betala:** 20 000 kr

\`\`\`
Verifikationsnummer: V-2024-0042
Bokföringsdatum: 2024-12-31
\`\`\``;

        const result = parseAIResponse(vatResponse);

        // Should have: intro text, table, text with bold, code block
        expect(result.length).toBeGreaterThanOrEqual(3);

        const tableBlock = result.find(b => b.type === 'table');
        expect(tableBlock).toBeDefined();
        expect(tableBlock?.content).toContain('2610');
        expect(tableBlock?.content).toContain('Utgående moms');

        const codeBlock = result.find(b => b.type === 'code');
        expect(codeBlock).toBeDefined();
        expect(codeBlock?.content).toContain('V-2024-0042');
    });
});

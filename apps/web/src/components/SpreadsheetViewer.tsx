import { FunctionComponent } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import type { SpreadsheetData, CellStyle } from '../utils/workbookBuilder';

interface SpreadsheetViewerProps {
    spreadsheetData: SpreadsheetData;
}

/** Convert column index to Excel letter(s): 0→A, 1→B, 25→Z, 26→AA */
function colLetter(index: number): string {
    let result = '';
    let i = index;
    while (i >= 0) {
        result = String.fromCharCode(65 + (i % 26)) + result;
        i = Math.floor(i / 26) - 1;
    }
    return result;
}

/** Format cell value for display */
function formatCell(value: string | number | null): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'number') {
        return value.toLocaleString('sv-SE', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        });
    }
    return String(value);
}

/** Build cell address string matching workbookBuilder format */
function cellAddr(row: number, col: number): string {
    let letter = '';
    let c = col;
    while (c >= 0) {
        letter = String.fromCharCode(65 + (c % 26)) + letter;
        c = Math.floor(c / 26) - 1;
    }
    return `${letter}${row}`;
}

/** Get CSS classes for a cell based on its style and value */
function getCellClasses(style: CellStyle | undefined, value: string | number | null): string {
    const classes: string[] = ['sv-cell'];

    if (style?.isTitle) classes.push('sv-cell--title');
    if (style?.isSectionHeader) classes.push('sv-cell--section');
    if (style?.isColumnHeader) classes.push('sv-cell--col-header');
    if (style?.isTotalRow) classes.push('sv-cell--total');
    if (style?.bold) classes.push('sv-cell--bold');

    if (typeof value === 'number') {
        classes.push('sv-cell--numeric');
        if (value < 0) classes.push('sv-cell--negative');
    }

    return classes.join(' ');
}

export const SpreadsheetViewer: FunctionComponent<SpreadsheetViewerProps> = ({
    spreadsheetData,
}) => {
    const [activeSheetIndex, setActiveSheetIndex] = useState(0);

    const activeSheet = spreadsheetData.sheets[activeSheetIndex];

    // Pad all rows to maxCol width for consistent grid
    const paddedRows = useMemo(() => {
        if (!activeSheet) return [];
        return activeSheet.rows.map(row => {
            const padded = [...row];
            while (padded.length < activeSheet.maxCol) {
                padded.push(null);
            }
            return padded;
        });
    }, [activeSheet]);

    if (!activeSheet) return null;

    return (
        <div class="sv">
            {/* Spreadsheet grid */}
            <div class="sv-grid-wrapper">
                <table class="sv-grid">
                    <thead>
                        <tr>
                            <th class="sv-corner"></th>
                            {Array.from({ length: activeSheet.maxCol }, (_, i) => (
                                <th
                                    key={i}
                                    class="sv-col-letter"
                                    style={{ width: `${activeSheet.colWidths[i] || 100}px` }}
                                >
                                    {colLetter(i)}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {paddedRows.map((row, rowIdx) => (
                            <tr key={rowIdx}>
                                <td class="sv-row-number">{rowIdx + 1}</td>
                                {row.map((cell, colIdx) => {
                                    const addr = cellAddr(rowIdx, colIdx);
                                    const style = activeSheet.styles[addr];
                                    const inlineStyle: Record<string, string> = {};
                                    if (style?.bgColor) inlineStyle.backgroundColor = style.bgColor;
                                    if (style?.textColor) inlineStyle.color = style.textColor;

                                    return (
                                        <td
                                            key={colIdx}
                                            class={getCellClasses(style, cell)}
                                            style={Object.keys(inlineStyle).length > 0 ? inlineStyle : undefined}
                                        >
                                            {typeof cell === 'number' ? formatCell(cell) : (cell ?? '')}
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Sheet tabs */}
            <div class="sv-sheet-tabs">
                {spreadsheetData.sheets.map((sheet, idx) => (
                    <button
                        key={idx}
                        class={`sv-sheet-tab ${idx === activeSheetIndex ? 'sv-sheet-tab--active' : ''}`}
                        onClick={() => setActiveSheetIndex(idx)}
                    >
                        {sheet.name}
                    </button>
                ))}
            </div>
        </div>
    );
};

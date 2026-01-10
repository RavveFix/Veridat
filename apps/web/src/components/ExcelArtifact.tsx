import { FunctionComponent } from 'preact';
import { useState, useMemo } from 'preact/hooks';

export interface ExcelSheet {
    name: string;
    rowCount: number;
}

export interface ExcelArtifactProps {
    filename: string;
    sheets: ExcelSheet[];
    columns: string[];
    previewRows: unknown[][];
    period?: string;
    status: 'ready' | 'analyzing' | 'complete' | 'error';
    onAnalyze?: () => void;
    onDownload?: () => void;
    onClose?: () => void;
}

/**
 * Claude.ai-inspired Excel Artifact component
 * Displays Excel file data in an interactive, glass-morphism panel
 */
export const ExcelArtifact: FunctionComponent<ExcelArtifactProps> = ({
    filename,
    sheets,
    columns,
    previewRows,
    period,
    status,
    onAnalyze,
    onDownload,
    onClose
}) => {
    const [activeSheet, setActiveSheet] = useState(0);
    const [searchQuery, setSearchQuery] = useState('');
    const [sortColumn, setSortColumn] = useState<number | null>(null);
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

    // Calculate stats
    const totalRows = useMemo(() =>
        sheets.reduce((sum, sheet) => sum + sheet.rowCount, 0),
        [sheets]
    );

    // Filter and sort rows
    const displayRows = useMemo(() => {
        let rows = [...previewRows];

        // Filter by search
        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            rows = rows.filter(row =>
                row.some(cell =>
                    String(cell).toLowerCase().includes(query)
                )
            );
        }

        // Sort by column
        if (sortColumn !== null) {
            rows.sort((a, b) => {
                const aVal = a[sortColumn];
                const bVal = b[sortColumn];

                // Handle numeric comparison
                const aNum = parseFloat(String(aVal));
                const bNum = parseFloat(String(bVal));

                if (!isNaN(aNum) && !isNaN(bNum)) {
                    return sortDirection === 'asc' ? aNum - bNum : bNum - aNum;
                }

                // String comparison
                const aStr = String(aVal || '');
                const bStr = String(bVal || '');
                return sortDirection === 'asc'
                    ? aStr.localeCompare(bStr, 'sv')
                    : bStr.localeCompare(aStr, 'sv');
            });
        }

        return rows;
    }, [previewRows, searchQuery, sortColumn, sortDirection]);

    const handleSort = (columnIndex: number) => {
        if (sortColumn === columnIndex) {
            setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
        } else {
            setSortColumn(columnIndex);
            setSortDirection('asc');
        }
    };

    const formatCellValue = (value: unknown, columnName: string): string => {
        if (value === null || value === undefined) return '-';

        // Format numbers with Swedish locale
        if (typeof value === 'number') {
            // Check if it looks like currency
            const lowerCol = columnName.toLowerCase();
            if (lowerCol.includes('belopp') || lowerCol.includes('amount') ||
                lowerCol.includes('moms') || lowerCol.includes('vat') ||
                lowerCol.includes('pris') || lowerCol.includes('price')) {
                return value.toLocaleString('sv-SE', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                }) + ' kr';
            }
            return value.toLocaleString('sv-SE');
        }

        return String(value);
    };

    const isCurrencyColumn = (columnName: string): boolean => {
        const lower = columnName.toLowerCase();
        return lower.includes('belopp') || lower.includes('amount') ||
               lower.includes('moms') || lower.includes('vat') ||
               lower.includes('pris') || lower.includes('price') ||
               lower.includes('summa') || lower.includes('total');
    };

    const isNegative = (value: unknown): boolean => {
        return typeof value === 'number' && value < 0;
    };

    const getStatusBadge = () => {
        switch (status) {
            case 'ready':
                return <span class="excel-artifact-badge">Redo för analys</span>;
            case 'analyzing':
                return <span class="excel-artifact-badge analyzing">Analyserar...</span>;
            case 'complete':
                return <span class="excel-artifact-badge complete">✓ Analyserad</span>;
            case 'error':
                return <span class="excel-artifact-badge error">Fel</span>;
        }
    };

    return (
        <div class="excel-artifact">
            {/* Header */}
            <div class="excel-artifact-header">
                <div class="excel-artifact-header-left">
                    <div class="excel-artifact-icon">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                            <polyline points="14 2 14 8 20 8"></polyline>
                            <line x1="16" y1="13" x2="8" y2="13"></line>
                            <line x1="16" y1="17" x2="8" y2="17"></line>
                            <line x1="10" y1="9" x2="8" y2="9"></line>
                        </svg>
                    </div>
                    <div class="excel-artifact-title-group">
                        <div class="excel-artifact-title">{filename}</div>
                        {period && <div class="excel-artifact-subtitle">{period}</div>}
                    </div>
                </div>
                <div class="excel-artifact-header-right">
                    {getStatusBadge()}
                    {onClose && (
                        <button class="excel-artifact-close" onClick={onClose} title="Stäng">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </button>
                    )}
                </div>
            </div>

            {/* Stats Grid */}
            <div class="excel-artifact-stats">
                <div class="excel-stat-card">
                    <div class="excel-stat-value">{totalRows.toLocaleString('sv-SE')}</div>
                    <div class="excel-stat-label">Rader</div>
                </div>
                <div class="excel-stat-card">
                    <div class="excel-stat-value">{sheets.length}</div>
                    <div class="excel-stat-label">Blad</div>
                </div>
                <div class="excel-stat-card">
                    <div class="excel-stat-value">{columns.length}</div>
                    <div class="excel-stat-label">Kolumner</div>
                </div>
                <div class="excel-stat-card">
                    <div class="excel-stat-value">{period || '-'}</div>
                    <div class="excel-stat-label">Period</div>
                </div>
            </div>

            {/* Mobile Sheet Tabs */}
            {sheets.length > 1 && (
                <div class="excel-mobile-tabs">
                    {sheets.map((sheet, index) => (
                        <button
                            key={index}
                            class={`excel-mobile-tab ${index === activeSheet ? 'active' : ''}`}
                            onClick={() => setActiveSheet(index)}
                        >
                            {sheet.name}
                        </button>
                    ))}
                </div>
            )}

            {/* Content Area */}
            <div class="excel-artifact-content">
                {/* Sheet Sidebar (desktop) */}
                {sheets.length > 1 && (
                    <div class="excel-sheets-sidebar">
                        <div class="excel-sheets-header">Blad</div>
                        <div class="excel-sheets-list">
                            {sheets.map((sheet, index) => (
                                <div
                                    key={index}
                                    class={`excel-sheet-item ${index === activeSheet ? 'active' : ''}`}
                                    onClick={() => setActiveSheet(index)}
                                >
                                    <span class="excel-sheet-icon">📄</span>
                                    <span class="excel-sheet-name">{sheet.name}</span>
                                    <span class="excel-sheet-rows">{sheet.rowCount}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Table Area */}
                <div class="excel-table-area">
                    {/* Toolbar */}
                    <div class="excel-table-toolbar">
                        <input
                            type="text"
                            class="excel-search-input"
                            placeholder="Sök i tabellen..."
                            value={searchQuery}
                            onInput={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
                        />
                    </div>

                    {/* Table */}
                    <div class="excel-table-container">
                        {displayRows.length > 0 ? (
                            <table class="excel-artifact-table">
                                <thead>
                                    <tr>
                                        {columns.map((col, index) => (
                                            <th
                                                key={index}
                                                class={sortColumn === index ? 'sorted' : ''}
                                                onClick={() => handleSort(index)}
                                            >
                                                {col}
                                                <span class="sort-icon">
                                                    {sortColumn === index
                                                        ? (sortDirection === 'asc' ? '↑' : '↓')
                                                        : '↕'
                                                    }
                                                </span>
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {displayRows.map((row, rowIndex) => (
                                        <tr key={rowIndex}>
                                            {row.map((cell, cellIndex) => (
                                                <td
                                                    key={cellIndex}
                                                    class={`
                                                        ${isCurrencyColumn(columns[cellIndex]) ? 'currency' : ''}
                                                        ${typeof cell === 'number' ? 'number' : ''}
                                                        ${isNegative(cell) ? 'negative' : ''}
                                                    `.trim()}
                                                >
                                                    {formatCellValue(cell, columns[cellIndex])}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        ) : (
                            <div class="excel-empty-state">
                                <div class="excel-empty-icon">📊</div>
                                <div class="excel-empty-text">
                                    {searchQuery
                                        ? 'Inga resultat hittades för din sökning'
                                        : 'Ingen data att visa'
                                    }
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Action Footer */}
            <div class="excel-artifact-actions">
                {onAnalyze && status === 'ready' && (
                    <button class="excel-action-btn primary" onClick={onAnalyze}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="11" cy="11" r="8"></circle>
                            <path d="m21 21-4.3-4.3"></path>
                        </svg>
                        Analysera moms
                    </button>
                )}
                {status === 'analyzing' && (
                    <button class="excel-action-btn primary" disabled>
                        <span class="spinner"></span>
                        Analyserar...
                    </button>
                )}
                {onDownload && (
                    <button class="excel-action-btn secondary" onClick={onDownload}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                            <polyline points="7 10 12 15 17 10"></polyline>
                            <line x1="12" y1="15" x2="12" y2="3"></line>
                        </svg>
                        Ladda ner
                    </button>
                )}
            </div>
        </div>
    );
};

export default ExcelArtifact;

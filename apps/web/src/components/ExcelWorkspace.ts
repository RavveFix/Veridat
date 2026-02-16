import type * as XLSXTypes from 'xlsx';
import DOMPurify from 'dompurify';
import type { ExcelPanelElements, ExcelWorkspaceOptions } from '../types/excel';
import type { VATReportData } from '../types/vat';
import type { AIAnalysisProgress } from '../services/ChatService';
import { SpreadsheetViewer } from './SpreadsheetViewer';
import { ExcelArtifact, type ExcelSheet, type ExcelArtifactProps } from './ExcelArtifact';
import { mountPreactComponent } from './preact-adapter';
import { logger } from '../services/LoggerService';
import { buildAnalysisSummary } from '../utils/analysisSummary';
import { buildReportWorkbook } from '../utils/workbookBuilder';
import { generateExcelFile, copyReportToClipboard } from '../utils/excelExport';

/** Lazy-load xlsx to reduce initial bundle size (~300KB) */
let _xlsxModule: typeof import('xlsx') | null = null;
async function getXLSX(): Promise<typeof import('xlsx')> {
    if (!_xlsxModule) {
        _xlsxModule = await import('xlsx');
    }
    return _xlsxModule;
}

/**
 * ExcelWorkspace - Handles parsing and displaying Excel files using SheetJS
 *
 * Provides a split-panel workspace for viewing Excel files with:
 * - Multi-sheet support with tab navigation
 * - HTML table rendering with sticky headers
 * - Loading and error state handling
 * - Smooth slide-in/slide-out animations
 */
export type ArtifactContent =
    | { type: 'excel'; workbook: XLSXTypes.WorkBook; filename: string }
    | { type: 'vat_report'; data: VATReportData; fileUrl?: string; filePath?: string; fileBucket?: string };

/**
 * Panel state machine for tracking artifact display
 */
export type PanelState =
    | 'closed'
    | 'excel-preview'    // Showing ExcelArtifact
    | 'analyzing'        // Showing streaming progress
    | 'vat-report'       // Showing VATReportCard
    | 'error';

export class ExcelWorkspace {
    private currentWorkbook: XLSXTypes.WorkBook | null = null;
    private currentFile: string | null = null;
    private currentContent: ArtifactContent | null = null;
    private panelState: PanelState = 'closed';
    private elements: ExcelPanelElements;
    private options: ExcelWorkspaceOptions;
    private vatReportUnmount?: () => void;
    private excelArtifactUnmount?: () => void;
    private boundHandleOpenArtifact: (e: Event) => void;
    private activeTab: 'summary' | 'transactions' | 'journal' = 'summary';
    /** Cached preflight data for scanner table rendering */
    private preflightColumns: string[] = [];
    private preflightRows: string[][] = [];

    constructor(options: ExcelWorkspaceOptions = {}) {
        this.options = options;
        this.elements = this.initializePanel();

        // Bind event handlers
        this.boundHandleOpenArtifact = this.handleOpenArtifact.bind(this);

        // Listen for artifact panel open events (from VATSummaryCard)
        window.addEventListener('open-artifact-panel', this.boundHandleOpenArtifact);
    }

    /**
     * Handle open-artifact-panel event from VATSummaryCard
     */
    private handleOpenArtifact(e: Event): void {
        const event = e as CustomEvent<{
            type: string;
            data: VATReportData;
            fileUrl?: string;
            filePath?: string;
            fileBucket?: string;
        }>;

        if (event.detail?.type === 'vat_report' && event.detail.data) {
            this.openVATReport(
                event.detail.data,
                event.detail.fileUrl,
                event.detail.filePath,
                event.detail.fileBucket,
                true
            ).catch(err => logger.error('Failed to open VAT report from artifact', err));
        }
    }

    /**
     * Get current panel state
     */
    getPanelState(): PanelState {
        return this.panelState;
    }

    /**
     * Get current active tab
     */
    getActiveTab(): 'summary' | 'transactions' | 'journal' {
        return this.activeTab;
    }

    /**
     * Clean up event listeners
     */
    destroy(): void {
        window.removeEventListener('open-artifact-panel', this.boundHandleOpenArtifact);
        this.vatReportUnmount?.();
        this.excelArtifactUnmount?.();
    }

    /**
     * Initialize panel DOM elements and attach event listeners
     */
    private initializePanel(): ExcelPanelElements {
        const panel = document.getElementById('excel-panel');
        const container = document.getElementById('excel-table-container');
        const tabsContainer = document.getElementById('sheet-tabs');
        const closeBtn = document.getElementById('close-excel-panel');
        const filenameDisplay = document.getElementById('excel-filename');
        const backdrop = document.getElementById('excel-panel-backdrop');
        const titleIcon = document.getElementById('excel-title-icon');
        const panelTabs = document.getElementById('panel-tabs');
        const headerActions = document.getElementById('excel-header-actions');

        if (!panel || !container || !tabsContainer || !closeBtn || !filenameDisplay) {
            throw new Error('Excel panel DOM elements not found. Ensure all required elements exist in the HTML.');
        }

        // Attach close button listener
        closeBtn.addEventListener('click', () => this.closePanel());

        // Attach backdrop click listener (mobile: click backdrop to close)
        if (backdrop) {
            backdrop.addEventListener('click', () => this.closePanel());
        }

        // Setup tab click listeners
        if (panelTabs) {
            this.setupTabListeners(panelTabs);
        }

        return {
            panel,
            container,
            tabsContainer,
            closeBtn,
            filenameDisplay,
            backdrop: backdrop || undefined,
            titleIcon: titleIcon || undefined,
            panelTabs: panelTabs || undefined,
            headerActions: headerActions || undefined
        };
    }

    /**
     * Setup click listeners for panel tabs
     */
    private setupTabListeners(panelTabs: HTMLElement): void {
        const tabs = panelTabs.querySelectorAll('.panel-tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const tabId = (tab as HTMLElement).dataset.tab as 'summary' | 'transactions' | 'journal';
                if (tabId) {
                    this.setActiveTab(tabId);
                }
            });
        });
    }

    /**
     * Set the active tab and update UI
     */
    private setActiveTab(tabId: 'summary' | 'transactions' | 'journal'): void {
        this.activeTab = tabId;

        // Update tab button states
        if (this.elements.panelTabs) {
            const tabs = this.elements.panelTabs.querySelectorAll('.panel-tab');
            tabs.forEach(tab => {
                const isActive = (tab as HTMLElement).dataset.tab === tabId;
                tab.classList.toggle('active', isActive);
            });
        }

        // Dispatch event to VATReportCard
        window.dispatchEvent(new CustomEvent('panel-tab-change', {
            detail: { tab: tabId }
        }));
    }

    /**
     * Show or hide the panel tabs
     */
    private showPanelTabs(show: boolean): void {
        if (this.elements.panelTabs) {
            this.elements.panelTabs.classList.toggle('hidden', !show);
        }
    }

    /**
     * Toggle VAT report layout mode on the panel container
     */
    private setVatReportMode(enabled: boolean): void {
        this.elements.container.classList.toggle('vat-report-mode', enabled);
    }

    /**
     * Open and display an Excel file from a URL
     *
     * @param fileUrl - Public URL to the Excel file
     * @param filename - Display name for the file
     */
    async openExcelFile(fileUrl: string, filename: string): Promise<void> {
        try {
            this.setVatReportMode(false);

            // Update filename display
            this.elements.filenameDisplay.textContent = filename;

            // Show loading state
            this.elements.container.innerHTML = '<div class="excel-loading">Laddar Excel-fil...</div>';
            this.elements.panel.classList.add('open');

            // Fetch the file
            const response = await fetch(fileUrl);
            if (!response.ok) {
                throw new Error(`Kunde inte hämta filen: ${response.statusText}`);
            }

            const arrayBuffer = await response.arrayBuffer();

            // Parse the Excel file with SheetJS (lazy-loaded)
            const XLSX = await getXLSX();
            this.currentWorkbook = XLSX.read(arrayBuffer, { type: 'array' });
            this.currentFile = filename;

            // Render sheet tabs
            this.renderSheetTabs();

            // Display the first sheet
            if (this.currentWorkbook.SheetNames.length > 0) {
                await this.displaySheet(this.currentWorkbook.SheetNames[0]);
            } else {
                this.elements.container.innerHTML = '<div class="excel-error">Inga flikar hittades i denna Excel-fil.</div>';
            }

        } catch (error) {
            logger.error('Error opening Excel file', error);
            const errorMessage = error instanceof Error ? error.message : 'Okänt fel';
            this.elements.container.innerHTML = `<div class="excel-error">Kunde inte ladda Excel-filen: ${this.escapeHtml(errorMessage)}</div>`;

            // Call error callback if provided
            if (this.options.onError && error instanceof Error) {
                this.options.onError(error);
            }
        }
    }

    /**
     * Open and display an Excel file using the Claude-inspired Artifact UI
     *
     * @param fileUrl - Public URL to the Excel file
     * @param filename - Display name for the file
     * @param onAnalyze - Callback when user clicks "Analysera moms"
     */
    async openExcelArtifact(
        fileUrl: string,
        filename: string,
        onAnalyze?: () => void
    ): Promise<void> {
        try {
            this.setVatReportMode(false);

            // Unmount any previous Preact component
            this.excelArtifactUnmount?.();
            this.vatReportUnmount?.();

            // Update filename display
            this.elements.filenameDisplay.textContent = filename;

            // Show loading state
            this.elements.container.innerHTML = '<div class="excel-loading">Laddar Excel-fil...</div>';
            this.elements.panel.classList.add('open');

            // Hide sheet tabs (handled by artifact component)
            this.elements.tabsContainer.style.display = 'none';

            // Fetch the file
            const response = await fetch(fileUrl);
            if (!response.ok) {
                throw new Error(`Kunde inte hämta filen: ${response.statusText}`);
            }

            const arrayBuffer = await response.arrayBuffer();

            // Parse the Excel file with SheetJS (lazy-loaded)
            const XLSX = await getXLSX();
            this.currentWorkbook = XLSX.read(arrayBuffer, { type: 'array' });
            this.currentFile = filename;

            // Extract sheet info
            const sheets: ExcelSheet[] = this.currentWorkbook.SheetNames.map(name => {
                const worksheet = this.currentWorkbook!.Sheets[name];
                const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
                const rowCount = range.e.r - range.s.r;
                return { name, rowCount };
            });

            // Get first sheet data for preview
            const firstSheetName = this.currentWorkbook.SheetNames[0];
            const firstSheet = this.currentWorkbook.Sheets[firstSheetName];

            // Convert to JSON to get columns and rows
            const jsonData = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, {
                header: 1,
                defval: ''
            });

            // First row is headers, rest is data
            const columns = (jsonData[0] as string[] || []).map(col => String(col || ''));
            const previewRows = jsonData.slice(1, 51) as unknown[][]; // Preview max 50 rows

            // Detect period from filename or data
            const period = this.detectPeriod(filename, jsonData);

            // Clear container and mount Preact ExcelArtifact component
            this.elements.container.innerHTML = '';

            const props: ExcelArtifactProps = {
                filename,
                sheets,
                columns,
                previewRows,
                period,
                status: 'ready',
                onAnalyze: onAnalyze,
                onDownload: () => this.downloadCurrentFile(fileUrl, filename),
                onClose: () => this.closePanel()
            };

            this.excelArtifactUnmount = mountPreactComponent(
                ExcelArtifact,
                props,
                this.elements.container
            );

            // Update panel state
            this.panelState = 'excel-preview';

            // Hide panel tabs (not used for Excel preview)
            this.showPanelTabs(false);

            // Show backdrop on mobile
            this.elements.backdrop?.classList.add('visible');

            // Update title icon for Excel
            if (this.elements.titleIcon) {
                this.elements.titleIcon.textContent = '📊';
            }

            logger.debug('Excel artifact opened', { filename, sheets: sheets.length, rows: previewRows.length, state: this.panelState });

        } catch (error) {
            logger.error('Error opening Excel artifact', error);
            const errorMessage = error instanceof Error ? error.message : 'Okänt fel';
            this.elements.container.innerHTML = `<div class="excel-error">Kunde inte ladda Excel-filen: ${this.escapeHtml(errorMessage)}</div>`;

            if (this.options.onError && error instanceof Error) {
                this.options.onError(error);
            }
        }
    }

    /**
     * Detect period from filename or data
     */
    private detectPeriod(filename: string, _data: unknown[][]): string | undefined {
        // Try to detect from filename (e.g., "monta-december-2024.xlsx")
        const monthNames = ['januari', 'februari', 'mars', 'april', 'maj', 'juni',
            'juli', 'augusti', 'september', 'oktober', 'november', 'december'];

        const lowerFilename = filename.toLowerCase();

        for (let i = 0; i < monthNames.length; i++) {
            if (lowerFilename.includes(monthNames[i])) {
                // Try to find year
                const yearMatch = filename.match(/20\d{2}/);
                if (yearMatch) {
                    return `${monthNames[i].charAt(0).toUpperCase() + monthNames[i].slice(1)} ${yearMatch[0]}`;
                }
                return monthNames[i].charAt(0).toUpperCase() + monthNames[i].slice(1);
            }
        }

        // Try Q format (e.g., "Q4 2024")
        const quarterMatch = filename.match(/Q([1-4])\s*(20\d{2})/i);
        if (quarterMatch) {
            return `Q${quarterMatch[1]} ${quarterMatch[2]}`;
        }

        // Try year-month format (e.g., "2024-12")
        const ymMatch = filename.match(/(20\d{2})-?(0[1-9]|1[0-2])/);
        if (ymMatch) {
            const monthIndex = parseInt(ymMatch[2]) - 1;
            return `${monthNames[monthIndex].charAt(0).toUpperCase() + monthNames[monthIndex].slice(1)} ${ymMatch[1]}`;
        }

        return undefined;
    }

    /**
     * Download the current Excel file
     */
    private downloadCurrentFile(fileUrl: string, filename: string): void {
        const link = document.createElement('a');
        link.href = fileUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    /**
     * Update the ExcelArtifact status (e.g., when analysis starts)
     */
    async updateArtifactStatus(status: ExcelArtifactProps['status']): Promise<void> {
        // Re-mount with updated status
        if (this.currentWorkbook && this.currentFile) {
            const XLSX = await getXLSX();
            const sheets: ExcelSheet[] = this.currentWorkbook.SheetNames.map(name => {
                const worksheet = this.currentWorkbook!.Sheets[name];
                const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
                const rowCount = range.e.r - range.s.r;
                return { name, rowCount };
            });

            const firstSheetName = this.currentWorkbook.SheetNames[0];
            const firstSheet = this.currentWorkbook.Sheets[firstSheetName];
            const jsonData = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, {
                header: 1,
                defval: ''
            });

            const columns = (jsonData[0] as string[] || []).map(col => String(col || ''));
            const previewRows = jsonData.slice(1, 51) as unknown[][];
            const period = this.detectPeriod(this.currentFile, jsonData);

            // Unmount and remount with new status
            this.excelArtifactUnmount?.();
            this.elements.container.innerHTML = '';

            const props: ExcelArtifactProps = {
                filename: this.currentFile,
                sheets,
                columns,
                previewRows,
                period,
                status,
                onClose: () => this.closePanel()
            };

            this.excelArtifactUnmount = mountPreactComponent(
                ExcelArtifact,
                props,
                this.elements.container
            );
        }
    }

    /**
     * Render sheet tabs for multi-sheet navigation
     */
    private renderSheetTabs(): void {
        if (!this.currentWorkbook) return;

        this.elements.tabsContainer.innerHTML = '';

        this.currentWorkbook.SheetNames.forEach((sheetName, index) => {
            const tab = document.createElement('button');
            tab.className = 'sheet-tab';
            tab.textContent = sheetName;
            tab.dataset.sheetName = sheetName;
            tab.setAttribute('role', 'tab');
            tab.setAttribute('aria-selected', index === 0 ? 'true' : 'false');

            // Set active state for first tab
            if (index === 0) {
                tab.classList.add('active');
            }

            // Attach click listener
            tab.addEventListener('click', () => {
                // Remove active class from all tabs
                this.elements.tabsContainer.querySelectorAll('.sheet-tab').forEach(t => {
                    t.classList.remove('active');
                    t.setAttribute('aria-selected', 'false');
                });

                // Add active class to clicked tab
                tab.classList.add('active');
                tab.setAttribute('aria-selected', 'true');

                // Display the selected sheet
                void this.displaySheet(sheetName);

                // Call sheet change callback if provided
                if (this.options.onSheetChange) {
                    this.options.onSheetChange(sheetName);
                }
            });

            this.elements.tabsContainer.appendChild(tab);
        });
    }

    /**
     * Display a specific worksheet as an HTML table
     *
     * @param sheetName - Name of the sheet to display
     */
    private async displaySheet(sheetName: string): Promise<void> {
        if (!this.currentWorkbook) {
            this.setVatReportMode(false);
            this.elements.container.innerHTML = '<div class="excel-error">Ingen arbetsbok laddad.</div>';
            return;
        }

        const worksheet = this.currentWorkbook.Sheets[sheetName];

        if (!worksheet) {
            this.setVatReportMode(false);
            this.elements.container.innerHTML = '<div class="excel-error">Flik hittades inte.</div>';
            return;
        }

        // Convert worksheet to HTML table
        const XLSX = await getXLSX();
        const htmlTable = XLSX.utils.sheet_to_html(worksheet, {
            id: 'excel-table',
            editable: false
        });

        const safeTableHtml = this.sanitizeExcelHtmlTable(htmlTable);
        if (!safeTableHtml) {
            this.setVatReportMode(false);
            this.elements.container.innerHTML = '<div class="excel-error">Kunde inte rendera Excel-tabellen säkert.</div>';
            return;
        }

        this.setVatReportMode(false);
        this.elements.container.innerHTML = safeTableHtml;

        // Add custom styling to the table
        const table = this.elements.container.querySelector('table');
        if (table) {
            table.id = 'excel-table';
            table.classList.add('excel-table');

            // Harden links (if any) to prevent tab-nabbing
            table.querySelectorAll('a').forEach((a) => {
                a.setAttribute('target', '_blank');
                a.setAttribute('rel', 'noopener noreferrer');
            });
        }
    }

    /**
     * Sanitize the HTML generated by SheetJS to prevent XSS via cell contents.
     * Returns a safe `<table>...</table>` string or null if no table is found.
     */
    private sanitizeExcelHtmlTable(rawHtml: string): string | null {
        const doc = new DOMParser().parseFromString(rawHtml, 'text/html');
        const table = doc.querySelector('table');
        if (!table) return null;

        return DOMPurify.sanitize(table.outerHTML, {
            ALLOWED_TAGS: [
                'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
                'colgroup', 'col', 'caption', 'br', 'span', 'a'
            ],
            ALLOWED_ATTR: [
                'id', 'class', 'colspan', 'rowspan', 'href', 'target', 'rel'
            ],
            ALLOW_DATA_ATTR: false,
        });
    }

    /**
     * Close the Excel panel and clear state
     */
    closePanel(): void {
        // Unmount Preact components if present
        this.vatReportUnmount?.();
        this.vatReportUnmount = undefined;
        this.excelArtifactUnmount?.();
        this.excelArtifactUnmount = undefined;

        // Clear header action buttons
        this.clearHeaderActions();

        this.elements.panel.classList.remove('open');
        this.setVatReportMode(false);
        this.currentWorkbook = null;
        this.currentFile = null;
        this.currentContent = null;
        this.panelState = 'closed';
        this.elements.container.innerHTML = '';
        this.elements.tabsContainer.innerHTML = '';
        this.elements.filenameDisplay.textContent = '';

        // Hide backdrop
        this.elements.backdrop?.classList.remove('visible');

        // Reset title icon
        if (this.elements.titleIcon) {
            this.elements.titleIcon.textContent = '📊';
        }

        // Reset tabs visibility
        this.elements.tabsContainer.style.display = '';

        // Hide panel tabs
        this.showPanelTabs(false);

        // Call close callback if provided
        if (this.options.onClose) {
            this.options.onClose();
        }
    }

    /**
     * Render copy/download action buttons in the panel header
     */
    private renderHeaderActions(data: VATReportData): void {
        const container = this.elements.headerActions;
        if (!container) return;

        container.innerHTML = '';

        // Copy button
        const copyBtn = document.createElement('button');
        copyBtn.className = 'sv-btn sv-btn--copy';
        copyBtn.textContent = 'Kopiera';
        copyBtn.addEventListener('click', () => {
            copyReportToClipboard(data);
            copyBtn.textContent = '\u2713 Kopierat';
            setTimeout(() => { copyBtn.textContent = 'Kopiera'; }, 2000);
        });

        // Download button
        const dlBtn = document.createElement('button');
        dlBtn.className = 'sv-btn sv-btn--download';
        dlBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Ladda ner`;
        dlBtn.addEventListener('click', async () => {
            if (dlBtn.disabled) return;
            dlBtn.disabled = true;
            dlBtn.textContent = 'Genererar...';
            try {
                await generateExcelFile(data);
                dlBtn.textContent = '\u2713 Nedladdad';
                dlBtn.classList.add('sv-btn--success');
                setTimeout(() => {
                    dlBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Ladda ner`;
                    dlBtn.classList.remove('sv-btn--success');
                    dlBtn.disabled = false;
                }, 2000);
            } catch (err) {
                logger.error('Excel generation failed:', err);
                dlBtn.textContent = 'Ladda ner';
                dlBtn.disabled = false;
            }
        });

        container.appendChild(copyBtn);
        container.appendChild(dlBtn);
    }

    /**
     * Clear action buttons from header
     */
    private clearHeaderActions(): void {
        if (this.elements.headerActions) {
            this.elements.headerActions.innerHTML = '';
        }
    }

    /**
     * Check if the Excel panel is currently open
     *
     * @returns True if panel is open, false otherwise
     */
    isOpen(): boolean {
        return this.elements.panel.classList.contains('open');
    }

    /**
     * Get the currently displayed filename
     *
     * @returns Current filename or null if no file is open
     */
    getCurrentFilename(): string | null {
        return this.currentFile;
    }

    /**
     * Get the currently displayed sheet name
     *
     * @returns Current sheet name or null if no file is open
     */
    getCurrentSheet(): string | null {
        if (!this.currentWorkbook) return null;

        const activeTab = this.elements.tabsContainer.querySelector('.sheet-tab.active') as HTMLElement;
        return activeTab?.dataset.sheetName || null;
    }

    /**
     * Show analyzing state while processing Excel file (legacy static version)
     *
     * @param filename - Name of the file being analyzed
     */
    showAnalyzing(filename: string): void {
        this.setVatReportMode(false);

        // Update panel title
        this.elements.filenameDisplay.textContent = `Analyserar ${filename}...`;

        // Hide sheet tabs
        this.elements.tabsContainer.style.display = 'none';

        // Show loading animation
        this.elements.container.innerHTML = `
            <div class="excel-analyzing">
                <div class="analyzing-spinner"></div>
                <h3>Analyserar momsunderlag</h3>
                <p>Detta kan ta några sekunder...</p>
                <div class="analyzing-steps">
                    <div class="step"><span class="step-icon">📊</span> Läser Excel-data</div>
                    <div class="step"><span class="step-icon">🔢</span> Beräknar moms</div>
                    <div class="step"><span class="step-icon">✅</span> Validerar resultat</div>
                </div>
            </div>
        `;

        // Open the panel
        this.elements.panel.classList.add('open');
    }

    /**
     * Show AI-powered streaming analysis with real-time progress
     * Inspired by Claude Artifacts
     *
     * @param filename - Name of the file being analyzed
     */
    showStreamingAnalysis(filename: string): void {
        this.setVatReportMode(false);

        // Update panel title
        this.elements.filenameDisplay.textContent = filename;

        // Hide sheet tabs
        this.elements.tabsContainer.style.display = 'none';

        // Build scanner table HTML from preflight data
        const headerCells = this.preflightColumns.length > 0
            ? this.preflightColumns.map(col => `<th>${this.escapeHtml(col || '—')}</th>`).join('')
            : '<th>—</th>';
        const bodyRows = this.preflightRows.length > 0
            ? this.preflightRows.map(row =>
                `<tr>${row.map(cell => `<td>${this.escapeHtml(String(cell).substring(0, 30))}</td>`).join('')}</tr>`
            ).join('')
            : '<tr><td colspan="8" style="text-align:center;opacity:0.4">Laddar data...</td></tr>';

        // Create scanner UI
        this.elements.container.innerHTML = `
            <div class="scanner" id="scanner-root">
                <div class="scanner-table-area">
                    <div class="scanner-table-wrapper">
                        <div class="scanner-overlay">
                            <div class="scanline" id="scanline"></div>
                        </div>
                        <table class="scanner-table" id="scanner-table">
                            <thead><tr>${headerCells}</tr></thead>
                            <tbody>${bodyRows}</tbody>
                        </table>
                    </div>
                    <div class="scanner-labels" id="scanner-labels"></div>
                </div>
                <div class="scanner-terminal" id="scanner-terminal">
                    <div class="terminal-header">
                        <span class="terminal-dot red"></span>
                        <span class="terminal-dot yellow"></span>
                        <span class="terminal-dot green"></span>
                        <span class="terminal-title">AI Terminal</span>
                    </div>
                    <div class="terminal-body" id="terminal-body"></div>
                    <div class="terminal-confidence" id="terminal-confidence">
                        <div class="confidence-track"><div class="confidence-fill" id="confidence-fill"></div></div>
                        <span class="confidence-text" id="confidence-text">—</span>
                    </div>
                </div>
                <div class="scanner-progress-bar">
                    <div class="scanner-progress-fill-track">
                        <div class="scanner-progress-fill" id="scanner-progress-fill"></div>
                    </div>
                    <span class="scanner-progress-text" id="scanner-progress-text">Förbereder analys...</span>
                </div>
            </div>
        `;

        // Add initial terminal line
        this.addTerminalLine(`Öppnar ${this.escapeHtml(filename)}...`, 'info');

        // Open the panel and update state
        this.elements.panel.classList.add('open');
        this.panelState = 'analyzing';

        // Show backdrop on mobile
        this.elements.backdrop?.classList.add('visible');

        // Update title icon for analyzing state
        if (this.elements.titleIcon) {
            this.elements.titleIcon.textContent = '⚡';
        }
    }

    async updatePreflight(file: File): Promise<void> {
        try {
            const XLSX = await getXLSX();
            const arrayBuffer = await file.arrayBuffer();
            const workbook = XLSX.read(arrayBuffer, { type: 'array' });
            const sheetNames = workbook.SheetNames || [];

            const firstSheetName = sheetNames[0];
            const worksheet = firstSheetName ? workbook.Sheets[firstSheetName] : undefined;
            const ref = worksheet?.['!ref'] || '';
            let rows = 0;
            let cols = 0;

            if (ref) {
                const range = XLSX.utils.decode_range(ref);
                rows = range.e.r - range.s.r + 1;
                cols = range.e.c - range.s.c + 1;
            }

            // Cache sheet data for scanner table
            if (worksheet) {
                const jsonData = XLSX.utils.sheet_to_json<string[]>(worksheet, { header: 1, defval: '' });
                const maxCols = 8;
                const maxRows = 12;
                if (jsonData.length > 0) {
                    this.preflightColumns = (jsonData[0] || []).slice(0, maxCols).map(c => String(c || ''));
                    this.preflightRows = jsonData.slice(1, maxRows + 1).map(row =>
                        (row || []).slice(0, maxCols).map(cell => String(cell ?? ''))
                    );
                }
            }

            // Update scanner table if it exists (since showStreamingAnalysis is called first)
            const table = document.getElementById('scanner-table');
            if (table && this.preflightColumns.length > 0) {
                const headerCells = this.preflightColumns.map(col => `<th>${this.escapeHtml(col || '—')}</th>`).join('');
                const bodyRows = this.preflightRows.map(row =>
                    `<tr>${row.map(cell => `<td>${this.escapeHtml(String(cell).substring(0, 30))}</td>`).join('')}</tr>`
                ).join('');
                table.innerHTML = `<thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody>`;
            }

            // Log preflight info to terminal
            const extension = file.name.split('.').pop()?.toLowerCase() || '';
            this.addTerminalLine(`${extension.toUpperCase()} · ${this.formatFileSize(file.size)} · ${sheetNames.length} blad`, 'info');
            if (rows > 0) {
                this.addTerminalLine(`${rows} rader × ${cols} kolumner`, 'success');
            }
        } catch {
            this.addTerminalLine('Varning: kunde inte förhandsgranska data', 'warn');
        }
    }

    private formatFileSize(bytes: number): string {
        if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB'];
        let size = bytes;
        let unitIndex = 0;
        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }
        return `${size.toFixed(size >= 100 ? 0 : size >= 10 ? 1 : 2)} ${units[unitIndex]}`;
    }

    /**
     * Add a line to the scanner terminal
     */
    private addTerminalLine(text: string, type: 'info' | 'success' | 'warn' | 'error' | 'discovery' = 'info'): void {
        const body = document.getElementById('terminal-body');
        if (!body) return;

        const now = new Date();
        const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

        const line = document.createElement('div');
        line.className = `terminal-line ${type}`;
        line.innerHTML = `<span class="terminal-time">[${time}]</span><span class="terminal-text">${this.escapeHtml(text)}</span>`;
        body.appendChild(line);
        body.scrollTop = body.scrollHeight;
    }

    /**
     * Highlight a column in the scanner table
     */
    private highlightScannerColumn(columnName: string, type: 'amount' | 'vat' | 'date' | 'desc'): void {
        const colIndex = this.preflightColumns.findIndex(c =>
            c.toLowerCase().trim() === columnName.toLowerCase().trim()
        );
        if (colIndex < 0) return;

        // Add column highlight class to all cells in that column
        const table = document.getElementById('scanner-table');
        if (!table) return;

        const colClass = `scanner-col-${type}`;
        const rows = table.querySelectorAll('tr');
        rows.forEach(row => {
            const cells = row.querySelectorAll('th, td');
            if (cells[colIndex]) {
                cells[colIndex].classList.add(colClass);
            }
        });

        // Add floating label
        const labels = document.getElementById('scanner-labels');
        if (!labels) return;

        const icons: Record<string, string> = { amount: '💰', vat: '🧾', date: '📅', desc: '📝' };
        const names: Record<string, string> = { amount: 'Belopp', vat: 'Moms', date: 'Datum', desc: 'Beskrivning' };

        const label = document.createElement('span');
        label.className = `scanner-label ${type}`;
        label.textContent = `${icons[type] || ''} ${names[type] || type} → "${columnName}"`;
        labels.appendChild(label);
    }

    /**
     * Update streaming analysis progress
     *
     * @param progress - Progress update from AI analysis
     */
    updateStreamingProgress(progress: AIAnalysisProgress): void {
        // Update progress bar
        const progressFill = document.getElementById('scanner-progress-fill');
        const progressText = document.getElementById('scanner-progress-text');

        if (progressFill && typeof progress.progress === 'number') {
            const pct = Math.round(progress.progress * 100);
            progressFill.style.width = `${pct}%`;
        }

        if (progressText && progress.message) {
            progressText.textContent = progress.message;
        }

        // Update confidence gauge in terminal
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const progressAny = progress as any;
        const confidence = progressAny.confidence as number | undefined;

        if (confidence !== undefined && !isNaN(confidence)) {
            const fill = document.getElementById('confidence-fill');
            const text = document.getElementById('confidence-text');
            if (fill) {
                fill.style.width = `${confidence}%`;
                fill.className = 'confidence-fill' + (confidence < 70 ? ' low' : confidence < 90 ? ' medium' : '');
            }
            if (text) {
                text.textContent = `${Math.round(confidence)}%`;
            }
        }

        // Show insight in terminal
        if (progress.insight) {
            this.addTerminalLine(progress.insight, 'discovery');
        }

        // Map progress steps to terminal lines + column highlights
        const details = progress.details || {};
        switch (progress.step) {
            case 'parsing':
                if (details.rows_count) {
                    this.addTerminalLine(`${details.rows_count} rader, ${details.columns_count || '?'} kolumner ✓`, 'success');
                }
                break;
            case 'analyzing':
                this.addTerminalLine('Identifierar kolumner...', 'info');
                break;
            case 'detecting':
                if (details.file_type) {
                    this.addTerminalLine(`Filtyp: ${details.file_type} upptäckt`, 'discovery');
                } else {
                    this.addTerminalLine('Detekterar filtyp...', 'info');
                }
                break;
            case 'categorizing':
                this.addTerminalLine('Kategoriserar transaktioner...', 'info');
                break;
            case 'mapping': {
                // Highlight discovered columns on the scanner table
                const mapping = details as Record<string, unknown>;
                if (mapping.amount_column && typeof mapping.amount_column === 'string') {
                    this.highlightScannerColumn(mapping.amount_column, 'amount');
                    this.addTerminalLine(`💰 belopp → "${mapping.amount_column}"`, 'discovery');
                }
                if (mapping.vat_amount_column && typeof mapping.vat_amount_column === 'string') {
                    this.highlightScannerColumn(mapping.vat_amount_column, 'vat');
                    this.addTerminalLine(`🧾 moms → "${mapping.vat_amount_column}"`, 'discovery');
                }
                if (mapping.date_column && typeof mapping.date_column === 'string') {
                    this.highlightScannerColumn(mapping.date_column, 'date');
                    this.addTerminalLine(`📅 datum → "${mapping.date_column}"`, 'discovery');
                }
                if (mapping.description_column && typeof mapping.description_column === 'string') {
                    this.highlightScannerColumn(mapping.description_column, 'desc');
                    this.addTerminalLine(`📝 beskrivning → "${mapping.description_column}"`, 'discovery');
                }
                if (!mapping.amount_column && !mapping.vat_amount_column) {
                    this.addTerminalLine('AI-mappning av kolumner...', 'info');
                }
                break;
            }
            case 'normalizing':
                this.addTerminalLine('Normaliserar data...', 'info');
                break;
            case 'calculating':
                this.addTerminalLine('Beräknar moms...', 'info');
                break;
            default:
                // Handle extra steps from backend (python-calculating, claude-validating, etc.)
                if (progress.message) {
                    this.addTerminalLine(progress.message, 'info');
                }
                break;
        }

        // Handle complete state - show the VAT report
        if (progress.step === 'complete' && progress.report) {
            // Scanner completion effects
            this.addTerminalLine('✓ Analys klar!', 'success');

            const scanline = document.getElementById('scanline');
            if (scanline) scanline.classList.add('complete');

            const progressFillEl = document.getElementById('scanner-progress-fill');
            if (progressFillEl) {
                progressFillEl.style.width = '100%';
                progressFillEl.classList.add('complete');
            }

            const progressTextEl = document.getElementById('scanner-progress-text');
            if (progressTextEl) progressTextEl.textContent = 'Analys klar!';

            const table = document.getElementById('scanner-table');
            if (table) table.classList.add('complete');

            // After a brief delay, fade out scanner and show report
            setTimeout(() => {
                const scanner = document.getElementById('scanner-root');
                if (scanner) scanner.classList.add('fade-out');
            }, 600);

            setTimeout(() => {
                const reportData = progress.report as unknown as {
                    success?: boolean;
                    data?: Record<string, unknown>;
                    metadata?: Record<string, unknown>;
                };

                if (reportData?.data) {
                    const data = reportData.data;
                    const summary = data.summary as Record<string, unknown> || {};
                    const transactions = data.transactions as Array<Record<string, unknown>> || [];
                    const analysisSummary = buildAnalysisSummary(transactions, reportData.metadata as Record<string, unknown> | undefined);

                    // Build VAT breakdown from transactions (more reliable than vat_breakdown)
                    const salesItems: Array<Record<string, unknown>> = [];
                    const costItems: Array<Record<string, unknown>> = [];

                    // Calculate totals from transactions
                    let outgoing25 = 0;
                    let outgoing12 = 0;
                    let outgoing6 = 0;
                    let incoming = 0;

                    // Group transactions by type and rate
                    const salesByRate: Record<number, { net: number; vat: number; gross: number; count: number }> = {};
                    const costsByRate: Record<number, { net: number; vat: number; gross: number; count: number }> = {};

                    for (const tx of transactions) {
                        const amount = Number(tx.amount || 0);
                        const netAmount = Number(tx.net_amount || 0);
                        const vatAmount = Number(tx.vat_amount || 0);
                        const rate = Number(tx.vat_rate || 0);
                        const isCost = tx.type === 'cost' || amount < 0;

                        if (isCost) {
                            // Cost transaction
                            incoming += Math.abs(vatAmount);
                            if (!costsByRate[rate]) costsByRate[rate] = { net: 0, vat: 0, gross: 0, count: 0 };
                            costsByRate[rate].net += Math.abs(netAmount);
                            costsByRate[rate].vat += Math.abs(vatAmount);
                            costsByRate[rate].gross += Math.abs(amount);
                            costsByRate[rate].count++;
                        } else {
                            // Sale transaction
                            if (rate === 25) outgoing25 += vatAmount;
                            else if (rate === 12) outgoing12 += vatAmount;
                            else if (rate === 6) outgoing6 += vatAmount;

                            if (!salesByRate[rate]) salesByRate[rate] = { net: 0, vat: 0, gross: 0, count: 0 };
                            salesByRate[rate].net += netAmount;
                            salesByRate[rate].vat += vatAmount;
                            salesByRate[rate].gross += amount;
                            salesByRate[rate].count++;
                        }
                    }

                    // Build sales items
                    if (salesByRate[25]) {
                        salesItems.push({
                            rate: 25,
                            type: 'sale',
                            net_amount: salesByRate[25].net,
                            vat_amount: salesByRate[25].vat,
                            gross_amount: salesByRate[25].gross,
                            transaction_count: salesByRate[25].count,
                            bas_account: '3010',
                            description: 'Privatladdning 25% moms'
                        });
                    }
                    if (salesByRate[0]) {
                        salesItems.push({
                            rate: 0,
                            type: 'sale',
                            net_amount: salesByRate[0].net,
                            vat_amount: 0,
                            gross_amount: salesByRate[0].gross,
                            transaction_count: salesByRate[0].count,
                            bas_account: '3011',
                            description: 'Roaming-försäljning momsfri (OCPI)'
                        });
                    }

                    // Build cost items
                    for (const [rate, totals] of Object.entries(costsByRate)) {
                        costItems.push({
                            rate: Number(rate),
                            type: 'cost',
                            net_amount: totals.net,
                            vat_amount: totals.vat,
                            gross_amount: totals.gross,
                            transaction_count: totals.count,
                            bas_account: '6590',
                            description: Number(rate) === 25 ? 'Abonnemang och avgifter' : 'Plattformsavgifter'
                        });
                    }

                    const totalOutgoing = outgoing25 + outgoing12 + outgoing6;
                    const netVat = totalOutgoing - incoming;

                    // Transform Claude's response to VATReportData format
                    // Note: This data was used for the side panel, now kept for future use
                    const _vatData: VATReportData = {
                        type: 'vat_report',
                        period: String(data.period || ''),
                        company: {
                            name: String(data.company_name || ''),
                            org_number: ''
                        },
                        summary: {
                            total_income: Number(summary.total_sales || summary.total_net || 0),
                            total_costs: Math.abs(Number(summary.total_costs || 0)),
                            result: Number(summary.result || (Number(summary.total_sales || 0) - Math.abs(Number(summary.total_costs || 0))))
                        },
                        sales: salesItems.map(item => ({
                            description: String(item.description || `${item.rate}% moms`),
                            net: Number(item.net_amount || 0),
                            vat: Number(item.vat_amount || 0),
                            rate: typeof item.rate === 'number' ? Number(item.rate) : 25  // Fix: 0 är ett giltigt värde
                        })),
                        costs: costItems.map(item => ({
                            description: String(item.description || 'Kostnad'),
                            net: Math.abs(Number(item.net_amount || 0)),
                            vat: Math.abs(Number(item.vat_amount || 0)),
                            rate: typeof item.rate === 'number' ? Number(item.rate) : 25  // Fix: 0 är ett giltigt värde
                        })),
                        vat: {
                            outgoing_25: outgoing25,
                            outgoing_12: outgoing12,
                            outgoing_6: outgoing6,
                            incoming: incoming,
                            net: netVat,
                            to_pay: netVat > 0 ? netVat : 0,
                            to_refund: netVat < 0 ? Math.abs(netVat) : 0
                        },
                        journal_entries: this.generateJournalEntries(salesItems, costItems, outgoing25, incoming),
                        validation: {
                            is_valid: Boolean((data.validation as Record<string, unknown>)?.passed ?? true),
                            errors: [],
                            warnings: ((data.validation as Record<string, unknown>)?.warnings as string[]) || []
                        },
                        analysis_summary: analysisSummary,
                        // Add EV charging specific data if available
                        charging_sessions: summary.total_kwh ? [{
                            id: 'summary',
                            kwh: Number(summary.total_kwh || 0),
                            amount: Number(summary.total_sales || 0),
                            roaming_count: Number(summary.roaming_count || 0),
                            private_count: Number(summary.private_count || 0),
                            roaming_sales: Number(summary.roaming_sales || 0),
                            private_sales: Number(summary.private_sales || 0)
                        }] : undefined
                    };

                    // Show VAT report in side panel after analysis completes
                    this.openVATReport(_vatData).catch(err =>
                        logger.error('Failed to open VAT report', err)
                    );
                }
            }, 1200); // Delay to show scanner completion + fade-out
        }

        // Handle error state
        if (progress.step === 'error') {
            this.addTerminalLine(`✗ ${progress.error || 'Okänt fel'}`, 'error');
            const scanline = document.getElementById('scanline');
            if (scanline) scanline.classList.add('error');
            this.showAnalysisError(progress.error || 'Okänt fel');
        }
    }

    /**
     * Format progress details for display
     */
    /**
     * Show analysis error in the streaming UI
     */
    showAnalysisError(error: string): void {
        this.setVatReportMode(false);
        this.panelState = 'error';
        this.elements.container.innerHTML = `
            <div class="excel-analyzing error">
                <div class="error-icon">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"/>
                        <line x1="15" y1="9" x2="9" y2="15"/>
                        <line x1="9" y1="9" x2="15" y2="15"/>
                    </svg>
                </div>
                <h3>Analysen misslyckades</h3>
                <p class="error-message">${this.escapeHtml(error)}</p>
                <button class="retry-btn" onclick="window.dispatchEvent(new CustomEvent('retry-analysis'))">
                    Försök igen
                </button>
            </div>
        `;
    }

    /**
     * Simple HTML escape
     */
    private escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Open and display a VAT report in the panel
     *
     * @param data - VAT report data to display
     * @param fileUrl - Optional URL to the original Excel file
     * @param filePath - Optional storage path to the original Excel file
     * @param fileBucket - Optional storage bucket for the Excel file
     * @param skipSave - Skip saving to messages (when opening from button)
     */
    async openVATReport(data: VATReportData, fileUrl?: string, filePath?: string, fileBucket?: string, skipSave = false): Promise<void> {
        try {
            this.setVatReportMode(true);

            // Unmount previous Preact component if exists
            this.vatReportUnmount?.();

            // Store content information
            this.currentContent = { type: 'vat_report', data, fileUrl, filePath, fileBucket };

            // Update panel title
            this.elements.filenameDisplay.textContent = `Bokföringsunderlag ${data.period}`;

            // Hide sheet tabs (not needed for report)
            this.elements.tabsContainer.style.display = 'none';

            // Hide panel tabs - SpreadsheetViewer has its own sheet tabs
            this.showPanelTabs(false);

            // Build in-memory workbook with pre-computed sheet data
            const spreadsheetData = await buildReportWorkbook(data);

            // Render action buttons in header
            this.renderHeaderActions(data);

            // Clear container and mount SpreadsheetViewer
            this.elements.container.innerHTML = '';
            this.vatReportUnmount = mountPreactComponent(
                SpreadsheetViewer,
                { spreadsheetData },
                this.elements.container
            );

            // Open the panel and update state
            this.elements.panel.classList.add('open');
            this.panelState = 'vat-report';

            // Show backdrop on mobile
            this.elements.backdrop?.classList.add('visible');

            // Update title icon for VAT report
            if (this.elements.titleIcon) {
                this.elements.titleIcon.textContent = '📄';
            }

            // Dispatch event so main.ts can save the VAT report to messages table
            // Only if not opening from a button (skipSave = false)
            if (!skipSave) {
                window.dispatchEvent(new CustomEvent('vat-report-ready', {
                    detail: { data, fileUrl, filePath, fileBucket }
                }));
            }

            logger.debug('VAT report opened in panel (Preact)', { period: data.period, skipSave, state: this.panelState });
        } catch (error) {
            logger.error('Error opening VAT report', error);
            const errorMessage = error instanceof Error ? error.message : 'Okänt fel';
            this.elements.container.innerHTML = `<div class="excel-error">Kunde inte visa momsrapporten: ${this.escapeHtml(errorMessage)}</div>`;

            if (this.options.onError && error instanceof Error) {
                this.options.onError(error);
            }
        }
    }

    /**
     * Generate journal entries (verifikationer) according to Swedish BAS account plan
     *
     * @param salesItems - Sales transactions grouped by VAT rate
     * @param costItems - Cost transactions grouped by VAT rate
     * @param outgoingVat - Total outgoing VAT (utgående moms)
     * @param incomingVat - Total incoming VAT (ingående moms)
     * @returns Array of journal entries
     */
    private generateJournalEntries(
        salesItems: Array<Record<string, unknown>>,
        costItems: Array<Record<string, unknown>>,
        outgoingVat: number,
        incomingVat: number
    ): Array<{ account: string; name: string; debit: number; credit: number }> {
        const entries: Array<{ account: string; name: string; debit: number; credit: number }> = [];

        // Calculate totals
        const totalSalesNet = salesItems.reduce((sum, item) => sum + Number(item.net_amount || 0), 0);
        const totalSalesGross = totalSalesNet + outgoingVat;
        const totalCostsNet = costItems.reduce((sum, item) => sum + Number(item.net_amount || 0), 0);
        const totalCostsGross = totalCostsNet + incomingVat;

        // INKOMSTER (SALES) - Kredit sida
        // 1930 Bankkonto (inkomster) - DEBET
        if (totalSalesGross > 0) {
            entries.push({
                account: '1930',
                name: 'Företagskonto (inkomster)',
                debit: totalSalesGross,
                credit: 0
            });
        }

        // Sales by type
        for (const item of salesItems) {
            const net = Number(item.net_amount || 0);
            const account = String(item.bas_account || '3000');
            const description = String(item.description || 'Försäljning');

            if (net > 0) {
                entries.push({
                    account: account,
                    name: description,
                    debit: 0,
                    credit: net
                });
            }
        }

        // 2610 Utgående moms - KREDIT
        if (outgoingVat > 0) {
            entries.push({
                account: '2610',
                name: 'Utgående moms 25%',
                debit: 0,
                credit: outgoingVat
            });
        }

        // KOSTNADER (COSTS) - Debet sida
        // Costs by type
        for (const item of costItems) {
            const net = Number(item.net_amount || 0);
            const account = String(item.bas_account || '6000');
            const description = String(item.description || 'Kostnad');

            if (net > 0) {
                entries.push({
                    account: account,
                    name: description,
                    debit: net,
                    credit: 0
                });
            }
        }

        // 2640 Ingående moms - DEBET
        if (incomingVat > 0) {
            entries.push({
                account: '2640',
                name: 'Ingående moms',
                debit: incomingVat,
                credit: 0
            });
        }

        // 1930 Bankkonto (kostnader) - KREDIT
        if (totalCostsGross > 0) {
            entries.push({
                account: '1930',
                name: 'Företagskonto (kostnader)',
                debit: 0,
                credit: totalCostsGross
            });
        }

        return entries;
    }

    /**
     * Get the current content type
     *
     * @returns Current content information or null if panel is closed
     */
    getCurrentContent(): ArtifactContent | null {
        return this.currentContent;
    }
}

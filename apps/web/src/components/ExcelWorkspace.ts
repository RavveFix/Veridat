import * as XLSX from 'xlsx';
import DOMPurify from 'dompurify';
import type { ExcelPanelElements, ExcelWorkspaceOptions } from '../types/excel';
import type { VATReportData } from '../types/vat';
import type { AIAnalysisProgress } from '../services/ChatService';
import { VATReportCard } from './VATReportCard';
import { ExcelArtifact, type ExcelSheet, type ExcelArtifactProps } from './ExcelArtifact';
import { mountPreactComponent } from './preact-adapter';
import { logger } from '../services/LoggerService';

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
    | { type: 'excel'; workbook: XLSX.WorkBook; filename: string }
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
    private currentWorkbook: XLSX.WorkBook | null = null;
    private currentFile: string | null = null;
    private currentContent: ArtifactContent | null = null;
    private panelState: PanelState = 'closed';
    private elements: ExcelPanelElements;
    private options: ExcelWorkspaceOptions;
    private vatReportUnmount?: () => void;
    private excelArtifactUnmount?: () => void;
    private boundHandleOpenArtifact: (e: Event) => void;
    private activeTab: 'summary' | 'transactions' | 'journal' = 'summary';

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
            );
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
            panelTabs: panelTabs || undefined
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
     * Open and display an Excel file from a URL
     *
     * @param fileUrl - Public URL to the Excel file
     * @param filename - Display name for the file
     */
    async openExcelFile(fileUrl: string, filename: string): Promise<void> {
        try {
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

            // Parse the Excel file with SheetJS
            this.currentWorkbook = XLSX.read(arrayBuffer, { type: 'array' });
            this.currentFile = filename;

            // Render sheet tabs
            this.renderSheetTabs();

            // Display the first sheet
            if (this.currentWorkbook.SheetNames.length > 0) {
                this.displaySheet(this.currentWorkbook.SheetNames[0]);
            } else {
                this.elements.container.innerHTML = '<div class="excel-error">Inga flikar hittades i denna Excel-fil.</div>';
            }

        } catch (error) {
            console.error('Error opening Excel file:', error);
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

            // Parse the Excel file with SheetJS
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
            console.error('Error opening Excel artifact:', error);
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
    updateArtifactStatus(status: ExcelArtifactProps['status']): void {
        // Re-mount with updated status
        if (this.currentWorkbook && this.currentFile) {
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
                this.displaySheet(sheetName);

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
    private displaySheet(sheetName: string): void {
        if (!this.currentWorkbook) {
            this.elements.container.innerHTML = '<div class="excel-error">Ingen arbetsbok laddad.</div>';
            return;
        }

        const worksheet = this.currentWorkbook.Sheets[sheetName];

        if (!worksheet) {
            this.elements.container.innerHTML = '<div class="excel-error">Flik hittades inte.</div>';
            return;
        }

        // Convert worksheet to HTML table
        const htmlTable = XLSX.utils.sheet_to_html(worksheet, {
            id: 'excel-table',
            editable: false
        });

        const safeTableHtml = this.sanitizeExcelHtmlTable(htmlTable);
        if (!safeTableHtml) {
            this.elements.container.innerHTML = '<div class="excel-error">Kunde inte rendera Excel-tabellen säkert.</div>';
            return;
        }

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

        this.elements.panel.classList.remove('open');
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
        // Update panel title
        this.elements.filenameDisplay.textContent = filename;

        // Hide sheet tabs
        this.elements.tabsContainer.style.display = 'none';

        // Create streaming progress UI
        this.elements.container.innerHTML = `
            <div class="excel-analyzing streaming">
                <div class="ai-thinking">
                    <div class="ai-avatar">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Z"/>
                            <circle cx="12" cy="12" r="4"/>
                        </svg>
                    </div>
                    <div class="thinking-text">AI analyserar...</div>
                </div>

                <div class="streaming-progress">
                    <div class="progress-bar-container">
                        <div class="progress-bar" id="ai-progress-bar"></div>
                    </div>
                    <div class="progress-text" id="ai-progress-text">Förbereder analys...</div>
                    <div class="confidence-display" id="ai-confidence" style="display: none;">
                        <div class="confidence-bar-container">
                            <div class="confidence-bar" id="ai-confidence-bar"></div>
                        </div>
                        <span class="confidence-label" id="ai-confidence-label"></span>
                    </div>
                </div>

                <div class="analysis-steps" id="ai-analysis-steps">
                    <!-- STEG 1: CLAUDE -->
                    <div class="step-group" data-ai="claude">
                        <div class="step-group-header">
                            <span class="ai-badge claude">Claude</span>
                            <span class="step-group-title">Analyserar & beräknar</span>
                        </div>
                        <div class="step-item" data-step="parsing">
                            <div class="step-indicator pending"></div>
                            <div class="step-content">
                                <div class="step-title">Läser Excel-fil</div>
                                <div class="step-detail"></div>
                            </div>
                        </div>
                        <div class="step-item" data-step="analyzing">
                            <div class="step-indicator pending"></div>
                            <div class="step-content">
                                <div class="step-title">Identifierar kolumner</div>
                                <div class="step-detail"></div>
                            </div>
                        </div>
                        <div class="step-item" data-step="calculating">
                            <div class="step-indicator pending"></div>
                            <div class="step-content">
                                <div class="step-title">Beräknar moms & kWh</div>
                                <div class="step-detail"></div>
                            </div>
                        </div>
                    </div>

                    <!-- STEG 2: PYTHON -->
                    <div class="step-group" data-ai="python">
                        <div class="step-group-header">
                            <span class="ai-badge python">Python</span>
                            <span class="step-group-title">Verifierar beräkningar</span>
                        </div>
                        <div class="step-item" data-step="verifying">
                            <div class="step-indicator pending"></div>
                            <div class="step-content">
                                <div class="step-title">Kontrollerar moms exakt</div>
                                <div class="step-detail"></div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="ai-insights" id="ai-insights-container">
                    <!-- Insight bubbles will be added here dynamically -->
                </div>

                <div class="ai-notes" id="ai-analysis-notes" style="display: none;">
                    <div class="notes-header">AI insikter</div>
                    <div class="notes-content" id="ai-notes-content"></div>
                </div>
            </div>
        `;

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

    /**
     * Show an insight bubble with animation (Claude-style AI explanation)
     */
    private showInsightBubble(insight: string): void {
        const container = document.getElementById('ai-insights-container');
        if (!container) return;

        // Create bubble element
        const bubble = document.createElement('div');
        bubble.className = 'insight-bubble';
        bubble.innerHTML = `
            <div class="insight-icon">💡</div>
            <div class="insight-text">${this.escapeHtml(insight)}</div>
        `;

        // Add to container with animation
        container.appendChild(bubble);

        // Trigger animation
        requestAnimationFrame(() => {
            bubble.classList.add('visible');
        });

        // Scroll to show latest insight
        container.scrollTop = container.scrollHeight;
    }

    /**
     * Update streaming analysis progress
     *
     * @param progress - Progress update from AI analysis
     */
    updateStreamingProgress(progress: AIAnalysisProgress): void {
        // Update progress bar
        const progressBar = document.getElementById('ai-progress-bar');
        const progressText = document.getElementById('ai-progress-text');

        if (progressBar && typeof progress.progress === 'number') {
            progressBar.style.width = `${Math.round(progress.progress * 100)}%`;
        }

        if (progressText && progress.message) {
            progressText.textContent = progress.message;
        }

        // Update confidence display if present
        const confidenceContainer = document.getElementById('ai-confidence');
        const confidenceBar = document.getElementById('ai-confidence-bar');
        const confidenceLabel = document.getElementById('ai-confidence-label');

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const progressAny = progress as any;
        const confidence = progressAny.confidence as number | undefined;

        if (confidence !== undefined && !isNaN(confidence) && confidenceContainer && confidenceBar && confidenceLabel) {
            confidenceContainer.style.display = 'flex';
            confidenceBar.style.width = `${confidence}%`;

            // Set color based on confidence level
            let confidenceClass = 'high';
            let label = 'Hög säkerhet';
            if (confidence < 70) {
                confidenceClass = 'low';
                label = 'Låg säkerhet';
            } else if (confidence < 90) {
                confidenceClass = 'medium';
                label = 'Medelhög säkerhet';
            }

            confidenceBar.className = `confidence-bar ${confidenceClass}`;
            confidenceLabel.textContent = `${label} (${Math.round(confidence)}%)`;
        }

        // Show insight bubble if present (Claude-style AI explanation)
        if (progress.insight) {
            this.showInsightBubble(progress.insight);
        }

        // Update step indicators
        const stepsContainer = document.getElementById('ai-analysis-steps');
        if (stepsContainer) {
            // All steps in order - includes Monta-specific steps (detecting, categorizing)
            const steps = ['parsing', 'analyzing', 'detecting', 'categorizing', 'mapping', 'normalizing', 'calculating', 'python-calculating', 'claude-validating'];
            const currentStepIndex = steps.indexOf(progress.step);

            steps.forEach((step, index) => {
                const stepItem = stepsContainer.querySelector(`[data-step="${step}"]`);
                if (!stepItem) return;

                const indicator = stepItem.querySelector('.step-indicator');
                const detail = stepItem.querySelector('.step-detail');

                if (index < currentStepIndex) {
                    // Completed steps
                    indicator?.classList.remove('pending', 'active');
                    indicator?.classList.add('completed');
                } else if (index === currentStepIndex) {
                    // Current step
                    indicator?.classList.remove('pending', 'completed');
                    indicator?.classList.add('active');

                    // Update detail if we have it
                    if (detail && progress.details) {
                        const detailText = this.formatProgressDetails(progress.step, progress.details);
                        if (detailText) {
                            detail.textContent = detailText;
                        }
                    }
                } else {
                    // Future steps
                    indicator?.classList.remove('active', 'completed');
                    indicator?.classList.add('pending');
                }
            });
        }

        // Update AI notes if we have mapping info
        if (progress.step === 'mapping' && progress.details) {
            this.showAINotes(progress.details);
        }

        // Handle complete state - show the VAT report
        if (progress.step === 'complete' && progress.report) {
            const thinkingText = this.elements.container.querySelector('.thinking-text');
            if (thinkingText) {
                thinkingText.textContent = 'Analys klar!';
            }

            // After a brief delay to show "Analys klar!", display the actual report
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

                    console.log('[Veridat] Sales items:', salesItems);
                    console.log('[Veridat] Cost items:', costItems);
                    console.log('[Veridat] Summary:', summary);

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
                    this.openVATReport(_vatData);
                }
            }, 800); // Brief delay to show completion
        }

        // Handle error state
        if (progress.step === 'error') {
            this.showAnalysisError(progress.error || 'Okänt fel');
        }
    }

    /**
     * Format progress details for display
     */
    private formatProgressDetails(step: string, details: Record<string, unknown>): string {
        switch (step) {
            case 'parsing':
                if (details.rows_count && details.columns_count) {
                    return `${details.rows_count} rader, ${details.columns_count} kolumner`;
                }
                break;
            case 'mapping':
                if (details.file_type) {
                    return String(details.file_type);
                }
                break;
            case 'normalizing':
                if (details.total_transactions) {
                    return `${details.total_transactions} transaktioner`;
                }
                break;
            case 'python-calculating':
                if (details.period) {
                    return `Period: ${details.period}`;
                }
                break;
            case 'claude-validating':
                if (details.passed !== undefined) {
                    return details.passed ? 'Godkänd' : 'Varningar hittades';
                }
                break;
        }
        return '';
    }

    /**
     * Show AI analysis notes/insights
     */
    private showAINotes(details: Record<string, unknown>): void {
        const notesContainer = document.getElementById('ai-analysis-notes');
        const notesContent = document.getElementById('ai-notes-content');

        if (notesContainer && notesContent) {
            const notes: string[] = [];

            if (details.file_type) {
                notes.push(`<strong>Filtyp:</strong> ${this.escapeHtml(String(details.file_type))}`);
            }

            if (details.confidence) {
                const confidence = Math.round(Number(details.confidence) * 100);
                const confidenceClass = confidence >= 80 ? 'high' : confidence >= 60 ? 'medium' : 'low';
                notes.push(`<strong>Konfidens:</strong> <span class="confidence ${confidenceClass}">${confidence}%</span>`);
            }

            if (details.notes) {
                notes.push(`<strong>Observation:</strong> ${this.escapeHtml(String(details.notes))}`);
            }

            if (notes.length > 0) {
                notesContent.innerHTML = notes.join('<br>');
                notesContainer.style.display = 'block';
            }
        }
    }

    /**
     * Show analysis error in the streaming UI
     */
    showAnalysisError(error: string): void {
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
    openVATReport(data: VATReportData, fileUrl?: string, filePath?: string, fileBucket?: string, skipSave = false): void {
        try {
            // Unmount previous Preact component if exists
            this.vatReportUnmount?.();

            // Store content information
            this.currentContent = { type: 'vat_report', data, fileUrl, filePath, fileBucket };

            // Update panel title
            this.elements.filenameDisplay.textContent = `Momsredovisning ${data.period}`;

            // Hide sheet tabs (not needed for VAT report)
            this.elements.tabsContainer.style.display = 'none';

            // Show panel tabs and reset to summary
            this.showPanelTabs(true);
            this.setActiveTab('summary');

            // Clear container and mount Preact component
            this.elements.container.innerHTML = '';
            this.vatReportUnmount = mountPreactComponent(
                VATReportCard,
                { data, initialTab: 'summary' },
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
            console.error('Error opening VAT report:', error);
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

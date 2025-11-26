import * as XLSX from 'xlsx';
import type { ExcelPanelElements, ExcelWorkspaceOptions } from '../types/excel';
import type { VATReportData } from '../types/vat';
import { VATReportCard } from './VATReportCard';
import { mountPreactComponent } from './preact-adapter';

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
    | { type: 'vat_report'; data: VATReportData; fileUrl?: string };

export class ExcelWorkspace {
    private currentWorkbook: XLSX.WorkBook | null = null;
    private currentFile: string | null = null;
    private currentContent: ArtifactContent | null = null;
    private elements: ExcelPanelElements;
    private options: ExcelWorkspaceOptions;
    private vatReportUnmount?: () => void;

    constructor(options: ExcelWorkspaceOptions = {}) {
        this.options = options;
        this.elements = this.initializePanel();
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

        if (!panel || !container || !tabsContainer || !closeBtn || !filenameDisplay) {
            throw new Error('Excel panel DOM elements not found. Ensure all required elements exist in the HTML.');
        }

        // Attach close button listener
        closeBtn.addEventListener('click', () => this.closePanel());

        return {
            panel,
            container,
            tabsContainer,
            closeBtn,
            filenameDisplay
        };
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
            this.elements.container.innerHTML = `<div class="excel-error">Kunde inte ladda Excel-filen: ${errorMessage}</div>`;

            // Call error callback if provided
            if (this.options.onError && error instanceof Error) {
                this.options.onError(error);
            }
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

        this.elements.container.innerHTML = htmlTable;

        // Add custom styling to the table
        const table = this.elements.container.querySelector('table');
        if (table) {
            table.classList.add('excel-table');
        }
    }

    /**
     * Close the Excel panel and clear state
     */
    closePanel(): void {
        // Unmount Preact component if present
        this.vatReportUnmount?.();
        this.vatReportUnmount = undefined;

        this.elements.panel.classList.remove('open');
        this.currentWorkbook = null;
        this.currentFile = null;
        this.currentContent = null;
        this.elements.container.innerHTML = '';
        this.elements.tabsContainer.innerHTML = '';
        this.elements.filenameDisplay.textContent = '';

        // Reset tabs visibility
        this.elements.tabsContainer.style.display = '';

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
     * Open and display a VAT report in the panel
     *
     * @param data - VAT report data to display
     * @param fileUrl - Optional URL to the original Excel file
     */
    openVATReport(data: VATReportData, fileUrl?: string): void {
        try {
            // Unmount previous Preact component if exists
            this.vatReportUnmount?.();

            // Store content information
            this.currentContent = { type: 'vat_report', data, fileUrl };

            // Update panel title
            this.elements.filenameDisplay.textContent = `Momsredovisning ${data.period}`;

            // Hide sheet tabs (not needed for VAT report)
            this.elements.tabsContainer.style.display = 'none';

            // Clear container and mount Preact component
            this.elements.container.innerHTML = '';
            this.vatReportUnmount = mountPreactComponent(
                VATReportCard,
                { data },
                this.elements.container
            );

            // Open the panel
            this.elements.panel.classList.add('open');

            console.log('VAT report opened in panel (Preact):', data.period);
        } catch (error) {
            console.error('Error opening VAT report:', error);
            const errorMessage = error instanceof Error ? error.message : 'Okänt fel';
            this.elements.container.innerHTML = `<div class="excel-error">Kunde inte visa momsrapporten: ${errorMessage}</div>`;

            if (this.options.onError && error instanceof Error) {
                this.options.onError(error);
            }
        }
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

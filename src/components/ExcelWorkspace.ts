import * as XLSX from 'xlsx';
import type { ExcelPanelElements, ExcelWorkspaceOptions } from '../types/excel';
import type { VATReportData } from '../types/vat';
import type { AIAnalysisProgress } from '../services/ChatService';
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

                <div class="ai-notes" id="ai-analysis-notes" style="display: none;">
                    <div class="notes-header">AI insikter</div>
                    <div class="notes-content" id="ai-notes-content"></div>
                </div>
            </div>
        `;

        // Open the panel
        this.elements.panel.classList.add('open');
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

        // Update step indicators
        const stepsContainer = document.getElementById('ai-analysis-steps');
        if (stepsContainer) {
            // All steps in order across all 3 AI backends
            const steps = ['parsing', 'analyzing', 'mapping', 'normalizing', 'python-calculating', 'claude-validating'];
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
                    // Debug: log the full response
                    console.log('[Britta] Full report data:', JSON.stringify(reportData.data, null, 2));

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

                    console.log('[Britta] Sales items:', salesItems);
                    console.log('[Britta] Cost items:', costItems);
                    console.log('[Britta] Summary:', summary);

                    const totalOutgoing = outgoing25 + outgoing12 + outgoing6;
                    const netVat = totalOutgoing - incoming;

                    // Transform Claude's response to VATReportData format
                    const vatData: VATReportData = {
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
                            rate: Number(item.rate || 25)
                        })),
                        costs: costItems.map(item => ({
                            description: String(item.description || 'Kostnad'),
                            net: Math.abs(Number(item.net_amount || 0)),
                            vat: Math.abs(Number(item.vat_amount || 0)),
                            rate: Number(item.rate || 25)
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
                        journal_entries: [],
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

                    // Show the VAT report
                    this.openVATReport(vatData);
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
                notes.push(`<strong>Filtyp:</strong> ${details.file_type}`);
            }

            if (details.confidence) {
                const confidence = Math.round(Number(details.confidence) * 100);
                const confidenceClass = confidence >= 80 ? 'high' : confidence >= 60 ? 'medium' : 'low';
                notes.push(`<strong>Konfidens:</strong> <span class="confidence ${confidenceClass}">${confidence}%</span>`);
            }

            if (details.notes) {
                notes.push(`<strong>Observation:</strong> ${details.notes}`);
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

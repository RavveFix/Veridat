// Excel Viewer Module
// Handles parsing and displaying Excel files using SheetJS

class ExcelViewer {
    constructor() {
        this.currentWorkbook = null;
        this.currentFile = null;
        this.panel = null;
        this.container = null;
        this.tabsContainer = null;
        this.closeBtn = null;
        this.filenameDisplay = null;

        this.initializePanel();
    }

    initializePanel() {
        this.panel = document.getElementById('excel-panel');
        this.container = document.getElementById('excel-table-container');
        this.tabsContainer = document.getElementById('sheet-tabs');
        this.closeBtn = document.getElementById('close-excel-panel');
        this.filenameDisplay = document.getElementById('excel-filename');

        if (this.closeBtn) {
            this.closeBtn.addEventListener('click', () => this.closePanel());
        }
    }

    async openExcelFile(fileUrl, filename) {
        try {
            this.filenameDisplay.textContent = filename;

            // Show loading state
            this.container.innerHTML = '<div class="excel-loading">Loading Excel file...</div>';
            this.panel.classList.add('open');

            // Fetch the file
            const response = await fetch(fileUrl);
            if (!response.ok) {
                throw new Error(`Failed to fetch file: ${response.statusText}`);
            }

            const arrayBuffer = await response.arrayBuffer();

            // Check if XLSX library is loaded
            if (typeof XLSX === 'undefined') {
                throw new Error('SheetJS library not loaded');
            }

            // Parse the Excel file
            this.currentWorkbook = XLSX.read(arrayBuffer, { type: 'array' });
            this.currentFile = filename;

            // Render sheet tabs
            this.renderSheetTabs();

            // Display the first sheet
            if (this.currentWorkbook.SheetNames.length > 0) {
                this.displaySheet(this.currentWorkbook.SheetNames[0]);
            } else {
                this.container.innerHTML = '<div class="excel-error">No sheets found in this Excel file.</div>';
            }

        } catch (error) {
            console.error('Error opening Excel file:', error);
            this.container.innerHTML = `<div class="excel-error">Failed to load Excel file: ${error.message}</div>`;
        }
    }

    renderSheetTabs() {
        this.tabsContainer.innerHTML = '';

        this.currentWorkbook.SheetNames.forEach((sheetName, index) => {
            const tab = document.createElement('button');
            tab.className = 'sheet-tab';
            tab.textContent = sheetName;
            tab.dataset.sheetName = sheetName;

            if (index === 0) {
                tab.classList.add('active');
            }

            tab.addEventListener('click', () => {
                // Remove active class from all tabs
                this.tabsContainer.querySelectorAll('.sheet-tab').forEach(t => {
                    t.classList.remove('active');
                });
                // Add active class to clicked tab
                tab.classList.add('active');
                // Display the selected sheet
                this.displaySheet(sheetName);
            });

            this.tabsContainer.appendChild(tab);
        });
    }

    displaySheet(sheetName) {
        const worksheet = this.currentWorkbook.Sheets[sheetName];

        if (!worksheet) {
            this.container.innerHTML = '<div class="excel-error">Sheet not found.</div>';
            return;
        }

        // Convert worksheet to HTML table
        const htmlTable = XLSX.utils.sheet_to_html(worksheet, {
            id: 'excel-table',
            editable: false
        });

        this.container.innerHTML = htmlTable;

        // Add custom styling to the table
        const table = this.container.querySelector('table');
        if (table) {
            table.classList.add('excel-table');
        }
    }

    closePanel() {
        this.panel.classList.remove('open');
        this.currentWorkbook = null;
        this.currentFile = null;
        this.container.innerHTML = '';
        this.tabsContainer.innerHTML = '';
        this.filenameDisplay.textContent = '';
    }

    isOpen() {
        return this.panel && this.panel.classList.contains('open');
    }
}

// Export for use in main.js
window.ExcelViewer = ExcelViewer;

import type * as XLSX from 'xlsx';

/**
 * Excel workbook data including parsed workbook and metadata
 */
export interface ExcelWorkbookData {
  workbook: XLSX.WorkBook;
  filename: string;
  currentSheet: string;
}

/**
 * DOM element references for Excel panel
 */
export interface ExcelPanelElements {
  panel: HTMLElement;
  container: HTMLElement;
  tabsContainer: HTMLElement;
  closeBtn: HTMLElement;
  filenameDisplay: HTMLElement;
  /** Optional backdrop for mobile overlay */
  backdrop?: HTMLElement;
  /** Optional title icon element */
  titleIcon?: HTMLElement;
  /** Optional panel tabs for VAT report navigation */
  panelTabs?: HTMLElement;
  /** Optional header actions container for action buttons */
  headerActions?: HTMLElement;
}

/**
 * Configuration options for ExcelWorkspace
 */
export interface ExcelWorkspaceOptions {
  onClose?: () => void;
  onSheetChange?: (sheetName: string) => void;
  onError?: (error: Error) => void;
}

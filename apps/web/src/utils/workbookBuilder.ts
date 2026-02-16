import type { VATReportData } from '../types/vat';
import { groupToVerifikationer } from './verifikatGrouper';

type SheetRow = Array<string | number | null>;

/** Style hints for a single cell in the spreadsheet viewer */
export interface CellStyle {
    bold?: boolean;
    bgColor?: string;
    textColor?: string;
    isSectionHeader?: boolean;
    isTotalRow?: boolean;
    isColumnHeader?: boolean;
    isTitle?: boolean;
}

/** Pre-computed sheet data ready for rendering (no SheetJS dependency needed) */
export interface PrecomputedSheet {
    name: string;
    rows: SheetRow[];
    colWidths: number[];
    maxCol: number;
    styles: Record<string, CellStyle>;
}

/** Complete spreadsheet data with both renderable sheets and the SheetJS workbook for download */
export interface SpreadsheetData {
    sheets: PrecomputedSheet[];
    workbook: import('xlsx').WorkBook;
}

/** Convert character-width to approximate pixel width */
function wchToPixels(wch: number): number {
    return Math.round(wch * 8.5 + 16);
}

/** Encode cell address like "A0", "B3" etc. */
function cellAddr(row: number, col: number): string {
    let letter = '';
    let c = col;
    while (c >= 0) {
        letter = String.fromCharCode(65 + (c % 26)) + letter;
        c = Math.floor(c / 26) - 1;
    }
    return `${letter}${row}`;
}

/**
 * Build a complete report workbook from VATReportData.
 * Returns pre-computed sheet data with style maps for the SpreadsheetViewer,
 * plus the SheetJS WorkBook for Excel download.
 */
export async function buildReportWorkbook(data: VATReportData): Promise<SpreadsheetData> {
    const XLSX = await import('xlsx');
    const { period, company, sales, costs, vat, journal_entries } = data;

    const wb = XLSX.utils.book_new();
    const precomputedSheets: PrecomputedSheet[] = [];

    // ── Sheet 1: Sammanfattning ──
    const sammanfattningRows: SheetRow[] = [];
    const sammanfattningStyles: Record<string, CellStyle> = {};

    sammanfattningRows.push(['BOKFÖRINGSUNDERLAG – MONTA']);
    sammanfattningStyles[cellAddr(0, 0)] = { isTitle: true, bold: true };

    sammanfattningRows.push([`${company?.name || 'Företag'} | Org.nr: ${company?.org_number || 'N/A'}`]);
    sammanfattningStyles[cellAddr(1, 0)] = { bold: true };

    sammanfattningRows.push([`Period: ${period}`]);
    sammanfattningRows.push([`Genererat: ${new Date().toLocaleDateString('sv-SE')} ${new Date().toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}`]);
    sammanfattningRows.push([]);

    // INTÄKTER section
    const intakterRow = sammanfattningRows.length;
    sammanfattningRows.push(['INTÄKTER']);
    sammanfattningStyles[cellAddr(intakterRow, 0)] = { isSectionHeader: true, bold: true, bgColor: '#0d9488', textColor: '#ffffff' };

    const intakterHeaderRow = sammanfattningRows.length;
    sammanfattningRows.push(['Kategori', 'Antal', 'Belopp exkl. moms', 'Moms (25%)']);
    for (let c = 0; c < 4; c++) {
        sammanfattningStyles[cellAddr(intakterHeaderRow, c)] = { isColumnHeader: true, bold: true, bgColor: '#f0f0f0' };
    }

    for (const s of sales) {
        sammanfattningRows.push([s.description, 1, s.net, s.vat]);
    }

    const totalSalesNet = sales.reduce((sum, s) => sum + s.net, 0);
    const totalSalesVat = sales.reduce((sum, s) => sum + s.vat, 0);
    const sumIntakterRow = sammanfattningRows.length;
    sammanfattningRows.push(['Summa intäkter', sales.length, totalSalesNet, totalSalesVat]);
    for (let c = 0; c < 4; c++) {
        sammanfattningStyles[cellAddr(sumIntakterRow, c)] = { isTotalRow: true, bold: true };
    }

    sammanfattningRows.push([]);

    // KOSTNADER section
    const kostnaderRow = sammanfattningRows.length;
    sammanfattningRows.push(['KOSTNADER']);
    sammanfattningStyles[cellAddr(kostnaderRow, 0)] = { isSectionHeader: true, bold: true, bgColor: '#dc2626', textColor: '#ffffff' };

    const kostnaderHeaderRow = sammanfattningRows.length;
    sammanfattningRows.push(['Kategori', 'Antal', 'Belopp exkl. moms', 'Moms (25%)']);
    for (let c = 0; c < 4; c++) {
        sammanfattningStyles[cellAddr(kostnaderHeaderRow, c)] = { isColumnHeader: true, bold: true, bgColor: '#f0f0f0' };
    }

    for (const c of costs) {
        sammanfattningRows.push([c.description, 1, -Math.abs(c.net), -Math.abs(c.vat)]);
    }

    const totalCostsNet = costs.reduce((sum, c) => sum + Math.abs(c.net), 0);
    const totalCostsVat = costs.reduce((sum, c) => sum + Math.abs(c.vat), 0);
    const sumKostnaderRow = sammanfattningRows.length;
    sammanfattningRows.push(['Summa kostnader', costs.length, -totalCostsNet, -totalCostsVat]);
    for (let c = 0; c < 4; c++) {
        sammanfattningStyles[cellAddr(sumKostnaderRow, c)] = { isTotalRow: true, bold: true };
    }

    sammanfattningRows.push([]);

    // NETTORESULTAT
    const nettoRow = sammanfattningRows.length;
    sammanfattningRows.push(['NETTORESULTAT (intäkter + kostnader)', null, totalSalesNet - totalCostsNet, totalSalesVat - totalCostsVat]);
    for (let c = 0; c < 4; c++) {
        sammanfattningStyles[cellAddr(nettoRow, c)] = { isTotalRow: true, bold: true, bgColor: '#eef2ff' };
    }

    // Build SheetJS sheet
    const sammanfattningSheet = XLSX.utils.aoa_to_sheet(sammanfattningRows);
    const sammanfattningColWidths = [45, 8, 20, 15];
    sammanfattningSheet['!cols'] = sammanfattningColWidths.map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, sammanfattningSheet, 'Sammanfattning');

    precomputedSheets.push({
        name: 'Sammanfattning',
        rows: sammanfattningRows,
        colWidths: sammanfattningColWidths.map(wchToPixels),
        maxCol: 4,
        styles: sammanfattningStyles,
    });

    // ── Sheet 2: Verifikationer ──
    const verifikationer = groupToVerifikationer(journal_entries, sales, costs, period);
    const verifikationerRows: SheetRow[] = [];
    const verifikationerStyles: Record<string, CellStyle> = {};

    verifikationerRows.push(['VERIFIKATIONER']);
    verifikationerStyles[cellAddr(0, 0)] = { isTitle: true, bold: true };
    verifikationerRows.push([]);

    for (const v of verifikationer) {
        const vTitleRow = verifikationerRows.length;
        verifikationerRows.push([`V${v.number} – ${v.description}`, null, null, null]);
        verifikationerStyles[cellAddr(vTitleRow, 0)] = { isSectionHeader: true, bold: true, bgColor: '#1e40af', textColor: '#ffffff' };

        verifikationerRows.push([`Datum: ${v.date}`, null, null, null]);

        const headerRow = verifikationerRows.length;
        verifikationerRows.push(['Konto', 'Benämning', 'Debet', 'Kredit']);
        for (let c = 0; c < 4; c++) {
            verifikationerStyles[cellAddr(headerRow, c)] = { isColumnHeader: true, bold: true, bgColor: '#f0f0f0' };
        }

        for (const e of v.entries) {
            verifikationerRows.push([e.account, e.name, e.debit || null, e.credit || null]);
        }

        const totalD = v.entries.reduce((sum, e) => sum + e.debit, 0);
        const totalC = v.entries.reduce((sum, e) => sum + e.credit, 0);
        const totRow = verifikationerRows.length;
        verifikationerRows.push(['', 'TOTALT', totalD, totalC]);
        for (let c = 0; c < 4; c++) {
            verifikationerStyles[cellAddr(totRow, c)] = { isTotalRow: true, bold: true };
        }

        verifikationerRows.push([]);
    }

    const verifikationerSheet = XLSX.utils.aoa_to_sheet(verifikationerRows);
    const verifikationerColWidths = [12, 40, 15, 15];
    verifikationerSheet['!cols'] = verifikationerColWidths.map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, verifikationerSheet, 'Verifikationer');

    precomputedSheets.push({
        name: 'Verifikationer',
        rows: verifikationerRows,
        colWidths: verifikationerColWidths.map(wchToPixels),
        maxCol: 4,
        styles: verifikationerStyles,
    });

    // ── Sheet 3: Momsrapport ──
    const momsRows: SheetRow[] = [];
    const momsStyles: Record<string, CellStyle> = {};

    momsRows.push(['MOMSRAPPORT']);
    momsStyles[cellAddr(0, 0)] = { isTitle: true, bold: true };
    momsRows.push([`Period: ${period}`]);
    momsRows.push([]);

    const utgaendeRow = momsRows.length;
    momsRows.push(['UTGÅENDE MOMS']);
    momsStyles[cellAddr(utgaendeRow, 0)] = { isSectionHeader: true, bold: true, bgColor: '#0d9488', textColor: '#ffffff' };

    momsRows.push(['Utgående moms 25%', vat.outgoing_25 || 0]);
    if ((vat.outgoing_12 ?? 0) > 0) momsRows.push(['Utgående moms 12%', vat.outgoing_12!]);
    if ((vat.outgoing_6 ?? 0) > 0) momsRows.push(['Utgående moms 6%', vat.outgoing_6!]);

    const sumUtgRow = momsRows.length;
    momsRows.push(['Summa utgående moms', (vat.outgoing_25 || 0) + (vat.outgoing_12 || 0) + (vat.outgoing_6 || 0)]);
    for (let c = 0; c < 2; c++) {
        momsStyles[cellAddr(sumUtgRow, c)] = { isTotalRow: true, bold: true };
    }

    momsRows.push([]);

    const ingaendeRow = momsRows.length;
    momsRows.push(['INGÅENDE MOMS']);
    momsStyles[cellAddr(ingaendeRow, 0)] = { isSectionHeader: true, bold: true, bgColor: '#2563eb', textColor: '#ffffff' };
    momsRows.push(['Ingående moms (avdragsgill)', vat.incoming || 0]);

    momsRows.push([]);

    const nettoSectionRow = momsRows.length;
    momsRows.push(['NETTO']);
    momsStyles[cellAddr(nettoSectionRow, 0)] = { isSectionHeader: true, bold: true, bgColor: '#7c3aed', textColor: '#ffffff' };
    momsRows.push(['Nettomoms', vat.net]);

    const payRow = momsRows.length;
    momsRows.push([vat.net >= 0 ? 'Moms att betala' : 'Moms att återfå', Math.abs(vat.net)]);
    for (let c = 0; c < 2; c++) {
        momsStyles[cellAddr(payRow, c)] = { isTotalRow: true, bold: true, bgColor: '#eef2ff' };
    }

    const momsSheet = XLSX.utils.aoa_to_sheet(momsRows);
    const momsColWidths = [30, 18];
    momsSheet['!cols'] = momsColWidths.map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, momsSheet, 'Momsrapport');

    precomputedSheets.push({
        name: 'Momsrapport',
        rows: momsRows,
        colWidths: momsColWidths.map(wchToPixels),
        maxCol: 2,
        styles: momsStyles,
    });

    // ── Sheet 4: Transaktioner ──
    const txRows: SheetRow[] = [];
    const txStyles: Record<string, CellStyle> = {};

    txRows.push(['TRANSAKTIONER']);
    txStyles[cellAddr(0, 0)] = { isTitle: true, bold: true };
    txRows.push([`Period: ${period}`]);
    txRows.push([]);

    const txHeaderRow = txRows.length;
    txRows.push(['Typ', 'Beskrivning', 'Netto', 'Moms', 'Brutto', 'Momssats (%)']);
    for (let c = 0; c < 6; c++) {
        txStyles[cellAddr(txHeaderRow, c)] = { isColumnHeader: true, bold: true, bgColor: '#f0f0f0' };
    }

    for (const s of sales) {
        txRows.push(['Intäkt', s.description, s.net, s.vat, s.net + s.vat, s.rate]);
    }
    for (const c of costs) {
        txRows.push(['Kostnad', c.description, -Math.abs(c.net), -Math.abs(c.vat), -(Math.abs(c.net) + Math.abs(c.vat)), c.rate]);
    }

    txRows.push([]);

    const grandNet = totalSalesNet - totalCostsNet;
    const grandVat = totalSalesVat - totalCostsVat;
    const totTxRow = txRows.length;
    txRows.push(['TOTALT', `${sales.length + costs.length} transaktioner`, grandNet, grandVat, grandNet + grandVat, null]);
    for (let c = 0; c < 6; c++) {
        txStyles[cellAddr(totTxRow, c)] = { isTotalRow: true, bold: true };
    }

    const txSheet = XLSX.utils.aoa_to_sheet(txRows);
    const txColWidths = [10, 40, 15, 12, 15, 12];
    txSheet['!cols'] = txColWidths.map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, txSheet, 'Transaktioner');

    precomputedSheets.push({
        name: 'Transaktioner',
        rows: txRows,
        colWidths: txColWidths.map(wchToPixels),
        maxCol: 6,
        styles: txStyles,
    });

    return { sheets: precomputedSheets, workbook: wb };
}

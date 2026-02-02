import * as XLSX from 'xlsx';
import type { VATReportData } from '../types/vat';

type SheetRow = Array<string | number | null>;
type SheetData = SheetRow[];

export async function generateExcelFile(data: VATReportData): Promise<void> {
    const { period, company, sales, costs, vat, journal_entries, summary } = data;

    // Create workbook
    const wb = XLSX.utils.book_new();

    // Sheet 1: Sammanfattning
    const summaryData: SheetData = [
        ['MOMSREDOVISNING', period],
        [],
        ['Företag:', company?.name || ''],
        ['Organisationsnummer:', company?.org_number || ''],
        [],
        ['SAMMANFATTNING'],
        ['Total försäljning (exkl moms)', summary.total_income],
        ['Totala kostnader (exkl moms)', summary.total_costs],
        ['Resultat', summary.result],
        [],
        ['MOMSREDOVISNING'],
        ['Utgående moms 25%', vat.outgoing_25 || 0],
        ['Utgående moms 12%', vat.outgoing_12 || 0],
        ['Utgående moms 6%', vat.outgoing_6 || 0],
        ['Ingående moms', vat.incoming || 0],
        ['Nettomoms', vat.net],
        ['Moms att betala', vat.to_pay || 0],
        ['Moms att återfå', vat.to_refund || 0]
    ];

    const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
    summarySheet['!cols'] = [{ wch: 30 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, summarySheet, 'Sammanfattning');

    // Sheet 2: Försäljning
    const salesData: SheetData = [['Beskrivning', 'Netto (exkl moms)', 'Moms', 'Momssats (%)']];
    sales.forEach(s => salesData.push([s.description, s.net, s.vat, s.rate]));

    const salesSheet = XLSX.utils.aoa_to_sheet(salesData);
    salesSheet['!cols'] = [{ wch: 40 }, { wch: 18 }, { wch: 12 }, { wch: 15 }];
    XLSX.utils.book_append_sheet(wb, salesSheet, 'Försäljning');

    // Sheet 3: Kostnader
    const costsData: SheetData = [['Beskrivning', 'Netto (exkl moms)', 'Moms', 'Momssats (%)']];
    costs.forEach(c => costsData.push([c.description, c.net, c.vat, c.rate]));

    const costsSheet = XLSX.utils.aoa_to_sheet(costsData);
    costsSheet['!cols'] = [{ wch: 40 }, { wch: 18 }, { wch: 12 }, { wch: 15 }];
    XLSX.utils.book_append_sheet(wb, costsSheet, 'Kostnader');

    // Sheet 4: Momsuppdelning
    const vatData: SheetData = [
        ['UTGÅENDE MOMS'],
        ['Moms 25%', vat.outgoing_25 || 0],
        ['Moms 12%', vat.outgoing_12 || 0],
        ['Moms 6%', vat.outgoing_6 || 0],
        [],
        ['INGÅENDE MOMS'],
        ['Moms', vat.incoming || 0],
        [],
        ['NETTO'],
        ['Nettomoms', vat.net],
        ['Moms att betala', vat.to_pay || 0],
        ['Moms att återfå', vat.to_refund || 0]
    ];

    const vatSheet = XLSX.utils.aoa_to_sheet(vatData);
    vatSheet['!cols'] = [{ wch: 25 }, { wch: 15 }];
    XLSX.utils.book_append_sheet(wb, vatSheet, 'Moms');

    // Sheet 5: Verifikationer
    const journalData: SheetData = [['Konto', 'Kontonamn', 'Debet', 'Kredit']];
    journal_entries.forEach(e => journalData.push([e.account, e.name, e.debit, e.credit]));

    // Add totals
    const totalDebit = journal_entries.reduce((sum, e) => sum + e.debit, 0);
    const totalCredit = journal_entries.reduce((sum, e) => sum + e.credit, 0);
    journalData.push([]);
    journalData.push(['TOTALT', '', totalDebit, totalCredit]);

    const journalSheet = XLSX.utils.aoa_to_sheet(journalData);
    journalSheet['!cols'] = [{ wch: 10 }, { wch: 35 }, { wch: 15 }, { wch: 15 }];
    XLSX.utils.book_append_sheet(wb, journalSheet, 'Verifikationer');

    // Generate filename
    const safeName = (company?.name || 'Rapport').replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `Momsredovisning_${period}_${safeName}.xlsx`;

    // Download file
    XLSX.writeFile(wb, filename);
}

export function copyReportToClipboard(data: VATReportData): void {
    const text = formatReportAsText(data);

    navigator.clipboard.writeText(text)
        .then(() => {
            console.log('Report copied to clipboard');
        })
        .catch(err => {
            console.error('Failed to copy:', err);
        });
}

function formatReportAsText(data: VATReportData): string {
    let text = `MOMSREDOVISNING ${data.period}\n\n`;
    text += `Företag: ${data.company?.name || 'N/A'}\n`;
    text += `Org.nr: ${data.company?.org_number || 'N/A'}\n\n`;

    text += `=== SAMMANFATTNING ===\n`;
    text += `Försäljning: ${data.summary.total_income.toFixed(2)} SEK\n`;
    text += `Kostnader: ${data.summary.total_costs.toFixed(2)} SEK\n`;
    text += `Resultat: ${data.summary.result.toFixed(2)} SEK\n\n`;

    text += `=== MOMS ===\n`;
    text += `Utgående moms 25%: ${data.vat.outgoing_25.toFixed(2)} SEK\n`;
    if (data.vat.outgoing_12) {
        text += `Utgående moms 12%: ${data.vat.outgoing_12.toFixed(2)} SEK\n`;
    }
    if (data.vat.outgoing_6) {
        text += `Utgående moms 6%: ${data.vat.outgoing_6.toFixed(2)} SEK\n`;
    }
    text += `Ingående moms: ${data.vat.incoming.toFixed(2)} SEK\n`;
    text += `Nettomoms: ${data.vat.net.toFixed(2)} SEK\n`;

    return text;
}

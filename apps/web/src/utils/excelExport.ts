import type { VATReportData } from '../types/vat';
import { buildReportWorkbook } from './workbookBuilder';
import { logger } from '../services/LoggerService';

export async function generateExcelFile(data: VATReportData): Promise<void> {
    const XLSX = await import('xlsx');
    const { workbook } = await buildReportWorkbook(data);

    const safeName = (data.company?.name || 'Rapport').replace(/[^a-zA-Z0-9åäöÅÄÖ]/g, '_');
    const filename = `Bokforingsunderlag_${data.period}_${safeName}.xlsx`;

    XLSX.writeFile(workbook, filename);
}

export function copyReportToClipboard(data: VATReportData): void {
    const text = formatReportAsText(data);

    navigator.clipboard.writeText(text)
        .then(() => {
            logger.debug('Report copied to clipboard');
        })
        .catch(err => {
            logger.error('Failed to copy report to clipboard', err);
        });
}

function formatReportAsText(data: VATReportData): string {
    let text = `BOKFÖRINGSUNDERLAG ${data.period}\n`;
    text += `${'═'.repeat(40)}\n\n`;
    text += `Företag: ${data.company?.name || 'N/A'}\n`;
    text += `Org.nr: ${data.company?.org_number || 'N/A'}\n\n`;

    text += `── SAMMANFATTNING ──\n`;
    text += `Försäljning: ${data.summary.total_income.toFixed(2)} SEK\n`;
    text += `Kostnader: ${data.summary.total_costs.toFixed(2)} SEK\n`;
    text += `Resultat: ${data.summary.result.toFixed(2)} SEK\n\n`;

    text += `── MOMS ──\n`;
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

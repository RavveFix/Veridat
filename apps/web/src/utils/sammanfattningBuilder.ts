import type { VATReportData, SammanfattningRow } from '../types/vat';

export interface SammanfattningData {
    intakter: SammanfattningRow[];
    kostnader: SammanfattningRow[];
    totalIntakter: { antal: number; belopp: number; moms: number };
    totalKostnader: { antal: number; belopp: number; moms: number };
    nettoresultat: { belopp: number; moms: number };
    noter: string[];
}

/**
 * Builds structured Sammanfattning data from VATReportData.
 * Maps sales/costs into the table format matching the Claude/Opus output.
 */
export function buildSammanfattning(data: VATReportData): SammanfattningData {
    // Build intäkter rows from sales
    const intakter: SammanfattningRow[] = data.sales.map(s => ({
        kategori: s.description || `Försäljning ${s.rate}% moms`,
        antal: 1,
        belopp_exkl_moms: s.net,
        moms: s.vat,
        rate: s.rate,
    }));

    // Build kostnader rows from costs
    const kostnader: SammanfattningRow[] = data.costs.map(c => ({
        kategori: c.description || `Kostnad ${c.rate}% moms`,
        antal: 1,
        belopp_exkl_moms: -Math.abs(c.net),
        moms: -Math.abs(c.vat),
        rate: c.rate,
    }));

    // If analysis_summary has transaction counts, use those for antal
    if (data.analysis_summary) {
        const summary = data.analysis_summary;
        // Try to distribute counts across rows
        if (intakter.length > 0 && summary.revenue_transactions > 0) {
            // If top_revenues has count data, use it
            for (const row of intakter) {
                const match = summary.top_revenues.find(r => r.label === row.kategori);
                if (match) row.antal = match.count;
            }
        }
        if (kostnader.length > 0 && summary.cost_transactions > 0) {
            for (const row of kostnader) {
                const match = summary.top_costs.find(c => c.label === row.kategori);
                if (match) row.antal = match.count;
            }
        }
    }

    // Calculate totals
    const totalIntakter = {
        antal: intakter.reduce((sum, r) => sum + r.antal, 0),
        belopp: intakter.reduce((sum, r) => sum + r.belopp_exkl_moms, 0),
        moms: intakter.reduce((sum, r) => sum + r.moms, 0),
    };

    const totalKostnader = {
        antal: kostnader.reduce((sum, r) => sum + r.antal, 0),
        belopp: kostnader.reduce((sum, r) => sum + r.belopp_exkl_moms, 0),
        moms: kostnader.reduce((sum, r) => sum + r.moms, 0),
    };

    const nettoresultat = {
        belopp: totalIntakter.belopp + totalKostnader.belopp,
        moms: totalIntakter.moms + totalKostnader.moms,
    };

    // Build notes
    const noter = buildNoter(data);

    return { intakter, kostnader, totalIntakter, totalKostnader, nettoresultat, noter };
}

function buildNoter(data: VATReportData): string[] {
    const noter: string[] = [];

    // Check for 0% VAT (roaming / reverse charge)
    const hasZeroVat = data.sales.some(s => s.rate === 0) || data.costs.some(c => c.rate === 0);
    if (hasZeroVat) {
        noter.push('* 3014 = Försäljning tjänster utomlands, omvänd skattskyldighet (reverse charge). Roaming-intäkter från utländska operatörer redovisas utan moms.');
    }

    // Check for roaming costs
    const hasRoamingCosts = data.costs.some(c =>
        c.description?.toLowerCase().includes('roaming') ||
        c.description?.toLowerCase().includes('transaktionsavgift')
    );
    if (hasRoamingCosts) {
        noter.push('Transaktionsavgifter till utländska operatörer debiteras utan moms – omvänd skattskyldighet.');
    }

    // Subscription note
    const hasSubscription = data.costs.some(c =>
        c.description?.toLowerCase().includes('abonnemang') ||
        c.description?.toLowerCase().includes('subscription')
    );
    if (hasSubscription) {
        noter.push('Operatörsabonnemang avser månadsavgift för plattformen.');
    }

    // General note
    noter.push('Alla belopp i SEK. Underlag baserat på transaktionsexport.');

    // Validation warnings as notes
    if (data.validation?.warnings?.length) {
        for (const w of data.validation.warnings) {
            noter.push(`Obs: ${w}`);
        }
    }

    return noter;
}

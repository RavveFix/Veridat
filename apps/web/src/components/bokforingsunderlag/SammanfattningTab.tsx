import { FunctionComponent } from 'preact';
import type { VATReportData } from '../../types/vat';
import { buildSammanfattning, type SammanfattningData } from '../../utils/sammanfattningBuilder';
import { useMemo } from 'preact/hooks';

interface SammanfattningTabProps {
    data: VATReportData;
}

const fmt = (v: number) => v.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const SammanfattningTab: FunctionComponent<SammanfattningTabProps> = ({ data }) => {
    const sammanfattning = useMemo(() => buildSammanfattning(data), [data]);

    return (
        <div class="bfu-sammanfattning">
            {/* Company header */}
            <div class="bfu-doc-header">
                <div class="bfu-doc-company">{data.company?.name || 'Företag'}</div>
                {data.company?.org_number && (
                    <div class="bfu-doc-meta">Org.nr: {data.company.org_number}</div>
                )}
                <div class="bfu-doc-meta">Period: {data.period}</div>
                <div class="bfu-doc-meta">
                    Genererat: {new Date().toLocaleDateString('sv-SE')} {new Date().toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}
                </div>
            </div>

            {/* INTÄKTER */}
            <SectionTable
                title="INTÄKTER"
                rows={sammanfattning.intakter}
                total={sammanfattning.totalIntakter}
                totalLabel="Summa intäkter"
                colorClass="income"
            />

            {/* KOSTNADER */}
            <SectionTable
                title="KOSTNADER"
                rows={sammanfattning.kostnader}
                total={sammanfattning.totalKostnader}
                totalLabel="Summa kostnader"
                colorClass="costs"
            />

            {/* NETTORESULTAT */}
            <div class="bfu-nettoresultat">
                <div class="bfu-nettoresultat-label">NETTORESULTAT (intäkter + kostnader)</div>
                <div class="bfu-nettoresultat-values">
                    <span class={`bfu-nettoresultat-amount ${sammanfattning.nettoresultat.belopp >= 0 ? 'positive' : 'negative'}`}>
                        {fmt(sammanfattning.nettoresultat.belopp)} kr
                    </span>
                    <span class={`bfu-nettoresultat-moms ${sammanfattning.nettoresultat.moms >= 0 ? 'positive' : 'negative'}`}>
                        {fmt(sammanfattning.nettoresultat.moms)} kr
                    </span>
                </div>
            </div>

            {/* NOTER */}
            {sammanfattning.noter.length > 0 && (
                <div class="bfu-noter">
                    <div class="bfu-noter-title">NOTER</div>
                    {sammanfattning.noter.map((note, i) => (
                        <div key={i} class="bfu-noter-item">{note}</div>
                    ))}
                </div>
            )}
        </div>
    );
};

/* Reusable section table for Intäkter and Kostnader */
interface SectionTableProps {
    title: string;
    rows: SammanfattningData['intakter'];
    total: SammanfattningData['totalIntakter'];
    totalLabel: string;
    colorClass: string;
}

const SectionTable: FunctionComponent<SectionTableProps> = ({ title, rows, total, totalLabel, colorClass }) => (
    <div class={`bfu-section bfu-section--${colorClass}`}>
        <div class="bfu-section-title">{title}</div>
        <table class="bfu-table">
            <thead>
                <tr>
                    <th class="bfu-table-col-kategori">Kategori</th>
                    <th class="bfu-table-col-antal">Antal</th>
                    <th class="bfu-table-col-belopp">Belopp exkl. moms</th>
                    <th class="bfu-table-col-moms">Moms (25%)</th>
                </tr>
            </thead>
            <tbody>
                {rows.map((row, i) => (
                    <tr key={i}>
                        <td>{row.kategori}</td>
                        <td class="num">{row.antal}</td>
                        <td class="num">{fmt(row.belopp_exkl_moms)} kr</td>
                        <td class="num">{fmt(row.moms)} kr</td>
                    </tr>
                ))}
            </tbody>
            <tfoot>
                <tr class="bfu-table-total">
                    <td>{totalLabel}</td>
                    <td class="num">{total.antal}</td>
                    <td class="num">{fmt(total.belopp)} kr</td>
                    <td class="num">{fmt(total.moms)} kr</td>
                </tr>
            </tfoot>
        </table>
    </div>
);

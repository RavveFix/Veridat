import { FunctionComponent } from 'preact';
import { useMemo } from 'preact/hooks';
import type { VATReportData, Verifikat } from '../../types/vat';
import { groupToVerifikationer } from '../../utils/verifikatGrouper';

interface VerifikationerTabProps {
    data: VATReportData;
}

const fmt = (v: number) => v.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const VerifikationerTab: FunctionComponent<VerifikationerTabProps> = ({ data }) => {
    const verifikationer = useMemo(
        () => groupToVerifikationer(data.journal_entries, data.sales, data.costs, data.period),
        [data]
    );

    if (verifikationer.length === 0) {
        return <div class="bfu-empty">Inga verifikationer genererade.</div>;
    }

    return (
        <div class="bfu-verifikationer">
            {verifikationer.map(v => (
                <VerifikatCard key={v.number} verifikat={v} />
            ))}
        </div>
    );
};

const VerifikatCard: FunctionComponent<{ verifikat: Verifikat }> = ({ verifikat }) => {
    const totalDebit = verifikat.entries.reduce((sum, e) => sum + e.debit, 0);
    const totalCredit = verifikat.entries.reduce((sum, e) => sum + e.credit, 0);
    const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;

    return (
        <div class="bfu-verifikat">
            <div class="bfu-verifikat-header">
                <div class="bfu-verifikat-badge">V{verifikat.number}</div>
                <div class="bfu-verifikat-info">
                    <div class="bfu-verifikat-desc">{verifikat.description}</div>
                    <div class="bfu-verifikat-date">{verifikat.date}</div>
                </div>
                {verifikat.grossAmount !== undefined && (
                    <div class={`bfu-verifikat-amount ${verifikat.grossAmount >= 0 ? 'positive' : 'negative'}`}>
                        {fmt(verifikat.grossAmount)} kr
                    </div>
                )}
            </div>
            <table class="bfu-verifikat-table">
                <thead>
                    <tr>
                        <th class="col-account">Konto</th>
                        <th class="col-name">Benämning</th>
                        <th class="col-amount">Debet</th>
                        <th class="col-amount">Kredit</th>
                    </tr>
                </thead>
                <tbody>
                    {verifikat.entries.map((entry, i) => (
                        <tr key={i}>
                            <td class="col-account">{entry.account}</td>
                            <td class="col-name">{entry.name}</td>
                            <td class="col-amount debit">
                                {entry.debit > 0 ? fmt(entry.debit) : ''}
                            </td>
                            <td class="col-amount credit">
                                {entry.credit > 0 ? fmt(entry.credit) : ''}
                            </td>
                        </tr>
                    ))}
                </tbody>
                <tfoot>
                    <tr class="bfu-verifikat-total">
                        <td></td>
                        <td class="col-name">
                            <span class={isBalanced ? 'bfu-balance-ok' : 'bfu-balance-error'}>
                                {isBalanced ? '✓ Balanserad' : '✗ Ej balanserad'}
                            </span>
                        </td>
                        <td class="col-amount debit">{fmt(totalDebit)}</td>
                        <td class="col-amount credit">{fmt(totalCredit)}</td>
                    </tr>
                </tfoot>
            </table>
        </div>
    );
};

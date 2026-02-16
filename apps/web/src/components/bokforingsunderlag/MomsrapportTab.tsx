import { FunctionComponent } from 'preact';
import type { VATReportData } from '../../types/vat';

interface MomsrapportTabProps {
    data: VATReportData;
}

const fmt = (v: number) => v.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const MomsrapportTab: FunctionComponent<MomsrapportTabProps> = ({ data }) => {
    const { vat } = data;
    const netVat = vat.net ?? 0;
    const isRefund = netVat < 0;

    return (
        <div class="bfu-momsrapport">
            {/* Utgående moms */}
            <div class="bfu-moms-section">
                <div class="bfu-moms-section-title">UTGÅENDE MOMS</div>
                <div class="bfu-moms-rows">
                    <MomsRow label="Utgående moms 25%" amount={vat.outgoing_25} />
                    {(vat.outgoing_12 ?? 0) > 0 && (
                        <MomsRow label="Utgående moms 12%" amount={vat.outgoing_12!} />
                    )}
                    {(vat.outgoing_6 ?? 0) > 0 && (
                        <MomsRow label="Utgående moms 6%" amount={vat.outgoing_6!} />
                    )}
                    <MomsRow
                        label="Summa utgående moms"
                        amount={(vat.outgoing_25 || 0) + (vat.outgoing_12 || 0) + (vat.outgoing_6 || 0)}
                        isTotal
                    />
                </div>
            </div>

            {/* Ingående moms */}
            <div class="bfu-moms-section">
                <div class="bfu-moms-section-title">INGÅENDE MOMS</div>
                <div class="bfu-moms-rows">
                    <MomsRow label="Ingående moms (avdragsgill)" amount={vat.incoming} isNegative />
                </div>
            </div>

            {/* Netto */}
            <div class={`bfu-moms-netto ${isRefund ? 'refund' : 'pay'}`}>
                <div class="bfu-moms-netto-row">
                    <span class="bfu-moms-netto-label">
                        {isRefund ? 'Moms att återfå' : 'Moms att betala'}
                    </span>
                    <span class="bfu-moms-netto-amount">
                        {fmt(Math.abs(netVat))} kr
                    </span>
                </div>
            </div>

            {/* Skatteverket info */}
            <div class="bfu-moms-info">
                <div class="bfu-moms-info-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"/>
                        <path d="M12 16v-4"/>
                        <path d="M12 8h.01"/>
                    </svg>
                </div>
                <div class="bfu-moms-info-text">
                    Redovisas till Skatteverket via momsdeklaration.
                    Kontrollera att beloppen stämmer med ditt bokföringssystem.
                </div>
            </div>
        </div>
    );
};

interface MomsRowProps {
    label: string;
    amount: number;
    isTotal?: boolean;
    isNegative?: boolean;
}

const MomsRow: FunctionComponent<MomsRowProps> = ({ label, amount, isTotal, isNegative }) => (
    <div class={`bfu-moms-row ${isTotal ? 'total' : ''}`}>
        <span class="bfu-moms-row-label">{label}</span>
        <span class={`bfu-moms-row-amount ${isNegative ? 'negative' : ''}`}>
            {isNegative ? '-' : ''}{fmt(Math.abs(amount))} kr
        </span>
    </div>
);

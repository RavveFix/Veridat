import { FunctionComponent } from 'preact';
import { useState } from 'preact/hooks';
import { BorderBeam } from '@/registry/magicui/border-beam';
import type { VATReportData } from '../../types/vat';

interface VATSummaryCardProps {
    /** Period (e.g., "December 2024") */
    period: string;
    /** Net VAT amount (positive = pay, negative = refund) */
    netVat: number;
    /** Total sales/income */
    totalIncome?: number;
    /** Full VAT report data for opening in side panel */
    fullData: VATReportData;
    /** Optional file URL for downloads */
    fileUrl?: string;
    /** Optional storage path for secure access */
    filePath?: string;
    /** Optional storage bucket */
    fileBucket?: string;
}

/**
 * VATSummaryCard - Compact inline card for VAT reports
 *
 * Displays a small summary pill in the chat with:
 * - Period badge
 * - Net VAT amount (to pay or refund)
 * - "Open report" button that opens the full report in the side panel
 *
 * This replaces the full inline VATArtifact for a cleaner chat experience.
 */
export const VATSummaryCard: FunctionComponent<VATSummaryCardProps> = ({
    period,
    netVat,
    totalIncome,
    fullData,
    fileUrl,
    filePath,
    fileBucket,
}) => {
    const [isHovered, setIsHovered] = useState(false);
    const isRefund = netVat < 0;
    const displayVat = Math.abs(netVat);
    const vatLabel = isRefund ? 'Att återfå' : 'Att betala';

    const handleOpenPanel = () => {
        // Dispatch event to open VAT report in side panel
        window.dispatchEvent(new CustomEvent('open-artifact-panel', {
            detail: {
                type: 'vat_report',
                data: fullData,
                fileUrl,
                filePath,
                fileBucket
            }
        }));
    };

    return (
        <div
            class={`vat-summary-card ${isHovered ? 'hovered' : ''}`}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            <BorderBeam 
                size={120} 
                duration={10} 
                delay={0}
                colorFrom="var(--accent-primary)"
                colorTo="var(--accent-secondary)"
            />
            {/* Success indicator */}
            <div class="vat-summary-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
            </div>

            {/* Content */}
            <div class="vat-summary-content">
                <div class="vat-summary-header">
                    <span class="vat-summary-title">Momsredovisning klar</span>
                    <span class="vat-summary-period">{period}</span>
                </div>

                <div class="vat-summary-stats">
                    {totalIncome !== undefined && (
                        <div class="vat-summary-stat">
                            <span class="stat-value">{totalIncome.toLocaleString('sv-SE')}</span>
                            <span class="stat-label">SEK försäljning</span>
                        </div>
                    )}
                    <div class={`vat-summary-stat ${isRefund ? 'refund' : 'pay'}`}>
                        <span class="stat-value">{displayVat.toLocaleString('sv-SE')}</span>
                        <span class="stat-label">SEK {vatLabel.toLowerCase()}</span>
                    </div>
                </div>
            </div>

            {/* Action button */}
            <button
                class="vat-summary-action"
                onClick={handleOpenPanel}
                title="Öppna fullständig rapport"
            >
                <span>Öppna rapport</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
            </button>
        </div>
    );
};

export default VATSummaryCard;

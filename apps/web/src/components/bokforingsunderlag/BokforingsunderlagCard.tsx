import { FunctionComponent } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import type { VATReportData } from '../../types/vat';
import { generateExcelFile, copyReportToClipboard } from '../../utils/excelExport';
import { logger } from '../../services/LoggerService';
import { SammanfattningTab } from './SammanfattningTab';
import { VerifikationerTab } from './VerifikationerTab';
import { MomsrapportTab } from './MomsrapportTab';
import { TransaktionerTab } from './TransaktionerTab';
import { groupToVerifikationer } from '../../utils/verifikatGrouper';

type BokforingsunderlagTab = 'sammanfattning' | 'verifikationer' | 'momsrapport' | 'transaktioner';

interface BokforingsunderlagCardProps {
    data: VATReportData;
    variant?: 'panel' | 'inline';
    initialTab?: BokforingsunderlagTab;
}

const TABS: { id: BokforingsunderlagTab; label: string; countKey?: string }[] = [
    { id: 'sammanfattning', label: 'Sammanfattning' },
    { id: 'verifikationer', label: 'Verifikationer' },
    { id: 'momsrapport', label: 'Momsrapport' },
    { id: 'transaktioner', label: 'Transaktioner' },
];

export const BokforingsunderlagCard: FunctionComponent<BokforingsunderlagCardProps> = ({
    data,
    variant = 'panel',
    initialTab = 'sammanfattning',
}) => {
    const [activeTab, setActiveTab] = useState<BokforingsunderlagTab>(initialTab);
    const [downloadLoading, setDownloadLoading] = useState(false);
    const [downloadSuccess, setDownloadSuccess] = useState(false);
    const [copySuccess, setCopySuccess] = useState(false);

    // Compute tab counts
    const verifikationer = useMemo(
        () => groupToVerifikationer(data.journal_entries, data.sales, data.costs, data.period),
        [data]
    );
    const txCount = data.sales.length + data.costs.length;

    const getTabCount = (id: BokforingsunderlagTab): number | undefined => {
        switch (id) {
            case 'verifikationer': return verifikationer.length;
            case 'transaktioner': return txCount;
            default: return undefined;
        }
    };

    const handleDownload = async () => {
        if (downloadLoading) return;
        setDownloadLoading(true);
        try {
            await generateExcelFile(data);
            setDownloadSuccess(true);
            setTimeout(() => {
                setDownloadLoading(false);
                setDownloadSuccess(false);
            }, 2000);
        } catch (error) {
            logger.error('Excel generation failed:', error);
            setDownloadLoading(false);
        }
    };

    const handleCopy = () => {
        copyReportToClipboard(data);
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 2000);
    };

    return (
        <div class={`bfu ${variant === 'inline' ? 'bfu--inline' : 'bfu--panel'}`}>
            {/* Header */}
            <div class="bfu-header">
                <div class="bfu-header-top">
                    <div class="bfu-header-icon">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                            <polyline points="14 2 14 8 20 8"/>
                            <line x1="16" y1="13" x2="8" y2="13"/>
                            <line x1="16" y1="17" x2="8" y2="17"/>
                        </svg>
                    </div>
                    <div class="bfu-header-text">
                        <h2 class="bfu-title">BOKFÖRINGSUNDERLAG</h2>
                        <div class="bfu-subtitle">
                            {data.company?.name || 'Företag'}
                            {data.period && <span class="bfu-period-badge">{data.period}</span>}
                        </div>
                    </div>
                </div>

                {/* Validation badge */}
                {data.validation?.is_valid && (
                    <div class="bfu-validation-badge success">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                            <polyline points="20 6 9 17 4 12"/>
                        </svg>
                        Validerad
                    </div>
                )}
            </div>

            {/* Tab Navigation */}
            <div class="bfu-tabs">
                {TABS.map(tab => {
                    const count = getTabCount(tab.id);
                    return (
                        <button
                            key={tab.id}
                            class={`bfu-tab ${activeTab === tab.id ? 'active' : ''}`}
                            onClick={() => setActiveTab(tab.id)}
                        >
                            {tab.label}
                            {count !== undefined && <span class="bfu-tab-count">{count}</span>}
                        </button>
                    );
                })}
            </div>

            {/* Tab Content */}
            <div class="bfu-content">
                {activeTab === 'sammanfattning' && <SammanfattningTab data={data} />}
                {activeTab === 'verifikationer' && <VerifikationerTab data={data} />}
                {activeTab === 'momsrapport' && <MomsrapportTab data={data} />}
                {activeTab === 'transaktioner' && <TransaktionerTab data={data} />}
            </div>

            {/* Action Footer */}
            <div class="bfu-actions">
                <button
                    class={`bfu-action-btn bfu-action-primary ${downloadSuccess ? 'success' : ''}`}
                    onClick={handleDownload}
                    disabled={downloadLoading}
                >
                    {downloadLoading ? (
                        <span>Genererar...</span>
                    ) : downloadSuccess ? (
                        <span>✓ Nedladdad!</span>
                    ) : (
                        <>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                <polyline points="7 10 12 15 17 10"/>
                                <line x1="12" y1="15" x2="12" y2="3"/>
                            </svg>
                            Ladda ner Excel
                        </>
                    )}
                </button>
                <button class="bfu-action-btn bfu-action-secondary" onClick={handleCopy}>
                    {copySuccess ? '✓ Kopierat!' : 'Kopiera'}
                </button>
            </div>
        </div>
    );
};

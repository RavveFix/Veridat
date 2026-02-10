import { FunctionComponent } from 'preact';

interface FortnoxSyncStatus {
    status: 'not_synced' | 'pending' | 'in_progress' | 'success' | 'failed' | null;
    fortnoxDocumentNumber: string | null;
    fortnoxVoucherSeries: string | null;
    syncedAt: string | null;
    errorMessage?: string;
}

interface FortnoxSyncStatusPanelProps {
    status: FortnoxSyncStatus;
    loading: boolean;
    error: string | null;
    onExport: () => void;
}

export type { FortnoxSyncStatus };

export const FortnoxSyncStatusPanel: FunctionComponent<FortnoxSyncStatusPanelProps> = ({ status, loading, error, onExport }) => {
    const formatDate = (dateStr: string | null) => {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        return date.toLocaleDateString('sv-SE', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    const getStatusIcon = () => {
        switch (status.status) {
            case 'success':
                return (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                        <polyline points="22 4 12 14.01 9 11.01"></polyline>
                    </svg>
                );
            case 'failed':
                return (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="15" y1="9" x2="9" y2="15"></line>
                        <line x1="9" y1="9" x2="15" y2="15"></line>
                    </svg>
                );
            case 'pending':
            case 'in_progress':
                return (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" class="spin">
                        <circle cx="12" cy="12" r="10"></circle>
                        <polyline points="12 6 12 12 16 14"></polyline>
                    </svg>
                );
            default:
                return (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="2">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="8" x2="12" y2="12"></line>
                        <line x1="12" y1="16" x2="12.01" y2="16"></line>
                    </svg>
                );
        }
    };

    const getStatusText = () => {
        switch (status.status) {
            case 'success':
                return `Exporterad som ${status.fortnoxVoucherSeries}-${status.fortnoxDocumentNumber}`;
            case 'failed':
                return 'Export misslyckades';
            case 'pending':
                return 'Väntar på export...';
            case 'in_progress':
                return 'Exporterar...';
            default:
                return 'Ej exporterad till Fortnox';
        }
    };

    return (
        <div class={`fortnox-sync-panel ${status.status || 'not_synced'}`}>
            <div class="fortnox-header">
                <div class="fortnox-logo">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                        <rect width="24" height="24" rx="4" fill="#1B365D"/>
                        <text x="12" y="16" text-anchor="middle" fill="white" font-size="10" font-weight="bold">FX</text>
                    </svg>
                    <span>Fortnox Integration</span>
                </div>
                <div class="fortnox-status">
                    {getStatusIcon()}
                    <span class="status-text">{getStatusText()}</span>
                </div>
            </div>

            {status.status === 'success' && status.syncedAt && (
                <div class="fortnox-details">
                    <span class="sync-date">Exporterad {formatDate(status.syncedAt)}</span>
                    <a
                        href={`https://apps.fortnox.se/vouchers/${status.fortnoxVoucherSeries}/${status.fortnoxDocumentNumber}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="fortnox-link"
                    >
                        Öppna i Fortnox →
                    </a>
                </div>
            )}

            {error && (
                <div class="fortnox-error">
                    <span>{error}</span>
                </div>
            )}

            {(status.status === null || status.status === 'not_synced' || status.status === 'failed') && (
                <>
                    <button
                        class="btn-fortnox"
                        onClick={onExport}
                        disabled={loading}
                    >
                        {loading ? (
                            <>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin">
                                    <circle cx="12" cy="12" r="10"></circle>
                                    <path d="M12 2a10 10 0 0 1 10 10"></path>
                                </svg>
                                Exporterar...
                            </>
                        ) : (
                            <>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                    <polyline points="17 8 12 3 7 8"></polyline>
                                    <line x1="12" y1="3" x2="12" y2="15"></line>
                                </svg>
                                {status.status === 'failed' ? 'Försök igen' : 'Exportera till Fortnox'}
                            </>
                        )}
                    </button>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #888)', marginTop: '0.5rem', textAlign: 'center', lineHeight: '1.4' }}>
                        AI-genererat förslag — granska innan export.
                    </div>
                </>
            )}
        </div>
    );
};

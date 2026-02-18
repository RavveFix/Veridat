import { useEffect, useMemo, useState } from 'preact/hooks';
import { companyService } from '../services/CompanyService';
import type { Company } from '../types/company';

interface AgencyPanelProps {
    onBack: () => void;
}

const AGENCY_PANEL_STACK_STYLE = {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem'
};

const AGENCY_HEADER_ROW_STYLE = {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem'
};

const AGENCY_BACK_BUTTON_STYLE = {
    background: 'transparent',
    border: '1px solid var(--glass-border)',
    borderRadius: '8px',
    color: 'var(--text-secondary)',
    padding: '0.4rem 0.75rem',
    fontSize: '0.8rem',
    cursor: 'pointer'
};

const AGENCY_SUBTITLE_STYLE = {
    fontSize: '0.85rem',
    color: 'var(--text-secondary)'
};

const AGENCY_STATUS_MESSAGE_STYLE = {
    padding: '0.7rem 0.9rem',
    borderRadius: '8px',
    background: 'rgba(16, 185, 129, 0.12)',
    color: '#10b981',
    fontSize: '0.85rem',
    border: '1px solid rgba(16, 185, 129, 0.25)'
};

const AGENCY_COMPANY_LIST_CARD_STYLE = {
    padding: '1rem',
    borderRadius: '12px',
    border: '1px solid var(--glass-border)',
    background: 'rgba(255, 255, 255, 0.04)'
};

const AGENCY_COMPANY_LIST_TITLE_STYLE = {
    fontWeight: 600,
    color: 'var(--text-primary)',
    marginBottom: '0.75rem'
};

const AGENCY_EMPTY_STATE_STYLE = {
    fontSize: '0.85rem',
    color: 'var(--text-secondary)'
};

const AGENCY_COMPANY_LIST_STYLE = {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.6rem'
};

const AGENCY_COMPANY_DETAILS_STYLE = {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem'
};

const AGENCY_COMPANY_NAME_STYLE = {
    fontWeight: 600,
    color: 'var(--text-primary)'
};

const AGENCY_COMPANY_META_STYLE = {
    fontSize: '0.8rem',
    color: 'var(--text-secondary)'
};

const AGENCY_COMPANY_META_SMALL_STYLE = {
    fontSize: '0.75rem',
    color: 'var(--text-secondary)'
};

const AGENCY_COMPANY_ACTIONS_STYLE = {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem'
};

const AGENCY_ACTIVE_BADGE_STYLE = {
    padding: '0.2rem 0.6rem',
    borderRadius: '999px',
    background: 'rgba(59, 130, 246, 0.15)',
    color: '#3b82f6',
    fontSize: '0.7rem',
    fontWeight: 600
};

const AGENCY_OPEN_BUTTON_STYLE = {
    padding: '0.45rem 0.9rem',
    borderRadius: '8px',
    border: 'none',
    background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '0.8rem',
    fontWeight: 600
};

const AGENCY_FOOTER_NOTE_STYLE = {
    padding: '0.9rem',
    borderRadius: '12px',
    border: '1px solid var(--glass-border)',
    background: 'rgba(255, 255, 255, 0.03)',
    fontSize: '0.85rem',
    color: 'var(--text-secondary)',
    lineHeight: 1.5
};

function getAgencyCompanyRowStyle(isActive: boolean) {
    return {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '1rem',
        padding: '0.75rem 0.9rem',
        borderRadius: '10px',
        border: '1px solid var(--glass-border)',
        background: isActive ? 'rgba(59, 130, 246, 0.12)' : 'rgba(255, 255, 255, 0.03)'
    };
}

function formatDate(value?: string): string {
    if (!value) return '—';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '—';
    return parsed.toLocaleDateString('sv-SE');
}

export function AgencyPanel({ onBack }: AgencyPanelProps) {
    const [companies, setCompanies] = useState<Company[]>(companyService.getAll());
    const [currentId, setCurrentId] = useState<string>(companyService.getCurrentId());
    const [statusMessage, setStatusMessage] = useState<string | null>(null);

    useEffect(() => {
        const handler = () => {
            setCompanies(companyService.getAll());
            setCurrentId(companyService.getCurrentId());
        };
        window.addEventListener('company-changed', handler);
        return () => window.removeEventListener('company-changed', handler);
    }, []);

    const sortedCompanies = useMemo(() => {
        return [...companies].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }, [companies]);

    const handleSwitch = (company: Company) => {
        companyService.switchTo(company.id);
        setStatusMessage(`Aktivt bolag: ${company.name}`);
    };

    return (
        <div data-testid="agency-panel" style={AGENCY_PANEL_STACK_STYLE}>
            <div style={AGENCY_HEADER_ROW_STYLE}>
                <button
                    type="button"
                    onClick={onBack}
                    style={AGENCY_BACK_BUTTON_STYLE}
                >
                    Tillbaka
                </button>
                <span style={AGENCY_SUBTITLE_STYLE}>
                    Byråvy för att byta mellan klientbolag.
                </span>
            </div>

            {statusMessage && (
                <div style={AGENCY_STATUS_MESSAGE_STYLE}>
                    {statusMessage}
                </div>
            )}

            <div style={AGENCY_COMPANY_LIST_CARD_STYLE}>
                <div data-testid="agency-company-list-title" style={AGENCY_COMPANY_LIST_TITLE_STYLE}>
                    Klientbolag
                </div>
                {sortedCompanies.length === 0 ? (
                    <div style={AGENCY_EMPTY_STATE_STYLE}>
                        Inga bolag hittades.
                    </div>
                ) : (
                    <div style={AGENCY_COMPANY_LIST_STYLE}>
                        {sortedCompanies.map((company) => {
                            const isActive = company.id === currentId;
                            return (
                                <div
                                    key={company.id}
                                    data-testid={`agency-company-row-${company.id}`}
                                    style={getAgencyCompanyRowStyle(isActive)}
                                >
                                    <div style={AGENCY_COMPANY_DETAILS_STYLE}>
                                        <div style={AGENCY_COMPANY_NAME_STYLE}>{company.name}</div>
                                        <div style={AGENCY_COMPANY_META_STYLE}>
                                            Org.nr: {company.orgNumber || '—'}
                                        </div>
                                        <div style={AGENCY_COMPANY_META_SMALL_STYLE}>
                                            Senast uppdaterad: {formatDate(company.updatedAt)}
                                        </div>
                                    </div>
                                    <div style={AGENCY_COMPANY_ACTIONS_STYLE}>
                                        {isActive && (
                                            <span style={AGENCY_ACTIVE_BADGE_STYLE}>
                                                Aktivt
                                            </span>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => handleSwitch(company)}
                                            data-testid={`agency-open-company-${company.id}`}
                                            style={AGENCY_OPEN_BUTTON_STYLE}
                                        >
                                            Öppna
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            <div style={AGENCY_FOOTER_NOTE_STYLE}>
                Byråvyn visar klientbolag och gör det enkelt att byta aktivt bolag.
                Statuskolumner och attestflöde kommer i nästa steg.
            </div>
        </div>
    );
}

import { useEffect, useMemo, useState } from 'preact/hooks';
import { companyService } from '../services/CompanyService';
import type { Company } from '../types/company';

interface AgencyPanelProps {
    onBack: () => void;
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
        <div data-testid="agency-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <button
                    type="button"
                    onClick={onBack}
                    style={{
                        background: 'transparent',
                        border: '1px solid var(--glass-border)',
                        borderRadius: '8px',
                        color: 'var(--text-secondary)',
                        padding: '0.4rem 0.75rem',
                        fontSize: '0.8rem',
                        cursor: 'pointer'
                    }}
                >
                    Tillbaka
                </button>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    Byråvy för att byta mellan klientbolag.
                </span>
            </div>

            {statusMessage && (
                <div style={{
                    padding: '0.7rem 0.9rem',
                    borderRadius: '8px',
                    background: 'rgba(16, 185, 129, 0.12)',
                    color: '#10b981',
                    fontSize: '0.85rem',
                    border: '1px solid rgba(16, 185, 129, 0.25)'
                }}>
                    {statusMessage}
                </div>
            )}

            <div style={{
                padding: '1rem',
                borderRadius: '12px',
                border: '1px solid var(--glass-border)',
                background: 'rgba(255, 255, 255, 0.04)'
            }}>
                <div data-testid="agency-company-list-title" style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.75rem' }}>
                    Klientbolag
                </div>
                {sortedCompanies.length === 0 ? (
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        Inga bolag hittades.
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                        {sortedCompanies.map((company) => {
                            const isActive = company.id === currentId;
                            return (
                                <div
                                    key={company.id}
                                    data-testid={`agency-company-row-${company.id}`}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        gap: '1rem',
                                        padding: '0.75rem 0.9rem',
                                        borderRadius: '10px',
                                        border: '1px solid var(--glass-border)',
                                        background: isActive ? 'rgba(59, 130, 246, 0.12)' : 'rgba(255, 255, 255, 0.03)'
                                    }}
                                >
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{company.name}</div>
                                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                            Org.nr: {company.orgNumber || '—'}
                                        </div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                            Senast uppdaterad: {formatDate(company.updatedAt)}
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        {isActive && (
                                            <span style={{
                                                padding: '0.2rem 0.6rem',
                                                borderRadius: '999px',
                                                background: 'rgba(59, 130, 246, 0.15)',
                                                color: '#3b82f6',
                                                fontSize: '0.7rem',
                                                fontWeight: 600
                                            }}>
                                                Aktivt
                                            </span>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => handleSwitch(company)}
                                            data-testid={`agency-open-company-${company.id}`}
                                            style={{
                                                padding: '0.45rem 0.9rem',
                                                borderRadius: '8px',
                                                border: 'none',
                                                background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
                                                color: '#fff',
                                                cursor: 'pointer',
                                                fontSize: '0.8rem',
                                                fontWeight: 600
                                            }}
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

            <div style={{
                padding: '0.9rem',
                borderRadius: '12px',
                border: '1px solid var(--glass-border)',
                background: 'rgba(255, 255, 255, 0.03)',
                fontSize: '0.85rem',
                color: 'var(--text-secondary)',
                lineHeight: 1.5
            }}>
                Byråvyn visar klientbolag och gör det enkelt att byta aktivt bolag.
                Statuskolumner och attestflöde kommer i nästa steg.
            </div>
        </div>
    );
}

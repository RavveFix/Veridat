import { CHANGELOG, type ChangelogEntry } from '../../constants/changelog';

export function ChangelogPanel() {
    return (
        <section style={{ marginBottom: '2rem', borderTop: '1px solid var(--glass-border)', paddingTop: '1.5rem' }}>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', color: 'var(--text-primary)' }}>Nyheter & Uppdateringar</h3>
            <div>
                {CHANGELOG.map((entry: ChangelogEntry, index: number) => (
                    <div key={entry.version} style={{
                        marginBottom: index === CHANGELOG.length - 1 ? 0 : '1.5rem',
                        paddingBottom: index === CHANGELOG.length - 1 ? 0 : '1.5rem',
                        borderBottom: index === CHANGELOG.length - 1 ? 'none' : '1px solid rgba(255, 255, 255, 0.05)'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.5rem' }}>
                            <h4 style={{
                                fontSize: '0.95rem',
                                margin: 0,
                                color: 'var(--text-primary)',
                                fontWeight: '600'
                            }}>
                                {entry.title}
                            </h4>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span style={{
                                    fontSize: '0.75rem',
                                    color: 'var(--text-secondary)'
                                }}>
                                    {entry.date}
                                </span>
                                <span style={{
                                    background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
                                    padding: '0.15rem 0.5rem',
                                    borderRadius: '6px',
                                    fontSize: '0.7rem',
                                    fontWeight: '600',
                                    color: 'white'
                                }}>
                                    v{entry.version}
                                </span>
                            </div>
                        </div>
                        <div style={{ marginTop: '0.75rem' }}>
                            {entry.changes.map((change, idx) => (
                                <div key={idx} style={{
                                    marginBottom: idx === entry.changes.length - 1 ? 0 : '0.6rem',
                                    fontSize: '0.85rem',
                                    color: 'var(--text-secondary)',
                                    display: 'flex',
                                    gap: '0.6rem',
                                    alignItems: 'flex-start'
                                }}>
                                    <span style={{
                                        display: 'inline-block',
                                        padding: '0.15rem 0.4rem',
                                        borderRadius: '4px',
                                        fontSize: '0.65rem',
                                        fontWeight: '700',
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.5px',
                                        background: change.type === 'new' ? 'rgba(16, 185, 129, 0.15)' :
                                            change.type === 'improved' ? 'rgba(59, 130, 246, 0.15)' :
                                                'rgba(251, 191, 36, 0.15)',
                                        color: change.type === 'new' ? '#10b981' :
                                            change.type === 'improved' ? '#3b82f6' :
                                                '#fbbf24',
                                        border: `1px solid ${change.type === 'new' ? 'rgba(16, 185, 129, 0.3)' :
                                            change.type === 'improved' ? 'rgba(59, 130, 246, 0.3)' :
                                                'rgba(251, 191, 36, 0.3)'}`,
                                        minWidth: '55px',
                                        textAlign: 'center',
                                        flexShrink: 0
                                    }}>
                                        {change.type === 'new' ? 'Nytt' : change.type === 'improved' ? 'Bättre' : 'Fixat'}
                                    </span>
                                    <span style={{ flex: 1, lineHeight: '1.5' }}>{change.description}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </section>
    );
}

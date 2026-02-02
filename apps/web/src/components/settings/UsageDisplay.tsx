interface UsageDisplayProps {
    usage: {
        hourlyUsed: number;
        dailyUsed: number;
        hourlyReset: string | null;
        dailyReset: string | null;
    } | null;
    usageError: string | null;
    plan: 'free' | 'pro';
    planLimits: { hourly: number; daily: number };
    formatResetAt: (resetIso: string | null, windowMs: number) => string;
}

export function UsageDisplay({ usage, usageError, plan, planLimits, formatResetAt }: UsageDisplayProps) {
    return (
        <section style={{ marginBottom: '2rem' }}>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', color: 'var(--text-primary)' }}>Plan & Användning</h3>

            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '1rem'
            }}>
                <span style={{ color: 'var(--text-secondary)' }}>Din plan</span>
                <span style={{
                    background: plan === 'pro'
                        ? 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))'
                        : 'rgba(255, 255, 255, 0.08)',
                    padding: '0.2rem 0.6rem',
                    borderRadius: '999px',
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    color: plan === 'pro' ? '#fff' : 'var(--text-secondary)',
                    border: plan === 'pro' ? 'none' : '1px solid var(--glass-border)'
                }}>
                    {plan === 'pro' ? 'Pro (199 kr/mån)' : 'Gratis'}
                </span>
            </div>

            {usageError ? (
                <div style={{
                    padding: '0.8rem',
                    borderRadius: '8px',
                    marginBottom: '1rem',
                    background: 'var(--status-danger-bg)',
                    color: 'var(--status-danger)',
                    border: '1px solid var(--status-danger-border)'
                }}>
                    {usageError}
                </div>
            ) : (
                <div style={{
                    padding: '1rem',
                    borderRadius: '12px',
                    border: '1px solid var(--glass-border)',
                    background: 'rgba(255, 255, 255, 0.04)'
                }}>
                    <div style={{ marginBottom: '1rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                            <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Denna timme</span>
                            <span style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.9rem' }}>
                                {(usage?.hourlyUsed ?? 0)}/{planLimits.hourly}
                            </span>
                        </div>
                        <div style={{ height: '8px', background: 'rgba(255, 255, 255, 0.08)', borderRadius: '999px', overflow: 'hidden' }}>
                            <div style={{
                                width: `${Math.min(100, ((usage?.hourlyUsed ?? 0) / planLimits.hourly) * 100)}%`,
                                height: '100%',
                                background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))'
                            }} />
                        </div>
                        <div style={{ marginTop: '0.4rem', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                            Återställs {formatResetAt(usage?.hourlyReset ?? null, 60 * 60 * 1000)}
                        </div>
                    </div>

                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                            <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Idag</span>
                            <span style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.9rem' }}>
                                {(usage?.dailyUsed ?? 0)}/{planLimits.daily}
                            </span>
                        </div>
                        <div style={{ height: '8px', background: 'rgba(255, 255, 255, 0.08)', borderRadius: '999px', overflow: 'hidden' }}>
                            <div style={{
                                width: `${Math.min(100, ((usage?.dailyUsed ?? 0) / planLimits.daily) * 100)}%`,
                                height: '100%',
                                background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))'
                            }} />
                        </div>
                        <div style={{ marginTop: '0.4rem', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                            Återställs {formatResetAt(usage?.dailyReset ?? null, 24 * 60 * 60 * 1000)}
                        </div>
                    </div>

                    {plan !== 'pro' && (
                        <a
                            href="mailto:hej@veridat.se?subject=Uppgradera%20till%20Pro&body=Hej%2C%0A%0AJag%20skulle%20vilja%20uppgradera%20till%20Pro%20(199%20kr%2Fm%C3%A5n).%0A%0AMvh"
                            style={{
                                display: 'block',
                                marginTop: '1rem',
                                padding: '0.85rem 1rem',
                                borderRadius: '99px',
                                textAlign: 'center',
                                textDecoration: 'none',
                                fontWeight: '500',
                                fontSize: '0.9rem',
                                color: '#fff',
                                background: '#1a1a1a',
                                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
                                transition: 'all 0.2s ease'
                            }}
                            onMouseOver={(e) => (e.currentTarget.style.background = '#2a2a2a')}
                            onMouseOut={(e) => (e.currentTarget.style.background = '#1a1a1a')}
                        >
                            Uppgradera till Pro
                        </a>
                    )}
                </div>
            )}
        </section>
    );
}

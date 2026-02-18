interface UsageDisplayProps {
    usage: {
        hourlyUsed: number;
        dailyUsed: number;
        hourlyReset: string | null;
        dailyReset: string | null;
    } | null;
    usageError: string | null;
    plan: 'free' | 'pro' | 'trial';
    planLimits: { hourly: number; daily: number };
    formatResetAt: (resetIso: string | null, windowMs: number) => string;
}

const USAGE_PROGRESS_ROW_HEADER_STYLE = {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '0.5rem'
};

const USAGE_PROGRESS_ROW_LABEL_STYLE = {
    color: 'var(--text-secondary)',
    fontSize: '0.9rem'
};

const USAGE_PROGRESS_ROW_VALUE_STYLE = {
    color: 'var(--text-primary)',
    fontWeight: 600,
    fontSize: '0.9rem'
};

const USAGE_PROGRESS_TRACK_STYLE = {
    height: '8px',
    background: 'var(--surface-3)',
    borderRadius: '999px',
    overflow: 'hidden'
};

const USAGE_PROGRESS_FILL_BASE_STYLE = {
    height: '100%',
    background: '#2563eb',
    borderRadius: '999px'
};

const USAGE_PROGRESS_RESET_STYLE = {
    marginTop: '0.4rem',
    color: 'var(--text-secondary)',
    fontSize: '0.8rem'
};

const USAGE_SECTION_STYLE = {
    marginBottom: '2rem'
};

const USAGE_SECTION_TITLE_STYLE = {
    fontSize: '1.1rem',
    marginBottom: '1rem',
    color: 'var(--text-primary)'
};

const USAGE_PLAN_ROW_STYLE = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '1rem'
};

const USAGE_PLAN_LABEL_STYLE = {
    color: 'var(--text-secondary)'
};

const USAGE_PLAN_BADGE_BASE_STYLE = {
    padding: '0.2rem 0.6rem',
    borderRadius: '999px',
    fontSize: '0.85rem',
    fontWeight: 700
};

const USAGE_ERROR_BOX_STYLE = {
    padding: '0.8rem',
    borderRadius: '8px',
    marginBottom: '1rem',
    background: 'var(--status-danger-bg)',
    color: 'var(--status-danger)',
    border: '1px solid var(--status-danger-border)'
};

const USAGE_CARD_STYLE = {
    padding: '1rem',
    borderRadius: '12px',
    border: '1px solid var(--surface-border)',
    background: 'var(--surface-1)',
    boxShadow: 'var(--surface-shadow)'
};

const USAGE_HOURLY_BLOCK_STYLE = {
    marginBottom: '1rem'
};

const USAGE_UPGRADE_LINK_STYLE = {
    display: 'block',
    marginTop: '1.25rem',
    padding: '0.9rem 1.25rem',
    borderRadius: '14px',
    textAlign: 'center',
    textDecoration: 'none',
    fontWeight: '600',
    fontSize: '0.95rem',
    color: '#fff',
    background: '#2563eb',
    boxShadow: 'none',
    border: 'none'
};

function setUpgradeButtonBackground(link: HTMLAnchorElement, isHover: boolean): void {
    link.style.background = isHover ? '#1d4ed8' : '#2563eb';
}

function getUsageProgressPercent(used: number, limit: number): number {
    if (limit <= 0) return 0;
    return Math.min(100, (used / limit) * 100);
}

function getUsageProgressFillStyle(used: number, limit: number) {
    return {
        ...USAGE_PROGRESS_FILL_BASE_STYLE,
        width: `${getUsageProgressPercent(used, limit)}%`
    };
}

function getUsagePlanBadgeStyle(isPro: boolean) {
    return {
        ...USAGE_PLAN_BADGE_BASE_STYLE,
        background: isPro ? 'var(--accent-gradient)' : 'var(--surface-2)',
        color: isPro ? '#fff' : 'var(--text-secondary)',
        border: isPro ? 'none' : '1px solid var(--surface-border)'
    };
}

function UsageProgressRow({
    label,
    used,
    limit,
    resetText,
}: {
    label: string;
    used: number;
    limit: number;
    resetText: string;
}) {
    return (
        <div>
            <div style={USAGE_PROGRESS_ROW_HEADER_STYLE}>
                <span style={USAGE_PROGRESS_ROW_LABEL_STYLE}>{label}</span>
                <span style={USAGE_PROGRESS_ROW_VALUE_STYLE}>
                    {used}/{limit}
                </span>
            </div>
            <div style={USAGE_PROGRESS_TRACK_STYLE}>
                <div style={getUsageProgressFillStyle(used, limit)} />
            </div>
            <div style={USAGE_PROGRESS_RESET_STYLE}>
                Återställs {resetText}
            </div>
        </div>
    );
}

export function UsageDisplay({ usage, usageError, plan, planLimits, formatResetAt }: UsageDisplayProps) {
    const isPro = plan === 'pro' || plan === 'trial';
    const planLabel = plan === 'pro'
        ? 'Pro (199 kr/mån)'
        : plan === 'trial'
            ? 'Trial (14 dagar)'
            : 'Gratis';
    return (
        <section style={USAGE_SECTION_STYLE}>
            <h3 style={USAGE_SECTION_TITLE_STYLE}>Plan & Användning</h3>

            <div style={USAGE_PLAN_ROW_STYLE}>
                <span style={USAGE_PLAN_LABEL_STYLE}>Din plan</span>
                <span style={getUsagePlanBadgeStyle(isPro)}>
                    {planLabel}
                </span>
            </div>

            {usageError ? (
                <div style={USAGE_ERROR_BOX_STYLE}>
                    {usageError}
                </div>
            ) : (
                <div style={USAGE_CARD_STYLE}>
                    <div style={USAGE_HOURLY_BLOCK_STYLE}>
                        <UsageProgressRow
                            label="Denna timme"
                            used={usage?.hourlyUsed ?? 0}
                            limit={planLimits.hourly}
                            resetText={formatResetAt(usage?.hourlyReset ?? null, 60 * 60 * 1000)}
                        />
                    </div>

                    <UsageProgressRow
                        label="Idag"
                        used={usage?.dailyUsed ?? 0}
                        limit={planLimits.daily}
                        resetText={formatResetAt(usage?.dailyReset ?? null, 24 * 60 * 60 * 1000)}
                    />

                    {plan !== 'pro' && (
                        <a
                            href="mailto:hej@veridat.se?subject=Uppgradera%20till%20Pro&body=Hej%2C%0A%0AJag%20skulle%20vilja%20uppgradera%20till%20Pro%20(199%20kr%2Fm%C3%A5n%2C%2040%20förfrågningar%2Ftimme%2C%20200%2Fdag).%0A%0AMvh"
                            style={USAGE_UPGRADE_LINK_STYLE}
                            onMouseOver={(e) => setUpgradeButtonBackground(e.currentTarget, true)}
                            onMouseOut={(e) => setUpgradeButtonBackground(e.currentTarget, false)}
                        >
                            Uppgradera till Pro (40/t, 200/d)
                        </a>
                    )}
                </div>
            )}
        </section>
    );
}

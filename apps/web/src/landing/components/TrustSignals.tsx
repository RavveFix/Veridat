import { useEffect, useState, useRef } from 'preact/hooks';

interface StatItem {
    value: number;
    suffix: string;
    label: string;
    prefix?: string;
}

function AnimatedNumber({ value, suffix, prefix = '' }: { value: number; suffix: string; prefix?: string }) {
    const [displayValue, setDisplayValue] = useState(0);
    const ref = useRef<HTMLDivElement>(null);
    const hasAnimated = useRef(false);

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting && !hasAnimated.current) {
                    hasAnimated.current = true;
                    animateValue();
                }
            },
            { threshold: 0.3 }
        );

        if (ref.current) {
            observer.observe(ref.current);
        }

        return () => observer.disconnect();
    }, []);

    const animateValue = () => {
        const duration = 2000;
        const steps = 60;
        const stepValue = value / steps;
        let current = 0;

        const interval = setInterval(() => {
            current += stepValue;
            if (current >= value) {
                setDisplayValue(value);
                clearInterval(interval);
            } else {
                setDisplayValue(Math.floor(current));
            }
        }, duration / steps);
    };

    const formatNumber = (num: number) => {
        if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
        if (num >= 1000) return (num / 1000).toFixed(num >= 10000 ? 0 : 1) + 'K';
        return num.toString();
    };

    return (
        <div ref={ref} class="stat-value">
            {prefix}{formatNumber(displayValue)}{suffix}
        </div>
    );
}

export function TrustSignals() {
    const stats: StatItem[] = [
        { value: 50000, suffix: '+', label: 'Transaktioner analyserade' },
        { value: 2500000, suffix: '', prefix: '', label: 'SEK hanterat' },
        { value: 99.9, suffix: '%', label: 'Uptime' },
        { value: 2, suffix: 's', prefix: '<', label: 'Svarstid' }
    ];

    const industries = [
        'Konsult',
        'E-handel',
        'Bygg & Fastighet',
        'Kreativa byrå',
        'Tech & SaaS'
    ];

    return (
        <section class="trust-section fade-in-up">
            <div class="container">
                <p class="trust-label">Företagare litar på Britta</p>

                <div class="stats-grid">
                    {stats.map((stat, index) => (
                        <div
                            class={`stat-card fade-in-up delay-${(index + 1) * 100}`}
                            key={stat.label}
                        >
                            <AnimatedNumber
                                value={stat.value}
                                suffix={stat.suffix}
                                prefix={stat.prefix}
                            />
                            <div class="stat-label">{stat.label}</div>
                        </div>
                    ))}
                </div>

                <div class="industries-section">
                    <span class="industries-label">Används av företag inom:</span>
                    <div class="industries-tags">
                        {industries.map((industry, index) => (
                            <span
                                class={`industry-tag fade-in-up delay-${(index + 1) * 100}`}
                                key={industry}
                            >
                                {industry}
                            </span>
                        ))}
                    </div>
                </div>
            </div>

            <style>{`
                .trust-section {
                    padding: 4rem 0 2rem;
                    position: relative;
                }

                .trust-label {
                    text-align: center;
                    font-size: 0.9rem;
                    text-transform: uppercase;
                    letter-spacing: 0.15em;
                    color: var(--text-secondary);
                    margin-bottom: 2.5rem;
                    font-weight: 500;
                }

                .stats-grid {
                    display: grid;
                    grid-template-columns: repeat(4, 1fr);
                    gap: 1.5rem;
                    max-width: 900px;
                    margin: 0 auto 3rem;
                }

                @media (max-width: 768px) {
                    .stats-grid {
                        grid-template-columns: repeat(2, 1fr);
                    }
                }

                .stat-card {
                    text-align: center;
                    padding: 1.5rem 1rem;
                    background: rgba(255, 255, 255, 0.02);
                    border: 1px solid rgba(255, 255, 255, 0.05);
                    border-radius: 16px;
                    transition: all 0.3s ease;
                }

                .stat-card:hover {
                    background: rgba(255, 255, 255, 0.05);
                    border-color: rgba(0, 240, 255, 0.2);
                    transform: translateY(-4px);
                    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
                }

                .stat-value {
                    font-family: var(--font-display);
                    font-size: 2.5rem;
                    font-weight: 700;
                    background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                    background-clip: text;
                    margin-bottom: 0.5rem;
                    letter-spacing: -0.02em;
                }

                .stat-label {
                    font-size: 0.85rem;
                    color: var(--text-secondary);
                    font-weight: 500;
                }

                .industries-section {
                    text-align: center;
                    padding-top: 2rem;
                    border-top: 1px solid rgba(255, 255, 255, 0.05);
                }

                .industries-label {
                    display: block;
                    font-size: 0.85rem;
                    color: var(--text-secondary);
                    margin-bottom: 1rem;
                }

                .industries-tags {
                    display: flex;
                    flex-wrap: wrap;
                    justify-content: center;
                    gap: 0.75rem;
                }

                .industry-tag {
                    padding: 0.5rem 1rem;
                    background: rgba(255, 255, 255, 0.03);
                    border: 1px solid rgba(255, 255, 255, 0.08);
                    border-radius: 100px;
                    font-size: 0.85rem;
                    color: var(--text-secondary);
                    transition: all 0.2s ease;
                }

                .industry-tag:hover {
                    background: rgba(0, 240, 255, 0.08);
                    border-color: rgba(0, 240, 255, 0.3);
                    color: var(--accent-primary);
                }
            `}</style>
        </section>
    );
}

import { supabase } from '../../lib/supabase';
import { VNode } from 'preact';

interface Step {
    number: number;
    title: string;
    description: string;
    icon: VNode;
}

export function HowItWorks() {
    const steps: Step[] = [
        {
            number: 1,
            title: 'Ladda upp',
            description: 'Dra in din Excel-fil eller ta ett foto på kvittot',
            icon: (
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
            )
        },
        {
            number: 2,
            title: 'Veridat analyserar',
            description: 'AI läser och kategoriserar alla transaktioner',
            icon: (
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                </svg>
            )
        },
        {
            number: 3,
            title: 'Granska',
            description: 'Se sammanfattning och justera vid behov',
            icon: (
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
            )
        },
        {
            number: 4,
            title: 'Bokför',
            description: 'Ett klick till Fortnox - klart!',
            icon: (
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                </svg>
            )
        }
    ];

    const handleGetStarted = async (e: MouseEvent) => {
        e.preventDefault();
        const { data: { session } } = await supabase.auth.getSession();
        window.location.href = session ? '/app' : '/login';
    };

    return (
        <section id="how-it-works" class="how-it-works-section">
            <div class="container">
                <div class="section-header fade-in-up">
                    <h2>Så fungerar Veridat</h2>
                    <p class="section-subtitle">Från Excel-kaos till bokförd verifikation på sekunder</p>
                </div>

                <div class="steps-container">
                    {/* Connection line */}
                    <div class="connection-line" aria-hidden="true">
                        <div class="line-glow"></div>
                    </div>

                    <div class="steps-grid">
                        {steps.map((step, index) => (
                            <div
                                class={`step-card fade-in-up delay-${(index + 1) * 100}`}
                                key={step.number}
                            >
                                <div class="step-number">{step.number}</div>
                                <div class="step-icon">{step.icon}</div>
                                <h3 class="step-title">{step.title}</h3>
                                <p class="step-description">{step.description}</p>
                            </div>
                        ))}
                    </div>
                </div>

                <div class="cta-container fade-in-up delay-400">
                    <a href="/login" class="btn btn-primary btn-glow" onClick={handleGetStarted}>
                        Prova nu - Det är gratis
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="5" y1="12" x2="19" y2="12" />
                            <polyline points="12 5 19 12 12 19" />
                        </svg>
                    </a>
                </div>
            </div>

            <style>{`
                .how-it-works-section {
                    padding: 6rem 0;
                    position: relative;
                    overflow: hidden;
                    background: radial-gradient(ellipse at center, rgba(0, 240, 255, 0.03) 0%, transparent 70%);
                }

                .how-it-works-section .section-header {
                    text-align: center;
                    margin-bottom: 4rem;
                }

                .how-it-works-section h2 {
                    font-size: 2.5rem;
                    margin-bottom: 1rem;
                    background: linear-gradient(135deg, #fff 0%, rgba(255,255,255,0.8) 100%);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                    background-clip: text;
                }

                .how-it-works-section .section-subtitle {
                    color: var(--text-secondary);
                    font-size: 1.15rem;
                    max-width: 500px;
                    margin: 0 auto;
                }

                .steps-container {
                    position: relative;
                    max-width: 1000px;
                    margin: 0 auto;
                }

                .connection-line {
                    position: absolute;
                    top: 60px;
                    left: 12.5%;
                    right: 12.5%;
                    height: 2px;
                    background: rgba(255, 255, 255, 0.1);
                    z-index: 0;
                }

                .line-glow {
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: linear-gradient(90deg,
                        transparent 0%,
                        var(--accent-primary) 20%,
                        var(--accent-secondary) 50%,
                        var(--accent-primary) 80%,
                        transparent 100%
                    );
                    opacity: 0.6;
                    animation: shimmer 3s ease-in-out infinite;
                }

                @keyframes shimmer {
                    0%, 100% { opacity: 0.3; }
                    50% { opacity: 0.8; }
                }

                @media (max-width: 768px) {
                    .connection-line {
                        display: none;
                    }
                }

                .steps-grid {
                    display: grid;
                    grid-template-columns: repeat(4, 1fr);
                    gap: 2rem;
                    position: relative;
                    z-index: 1;
                }

                @media (max-width: 900px) {
                    .steps-grid {
                        grid-template-columns: repeat(2, 1fr);
                    }
                }

                @media (max-width: 500px) {
                    .steps-grid {
                        grid-template-columns: 1fr;
                    }
                }

                .step-card {
                    text-align: center;
                    padding: 1.5rem;
                    position: relative;
                }

                .step-number {
                    width: 48px;
                    height: 48px;
                    margin: 0 auto 1.5rem;
                    background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-family: var(--font-display);
                    font-weight: 700;
                    font-size: 1.25rem;
                    color: #000;
                    box-shadow: 0 0 30px rgba(0, 240, 255, 0.3);
                    position: relative;
                    z-index: 2;
                }

                .step-icon {
                    width: 64px;
                    height: 64px;
                    margin: 0 auto 1rem;
                    background: rgba(255, 255, 255, 0.03);
                    border: 1px solid rgba(255, 255, 255, 0.08);
                    border-radius: 16px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: var(--accent-primary);
                    transition: all 0.3s ease;
                }

                .step-card:hover .step-icon {
                    background: rgba(0, 240, 255, 0.1);
                    border-color: rgba(0, 240, 255, 0.3);
                    transform: translateY(-4px);
                    box-shadow: 0 10px 30px rgba(0, 240, 255, 0.15);
                }

                .step-title {
                    font-family: var(--font-display);
                    font-size: 1.25rem;
                    font-weight: 600;
                    margin-bottom: 0.5rem;
                    color: var(--text-primary);
                }

                .step-description {
                    font-size: 0.9rem;
                    color: var(--text-secondary);
                    line-height: 1.5;
                }

                .cta-container {
                    text-align: center;
                    margin-top: 4rem;
                }

                .cta-container .btn {
                    font-size: 1.1rem;
                    padding: 1rem 2rem;
                }
            `}</style>
        </section>
    );
}

import { supabase } from '../../lib/supabase';
import { useEffect, useState } from 'preact/hooks';

export function Hero() {
    const [text, setText] = useState('');
    const fullText = 'Framtiden';
    
    // Dynamic Date Logic
    const today = new Date();
    // Previous month for the report
    const prevMonthDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const reportDateString = prevMonthDate.toISOString().slice(0, 7); // YYYY-MM
    
    // Typing Effect
    useEffect(() => {
        let currentIndex = 0;
        const interval = setInterval(() => {
            if (currentIndex <= fullText.length) {
                setText(fullText.slice(0, currentIndex));
                currentIndex++;
            } else {
                clearInterval(interval);
            }
        }, 150); // Typing speed
        return () => clearInterval(interval);
    }, []);

    const handleOpenApp = async (e: MouseEvent) => {
        e.preventDefault();
        const { data: { session } } = await supabase.auth.getSession();
        window.location.href = session ? '/app' : '/login';
    };

    return (
        <section class="hero-section" style="padding: 8rem 0 4rem; text-align: center; position: relative;">
            <div class="container">
                <div class="fade-in-up">
                    <div style="display: flex; justify-content: center; margin-bottom: 2rem;">
                         {/* Interactive Orb with hover effect */}
                         <div class="britta-orb large thinking interactive-orb"></div>
                         <style>{`
                            .interactive-orb { transition: transform 0.3s ease, filter 0.3s ease; cursor: pointer; }
                            .interactive-orb:hover { transform: scale(1.1); filter: brightness(1.2); }
                            .cursor-caret { display: inline-block; width: 4px; height: 1em; background: var(--accent-primary); margin-left: 2px; animation: blink 1s step-end infinite; vertical-align: middle; }
                            @keyframes blink { 50% { opacity: 0; } }
                         `}</style>
                    </div>
                    <h1 style="font-size: clamp(3.5rem, 8vw, 6rem); margin-bottom: 1.5rem;">
                        Din AI-ekonom för <br />
                        <span class="text-gradient-primary">
                            {text}<span class="cursor-caret"></span>
                        </span>
                    </h1>
                    <p style="font-size: 1.25rem; color: var(--text-secondary); max-width: 600px; margin: 0 auto 3rem;">
                        Släpp Excel-kaoset. Ladda upp dina filer och låt Britta analysera, kategorisera och förbereda din bokföring automatiskt.
                    </p>

                    <div style="display: flex; gap: 1rem; justify-content: center; margin-bottom: 6rem;">
                        <a href="/login" class="btn btn-primary btn-glow" onClick={handleOpenApp}>
                            Öppna Britta
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <line x1="5" y1="12" x2="19" y2="12"></line>
                                <polyline points="12 5 19 12 12 19"></polyline>
                            </svg>
                        </a>
                        <a href="#features" class="btn btn-glass">
                            Läs mer
                        </a>
                    </div>
                </div>

                {/* Premium App Mockup */}
                <div class="fade-in-up delay-200" style="perspective: 1000px;">
                    <div class="glass-card" style="
                        max-width: 1000px; 
                        margin: 0 auto; 
                        aspect-ratio: 16/9; 
                        overflow: hidden; 
                        position: relative;
                        transform: rotateX(2deg);
                        box-shadow: 0 50px 100px -20px rgba(0,0,0,0.5), 0 0 0 1px var(--glass-border);
                        background: rgba(10, 10, 15, 0.8);
                    ">
                        {/* Window Controls */}
                        <div style="padding: 1rem 1.5rem; border-bottom: 1px solid var(--glass-border); display: flex; gap: 0.5rem; background: rgba(255,255,255,0.02);">
                            <div style="width: 12px; height: 12px; border-radius: 50%; background: #ff5f56; box-shadow: 0 0 10px rgba(255, 95, 86, 0.3);"></div>
                            <div style="width: 12px; height: 12px; border-radius: 50%; background: #ffbd2e; box-shadow: 0 0 10px rgba(255, 189, 46, 0.3);"></div>
                            <div style="width: 12px; height: 12px; border-radius: 50%; background: #27c93f; box-shadow: 0 0 10px rgba(39, 201, 63, 0.3);"></div>
                        </div>

                        <div style="display: flex; height: 100%;">
                            {/* Sidebar */}
                            <div style="width: 240px; border-right: 1px solid var(--glass-border); background: rgba(255,255,255,0.01); display: none; @media(min-width: 768px){display:flex;} flex-direction: column; padding: 1.5rem;">
                                <div style="height: 32px; width: 120px; background: rgba(255,255,255,0.05); border-radius: 6px; margin-bottom: 2rem;"></div>
                                <div style="display: flex; flex-direction: column; gap: 1rem;">
                                    <div style="height: 24px; width: 100%; background: rgba(255,255,255,0.03); border-radius: 6px;"></div>
                                    <div style="height: 24px; width: 100%; background: rgba(255,255,255,0.03); border-radius: 6px;"></div>
                                    <div style="height: 24px; width: 80%; background: rgba(255,255,255,0.03); border-radius: 6px;"></div>
                                </div>
                            </div>

                            {/* Main Content */}
                            <div style="flex: 1; padding: 2rem; display: flex; flex-direction: column; position: relative;">
                                {/* Chat Area */}
                                <div style="flex: 1; display: flex; flex-direction: column; gap: 1.5rem; max-width: 800px; margin: 0 auto; width: 100%;">

                                    {/* User Message */}
                                    <div style="align-self: flex-end; display: flex; gap: 1rem; max-width: 80%;">
                                        <div style="background: rgba(255,255,255,0.1); padding: 1rem 1.5rem; border-radius: 18px 18px 4px 18px; backdrop-filter: blur(10px);">
                                            <p style="margin: 0;">Här är månadens transaktioner för elbilsladdning.</p>
                                            <div style="margin-top: 0.5rem; display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem; opacity: 0.7;">
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path></svg>
                                                laddning_okt.xlsx
                                            </div>
                                        </div>
                                        <div style="width: 36px; height: 36px; border-radius: 50%; background: #333; display: flex; align-items: center; justify-content: center; font-size: 0.8rem;">Du</div>
                                    </div>

                                    {/* AI Message */}
                                    <div style="align-self: flex-start; display: flex; gap: 1rem; max-width: 85%;">
                                        <div style="font-size: 1.1rem; font-weight: 700; background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; align-self: flex-start; padding-top: 1.5rem;">Britta</div>
                                        <div class="tech-card">
                                            <div style="position: relative; z-index: 1;">
                                                <strong style="color: var(--accent-primary); display: block; margin-bottom: 1rem; font-family: 'JetBrains Mono', monospace; letter-spacing: 0.05em; font-size: 0.9rem;">SAMMANFATTNING_{reportDateString}</strong>

                                                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.5rem;">
                                                    <div class="tech-stat float-slow">
                                                        <span class="tech-label">Intäkter</span>
                                                        <div class="tech-value">298.81 <span style="font-size: 0.8em; opacity: 0.7;">SEK</span></div>
                                                    </div>
                                                    <div class="tech-stat float-delayed">
                                                        <span class="tech-label">Moms att återfå</span>
                                                        <div class="tech-value" style="color: #4ade80;">85.25 <span style="font-size: 0.8em; opacity: 0.7;">SEK</span></div>
                                                    </div>
                                                </div>

                                                <p style="margin: 0 0 1.5rem 0; line-height: 1.6; font-size: 0.95rem; color: rgba(255,255,255,0.9);">
                                                    Jag har identifierat laddningssessioner (25% moms) och roaming (momsfritt). Vill du att jag bokför detta direkt i Fortnox?
                                                </p>

                                                <div style="display: flex; gap: 0.75rem;">
                                                    <button class="tech-btn">Ja, bokför</button>
                                                    <button class="tech-btn tech-btn-secondary">Visa detaljer</button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}

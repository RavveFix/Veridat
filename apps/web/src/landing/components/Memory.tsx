
export function Memory() {
    const memoryFeatures = [
        {
            title: "Långtidsminne för ditt bolag",
            description: "Veridat lär sig hur ditt företag fungerar. Hon kommer ihåg dina projekt, dina kunder och hur du föredrar att bokföra.",
            icon: (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z" />
                    <path d="M12 6v6l4 2" />
                </svg>
            )
        },
        {
            title: "Företagskontext som alltid är med",
            description: "Varje chat startar med full koll. Veridat har koll på dina senaste momsrapporter, resultatmål och viktiga händelser i bolaget.",
            icon: (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                    <line x1="16" y1="2" x2="16" y2="6"></line>
                    <line x1="8" y1="2" x2="8" y2="6"></line>
                    <line x1="3" y1="10" x2="21" y2="10"></line>
                </svg>
            )
        },
        {
            title: "Sökbar historik",
            description: "Hitta snabbt vad ni pratade om förra månaden. Hela er konversationshistorik är sökbar och tillgänglig som kontext.",
            icon: (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
            )
        }
    ];

    return (
        <section id="memory" style="padding: 6rem 0; position: relative; overflow: hidden;">
            <div class="container">
                <div style="text-align: center; margin-bottom: 4rem;">
                    <h2 class="fade-in-up" style="font-size: 2.5rem; margin-bottom: 1rem; line-height: 1.2; padding-bottom: 0.1em; background: linear-gradient(135deg, #fff 0%, rgba(255,255,255,0.7) 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">
                        Veridat kommer ihåg
                    </h2>
                    <p class="fade-in-up delay-100" style="color: var(--text-secondary); max-width: 600px; margin: 0 auto; font-size: 1.1rem;">
                        Istället för att börja om från noll i varje chat, bygger Veridat upp en djup förståelse för din verksamhet över tid.
                    </p>
                </div>

                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 2rem;">
                    {memoryFeatures.map((feature, index) => (
                        <div class={`glass-card fade-in-up delay-${(index + 1) * 100}`} style="padding: 2.5rem; border: 1px solid rgba(255,255,255,0.05);">
                            <div style="width: 48px; height: 48px; background: rgba(var(--accent-primary-rgb), 0.1); border-radius: 12px; display: flex; align-items: center; justify-content: center; margin-bottom: 1.5rem; color: var(--accent-primary);">
                                {feature.icon}
                            </div>
                            <h3 style="font-size: 1.25rem; margin-bottom: 1rem; color: #fff;">{feature.title}</h3>
                            <p style="color: var(--text-secondary); line-height: 1.6;">{feature.description}</p>
                        </div>
                    ))}
                </div>

                <div class="fade-in-up delay-400" style="margin-top: 4rem; text-align: center;">
                    <div class="glass-card" style="display: inline-flex; align-items: center; gap: 1rem; padding: 1rem 2rem; border-radius: 100px; border: 1px solid rgba(255,255,255,0.1);">
                        <span style="width: 8px; height: 8px; background: #10b981; border-radius: 50%; display: inline-block; box-shadow: 0 0 10px #10b981;"></span>
                        <span style="font-size: 0.9rem; color: var(--text-secondary);">Kontinuerligt lärande aktiverat</span>
                    </div>
                </div>
            </div>

            {/* Subtle decorative elements to differentiate from Features */}
            <div style="position: absolute; top: 20%; left: -5%; width: 300px; height: 300px; background: radial-gradient(circle, rgba(var(--accent-primary-rgb), 0.05) 0%, transparent 70%); pointer-events: none; z-index: -1;"></div>
            <div style="position: absolute; bottom: 10%; right: -5%; width: 400px; height: 400px; background: radial-gradient(circle, rgba(var(--accent-secondary-rgb), 0.05) 0%, transparent 70%); pointer-events: none; z-index: -1;"></div>
        </section>
    );
}

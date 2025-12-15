

export function Features() {
    const features = [
        {
            title: "Excel-analys",
            description: "Ladda upp dina Excel-filer direkt. Britta analyserar innehållet, identifierar intäkter och kostnader.",
            icon: (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <line x1="16" y1="13" x2="8" y2="13"></line>
                    <line x1="16" y1="17" x2="8" y2="17"></line>
                    <polyline points="10 9 9 9 8 9"></polyline>
                </svg>
            )
        },
        {
            title: "Fortnox Integration",
            description: "Britta pratar direkt med Fortnox. Skapa fakturor, kolla kunder och bokför verifikationer utan att lämna chatten.",
            icon: (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
                    <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
                </svg>
            )
        },
        {
            title: "Svensk Expertis",
            description: "Tränad på BAS-kontoplanen och svenska skatteregler. Kan hantera allt från representation till omvänd byggmoms.",
            icon: (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                </svg>
            )
        }
    ];

    return (
        <section id="features" style="padding: 6rem 0;">
            <div class="container">
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 2rem;">
                    {features.map((feature, index) => (
                        <div class={`glass-card fade-in-up delay-${(index + 1) * 100}`} style="padding: 2.5rem; transition: transform 0.3s ease;">
                            <div style="width: 56px; height: 56px; background: rgba(255,255,255,0.05); border-radius: 16px; display: flex; align-items: center; justify-content: center; margin-bottom: 1.5rem; color: var(--accent-primary);">
                                {feature.icon}
                            </div>
                            <h3 style="font-size: 1.5rem; margin-bottom: 1rem;">{feature.title}</h3>
                            <p style="color: var(--text-secondary);">{feature.description}</p>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}

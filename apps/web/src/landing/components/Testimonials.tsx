
export function Testimonials() {
    const testimonials = [
        {
            name: "Erik Svensson",
            role: "VD, TechConsult AB",
            content: "Britta har sparat mig timmar varje månad. Att kunna slänga in Excel-filer och få svar direkt är magiskt.",
            initials: "ES",
            color: "#FF5F56"
        },
        {
            name: "Maria Lindberg",
            role: "Frilansande Designer",
            content: "Jag hatar bokföring, men Britta gör det nästan kul. Det känns som att ha en riktig ekonom i fickan.",
            initials: "ML",
            color: "#FFBD2E"
        },
        {
            name: "Johan Andersson",
            role: "Ägare, Bygg & Montage",
            content: "Kopplingen till Fortnox fungerar klockrent. Jag kan fakturera direkt från chatten när jag är ute på jobb.",
            initials: "JA",
            color: "#27C93F"
        }
    ];

    const handleMouseMove = (e: MouseEvent) => {
        const card = e.currentTarget as HTMLElement;
        const rect = card.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const centerX = rect.width / 2;
        const centerY = rect.height / 2;

        const rotateX = ((y - centerY) / centerY) * -5; // Max 5deg rotation
        const rotateY = ((x - centerX) / centerX) * 5;

        card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
    };

    const handleMouseLeave = (e: MouseEvent) => {
        const card = e.currentTarget as HTMLElement;
        card.style.transform = 'perspective(1000px) rotateX(0) rotateY(0)';
    };

    return (
        <section id="testimonials" style="padding: 6rem 0; position: relative; overflow: hidden;">
            {/* Background decoration */}
            <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 100%; height: 100%; background: radial-gradient(circle at center, rgba(0, 240, 255, 0.03) 0%, transparent 70%); pointer-events: none;"></div>
            <div class="shooting-star" style="top: 20%; left: 10%; animation-delay: 0s;"></div>
            <div class="shooting-star" style="top: 60%; left: 80%; animation-delay: 2.5s;"></div>

            <div class="container">
                <div style="text-align: center; margin-bottom: 4rem;">
                    <h2 style="font-size: 2.5rem; margin-bottom: 1rem;">Vad våra användare säger</h2>
                    <p style="color: var(--text-secondary); max-width: 600px; margin: 0 auto;">
                        Över 1000 svenska företagare använder redan Britta för att förenkla sin vardag.
                    </p>
                </div>

                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 2rem;">
                    {testimonials.map((t, i) => (
                        <div
                            class={`glass-card tilt-card fade-in-up delay-${(i + 1) * 100}`}
                            style="padding: 2rem; display: flex; flex-direction: column; gap: 1.5rem;"
                            onMouseMove={handleMouseMove}
                            onMouseLeave={handleMouseLeave}
                        >
                            <div style="display: flex; gap: 0.5rem; color: #FFD700;">
                                ★★★★★
                            </div>
                            <p style="font-size: 1.1rem; line-height: 1.6; flex: 1;">"{t.content}"</p>
                            <div style="display: flex; align-items: center; gap: 1rem; margin-top: auto;">
                                <div style={`width: 48px; height: 48px; border-radius: 50%; background: ${t.color}; display: flex; align-items: center; justify-content: center; font-weight: 700; color: #000; font-size: 1.1rem;`}>
                                    {t.initials}
                                </div>
                                <div>
                                    <div style="font-weight: 600; color: var(--text-primary);">{t.name}</div>
                                    <div style="font-size: 0.9rem; color: var(--text-secondary);">{t.role}</div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}

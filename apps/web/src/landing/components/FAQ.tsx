
import { useState } from 'preact/hooks';

interface FAQItem {
    question: string;
    answer: string;
}

export function FAQ() {
    const questions: FAQItem[] = [
        {
            question: "Hur garanterar ni säkerheten för min data?",
            answer: "Vi använder kryptering på banknivå och strikta rutiner för datasäkerhet. Din information lagras på säkra servrar inom EU och används enbart för att leverera våra tjänster. Vi delar aldrig data utan ditt medgivande. Din företagsinformation är i trygga händer."
        },
        {
            question: "Hur fungerar automatisk kontering med AI?",
            answer: "Vår AI analyserar kvitton och fakturor för att föreslå automatisk kontering baserat på bokföringsregler. Du godkänner alltid slutresultatet, vilket ger dig full kontroll. Tekniken eliminerar slarvfel och följer tydliga säkerhetsramar. Processen är både transparent och säker."
        },
        {
            question: "Vad händer om något går fel i tekniken?",
            answer: "Systemet är byggt med flera säkerhetslager och redundans. Om AI:n är osäker vid automatisk kontering ber den om din input istället för att gissa. Vi övervakar systemet dygnet runt för att säkerställa stabilitet. Driftmiljön är robust och pålitlig för din verksamhet."
        },
        {
            question: "Uppfyller ni kraven för GDPR och datasäkerhet?",
            answer: "Ja, vi följer GDPR strikt och prioriterar din datasäkerhet i varje steg. All behandling av personuppgifter sker transparent och lagligt. Vi har rigorösa åtkomstkontroller för att skydda din integritet. Det är en grundpelare i vår trygga arkitektur."
        },
        {
            question: "Kan någon annan se min bokföring?",
            answer: "Nej, din data är isolerad och krypterad. Endast du och behöriga användare har åtkomst. Vår plattform är designad för att hålla affärshemligheter hemliga. Med modern AI-teknik och hårt skalskydd garanterar vi att ingen obehörig kommer in. Din data är helt skyddad hos oss."
        }
    ];

    const [openIndex, setOpenIndex] = useState<number | null>(0);

    const toggle = (index: number) => {
        setOpenIndex(openIndex === index ? null : index);
    };

    return (
        <section class="faq-section" id="faq">
            <div class="container">
                <div class="section-header">
                    <span class="sub-label">Säkerhet & Teknik</span>
                    <h2>Dina frågor om AI och säkerhet</h2>
                    <p class="section-desc">
                        Det ska kännas tryggt att automatisera. Här svarar vi på hur vi skyddar din data.
                    </p>
                </div>

                <div class="faq-grid">
                    {questions.map((item, index) => (
                        <div 
                            class={`faq-item ${openIndex === index ? 'active' : ''}`} 
                            key={index}
                            onClick={() => toggle(index)}
                        >
                            <div class="faq-question">
                                <h3>{item.question}</h3>
                                <div class="faq-icon">
                                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M12 5V19M5 12H19" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                    </svg>
                                </div>
                            </div>
                            <div class="faq-answer">
                                <div class="faq-answer-content">
                                    <p>{item.answer}</p>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <style>{`
                .faq-section {
                    padding: 6rem 0;
                    background: linear-gradient(180deg, transparent 0%, rgba(0, 0, 0, 0.2) 100%);
                }

                .section-header {
                    text-align: center;
                    margin-bottom: 4rem;
                    max-width: 600px;
                    margin-inline: auto;
                }

                .sub-label {
                    display: inline-block;
                    font-size: 0.85rem;
                    color: var(--accent-primary);
                    text-transform: uppercase;
                    letter-spacing: 0.1em;
                    margin-bottom: 1rem;
                    font-weight: 600;
                }

                .section-header h2 {
                    font-size: 2.5rem;
                    margin-bottom: 1rem;
                    background: linear-gradient(135deg, #fff 0%, rgba(255, 255, 255, 0.7) 100%);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                }

                .section-desc {
                    color: var(--text-secondary);
                    font-size: 1.1rem;
                    line-height: 1.6;
                }

                .faq-grid {
                    max-width: 800px;
                    margin: 0 auto;
                    display: flex;
                    flex-direction: column;
                    gap: 1rem;
                }

                .faq-item {
                    background: rgba(255, 255, 255, 0.03);
                    border: 1px solid rgba(255, 255, 255, 0.05);
                    border-radius: 12px;
                    overflow: hidden;
                    transition: all 0.3s ease;
                    cursor: pointer;
                }

                .faq-item:hover {
                    background: rgba(255, 255, 255, 0.05);
                    border-color: rgba(255, 255, 255, 0.1);
                }

                .faq-item.active {
                    background: rgba(255, 255, 255, 0.05);
                    border-color: var(--accent-primary);
                    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
                }

                .faq-question {
                    padding: 1.5rem;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }

                .faq-question h3 {
                    font-size: 1.1rem;
                    font-weight: 500;
                    margin: 0;
                    color: var(--text-primary);
                }

                .faq-icon {
                    color: var(--text-secondary);
                    transition: transform 0.3s ease;
                }

                .faq-item.active .faq-icon {
                    transform: rotate(45deg);
                    color: var(--accent-primary);
                }

                .faq-answer {
                    max-height: 0;
                    overflow: hidden;
                    transition: max-height 0.3s cubic-bezier(0, 1, 0, 1);
                }

                .faq-item.active .faq-answer {
                    max-height: 200px;
                    transition: max-height 0.5s ease-in-out;
                }

                .faq-answer-content {
                    padding: 0 1.5rem 1.5rem;
                    color: var(--text-secondary);
                    line-height: 1.6;
                }
                
                @media (max-width: 768px) {
                    .section-header h2 {
                        font-size: 2rem;
                    }
                }
            `}</style>
        </section>
    );
}

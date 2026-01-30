
export function Pricing() {
    return (
        <section id="pricing" class="pricing-section">
            <div class="container">
                <div class="section-header fade-in-up">
                    <h2 class="text-gradient">Enkla priser för smarta företag</h2>
                    <p class="section-subtitle">Välj den plan som passar ditt bolags behov bäst.</p>
                </div>

                <div class="pricing-grid">
                    {/* Veridat Start - Gratis */}
                    <div class="pricing-card fade-in-up delay-100">
                        <div class="pricing-header">
                            <h3 class="plan-name">Veridat Start</h3>
                            <div class="plan-price">
                                <span class="amount">0 kr</span>
                                <span class="period">/ mån</span>
                            </div>
                            <p class="plan-desc">För dig som precis har startat eller vill testa kraften i AI.</p>
                        </div>
                        <ul class="plan-features">
                            <li><span class="check-icon">✓</span> <strong>Gemini 3 Flash</strong></li>
                            <li><span class="check-icon">✓</span> 5 AI-analyser per månad</li>
                            <li><span class="check-icon">✓</span> Manuell bilduppladdning</li>
                            <li><span class="check-icon">✓</span> Grundläggande bokföringstips</li>
                            <li><span class="check-icon">✓</span> Support via Discord</li>
                        </ul>
                        <a href="/login" class="btn btn-glass">Kom igång gratis</a>
                    </div>

                    {/* Veridat Pro - Premium */}
                    <div class="pricing-card pro-card fade-in-up delay-200">
                        <div class="pro-badge">Mest populär</div>
                        <div class="pricing-header">
                            <h3 class="plan-name">Veridat Pro</h3>
                            <div class="plan-price">
                                <span class="amount">199 kr</span>
                                <span class="period">/ mån</span>
                            </div>
                            <p class="plan-desc">För det aktiva bolaget som vill ha en fullfjädrad AI-ekonom.</p>
                        </div>
                        <ul class="plan-features">
                            <li><span class="check-icon highlight">✓</span> <strong>Gemini 3 Pro</strong></li>
                            <li><span class="check-icon highlight">✓</span> <strong>Obegränsad</strong> AI-assistans</li>
                            <li><span class="check-icon highlight">✓</span> <strong>Integration med Fortnox</strong></li>
                            <li><span class="check-icon highlight">✓</span> Automatisk kvitto-tolkning</li>
                            <li><span class="check-icon highlight">✓</span> Prioriterad support</li>
                            <li><span class="check-icon highlight">✓</span> Export till Excel & PDF</li>
                        </ul>
                        <a href="mailto:support@veridat.se?subject=Uppgradering till Veridat Pro&body=Hej Veridat-teamet!%0D%0A%0D%0AJag är intresserad av att uppgradera mitt bolag till Veridat Pro. Kan ni hjälpa mig att komma igång?%0D%0A%0D%0AMed vänlig hälsning," class="btn btn-primary btn-glow">Kontakta oss för Pro</a>
                        <p class="vat-note">Priser exkl. moms</p>
                    </div>
                </div>
            </div>
        </section>
    );
}

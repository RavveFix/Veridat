

export function Footer() {
    return (
        <footer class="landing-footer">
            <div class="container">
                <div class="footer-content">
                    <div class="footer-brand">
                        <div class="footer-logo brand-logo">Veridat</div>
                        <p class="footer-tagline">
                            AI-bokföring för svenska företagare
                        </p>
                    </div>

                    <div class="footer-columns">
                        <div class="footer-col">
                            <h4>Produkt</h4>
                            <a href="/app">Kom igång</a>
                            <a href="/login">Logga in</a>
                            <a href="mailto:support@veridat.se">Support</a>
                        </div>

                        <div class="footer-col">
                            <h4>Juridiskt</h4>
                            <a href="/terms">Användarvillkor</a>
                            <a href="/privacy">Integritetspolicy</a>
                        </div>

                        <div class="footer-col">
                            <h4>Om Veridat</h4>
                            <a href="/manifest">AI Manifest</a>
                        </div>
                    </div>
                </div>

                <div class="footer-bottom">
                    <p class="copyright">
                        &copy; {new Date().getFullYear()} Veridat AI. Byggd för svenska företagare.
                    </p>
                </div>
            </div>
        </footer>
    );
}

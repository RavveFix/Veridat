

export function Footer() {
    return (
        <footer style="padding: 4rem 0; text-align: center; border-top: 1px solid var(--glass-border); margin-top: 4rem; background: rgba(0,0,0,0.2); backdrop-filter: blur(10px);">
            <div class="container">
                <div style="display: flex; flex-direction: column; gap: 1.5rem; align-items: center;">
                    <div style="display: flex; gap: 2rem; justify-content: center;">
                        <a href="/terms" class="footer-link">Användarvillkor</a>
                        <a href="/privacy" class="footer-link">Integritetspolicy</a>
                    </div>
                    <p style="color: var(--text-secondary); font-size: 0.9rem;">
                        &copy; {new Date().getFullYear()} Britta AI. Byggd för svenska företagare.
                    </p>
                </div>
            </div>
            <style>{`
                .footer-link {
                    color: var(--text-secondary);
                    text-decoration: none;
                    font-size: 0.9rem;
                    transition: color 0.2s ease;
                }
                .footer-link:hover {
                    color: var(--accent-primary);
                }
            `}</style>
        </footer>
    );
}

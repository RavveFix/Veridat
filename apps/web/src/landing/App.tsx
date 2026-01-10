
import { Hero } from './components/Hero';
import { Features } from './components/Features';
import { Memory } from './components/Memory';
import { Pricing } from './components/Pricing';
import { Testimonials } from './components/Testimonials';
import { Footer } from './components/Footer';
import './styles/landing.css';

export function App() {
    return (
        <div class="landing-page">
            <div class="aurora-bg">
                <div class="aurora-blob blob-1"></div>
                <div class="aurora-blob blob-2"></div>
                <div class="aurora-blob blob-3"></div>
            </div>

            <header class="header-glass">
                <div class="header-container">
                    <div class="logo" style="font-size: 1.5rem; font-weight: 700; background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;">
                        Britta
                    </div>
                    <div style="display: flex; align-items: center; gap: 1.5rem;">
                        <a href="mailto:support@britta.ai" class="support-link" style="text-decoration: none; color: var(--text-secondary); font-size: 0.9rem; transition: color 0.2s ease;">
                            Support
                        </a>
                        <a href="/login" class="btn btn-glass btn-glow" style="padding: 0.5rem 1.5rem; font-size: 0.9rem; border-radius: 12px;">
                            Logga in
                        </a>
                    </div>
                </div>
            </header>

            <main>
                <Hero />
                <Features />
                <Memory />
                <Pricing />
                <Testimonials />
            </main>

            <Footer />

            <style>{`
                .support-link:hover {
                    color: var(--accent-primary) !important;
                }
            `}</style>
        </div>
    );
}

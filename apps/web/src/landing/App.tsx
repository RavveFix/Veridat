
import { Analytics } from '@vercel/analytics/react';
import { Hero } from './components/Hero';
import { TrustSignals } from './components/TrustSignals';
import { Features } from './components/Features';
import { HowItWorks } from './components/HowItWorks';
import { Memory } from './components/Memory';
import { Pricing } from './components/Pricing';
import { Testimonials } from './components/Testimonials';
import { FAQ } from './components/FAQ';
import { Principles } from './components/Principles';
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
                    <div class="logo brand-logo" style="font-size: 1.5rem;">
                        Veridat
                    </div>
                    <div style="display: flex; align-items: center; gap: 1.5rem;">
                        <a href="#features" class="support-link" style="text-decoration: none; color: var(--text-secondary); font-size: 0.9rem; transition: color 0.2s ease;">
                            Funktioner
                        </a>
                        <a href="#how-it-works" class="support-link" style="text-decoration: none; color: var(--text-secondary); font-size: 0.9rem; transition: color 0.2s ease;">
                            Hur det funkar
                        </a>
                        <a href="#pricing" class="support-link" style="text-decoration: none; color: var(--text-secondary); font-size: 0.9rem; transition: color 0.2s ease;">
                            Priser
                        </a>
                        <a href="#about" class="support-link" style="text-decoration: none; color: var(--text-secondary); font-size: 0.9rem; transition: color 0.2s ease;">
                            Om oss
                        </a>
                        <a href="mailto:support@veridat.se" class="support-link" style="text-decoration: none; color: var(--text-secondary); font-size: 0.9rem; transition: color 0.2s ease;">
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
                <TrustSignals />
                <Features />
                <HowItWorks />
                <Memory />
                <Pricing />
                <Testimonials />
                <FAQ />
                <Principles />
            </main>

            <Footer />

            <Analytics />

            <style>{`
                .support-link:hover {
                    color: var(--accent-primary) !important;
                }
            `}</style>
        </div>
    );
}

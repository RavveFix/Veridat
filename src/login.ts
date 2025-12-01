import { createClient } from '@supabase/supabase-js';
import './landing/styles/landing.css';
import { logger } from './utils/logger';
import { mountPreactComponent } from './components/preact-adapter';
import { LegalConsentModal } from './components/LegalConsentModal';
import { CURRENT_TERMS_VERSION } from './constants/termsVersion';

// Initialize Supabase client
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

logger.debug('Login script loaded');

async function initLogin() {
    logger.debug('initLogin called, DOM readyState:', document.readyState);

    const loader = document.getElementById('app-loader');
    const loginForm = document.getElementById('login-form') as HTMLFormElement;

    // Check local consent first
    const localConsent = localStorage.getItem('has_accepted_terms_local');

    if (!localConsent) {
        // Hide form initially if not accepted
        if (loginForm) loginForm.style.display = 'none';

        // Create container for modal
        const modalContainer = document.createElement('div');
        document.body.appendChild(modalContainer);

        // Mount modal in local mode
        mountPreactComponent(
            LegalConsentModal,
            {
                mode: 'local' as const,
                onAccepted: (fullName: string) => {
                    // Save to local storage
                    localStorage.setItem('has_accepted_terms_local', 'true');
                    localStorage.setItem('user_full_name_local', fullName);
                    localStorage.setItem('terms_accepted_at_local', new Date().toISOString());
                    localStorage.setItem('terms_version_local', CURRENT_TERMS_VERSION);

                    // Show form
                    if (loginForm) {
                        loginForm.style.display = 'block';
                        // Add fade-in animation
                        loginForm.animate([
                            { opacity: 0, transform: 'translateY(10px)' },
                            { opacity: 1, transform: 'translateY(0)' }
                        ], { duration: 300, easing: 'ease-out', fill: 'forwards' });
                    }

                    // Remove modal container (mountPreactComponent handles unmount via return, but we can just remove the container here for simplicity in this flow)
                    modalContainer.remove();
                }
            },
            modalContainer
        );
    }

    // Check if already logged in
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
        logger.info('User already logged in, redirecting to app');
        // Keep loader visible while redirecting
        window.location.href = '/app';
        return;
    }

    // Not logged in - hide loader and show form (if consent accepted)
    if (loader) {
        loader.style.opacity = '0';
        setTimeout(() => {
            loader.remove();
        }, 500);
    }

    // Get form elements (re-query if needed, but variables defined above)
    const emailInput = document.getElementById('email') as HTMLInputElement;
    const messageEl = document.getElementById('message') as HTMLDivElement;
    const submitBtn = document.getElementById('submit-btn') as HTMLButtonElement;

    logger.debug('Login form element:', loginForm);
    logger.debug('Email input:', emailInput);
    logger.debug('Message element:', messageEl);
    logger.debug('Submit button:', submitBtn);

    if (!loginForm) {
        logger.error('Login form not found!');
        return;
    }

    // Handle form submission
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        logger.debug('Login form submitted');

        const email = emailInput.value.trim();
        logger.debug('Email:', email);

        if (!email) {
            logger.warn('No email entered');
            return;
        }

        // Disable button and show loading state
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Skickar...';
        }

        // Clear previous messages
        if (messageEl) {
            messageEl.className = 'message-box';
            messageEl.textContent = '';
        }

        try {
            logger.debug('Calling Supabase signInWithOtp...');
            const { error } = await supabase.auth.signInWithOtp({
                email,
                options: {
                    emailRedirectTo: window.location.origin + '/app'
                }
            });

            if (error) {
                logger.error('Supabase error:', error);
                throw error;
            }

            logger.success('Magic link sent successfully');

            // Show success message
            if (messageEl) {
                messageEl.textContent = 'Kolla din e-post! Vi har skickat en inloggningslänk.';
                messageEl.classList.add('success');
            }

            // Hide form
            loginForm.style.display = 'none';

        } catch (error: any) {
            logger.error('Login error:', error);

            // Show error message
            if (messageEl) {
                messageEl.textContent = error.message || 'Ett fel uppstod. Försök igen.';
                messageEl.classList.add('error');
            }

            // Re-enable button
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Skicka inloggningslänk';
            }
        }
    });

    logger.debug('Login form event listener attached');
}

// Wait for DOM to be ready
if (document.readyState === 'loading') {
    logger.debug('DOM still loading, waiting for DOMContentLoaded');
    document.addEventListener('DOMContentLoaded', initLogin);
} else {
    logger.debug('DOM already loaded, calling initLogin immediately');
    initLogin();
}

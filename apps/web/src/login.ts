import { createClient } from '@supabase/supabase-js';
import './styles/main.css'; // Shared styles
import './landing/styles/landing.css'; // Landing specific styles (for animations etc)
import { logger } from './services/LoggerService';
import { CURRENT_TERMS_VERSION } from './constants/termsVersion';

// Initialize Supabase client
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

logger.debug('Login script loaded');

function getSafeNextPath(raw: string | null): string | null {
    if (!raw) return null;
    if (!raw.startsWith('/')) return null;
    if (raw.startsWith('//')) return null;
    if (raw.includes('://')) return null;
    return raw;
}

function buildLoginRedirect(nextPath: string | null): string {
    const url = new URL(`${window.location.origin}/login`);
    if (nextPath) {
        url.searchParams.set('next', nextPath);
    }
    return url.toString();
}

async function initLogin() {
    logger.debug('initLogin called, DOM readyState:', document.readyState);

    // If Supabase sent a PKCE callback (`?code=...`), exchange it for a session here.
    // Without this, users can end up "bouncing" back to landing without being logged in.
    const url = new URL(window.location.href);
    const nextPath = getSafeNextPath(url.searchParams.get('next'));
    const code = url.searchParams.get('code');
    if (code) {
        logger.info('Auth callback detected, exchanging code for session');
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
            logger.error('Failed to exchange code for session', error);
        } else {
            url.searchParams.delete('code');
            window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
        }
    }

    const loader = document.getElementById('app-loader');
    const loginForm = document.getElementById('login-form') as HTMLFormElement;

    // Check if already logged in
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
        logger.info('User already logged in, redirecting');
        // Keep loader visible while redirecting
        window.location.href = nextPath || '/app/newchat';
        return;
    }

    // Not logged in - hide loader and show form immediately
    if (loader) {
        loader.style.opacity = '0';
        setTimeout(() => {
            loader.remove();
        }, 500);
    }

    // Clear any stale local consent from abandoned attempts to avoid cross-user leakage
    try {
        const staleConsent = localStorage.getItem('has_accepted_terms_local');
        const staleName = localStorage.getItem('user_full_name_local');
        if (staleConsent || staleName) {
            localStorage.removeItem('has_accepted_terms_local');
            localStorage.removeItem('user_full_name_local');
            localStorage.removeItem('terms_accepted_at_local');
            localStorage.removeItem('terms_version_local');
            localStorage.removeItem('consent_sync_pending');
        }
    } catch {
        // Ignore storage errors; login still works without cleanup
    }

    // Get form elements
    const fullNameInput = document.getElementById('full-name') as HTMLInputElement;
    const emailInput = document.getElementById('email') as HTMLInputElement;
    const messageEl = document.getElementById('message') as HTMLDivElement;
    const submitBtn = document.getElementById('submit-btn') as HTMLButtonElement;

    if (!loginForm) {
        logger.error('Login form not found!');
        return;
    }

    // Handle form submission (click-through consent - no checkbox needed)
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        logger.debug('Login form submitted');

        const fullName = fullNameInput.value.trim();
        const email = emailInput.value.trim();
        logger.debug('Login form data', { email, hasFullName: fullName.length > 0 });

        // Validate inputs
        if (!fullName) {
            logger.warn('No full name entered');
            if (messageEl) {
                messageEl.textContent = 'Vänligen ange ditt fullständiga namn.';
                messageEl.classList.add('error');
            }
            return;
        }

        if (!email) {
            logger.warn('No email entered');
            if (messageEl) {
                messageEl.textContent = 'Vänligen ange din e-postadress.';
                messageEl.classList.add('error');
            }
            return;
        }

        // Save pending registration to localStorage (will sync to DB after magic link callback)
        // Click-through consent: by submitting, user accepts terms
        localStorage.setItem('has_accepted_terms_local', 'true');
        localStorage.setItem('user_full_name_local', fullName);
        localStorage.setItem('terms_accepted_at_local', new Date().toISOString());
        localStorage.setItem('terms_version_local', CURRENT_TERMS_VERSION);

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

        // Proceed with login
        await performLogin(email, fullName, nextPath, messageEl, submitBtn, loginForm);
    });

    logger.debug('Login form event listener attached');
}

async function performLogin(
    email: string,
    fullName: string,
    nextPath: string | null,
    messageEl: HTMLDivElement,
    submitBtn: HTMLButtonElement,
    loginForm: HTMLFormElement
) {
    try {
        logger.debug('Calling Supabase signInWithOtp...');
        const { error } = await supabase.auth.signInWithOtp({
            email,
            options: {
                // Send the magic link back to the login route so the callback can be processed reliably.
                // If Supabase rejects a redirect URL, it may fall back to the Site URL (often `/`).
                emailRedirectTo: buildLoginRedirect(nextPath),
                data: {
                    full_name: fullName
                }
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

    } catch (error: unknown) {
        logger.error('Login error:', error);
        const errorMessage = error instanceof Error ? error.message : null;

        // Show error message
        if (messageEl) {
            messageEl.textContent = errorMessage || 'Ett fel uppstod. Försök igen.';
            messageEl.classList.add('error');
        }

        // Re-enable button
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Kom igång med Veridat';
        }
    }
}

// Wait for DOM to be ready
if (document.readyState === 'loading') {
    logger.debug('DOM still loading, waiting for DOMContentLoaded');
    document.addEventListener('DOMContentLoaded', initLogin);
} else {
    logger.debug('DOM already loaded, calling initLogin immediately');
    initLogin();
}

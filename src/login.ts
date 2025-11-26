import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

console.log('Login script loaded');

async function initLogin() {
    console.log('initLogin called, DOM readyState:', document.readyState);

    // Check if already logged in
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
        console.log('User already logged in, redirecting to app');
        window.location.href = '/app/';
        return;
    }

    // Get form elements
    const loginForm = document.getElementById('login-form') as HTMLFormElement;
    const emailInput = document.getElementById('email') as HTMLInputElement;
    const messageEl = document.getElementById('message') as HTMLDivElement;
    const submitBtn = document.getElementById('submit-btn') as HTMLButtonElement;

    console.log('Login form element:', loginForm);
    console.log('Email input:', emailInput);
    console.log('Message element:', messageEl);
    console.log('Submit button:', submitBtn);

    if (!loginForm) {
        console.error('Login form not found!');
        return;
    }

    // Handle form submission
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        console.log('Login form submitted');

        const email = emailInput.value.trim();
        console.log('Email:', email);

        if (!email) {
            console.warn('No email entered');
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
            console.log('Calling Supabase signInWithOtp...');
            const { error } = await supabase.auth.signInWithOtp({
                email,
                options: {
                    emailRedirectTo: window.location.origin + '/app/'
                }
            });

            if (error) {
                console.error('Supabase error:', error);
                throw error;
            }

            console.log('Magic link sent successfully');

            // Show success message
            if (messageEl) {
                messageEl.textContent = 'Kolla din e-post! Vi har skickat en inloggningslänk.';
                messageEl.classList.add('success');
            }

            // Hide form
            loginForm.style.display = 'none';

        } catch (error: any) {
            console.error('Login error:', error);

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

    console.log('Login form event listener attached');
}

// Wait for DOM to be ready
if (document.readyState === 'loading') {
    console.log('DOM still loading, waiting for DOMContentLoaded');
    document.addEventListener('DOMContentLoaded', initLogin);
} else {
    console.log('DOM already loaded, calling initLogin immediately');
    initLogin();
}

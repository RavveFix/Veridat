import { render } from 'preact';
import { App } from './App';
import '../styles/main.css'; // Import shared styles


function looksLikeSupabaseAuthCallback(): boolean {
    const search = window.location.search;
    const hash = window.location.hash;

    // Supabase can use either PKCE (`?code=...`) or implicit (`#access_token=...`) flows.
    return (
        search.includes('code=') ||
        search.includes('token_hash=') ||
        hash.includes('access_token=') ||
        hash.includes('refresh_token=') ||
        hash.includes('error=') ||
        search.includes('error=')
    );
}

// If a magic-link callback lands on the marketing page, forward it to `/login`
// (preserving the query/hash) so the login script can complete the session flow.
if (looksLikeSupabaseAuthCallback()) {
    window.location.replace(`/login${window.location.search}${window.location.hash}`);
}

const root = document.getElementById('app');

if (root) {
    render(<App />, root);
} else {
    console.error('Root element not found');
}

/**
 * AuthService - Authentication and consent management for Britta
 *
 * Handles:
 * - Session management
 * - Terms of service consent
 * - Consent sync between localStorage and database
 */

import { supabase } from '../lib/supabase';
import { CURRENT_TERMS_VERSION, isVersionOutdated } from '../constants/termsVersion';
import { logger } from './LoggerService';

export interface AuthState {
    isAuthenticated: boolean;
    userId: string | null;
    email: string | null;
    hasAcceptedTerms: boolean;
    termsVersion: string | null;
}

export interface ConsentData {
    fullName: string;
    acceptedAt: string;
    version: string;
}

class AuthServiceClass {
    /**
     * Get current session
     */
    async getSession() {
        const { data: { session } } = await supabase.auth.getSession();
        return session;
    }

    /**
     * Check if user is logged in
     */
    async isLoggedIn(): Promise<boolean> {
        const session = await this.getSession();
        return session !== null;
    }

    /**
     * Get current user ID
     */
    async getUserId(): Promise<string | null> {
        const session = await this.getSession();
        return session?.user?.id ?? null;
    }

    /**
     * Get current user email
     */
    async getUserEmail(): Promise<string | null> {
        const session = await this.getSession();
        return session?.user?.email ?? null;
    }

    /**
     * Check if user has accepted current terms of service
     */
    async hasAcceptedTerms(): Promise<boolean> {
        const session = await this.getSession();
        if (!session) return false;

        try {
            const { data: profile, error } = await supabase
                .from('profiles')
                .select('has_accepted_terms, terms_version')
                .eq('id', session.user.id)
                .single();

            if (error) {
                logger.warn('Error fetching profile, assuming terms not accepted', { error });
                return false;
            }

            const hasAccepted = !!profile?.has_accepted_terms;

            // Check if version is outdated (needs re-consent)
            if (hasAccepted && isVersionOutdated(profile?.terms_version)) {
                logger.info('Terms version outdated, user needs to re-consent');
                return false;
            }

            return hasAccepted;
        } catch (e) {
            logger.error('Exception checking terms', e);
            return false;
        }
    }

    /**
     * Check for local consent (from login page before DB sync)
     */
    hasLocalConsent(): boolean {
        const localConsent = localStorage.getItem('has_accepted_terms_local');
        const localName = localStorage.getItem('user_full_name_local');
        return !!(localConsent && localName);
    }

    /**
     * Get local consent data
     */
    getLocalConsentData(): ConsentData | null {
        const localConsent = localStorage.getItem('has_accepted_terms_local');
        const localName = localStorage.getItem('user_full_name_local');
        const localTime = localStorage.getItem('terms_accepted_at_local');
        const localVersion = localStorage.getItem('terms_version_local');

        if (!localConsent || !localName) return null;

        return {
            fullName: localName,
            acceptedAt: localTime || new Date().toISOString(),
            version: localVersion || CURRENT_TERMS_VERSION
        };
    }

    /**
     * Sync local consent to database
     */
    async syncLocalConsentToDatabase(): Promise<boolean> {
        const session = await this.getSession();
        if (!session) {
            logger.warn('Cannot sync consent - no session');
            return false;
        }

        const consentData = this.getLocalConsentData();
        if (!consentData) {
            logger.warn('No local consent data to sync');
            return false;
        }

        try {
            const { error } = await supabase.from('profiles').upsert({
                id: session.user.id,
                has_accepted_terms: true,
                terms_accepted_at: consentData.acceptedAt,
                terms_version: consentData.version,
                full_name: consentData.fullName
            });

            if (error) {
                logger.error('Error syncing consent to database', { error });
                localStorage.setItem('consent_sync_pending', 'true');
                return false;
            }

            logger.info('Consent synced successfully to database');
            this.clearLocalConsent();
            return true;
        } catch (syncError) {
            logger.error('Exception during consent sync', syncError);
            localStorage.setItem('consent_sync_pending', 'true');
            return false;
        }
    }

    /**
     * Check if there's a pending consent sync
     */
    hasConsentSyncPending(): boolean {
        return localStorage.getItem('consent_sync_pending') === 'true';
    }

    /**
     * Retry pending consent sync
     */
    async retryConsentSync(): Promise<boolean> {
        if (!this.hasConsentSyncPending()) return true;

        logger.info('Retrying pending consent sync...');
        return this.syncLocalConsentToDatabase();
    }

    /**
     * Save consent locally (for immediate use before DB sync)
     */
    saveLocalConsent(fullName: string): void {
        localStorage.setItem('has_accepted_terms_local', 'true');
        localStorage.setItem('user_full_name_local', fullName);
        localStorage.setItem('terms_accepted_at_local', new Date().toISOString());
        localStorage.setItem('terms_version_local', CURRENT_TERMS_VERSION);
        logger.info('Local consent saved', { fullName });
    }

    /**
     * Clear local consent data
     */
    clearLocalConsent(): void {
        localStorage.removeItem('has_accepted_terms_local');
        localStorage.removeItem('user_full_name_local');
        localStorage.removeItem('terms_accepted_at_local');
        localStorage.removeItem('terms_version_local');
        localStorage.removeItem('consent_sync_pending');
    }

    /**
     * Get full auth state
     */
    async getAuthState(): Promise<AuthState> {
        const session = await this.getSession();
        const hasAccepted = session ? await this.hasAcceptedTerms() : false;

        return {
            isAuthenticated: session !== null,
            userId: session?.user?.id ?? null,
            email: session?.user?.email ?? null,
            hasAcceptedTerms: hasAccepted || this.hasLocalConsent(),
            termsVersion: CURRENT_TERMS_VERSION
        };
    }

    /**
     * Logout user
     */
    async logout(): Promise<void> {
        logger.info('Logging out user');
        await supabase.auth.signOut();
    }

    /**
     * Check if current page requires authentication
     */
    isProtectedPage(): boolean {
        const path = window.location.pathname;
        return path.includes('/app/') || path === '/app';
    }

    /**
     * Check if on login page
     */
    isLoginPage(): boolean {
        return window.location.pathname.includes('login.html') || window.location.pathname === '/login';
    }

    /**
     * Check if on landing page
     */
    isLandingPage(): boolean {
        const path = window.location.pathname;
        return path === '/' || path.endsWith('index.html') || path === '/landing';
    }

    /**
     * Redirect to login if not authenticated
     */
    redirectToLogin(): void {
        logger.info('Redirecting to login');
        window.location.href = '/login';
    }

    /**
     * Redirect to app
     */
    redirectToApp(): void {
        logger.info('Redirecting to app');
        window.location.href = '/app/';
    }
}

// Singleton instance
export const authService = new AuthServiceClass();

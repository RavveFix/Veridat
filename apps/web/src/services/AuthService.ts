/**
 * AuthService - Authentication and consent management for Veridat
 *
 * Handles:
 * - Session management
 * - Terms of service consent
 * - Consent sync between localStorage and database
 */

import { supabase } from '../lib/supabase';
import { CURRENT_TERMS_VERSION } from '../constants/termsVersion';
import { type LegalDocType } from '../constants/legalDocs';
import { getRequiredDocsForUser } from '../constants/consentPolicy';
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

interface LocalLegalAcceptances {
    acceptedAt: string;
    version: string;
    docs: LegalDocType[];
    dpaAuthorized: boolean;
    userAgent: string;
}

export interface ConsentSyncContext {
    companyId: string;
    companyOrgNumber?: string | null;
}

class AuthServiceClass {
    private getRequiredDocs(userCreatedAt: string | null | undefined): LegalDocType[] {
        return getRequiredDocsForUser(userCreatedAt);
    }

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
        const requiredDocs = this.getRequiredDocs(session.user.created_at ?? null);

        try {
            const { data: acceptances, error } = await supabase
                .from('legal_acceptances')
                .select('doc_type, version')
                .eq('user_id', session.user.id)
                .eq('version', CURRENT_TERMS_VERSION)
                .in('doc_type', requiredDocs);

            if (error) {
                logger.warn('Error fetching legal acceptances, assuming not accepted', { error });
                return false;
            }

            const acceptedDocs = new Set((acceptances || []).map((row) => row.doc_type));
            const hasAllDocs = requiredDocs.every((doc) => acceptedDocs.has(doc));

            if (!hasAllDocs) {
                logger.info('Legal acceptance missing required documents', { requiredDocs });
            }

            return hasAllDocs;
        } catch (e) {
            logger.error('Exception checking terms', e);
            return false;
        }
    }

    /**
     * Check for local consent (from login page before DB sync)
     */
    hasLocalConsent(userCreatedAt: string | null | undefined = null): boolean {
        const localConsent = localStorage.getItem('has_accepted_terms_local');
        const localName = localStorage.getItem('user_full_name_local');
        const legalRaw = localStorage.getItem('legal_acceptances_local');

        if (!localConsent || !localName || !legalRaw) return false;

        try {
            const parsed = JSON.parse(legalRaw) as LocalLegalAcceptances;
            if (!parsed?.docs?.length) return false;
            const requiredDocs = this.getRequiredDocs(userCreatedAt);
            return requiredDocs.every((doc) => parsed.docs.includes(doc));
        } catch {
            return false;
        }
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
     * Get local legal acceptance details
     */
    getLocalLegalAcceptances(): LocalLegalAcceptances | null {
        const raw = localStorage.getItem('legal_acceptances_local');
        if (!raw) return null;
        try {
            return JSON.parse(raw) as LocalLegalAcceptances;
        } catch {
            return null;
        }
    }

    /**
     * Sync local consent to database
     */
    async syncLocalConsentToDatabase(context?: ConsentSyncContext): Promise<boolean> {
        const session = await this.getSession();
        if (!session) {
            logger.warn('Cannot sync consent - no session');
            return false;
        }
        const requiredDocs = this.getRequiredDocs(session.user.created_at ?? null);
        if (requiredDocs.includes('dpa') && !context?.companyId) {
            logger.error('Cannot sync required DPA acceptance without company context');
            localStorage.setItem('consent_sync_pending', 'true');
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

            const localAcceptances = this.getLocalLegalAcceptances();
            const acceptedAt = localAcceptances?.acceptedAt || consentData.acceptedAt;
            const version = localAcceptances?.version || consentData.version;
            const docs = requiredDocs;
            const userAgent = localAcceptances?.userAgent || navigator.userAgent;
            const dpaAuthorized = localAcceptances?.dpaAuthorized ?? false;
            const normalizedOrgNumber = context?.companyOrgNumber?.trim() ? context.companyOrgNumber.trim() : null;

            const acceptanceRows = docs.map((doc) => ({
                user_id: session.user.id,
                doc_type: doc,
                version,
                accepted_at: acceptedAt,
                user_agent: userAgent,
                dpa_authorized: doc === 'dpa' ? dpaAuthorized : false,
                company_id: doc === 'dpa' ? context?.companyId ?? null : null,
                company_org_number: doc === 'dpa' ? normalizedOrgNumber : null,
                accepted_from: 'prelogin'
            }));

            const { error: acceptanceError } = await supabase
                .from('legal_acceptances')
                .upsert(acceptanceRows, { onConflict: 'user_id,doc_type,version' });

            if (acceptanceError) {
                logger.error('Error syncing legal acceptances', { error: acceptanceError });
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
    async retryConsentSync(context?: ConsentSyncContext): Promise<boolean> {
        if (!this.hasConsentSyncPending()) return true;

        logger.info('Retrying pending consent sync...');
        return this.syncLocalConsentToDatabase(context);
    }

    /**
     * Save consent locally (for immediate use before DB sync)
     */
    saveLocalConsent(fullName: string): void {
        const acceptedAt = new Date().toISOString();
        const docs = this.getRequiredDocs(acceptedAt);
        localStorage.setItem('has_accepted_terms_local', 'true');
        localStorage.setItem('user_full_name_local', fullName);
        localStorage.setItem('terms_accepted_at_local', acceptedAt);
        localStorage.setItem('terms_version_local', CURRENT_TERMS_VERSION);
        localStorage.setItem('legal_acceptances_local', JSON.stringify({
            acceptedAt,
            version: CURRENT_TERMS_VERSION,
            docs,
            dpaAuthorized: false,
            userAgent: navigator.userAgent
        }));
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
        localStorage.removeItem('legal_acceptances_local');
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
            hasAcceptedTerms: hasAccepted || this.hasLocalConsent(session?.user?.created_at ?? null),
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
        return path === '/app' || path === '/app/' || path.startsWith('/app/');
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
        window.location.href = '/app/newchat';
    }
}

// Singleton instance
export const authService = new AuthServiceClass();

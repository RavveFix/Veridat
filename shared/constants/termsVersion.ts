/**
 * Terms and Privacy Policy Version Management
 * 
 * IMPORTANT: Increment CURRENT_TERMS_VERSION when you update:
 * - /terms.html (Terms of Service)
 * - /privacy.html (Privacy Policy)
 * 
 * When version changes, ALL users will be prompted to re-consent on next login.
 */

export const CURRENT_TERMS_VERSION = '1.3.0';

/**
 * Version history and change summaries
 * Used for audit trail and displaying "what changed" to users
 */
export const VERSION_HISTORY: Record<string, {
    date: string;
    summary: string;
    majorChanges: string[];
}> = {
    '1.3.0': {
        date: '2026-02-05',
        summary: 'DPA och säkerhetspolicy + AI-leverantörsinfo',
        majorChanges: [
            'Tillagt DPA och säkerhetspolicy som juridiska dokument',
            'Förtydligat AI-leverantör (Google Gemini i nuläget)',
            'Borttaget Resend som underbiträde i policyn'
        ]
    },
    '1.2.0': {
        date: '2026-01-13',
        summary: 'Komplett företagsinformation och GDPR-förbättringar',
        majorChanges: [
            'Lagt till fullständig företagsinformation (Fixverse AB)',
            'Tydliga lagringstider för alla datatyper',
            'Information om hur du klagar till IMY',
            'Cookie-policy och lokal lagring'
        ]
    },
    '1.1.0': {
        date: '2026-01-07',
        summary: 'Uppdatering för AI Act och förtydligat ansvar',
        majorChanges: [
            'Lagt till specifik lista över underbiträden (Google/OpenAI)',
            'Förtydligat transparens kring AI-beslut enligt EU AI Act',
            'Förstärkt ansvarsbegränsning för AI-genererad data',
            'Information om överföring till tredjeland (SCC)'
        ]
    },
    '1.0.0': {
        date: '2025-12-01',
        summary: 'Initial terms and privacy policy',
        majorChanges: [
            'Established baseline legal framework',
            'AI disclaimer and liability terms',
            'GDPR compliance requirements',
            'Data processing and retention policies'
        ]
    },
};

/**
 * Get change summary for a specific version
 */
export function getVersionChanges(version: string): string[] {
    return VERSION_HISTORY[version]?.majorChanges || [];
}

/**
 * Check if a user's version is outdated
 */
export function isVersionOutdated(userVersion: string | null | undefined): boolean {
    return !userVersion || userVersion !== CURRENT_TERMS_VERSION;
}

/**
 * Get all versions newer than the user's current version
 */
export function getVersionsSince(userVersion: string | null | undefined): string[] {
    if (!userVersion) return [CURRENT_TERMS_VERSION];

    const versions = Object.keys(VERSION_HISTORY).sort();
    const userVersionIndex = versions.indexOf(userVersion);

    if (userVersionIndex === -1) return [CURRENT_TERMS_VERSION];

    return versions.slice(userVersionIndex + 1);
}

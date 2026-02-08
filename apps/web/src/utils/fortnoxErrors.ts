/**
 * Maps Fortnox API error responses to Swedish user-friendly messages.
 * Used by VATReportCard, IntegrationsModal, and FortnoxPanel.
 */

const ERROR_CODE_MAP: Record<string, string> = {
    '2000663': 'Saknar behörighet för Leverantör/Leverantörsfaktura. Uppdatera scopes och koppla om Fortnox.',
    '2003275': 'Saknar behörighet för Leverantörsregister. Kontrollera modulrättigheter i Fortnox.',
    '2000664': 'Saknar behörighet för Leverantörsfaktura. Uppdatera scopes och koppla om Fortnox.',
};

const STATUS_CODE_MAP: Record<string, string> = {
    '401': 'Fortnox-sessionen har gått ut. Gå till Integrationer och koppla om.',
    '403': 'Saknar behörighet i Fortnox. Kontrollera scopes i Integrationer.',
    '404': 'Resursen hittades inte i Fortnox.',
    '429': 'För många anrop till Fortnox. Försök igen om en minut.',
    '500': 'Fortnox har ett serverproblem. Försök igen om en stund.',
    '502': 'Fortnox är tillfälligt otillgänglig. Försök igen.',
    '503': 'Fortnox är tillfälligt otillgänglig. Försök igen.',
};

/**
 * Extracts a user-friendly Swedish error message from a Fortnox-related error.
 */
export function getFortnoxErrorMessage(error: unknown): string {
    if (!(error instanceof Error)) return 'Ett okänt fel uppstod';

    const msg = error.message;

    // Check for known Fortnox error codes
    for (const [code, message] of Object.entries(ERROR_CODE_MAP)) {
        if (msg.includes(code)) return message;
    }

    // Check for HTTP status codes in message
    for (const [status, message] of Object.entries(STATUS_CODE_MAP)) {
        if (msg.includes(status)) return message;
    }

    // Keyword-based detection
    const lower = msg.toLowerCase();

    if (lower.includes('timeout') || lower.includes('timed out')) {
        return 'Fortnox svarar inte. Försök igen om en stund.';
    }

    if (lower.includes('scope') || lower.includes('behörighet')) {
        return 'Saknar nödvändiga behörigheter i Fortnox. Kontrollera scopes och koppla om.';
    }

    if (lower.includes('unauthorized') || lower.includes('token')) {
        return 'Fortnox-sessionen har gått ut. Koppla om i Integrationer.';
    }

    if (lower.includes('network') || lower.includes('fetch')) {
        return 'Nätverksfel. Kontrollera din internetanslutning.';
    }

    // Return the original message if it's already in Swedish, otherwise generic
    if (/[åäö]/i.test(msg)) return msg;
    return 'Export till Fortnox misslyckades. Försök igen.';
}

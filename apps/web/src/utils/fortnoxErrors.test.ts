import { describe, it, expect } from 'vitest';
import { getFortnoxErrorMessage } from './fortnoxErrors';

describe('getFortnoxErrorMessage', () => {
    it('returns generic message for non-Error input', () => {
        expect(getFortnoxErrorMessage('string')).toBe('Ett okänt fel uppstod');
        expect(getFortnoxErrorMessage(null)).toBe('Ett okänt fel uppstod');
        expect(getFortnoxErrorMessage(42)).toBe('Ett okänt fel uppstod');
    });

    describe('known Fortnox error codes', () => {
        it('maps error code 2000663 to permission message', () => {
            const err = new Error('Fortnox returned error 2000663');
            expect(getFortnoxErrorMessage(err)).toContain('Leverantör');
        });

        it('maps error code 2003275 to module permission message', () => {
            const err = new Error('Error 2003275 from API');
            expect(getFortnoxErrorMessage(err)).toContain('Leverantörsregister');
        });

        it('maps error code 2000664 to invoice permission message', () => {
            const err = new Error('2000664');
            expect(getFortnoxErrorMessage(err)).toContain('Leverantörsfaktura');
        });
    });

    describe('HTTP status codes', () => {
        it('maps 401 to session expired', () => {
            const err = new Error('HTTP 401 Unauthorized');
            expect(getFortnoxErrorMessage(err)).toContain('gått ut');
        });

        it('maps 403 to permission error', () => {
            const err = new Error('403 Forbidden');
            expect(getFortnoxErrorMessage(err)).toContain('behörighet');
        });

        it('maps 429 to rate limit', () => {
            const err = new Error('429 Too Many Requests');
            expect(getFortnoxErrorMessage(err)).toContain('många anrop');
        });

        it('maps 500 to server error', () => {
            const err = new Error('Internal Server Error 500');
            expect(getFortnoxErrorMessage(err)).toContain('serverproblem');
        });
    });

    describe('keyword-based detection', () => {
        it('detects timeout errors', () => {
            const err = new Error('Request timed out after 30s');
            expect(getFortnoxErrorMessage(err)).toContain('svarar inte');
        });

        it('detects scope/permission errors', () => {
            const err = new Error('Missing required scope for this action');
            expect(getFortnoxErrorMessage(err)).toContain('behörigheter');
        });

        it('detects unauthorized/token errors', () => {
            const err = new Error('Token has been revoked');
            expect(getFortnoxErrorMessage(err)).toContain('gått ut');
        });

        it('detects network errors', () => {
            const err = new Error('Network request failed');
            expect(getFortnoxErrorMessage(err)).toContain('Nätverksfel');
        });
    });

    describe('fallback behavior', () => {
        it('returns Swedish message as-is if it contains å/ä/ö', () => {
            const err = new Error('Fakturan är inte tillgänglig just nu');
            expect(getFortnoxErrorMessage(err)).toBe('Fakturan är inte tillgänglig just nu');
        });

        it('returns generic message for unknown English errors', () => {
            const err = new Error('Some unknown error happened');
            expect(getFortnoxErrorMessage(err)).toBe('Export till Fortnox misslyckades. Försök igen.');
        });
    });
});

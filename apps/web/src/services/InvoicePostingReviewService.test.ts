import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase', () => ({
    supabase: {
        auth: {
            getSession: vi.fn(),
        },
    },
}));

vi.mock('./LoggerService', () => ({
    logger: {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
    },
}));

import {
    getCheckBadges,
    getHighestIssueSeverity,
    getPostingTraceErrorMessage,
    parseBooleanEnvFlag,
    type PostingIssue,
} from './InvoicePostingReviewService';

describe('InvoicePostingReviewService helpers', () => {
    it('parses boolean env flags', () => {
        expect(parseBooleanEnvFlag('true')).toBe(true);
        expect(parseBooleanEnvFlag('1')).toBe(true);
        expect(parseBooleanEnvFlag('on')).toBe(true);
        expect(parseBooleanEnvFlag('false')).toBe(false);
        expect(parseBooleanEnvFlag(undefined)).toBe(false);
    });

    it('maps check results to badge statuses', () => {
        const badges = getCheckBadges({
            balanced: false,
            total_match: true,
            vat_match: false,
            control_account_present: true,
            row_account_consistency: false,
        });

        const byKey = new Map(badges.map((badge) => [badge.key, badge.status]));
        expect(byKey.get('balanced')).toBe('critical');
        expect(byKey.get('total_match')).toBe('ok');
        expect(byKey.get('vat_match')).toBe('warning');
        expect(byKey.get('control_account_present')).toBe('ok');
        expect(byKey.get('row_account_consistency')).toBe('warning');
    });

    it('returns highest issue severity', () => {
        const infoOnly: PostingIssue[] = [
            { code: 'A', severity: 'info', message: 'i', suggestion: 's' },
        ];
        const warning: PostingIssue[] = [
            { code: 'A', severity: 'info', message: 'i', suggestion: 's' },
            { code: 'B', severity: 'warning', message: 'w', suggestion: 's' },
        ];
        const critical: PostingIssue[] = [
            { code: 'A', severity: 'warning', message: 'w', suggestion: 's' },
            { code: 'B', severity: 'critical', message: 'c', suggestion: 's' },
        ];

        expect(getHighestIssueSeverity(infoOnly)).toBe('info');
        expect(getHighestIssueSeverity(warning)).toBe('warning');
        expect(getHighestIssueSeverity(critical)).toBe('critical');
    });

    it('maps FortnoxClientError to user-friendly posting trace message', () => {
        const message = getPostingTraceErrorMessage(
            {
                errorCode: 'FortnoxClientError',
                error: 'Ogiltig förfrågan till Fortnox. Kontrollera indata.',
            },
            400
        );

        expect(message).toBe('Faktisk kontering kunde inte hämtas för den här fakturan just nu. Kontrollera fakturan i Fortnox och försök igen.');
    });
});

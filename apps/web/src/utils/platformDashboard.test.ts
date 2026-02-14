import { describe, expect, it } from 'vitest';
import {
    buildTimeWindows,
    calcTrendDelta,
    classifyTriageBucket,
    computeAdoptionScore,
    computeOperationalScore,
    computePlatformScore,
    countIsoTimestampsInRange,
} from './platformDashboard';

describe('platformDashboard utilities', () => {
    it('clamps operational score to 0 when penalties exceed bounds', () => {
        const result = computeOperationalScore({
            fortnoxConnected: false,
            criticalAlerts: 10,
            warningAlerts: 10,
            overdueInvoices: 10,
            unbookedInvoices: 10,
            quotaRatio: 1,
        });

        expect(result.quotaPenalty).toBe(15);
        expect(result.score).toBe(0);
    });

    it('applies adoption weighting according to 30/30/25/15', () => {
        const result = computeAdoptionScore({
            importsLast7: 1,
            invoiceItemsLast7: 10,
            invoiceCompletedLast7: 8,
            activePeriods: 4,
            reconciledPeriods: 3,
            vatReportAgeDays: 40,
        });

        expect(result.bankCadenceScore).toBe(70);
        expect(result.invoiceFlowScore).toBe(80);
        expect(result.reconciliationScore).toBe(75);
        expect(result.vatFreshnessScore).toBe(65);
        expect(result.score).toBe(74);
    });

    it('computes platform score with 65/35 weighting', () => {
        expect(computePlatformScore(80, 20)).toBe(59);
    });

    it('classifies triage buckets by score and signals', () => {
        expect(classifyTriageBucket({ score: 80 })).toBe('working');
        expect(classifyTriageBucket({ score: 80, hasBlocker: true })).toBe('improve');
        expect(classifyTriageBucket({ score: 60, hasWarning: true })).toBe('improve');
        expect(classifyTriageBucket({ score: 30 })).toBe('add');
        expect(classifyTriageBucket({ score: 90, missingCapability: true })).toBe('add');
    });

    it('counts timestamps in current and previous 7-day windows safely', () => {
        const now = new Date('2026-02-12T12:00:00Z');
        const windows = buildTimeWindows(now, 7);

        const timestamps = [
            '2026-02-11T12:00:00Z', // current
            '2026-02-05T11:59:59Z', // previous
            '2026-01-20T09:00:00Z', // outside
            'not-a-date',
            '',
            null,
            undefined,
        ];

        const currentCount = countIsoTimestampsInRange(timestamps, windows.currentStart, windows.now);
        const previousCount = countIsoTimestampsInRange(timestamps, windows.previousStart, windows.previousEnd);

        expect(currentCount).toBe(1);
        expect(previousCount).toBe(1);
    });

    it('returns safe trend deltas when previous value is zero', () => {
        const growth = calcTrendDelta(5, 0);
        expect(growth.direction).toBe('up');
        expect(growth.percentChange).toBeNull();

        const flat = calcTrendDelta(0, 0);
        expect(flat.direction).toBe('flat');
        expect(flat.percentChange).toBe(0);
    });
});

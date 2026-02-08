/// <reference path="../functions/types/deno.d.ts" />

/**
 * In-memory sliding-window rate limiter for the Fortnox API.
 *
 * Fortnox allows ~4 requests per second per application.
 * This service delays outgoing requests when the limit is approached,
 * preventing 429 errors from Fortnox.
 *
 * Note: Because each Edge Function invocation runs in its own isolate
 * the window only tracks calls within a single invocation. This is still
 * useful for operations that make multiple sequential API calls (e.g.
 * sync_profile which fetches company info, financial years, and suppliers).
 */

import { createLogger } from './LoggerService.ts';

const logger = createLogger('fortnox-rate-limit');

export class FortnoxRateLimitService {
    private requestTimestamps: number[] = [];
    private readonly maxPerSecond: number;
    private readonly windowMs = 1000;

    constructor(maxPerSecond = 4) {
        this.maxPerSecond = maxPerSecond;
    }

    /**
     * Waits if the sliding window is full, then records the request.
     * Call this before every outgoing Fortnox API request.
     */
    async waitIfNeeded(): Promise<void> {
        const now = Date.now();

        // Evict timestamps outside the 1-second window
        this.requestTimestamps = this.requestTimestamps.filter(
            (ts) => now - ts < this.windowMs,
        );

        if (this.requestTimestamps.length >= this.maxPerSecond) {
            const oldest = this.requestTimestamps[0];
            const waitMs = this.windowMs - (now - oldest) + 50; // +50 ms safety buffer

            if (waitMs > 0) {
                logger.debug(`Rate limit: pausing ${waitMs}ms before next Fortnox call`);
                await new Promise((resolve) => setTimeout(resolve, waitMs));
            }
        }

        this.requestTimestamps.push(Date.now());
    }
}

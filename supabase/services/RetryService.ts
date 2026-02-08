/// <reference path="../functions/types/deno.d.ts" />

/**
 * Generic retry utility with exponential backoff and jitter.
 *
 * Used by FortnoxService to automatically retry transient Fortnox API errors.
 */

import { FortnoxApiError, FortnoxRateLimitError } from './FortnoxErrors.ts';
import { createLogger } from './LoggerService.ts';

const logger = createLogger('retry');

export interface RetryOptions {
    /** Maximum number of attempts (including the first try). Default 3. */
    maxAttempts: number;
    /** Base delay in milliseconds. Default 1000. */
    baseDelayMs: number;
    /** Maximum delay cap in milliseconds. Default 8000. */
    maxDelayMs: number;
}

const DEFAULT_OPTIONS: RetryOptions = {
    maxAttempts: 3,
    baseDelayMs: 1000,
    maxDelayMs: 8000,
};

/**
 * Retries `fn` with exponential backoff when retryable errors occur.
 *
 * - Exponential delay: baseDelay * 2^(attempt-1), capped at maxDelay
 * - Jitter: ±25% randomisation to prevent thundering herd
 * - Respects FortnoxRateLimitError.retryAfterMs when available
 */
export async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    options: Partial<RetryOptions> = {},
): Promise<T> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));

            const isRetryable = error instanceof FortnoxApiError ? error.retryable : false;

            if (!isRetryable || attempt >= opts.maxAttempts) {
                throw lastError;
            }

            // Calculate delay
            let delayMs: number;
            if (error instanceof FortnoxRateLimitError && error.retryAfterMs > 0) {
                delayMs = error.retryAfterMs;
            } else {
                delayMs = Math.min(
                    opts.baseDelayMs * Math.pow(2, attempt - 1),
                    opts.maxDelayMs,
                );
            }

            // Add jitter (±25%)
            const jitter = delayMs * 0.25 * (Math.random() * 2 - 1);
            delayMs = Math.max(0, Math.round(delayMs + jitter));

            logger.info(`Retry attempt ${attempt}/${opts.maxAttempts} after ${delayMs}ms`, {
                error: lastError.message,
            });

            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }

    throw lastError;
}

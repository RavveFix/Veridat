/// <reference path="../functions/types/deno.d.ts" />

/**
 * Typed Fortnox API error classes and classification.
 *
 * Maps HTTP status codes to specific error types so callers
 * (retry logic, frontend) can decide how to handle each case.
 */

// ---------------------------------------------------------------------------
// Base class
// ---------------------------------------------------------------------------

export class FortnoxApiError extends Error {
    readonly statusCode: number | undefined;
    readonly retryable: boolean;
    /** Swedish message safe to show to end-users */
    readonly userMessage: string;

    constructor(message: string, opts: { statusCode?: number; retryable: boolean; userMessage: string }) {
        super(message);
        this.name = 'FortnoxApiError';
        this.statusCode = opts.statusCode;
        this.retryable = opts.retryable;
        this.userMessage = opts.userMessage;
    }
}

// ---------------------------------------------------------------------------
// Concrete error types
// ---------------------------------------------------------------------------

export class FortnoxAuthError extends FortnoxApiError {
    constructor(message: string) {
        super(message, {
            statusCode: 401,
            retryable: false,
            userMessage: 'Fortnox-sessionen har gått ut. Koppla om Fortnox i Integrationer.',
        });
        this.name = 'FortnoxAuthError';
    }
}

export class FortnoxPermissionError extends FortnoxApiError {
    constructor(message: string) {
        super(message, {
            statusCode: 403,
            retryable: false,
            userMessage: 'Saknar behörighet i Fortnox. Kontrollera scopes och koppla om.',
        });
        this.name = 'FortnoxPermissionError';
    }
}

export class FortnoxNotFoundError extends FortnoxApiError {
    constructor(message: string) {
        super(message, {
            statusCode: 404,
            retryable: false,
            userMessage: 'Resursen hittades inte i Fortnox.',
        });
        this.name = 'FortnoxNotFoundError';
    }
}

export class FortnoxClientError extends FortnoxApiError {
    constructor(message: string, statusCode: number) {
        super(message, {
            statusCode,
            retryable: false,
            userMessage: 'Ogiltig förfrågan till Fortnox. Kontrollera indata.',
        });
        this.name = 'FortnoxClientError';
    }
}

export class FortnoxRateLimitError extends FortnoxApiError {
    readonly retryAfterMs: number;

    constructor(message: string, retryAfterMs = 1000) {
        super(message, {
            statusCode: 429,
            retryable: true,
            userMessage: 'För många anrop till Fortnox. Försök igen om en stund.',
        });
        this.name = 'FortnoxRateLimitError';
        this.retryAfterMs = retryAfterMs;
    }
}

export class FortnoxTransientError extends FortnoxApiError {
    constructor(message: string, statusCode: number) {
        super(message, {
            statusCode,
            retryable: true,
            userMessage: 'Fortnox svarar inte som förväntat. Försöker igen...',
        });
        this.name = 'FortnoxTransientError';
    }
}

export class FortnoxTimeoutError extends FortnoxApiError {
    constructor() {
        super('Request to Fortnox timed out', {
            statusCode: undefined,
            retryable: true,
            userMessage: 'Fortnox svarar inte. Försök igen om en stund.',
        });
        this.name = 'FortnoxTimeoutError';
    }
}

// ---------------------------------------------------------------------------
// Classification helper
// ---------------------------------------------------------------------------

/**
 * Classifies a raw error + HTTP status into a typed FortnoxApiError.
 * The returned error carries a Swedish `userMessage` and a `retryable` flag.
 */
export function classifyFortnoxError(error: Error, statusCode?: number): FortnoxApiError {
    if (error instanceof FortnoxApiError) return error;

    const msg = error.message || '';

    // Parse Retry-After header value if present in message
    const retryAfterMatch = msg.match(/retry-after:\s*(\d+)/i);
    const retryAfterMs = retryAfterMatch ? parseInt(retryAfterMatch[1], 10) * 1000 : 1000;

    switch (statusCode) {
        case 401:
            return new FortnoxAuthError(msg);
        case 403:
            return new FortnoxPermissionError(msg);
        case 404:
            return new FortnoxNotFoundError(msg);
        case 429:
            return new FortnoxRateLimitError(msg, retryAfterMs);
        case 500:
        case 502:
        case 503:
        case 504:
            return new FortnoxTransientError(msg, statusCode);
        default:
            if (statusCode && statusCode >= 400 && statusCode < 500) {
                return new FortnoxClientError(msg, statusCode);
            }
            // Network / unknown errors — treat as transient
            return new FortnoxTransientError(msg, statusCode ?? 0);
    }
}

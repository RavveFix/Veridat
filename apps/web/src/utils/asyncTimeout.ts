/**
 * Async timeout utility for Supabase calls
 * Prevents indefinite hangs by racing against a timeout
 */

/**
 * Custom error class for timeout scenarios
 */
export class TimeoutError extends Error {
    constructor(message: string = 'Operation timed out') {
        super(message);
        this.name = 'TimeoutError';
    }
}

/**
 * Wraps an async operation with a timeout
 * Uses Promise.race() to return whichever completes first
 *
 * @param promise - The async operation to wrap
 * @param timeoutMs - Timeout in milliseconds (default: 10000)
 * @param errorMessage - Custom error message for timeout
 * @returns Promise that rejects with TimeoutError if timeout is reached
 *
 * @example
 * const user = await withTimeout(
 *     supabase.auth.getUser(),
 *     10000,
 *     'Tidsgräns för autentisering'
 * );
 */
export async function withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number = 10000,
    errorMessage?: string
): Promise<T> {
    return Promise.race([
        promise,
        new Promise<never>((_, reject) => {
            setTimeout(
                () => reject(new TimeoutError(errorMessage || `Operation timed out after ${timeoutMs}ms`)),
                timeoutMs
            );
        })
    ]);
}

/**
 * Creates an AbortController-based timeout
 * Useful for fetch operations that support AbortSignal
 *
 * @param timeoutMs - Timeout in milliseconds
 * @returns Object with AbortSignal and cleanup function
 *
 * @example
 * const { signal, cleanup } = createAbortTimeout(10000);
 * try {
 *     await fetch(url, { signal });
 * } finally {
 *     cleanup();
 * }
 */
export function createAbortTimeout(timeoutMs: number): {
    signal: AbortSignal;
    cleanup: () => void;
} {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    return {
        signal: controller.signal,
        cleanup: () => clearTimeout(timeoutId)
    };
}

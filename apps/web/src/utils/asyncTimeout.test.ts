/**
 * Unit tests for Async Timeout Utilities
 *
 * Tests timeout handling for Supabase calls and async operations.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    withTimeout,
    TimeoutError,
    createAbortTimeout
} from './asyncTimeout';

describe('asyncTimeout', () => {
    describe('TimeoutError', () => {
        it('should create error with default message', () => {
            const error = new TimeoutError();

            expect(error).toBeInstanceOf(Error);
            expect(error).toBeInstanceOf(TimeoutError);
            expect(error.name).toBe('TimeoutError');
            expect(error.message).toBe('Operation timed out');
        });

        it('should create error with custom message', () => {
            const error = new TimeoutError('Supabase request failed');

            expect(error.message).toBe('Supabase request failed');
            expect(error.name).toBe('TimeoutError');
        });
    });

    describe('withTimeout', () => {
        it('should resolve when promise completes before timeout', async () => {
            const fastPromise = Promise.resolve('success');

            const result = await withTimeout(fastPromise, 1000);

            expect(result).toBe('success');
        });

        it('should reject with TimeoutError when promise takes too long', async () => {
            const slowPromise = new Promise((resolve) => {
                setTimeout(() => resolve('too late'), 500);
            });

            await expect(withTimeout(slowPromise, 50))
                .rejects
                .toThrow(TimeoutError);
        });

        it('should include timeout duration in default error message', async () => {
            const slowPromise = new Promise(() => {}); // Never resolves

            await expect(withTimeout(slowPromise, 100))
                .rejects
                .toThrow('Operation timed out after 100ms');
        });

        it('should use custom error message when provided', async () => {
            const slowPromise = new Promise(() => {});

            await expect(withTimeout(slowPromise, 50, 'Tidsgräns för autentisering'))
                .rejects
                .toThrow('Tidsgräns för autentisering');
        });

        it('should propagate original promise rejection', async () => {
            const failingPromise = Promise.reject(new Error('Original error'));

            await expect(withTimeout(failingPromise, 1000))
                .rejects
                .toThrow('Original error');
        });

        it('should use default timeout of 10000ms', async () => {
            vi.useFakeTimers();

            const neverResolves = new Promise(() => {});
            const promise = withTimeout(neverResolves);

            // Fast-forward 9 seconds - should not timeout yet
            vi.advanceTimersByTime(9000);

            // Fast-forward past 10 seconds
            vi.advanceTimersByTime(2000);

            await expect(promise).rejects.toThrow(TimeoutError);

            vi.useRealTimers();
        });

        it('should handle async operations correctly', async () => {
            const asyncOperation = async () => {
                await new Promise(resolve => setTimeout(resolve, 10));
                return { data: 'fetched' };
            };

            const result = await withTimeout(asyncOperation(), 1000);

            expect(result).toEqual({ data: 'fetched' });
        });

        it('should work with complex return types', async () => {
            interface User {
                id: string;
                name: string;
                email: string;
            }

            const fetchUser = Promise.resolve<User>({
                id: '123',
                name: 'Anna Andersson',
                email: 'anna@example.com'
            });

            const result = await withTimeout(fetchUser, 1000);

            expect(result.id).toBe('123');
            expect(result.name).toBe('Anna Andersson');
        });
    });

    describe('createAbortTimeout', () => {
        it('should return an AbortSignal', () => {
            const { signal, cleanup } = createAbortTimeout(1000);

            expect(signal).toBeInstanceOf(AbortSignal);
            expect(signal.aborted).toBe(false);

            cleanup();
        });

        it('should return a cleanup function', () => {
            const { cleanup } = createAbortTimeout(1000);

            expect(typeof cleanup).toBe('function');

            cleanup();
        });

        it('should abort signal after timeout', async () => {
            vi.useFakeTimers();

            const { signal, cleanup } = createAbortTimeout(100);

            expect(signal.aborted).toBe(false);

            vi.advanceTimersByTime(150);

            expect(signal.aborted).toBe(true);

            cleanup();
            vi.useRealTimers();
        });

        it('should not abort if cleanup is called before timeout', async () => {
            vi.useFakeTimers();

            const { signal, cleanup } = createAbortTimeout(100);

            // Cleanup before timeout
            cleanup();

            vi.advanceTimersByTime(150);

            // Signal should NOT be aborted because we cleaned up
            expect(signal.aborted).toBe(false);

            vi.useRealTimers();
        });

        it('should work with fetch-like operations', async () => {
            const { signal, cleanup } = createAbortTimeout(5000);

            // Simulate a fast fetch
            const mockFetch = async () => {
                if (signal.aborted) {
                    throw new Error('Aborted');
                }
                return { ok: true, data: 'response' };
            };

            try {
                const result = await mockFetch();
                expect(result.ok).toBe(true);
            } finally {
                cleanup();
            }
        });
    });
});

describe('Swedish use cases', () => {
    it('should handle Supabase auth timeout scenario', async () => {
        // Simulate slow Supabase auth call
        const slowAuthCall = new Promise((resolve) => {
            setTimeout(() => resolve({ user: { id: '123' } }), 50);
        });

        const result = await withTimeout(slowAuthCall, 1000, 'Inloggning tog för lång tid');

        expect(result).toEqual({ user: { id: '123' } });
    });

    it('should timeout on stuck database query', async () => {
        // Simulate a stuck database query
        const stuckQuery = new Promise(() => {
            // Never resolves - simulates hung connection
        });

        await expect(
            withTimeout(stuckQuery, 50, 'Databasförfrågan misslyckades')
        ).rejects.toThrow('Databasförfrågan misslyckades');
    });
});

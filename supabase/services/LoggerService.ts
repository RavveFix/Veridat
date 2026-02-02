// Logger Service for Supabase Edge Functions
// Provides consistent, tagged logging across all Edge Functions
/// <reference path="../functions/types/deno.d.ts" />

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
    userId?: string;
    requestId?: string;
    [key: string]: unknown;
}

/**
 * Creates a logger instance with a consistent tag prefix.
 * 
 * @example
 * const logger = createLogger('gemini-chat');
 * logger.info('Processing request', { userId: '123' });
 * // Output: [gemini-chat] Processing request {"userId":"123"}
 */
export function createLogger(tag: string) {
    const formatMessage = (level: LogLevel, message: string, context?: LogContext): string => {
        const timestamp = new Date().toISOString();
        const contextStr = context ? ` ${JSON.stringify(context)}` : '';
        return `[${tag}] ${message}${contextStr}`;
    };

    return {
        debug(message: string, context?: LogContext) {
            if (Deno.env.get('DEBUG') === 'true') {
                console.debug(formatMessage('debug', message, context));
            }
        },

        info(message: string, context?: LogContext) {
            console.log(formatMessage('info', message, context));
        },

        warn(message: string, context?: LogContext) {
            console.warn(formatMessage('warn', message, context));
        },

        error(message: string, error?: Error | unknown, context?: LogContext) {
            const errorContext = {
                ...context,
                error: error instanceof Error ? {
                    message: error.message,
                    name: error.name,
                    stack: error.stack?.split('\n').slice(0, 3).join(' | ')
                } : String(error)
            };
            console.error(formatMessage('error', message, errorContext));
        },

        /**
         * Log request details for debugging
         */
        request(method: string, url: string, context?: LogContext) {
            console.log(formatMessage('info', `${method} ${url}`, context));
        },

        /**
         * Log response details
         */
        response(status: number, durationMs?: number, context?: LogContext) {
            const msg = durationMs
                ? `Response ${status} (${durationMs}ms)`
                : `Response ${status}`;
            console.log(formatMessage('info', msg, context));
        }
    };
}

/**
 * Measures execution time of an async function
 */
export async function withTiming<T>(
    label: string,
    fn: () => Promise<T>,
    logger: ReturnType<typeof createLogger>
): Promise<T> {
    const start = performance.now();
    try {
        const result = await fn();
        const duration = Math.round(performance.now() - start);
        logger.info(`${label} completed`, { durationMs: duration });
        return result;
    } catch (error) {
        const duration = Math.round(performance.now() - start);
        logger.error(`${label} failed`, error, { durationMs: duration });
        throw error;
    }
}

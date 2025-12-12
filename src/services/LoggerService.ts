/**
 * LoggerService - Centralized logging for Britta
 *
 * Features:
 * - Environment-aware (verbose in dev, minimal in prod)
 * - Consistent formatting
 * - Structured data support
 * - Performance tracking
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
    level: LogLevel;
    message: string;
    timestamp: string;
    data?: unknown;
    duration?: number;
}

class LoggerServiceClass {
    private isDev: boolean;
    private prefix: string;
    private timers: Map<string, number> = new Map();

    constructor() {
        this.isDev = import.meta.env.DEV;
        this.prefix = '[Britta]';
    }

    /**
     * Debug level - only shown in development
     */
    debug(message: string, data?: unknown): void {
        if (this.isDev) {
            this.log('debug', message, data);
        }
    }

    /**
     * Info level - important events
     */
    info(message: string, data?: unknown): void {
        this.log('info', message, data);
    }

    /**
     * Warning level - potential issues
     */
    warn(message: string, data?: unknown): void {
        this.log('warn', message, data);
    }

    /**
     * Error level - errors and exceptions
     */
    error(message: string, error?: unknown): void {
        this.log('error', message, error);
    }

    /**
     * Success level - confirmation of successful operations
     */
    success(message: string, data?: unknown): void {
        const formattedMessage = `${this.prefix} ${message}`;
        if (this.isDev) {
            console.log(`%c${formattedMessage}`, 'color: #00F0FF; font-weight: bold', data !== undefined ? data : '');
        } else {
            console.log(formattedMessage, data !== undefined ? data : '');
        }
    }

    /**
     * Start a performance timer
     */
    startTimer(label: string): void {
        this.timers.set(label, performance.now());
        if (this.isDev) {
            console.time(`${this.prefix} ${label}`);
        }
    }

    /**
     * End a performance timer and log duration
     */
    endTimer(label: string): number {
        const start = this.timers.get(label);
        if (start) {
            const duration = performance.now() - start;
            this.timers.delete(label);

            if (this.isDev) {
                console.timeEnd(`${this.prefix} ${label}`);
            }

            this.debug(`${label} completed`, { duration: `${duration.toFixed(2)}ms` });
            return duration;
        }
        return 0;
    }

    /**
     * Group related logs together
     */
    group(label: string, collapsed = true): void {
        if (this.isDev) {
            if (collapsed) {
                console.groupCollapsed(`${this.prefix} ${label}`);
            } else {
                console.group(`${this.prefix} ${label}`);
            }
        }
    }

    /**
     * End a log group
     */
    groupEnd(): void {
        if (this.isDev) {
            console.groupEnd();
        }
    }

    /**
     * Log with specific formatting based on level
     */
    private log(level: LogLevel, message: string, data?: unknown): void {
        const timestamp = new Date().toISOString();
        const formattedMessage = `${this.prefix} ${message}`;

        const entry: LogEntry = {
            level,
            message,
            timestamp,
            data
        };

        // Console output based on level
        switch (level) {
            case 'debug':
                if (data !== undefined) {
                    console.debug(formattedMessage, data);
                } else {
                    console.debug(formattedMessage);
                }
                break;

            case 'info':
                if (data !== undefined) {
                    console.info(formattedMessage, data);
                } else {
                    console.info(formattedMessage);
                }
                break;

            case 'warn':
                if (data !== undefined) {
                    console.warn(formattedMessage, data);
                } else {
                    console.warn(formattedMessage);
                }
                break;

            case 'error':
                if (data !== undefined) {
                    console.error(formattedMessage, data);
                } else {
                    console.error(formattedMessage);
                }
                break;
        }

        // In production, could send critical errors to monitoring service
        if (!this.isDev && level === 'error') {
            this.sendToMonitoring(entry);
        }
    }

    /**
     * Placeholder for future monitoring integration (Sentry, etc.)
     */
    private sendToMonitoring(_entry: LogEntry): void {
        // TODO: Integrate with Sentry, LogRocket, or similar
        // For now, this is a no-op placeholder
    }
}

// Singleton instance
export const logger = new LoggerServiceClass();

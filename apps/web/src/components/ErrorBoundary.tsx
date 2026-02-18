import { Component, ComponentChildren } from 'preact';
import { logger } from '../services/LoggerService';

/**
 * Sanitizes error messages to prevent information disclosure.
 * Only shows safe, user-friendly messages to prevent leaking internal details.
 */
const sanitizeErrorMessage = (error: Error): string => {
    // Common safe error patterns that are okay to show to users
    const safePatterns = [
        /network/i,
        /timeout/i,
        /not found/i,
        /unauthorized/i,
        /forbidden/i
    ];

    // Check if error message matches safe patterns
    if (safePatterns.some(pattern => pattern.test(error.message))) {
        return error.message;
    }

    // Default to generic message for unknown errors to prevent info leakage
    return 'Ett oväntat fel inträffade. Vänligen försök igen.';
};

interface ErrorBoundaryProps {
    children: ComponentChildren;
    fallback?: (error: Error, retry: () => void) => ComponentChildren;
}

interface ErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
}

const ERROR_BOUNDARY_CONTAINER_STYLE = {
    padding: '1.5rem',
    background: 'rgba(239, 68, 68, 0.1)',
    border: '1px solid rgba(239, 68, 68, 0.3)',
    borderRadius: '12px',
    textAlign: 'center',
    margin: '1rem 0'
};

const ERROR_BOUNDARY_ICON_WRAP_STYLE = {
    marginBottom: '1rem'
};

const ERROR_BOUNDARY_TITLE_STYLE = {
    color: 'var(--error-color, #ef4444)',
    margin: '0 0 0.5rem 0',
    fontSize: '1.1rem'
};

const ERROR_BOUNDARY_MESSAGE_STYLE = {
    color: 'var(--text-secondary)',
    margin: '0 0 1rem 0',
    fontSize: '0.9rem'
};

const ERROR_BOUNDARY_RETRY_BUTTON_STYLE = {
    background: 'var(--accent-primary)',
    color: 'white',
    border: 'none',
    padding: '0.6rem 1.2rem',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '0.9rem',
    fontWeight: '500'
};

const FETCH_ERROR_CONTAINER_STYLE = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '2rem',
    gap: '1rem',
    color: 'var(--text-secondary)'
};

const FETCH_ERROR_TITLE_STYLE = {
    margin: 0,
    fontSize: '1rem',
    color: 'var(--text-primary)'
};

const FETCH_ERROR_MESSAGE_STYLE = {
    margin: 0,
    fontSize: '0.85rem',
    textAlign: 'center',
    maxWidth: '300px'
};

const FETCH_ERROR_RETRY_BUTTON_STYLE = {
    background: 'transparent',
    color: 'var(--accent-primary)',
    border: '1px solid var(--accent-primary)',
    padding: '0.5rem 1rem',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '0.85rem',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem'
};

/**
 * Error Boundary component that catches JavaScript errors in child components.
 * Provides a retry mechanism to recover from errors.
 * 
 * @example
 * <ErrorBoundary fallback={(error, retry) => (
 *     <div>
 *         <p>Something went wrong: {error.message}</p>
 *         <button onClick={retry}>Retry</button>
 *     </div>
 * )}>
 *     <MyComponent />
 * </ErrorBoundary>
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    state: ErrorBoundaryState = {
        hasError: false,
        error: null
    };

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: { componentStack?: string }) {
        logger.error('[ErrorBoundary] Caught error', error);
        logger.error('[ErrorBoundary] Component stack', errorInfo.componentStack);
    }

    handleRetry = () => {
        this.setState({ hasError: false, error: null });
    };

    render() {
        if (this.state.hasError && this.state.error) {
            if (this.props.fallback) {
                return this.props.fallback(this.state.error, this.handleRetry);
            }

            // Default fallback UI
            return (
                <div class="error-boundary" style={ERROR_BOUNDARY_CONTAINER_STYLE}>
                    <div style={ERROR_BOUNDARY_ICON_WRAP_STYLE}>
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--error-color, #ef4444)" stroke-width="2">
                            <circle cx="12" cy="12" r="10"></circle>
                            <line x1="12" y1="8" x2="12" y2="12"></line>
                            <line x1="12" y1="16" x2="12.01" y2="16"></line>
                        </svg>
                    </div>
                    <h3 style={ERROR_BOUNDARY_TITLE_STYLE}>
                        Något gick fel
                    </h3>
                    <p style={ERROR_BOUNDARY_MESSAGE_STYLE}>
                        {sanitizeErrorMessage(this.state.error)}
                    </p>
                    <button
                        onClick={this.handleRetry}
                        style={ERROR_BOUNDARY_RETRY_BUTTON_STYLE}
                    >
                        Försök igen
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}

/**
 * Default error fallback for data fetching errors.
 * Shows error message with retry button.
 */
interface FetchErrorProps {
    error: string;
    onRetry: () => void;
    title?: string;
}

export function FetchErrorFallback({ error, onRetry, title = 'Kunde inte ladda data' }: FetchErrorProps) {
    return (
        <div class="fetch-error" style={FETCH_ERROR_CONTAINER_STYLE}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4.99c-.77-1.33-2.69-1.33-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z"></path>
            </svg>
            <h3 style={FETCH_ERROR_TITLE_STYLE}>{title}</h3>
            <p style={FETCH_ERROR_MESSAGE_STYLE}>
                {error}
            </p>
            <button
                onClick={onRetry}
                style={FETCH_ERROR_RETRY_BUTTON_STYLE}
            >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                </svg>
                Försök igen
            </button>
        </div>
    );
}

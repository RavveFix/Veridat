/**
 * Integration Types
 *
 * Type definitions for the integrations system.
 * Designed to be extensible for multiple integration providers.
 */

export type IntegrationStatus = 'connected' | 'disconnected' | 'connecting' | 'error' | 'coming_soon';

export interface Integration {
    id: string;
    name: string;
    description: string;
    icon: string;
    status: IntegrationStatus;
    statusMessage?: string;
    connectedAt?: string;
    lastSync?: string;
}

export interface FortnoxIntegration extends Integration {
    id: 'fortnox';
    scopes?: string[];
    companyName?: string;
}

export interface IntegrationConfig {
    fortnox: {
        clientId: string;
        redirectUri: string;
        scopes: string[];
    };
}

// OAuth related types
export interface OAuthInitiateResponse {
    authorizationUrl: string;
    state: string;
}

export interface OAuthCallbackParams {
    code: string;
    state: string;
}

export interface OAuthTokenResponse {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
    scope: string;
}

// Fortnox-specific types
export interface FortnoxConnectionStatus {
    connected: boolean;
    companyName?: string;
    connectedAt?: string;
    lastSync?: string;
    error?: string;
}

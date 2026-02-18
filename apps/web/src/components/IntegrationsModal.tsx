/**
 * IntegrationsModal
 *
 * Modal for managing third-party integrations like Fortnox.
 * Designed to be extensible for multiple integration providers.
 */

import type { ComponentChildren, JSX } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { supabase } from '../lib/supabase';
import type { Integration, IntegrationStatus } from '../types/integrations';
import { withTimeout, TimeoutError } from '../utils/asyncTimeout';
import { logger } from '../services/LoggerService';
import { isFortnoxEligible, normalizeUserPlan, type UserPlan } from '../services/PlanGateService';
import { copilotService } from '../services/CopilotService';
import { companyService } from '../services/CompanyService';
import { financeAgentService } from '../services/FinanceAgentService';
import { ModalWrapper } from './ModalWrapper';
import { BankImportPanel } from './BankImportPanel';
import { AgencyPanel } from './AgencyPanel';
import { FortnoxPanel } from './FortnoxPanel';
import { BookkeepingRulesPanel } from './BookkeepingRulesPanel';
import { ReconciliationView } from './ReconciliationView';
import { InvoiceInboxPanel } from './InvoiceInboxPanel';
import { DashboardPanel } from './DashboardPanel';
import { VATReportFromFortnoxPanel } from './VATReportFromFortnoxPanel';

interface IntegrationsModalProps {
    onClose: () => void;
    initialTool?: string;
}

// Integration definitions - easily extensible
const INTEGRATIONS_CONFIG: Omit<Integration, 'status'>[] = [
    {
        id: 'fortnox',
        name: 'Fortnox',
        description: 'Bokföringssystem för fakturering och redovisning',
        icon: 'fortnox'
    },
    {
        id: 'visma',
        name: 'Visma',
        description: 'Ekonomisystem och lönesystem',
        icon: 'visma'
    },
    {
        id: 'bankid',
        name: 'BankID',
        description: 'Elektronisk identifiering',
        icon: 'bankid'
    }
];

// Which integrations are available vs coming soon
const AVAILABLE_INTEGRATIONS = ['fortnox'];

type IntegrationTool =
    | 'bank-import'
    | 'agency'
    | 'fortnox-panel'
    | 'bookkeeping-rules'
    | 'reconciliation'
    | 'invoice-inbox'
    | 'dashboard'
    | 'vat-report';

const FORTNOX_LOCKED_TOOLS: IntegrationTool[] = ['fortnox-panel', 'invoice-inbox', 'vat-report'];

function isIntegrationTool(value: unknown): value is IntegrationTool {
    return typeof value === 'string' && [
        'bank-import',
        'agency',
        'fortnox-panel',
        'bookkeeping-rules',
        'reconciliation',
        'invoice-inbox',
        'dashboard',
        'vat-report'
    ].includes(value);
}

function isFortnoxTool(tool: IntegrationTool | null | undefined): boolean {
    return !!tool && FORTNOX_LOCKED_TOOLS.includes(tool);
}

function parseBooleanEnvFlag(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'on';
}

// ---------------------------------------------------------------------------
// Tool Groups — data-driven rendering
// ---------------------------------------------------------------------------

interface ToolDef {
    id: IntegrationTool;
    title: string;
    description: string;
    iconPath: string;
    iconColor: string;
    badge: 'new' | 'pro' | 'beta';
    testId: string;
    requiresPro?: boolean;
}

interface PrimarySectionActionDef {
    label: string;
    tool: IntegrationTool;
}

interface PrimarySectionDef {
    id: 'today' | 'invoices' | 'bank' | 'vat';
    title: string;
    description: string;
    iconPath: string;
    iconColor: string;
    primaryLabel: string;
    primaryTool: IntegrationTool;
    secondaryAction?: PrimarySectionActionDef;
}

const TOOL_GROUPS: { title: string; tools: ToolDef[] }[] = [
    {
        title: 'Fortnox-verktyg',
        tools: [
            {
                id: 'fortnox-panel',
                title: 'Fortnoxpanel',
                description: 'Se leverantörsfakturor, status och Copilot i en vy.',
                iconPath: 'M2 3h20v14H2zM8 21h8M12 17v4',
                iconColor: '#2563eb',
                badge: 'pro',
                testId: 'integration-tool-fortnox-panel',
                requiresPro: true,
            },
            {
                id: 'vat-report',
                title: 'Momsdeklaration',
                description: 'Hämta momsrapport direkt från Fortnox med intäkter, kostnader och momsavräkning.',
                iconPath: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8',
                iconColor: '#3b82f6',
                badge: 'pro',
                testId: 'integration-tool-vat-report',
                requiresPro: true,
            },
            {
                id: 'invoice-inbox',
                title: 'Fakturainkorg',
                description: 'Ladda upp leverantörsfakturor (PDF/bild), AI-extrahera och exportera till Fortnox.',
                iconPath: 'M22 12h-6l-2 3H10l-2-3H2M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z',
                iconColor: '#8b5cf6',
                badge: 'pro',
                testId: 'integration-tool-invoice-inbox',
                requiresPro: true,
            },
        ],
    },
    {
        title: 'Bokföring och Bank',
        tools: [
            {
                id: 'dashboard',
                title: 'Översikt',
                description: 'Dashboard med ekonomisk status, deadlines och snabbåtgärder.',
                iconPath: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
                iconColor: '#10b981',
                badge: 'new',
                testId: 'integration-tool-dashboard',
            },
            {
                id: 'bank-import',
                title: 'Bankimport (CSV)',
                description: 'Importera kontoutdrag (Handelsbanken, SEB, Nordea, Swedbank) och matcha mot fakturor.',
                iconPath: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12',
                iconColor: '#0ea5e9',
                badge: 'beta',
                testId: 'integration-tool-bank-import',
            },
            {
                id: 'reconciliation',
                title: 'Bankavstämning',
                description: 'Översikt per period, markera månader som avstämda.',
                iconPath: 'M22 11.08V12a10 10 0 11-5.93-9.14M22 4L12 14.01l-3-3',
                iconColor: '#10b981',
                badge: 'new',
                testId: 'integration-tool-reconciliation',
            },
            {
                id: 'bookkeeping-rules',
                title: 'Bokföringsregler',
                description: 'Visa och hantera automatiska konteringsregler (leverantör \u2192 konto).',
                iconPath: 'M4 19.5A2.5 2.5 0 016.5 17H20M4 19.5A2.5 2.5 0 006.5 22H20V2H6.5A2.5 2.5 0 004 4.5v15z',
                iconColor: '#f59e0b',
                badge: 'new',
                testId: 'integration-tool-bookkeeping-rules',
            },
        ],
    },
    {
        title: 'Administration',
        tools: [
            {
                id: 'agency',
                title: 'Byråvy',
                description: 'Byt snabbt mellan klientbolag och få en enkel översikt.',
                iconPath: 'M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v4M12 14v4M16 14v4',
                iconColor: '#6366f1',
                badge: 'new',
                testId: 'integration-tool-agency',
            },
        ],
    },
];

const TOOL_DEFS_BY_ID = TOOL_GROUPS
    .flatMap((group) => group.tools)
    .reduce((acc, tool) => {
        acc[tool.id] = tool;
        return acc;
    }, {} as Record<IntegrationTool, ToolDef>);

const PRIMARY_SECTIONS_V2: PrimarySectionDef[] = [
    {
        id: 'today',
        title: 'Idag',
        description: 'Deadlines, larm och snabbåtgärder för perioden.',
        iconPath: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
        iconColor: '#10b981',
        primaryLabel: 'Öppna översikt',
        primaryTool: 'dashboard',
    },
    {
        id: 'invoices',
        title: 'Fakturor',
        description: 'Hantera leverantörsfakturor och öppna Fortnox statusvy.',
        iconPath: 'M22 12h-6l-2 3H10l-2-3H2M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z',
        iconColor: '#8b5cf6',
        primaryLabel: 'Öppna fakturainkorg',
        primaryTool: 'invoice-inbox',
        secondaryAction: {
            label: 'Öppna Fortnoxpanel',
            tool: 'fortnox-panel',
        },
    },
    {
        id: 'bank',
        title: 'Bank',
        description: 'Importera kontoutdrag och följ avstämning per period.',
        iconPath: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12',
        iconColor: '#0ea5e9',
        primaryLabel: 'Öppna bankimport',
        primaryTool: 'bank-import',
        secondaryAction: {
            label: 'Öppna bankavstämning',
            tool: 'reconciliation',
        },
    },
    {
        id: 'vat',
        title: 'Moms',
        description: 'Momsrapport och periodens momsunderlag från Fortnox.',
        iconPath: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8',
        iconColor: '#3b82f6',
        primaryLabel: 'Öppna momsdeklaration',
        primaryTool: 'vat-report',
    },
];

const ADVANCED_TOOLS_V2: IntegrationTool[] = ['bookkeeping-rules', 'fortnox-panel', 'agency'];

// ---------------------------------------------------------------------------
// Integration icon mapping
// ---------------------------------------------------------------------------

const ICON_MAP: Record<string, { letter: string; className: string }> = {
    fortnox: { letter: 'F', className: 'integ-icon integ-icon--fortnox' },
    visma: { letter: 'V', className: 'integ-icon integ-icon--visma' },
    bankid: { letter: 'B', className: 'integ-icon integ-icon--bankid' },
};

const STATUS_CLASS_MAP: Record<IntegrationStatus, string> = {
    connected: 'integ-badge--connected',
    disconnected: 'integ-badge--disconnected',
    connecting: 'integ-badge--connecting',
    error: 'integ-badge--error',
    coming_soon: 'integ-badge--coming-soon',
};

const STATUS_TEXT_MAP: Record<IntegrationStatus, string> = {
    connected: 'Ansluten',
    disconnected: 'Ej ansluten',
    connecting: 'Ansluter...',
    error: 'Fel',
    coming_soon: 'Kommer snart',
};

const UPGRADE_TO_PRO_MAILTO =
    'mailto:hej@veridat.se?subject=Uppgradera%20till%20Pro&body=Hej%2C%0A%0AJag%20vill%20uppgradera%20till%20Pro%20och%20aktivera%20Fortnox-integration.%0A%0AMvh';

const FORTNOX_PLAN_GATED_BANNER = {
    testId: 'fortnox-plan-gated-message',
    message: 'Fortnoxpanel, momsrapport och fakturainkorg kräver Veridat Pro eller Trial.',
} as const;

const FORTNOX_RECONNECT_BANNER = {
    testId: 'fortnox-reconnect-banner',
    message: 'Fortnox är inte kopplat för det aktiva bolaget. Anslut på nytt för att återaktivera Fortnox-verktygen.',
} as const;

const INTEGRATIONS_INFO_CARD = {
    title: 'Hur fungerar det?',
    message:
        'När du ansluter Fortnox kan Veridat automatiskt skapa fakturor, hämta kunder och artiklar, samt synka bokföringsdata. All kommunikation sker säkert via Fortnox officiella API.',
} as const;

const FORTNOX_PLAN_GATED_BANNER_STYLE = {
    padding: '1rem',
    borderRadius: '12px',
    border: '1px solid rgba(245, 158, 11, 0.25)',
    background: 'rgba(245, 158, 11, 0.08)',
    color: 'var(--text-secondary)',
    fontSize: '0.9rem',
    lineHeight: 1.5,
} as const;

const FORTNOX_RECONNECT_BANNER_STYLE = {
    padding: '0.9rem 1rem',
    borderRadius: '10px',
    border: '1px solid rgba(59, 130, 246, 0.3)',
    background: 'rgba(59, 130, 246, 0.08)',
    color: 'var(--text-secondary)',
    fontSize: '0.85rem',
    lineHeight: 1.5,
} as const;

const FORTNOX_UPGRADE_LINK_STYLE = {
    display: 'inline-block',
    marginTop: '1rem',
    padding: '0.7rem 1rem',
    borderRadius: '999px',
    textDecoration: 'none',
    fontWeight: 600,
    fontSize: '0.9rem',
    color: '#fff',
    background: '#2563eb',
    boxShadow: 'none',
} as const;

const INTEGRATIONS_MODAL_BODY_STYLE = {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem',
} as const;

const INTEGRATIONS_LOADING_STYLE = {
    textAlign: 'center',
    padding: '2rem',
} as const;

const INTEGRATIONS_LOADING_TIMEOUT_STYLE = {
    fontSize: '0.85rem',
    color: 'var(--accent-primary)',
    marginTop: '0.5rem',
} as const;

const INTEGRATIONS_LIST_GRID_STYLE = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
    gap: '0.75rem',
    marginTop: '0.75rem',
} as const;

const TOOL_GROUPS_WRAP_STYLE = {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem',
} as const;

const TOOL_GROUP_GRID_STYLE = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: '0.75rem',
    marginTop: '0.75rem',
} as const;

const INTEGRATIONS_INFO_CARD_TITLE_STYLE = {
    margin: '0 0 0.4rem',
    fontSize: '0.78rem',
} as const;

const INTEGRATIONS_INFO_CARD_TEXT_STYLE = {
    margin: 0,
    fontSize: '0.82rem',
    color: 'var(--text-secondary)',
    lineHeight: 1.5,
} as const;

const INTEGRATION_CONNECTION_CARD_BASE_STYLE = {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
} as const;

const INTEGRATION_CONNECTION_CONTENT_STYLE = {
    flex: 1,
    minWidth: 0,
} as const;

const INTEGRATION_CONNECTION_HEADER_ROW_STYLE = {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    marginBottom: '0.25rem',
} as const;

const INTEGRATION_CONNECTION_NAME_STYLE = {
    fontWeight: 700,
    color: 'var(--text-primary)',
    fontSize: '0.95rem',
    fontFamily: 'var(--font-display)',
} as const;

const INTEGRATION_CONNECTION_DESCRIPTION_STYLE = {
    margin: 0,
    color: 'var(--text-secondary)',
    fontSize: '0.8rem',
    lineHeight: 1.4,
} as const;

const INTEGRATION_CONNECTION_DATE_STYLE = {
    margin: '0.4rem 0 0',
    color: 'var(--text-secondary)',
    fontSize: '0.72rem',
} as const;

const INTEGRATION_CONNECTION_ACTION_STYLE = {
    flexShrink: 0,
} as const;

const INTEGRATION_TOOL_CARD_BASE_STYLE = {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '0.85rem',
    textAlign: 'left',
} as const;

const INTEGRATION_TOOL_TITLE_STYLE = {
    fontWeight: 700,
    fontSize: '0.88rem',
    color: 'var(--text-primary)',
    fontFamily: 'var(--font-display)',
    marginBottom: '0.2rem',
} as const;

const INTEGRATION_TOOL_DESCRIPTION_STYLE = {
    fontSize: '0.78rem',
    color: 'var(--text-secondary)',
    lineHeight: 1.4,
} as const;

const INTEGRATION_TOOL_BADGE_WRAP_STYLE = {
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
    flexShrink: 0,
    marginTop: '0.1rem',
} as const;

const INTEGRATION_TOOL_CONTENT_STYLE = {
    flex: 1,
    minWidth: 0,
} as const;

const MODAL_ERROR_BOX_STYLE = {
    padding: '0.8rem',
    borderRadius: '8px',
    background: 'var(--status-danger-bg)',
    color: 'var(--status-danger)',
    border: '1px solid var(--status-danger-border)',
    fontSize: '0.9rem'
} as const;

const MODAL_LOADING_SPINNER_STYLE = {
    margin: '0 auto 1rem'
} as const;

function getIntegrationConnectionCardStyle(isComingSoon: boolean) {
    return {
        ...INTEGRATION_CONNECTION_CARD_BASE_STYLE,
        opacity: isComingSoon ? 0.6 : 1,
    } as const;
}

function getIntegrationToolCardStyle(disabled: boolean) {
    return {
        ...INTEGRATION_TOOL_CARD_BASE_STYLE,
        cursor: disabled ? 'not-allowed' : 'pointer',
    } as const;
}

function getIntegrationToolIconStyle(iconColor: string) {
    return {
        background: `${iconColor}15`,
        color: iconColor,
    } as const;
}

interface InlineNoticeBannerProps {
    message: string;
    style: {
        padding: string;
        borderRadius: string;
        border: string;
        background: string;
        color: string;
        fontSize: string;
        lineHeight: number;
    };
    testId?: string;
}

function InlineNoticeBanner({ message, style, testId }: InlineNoticeBannerProps) {
    return (
        <div data-testid={testId} style={style}>
            {message}
        </div>
    );
}

function IntegrationsInfoCard() {
    return (
        <div className="panel-card panel-card--no-hover integ-info-card">
            <div className="integ-info-card__icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
            </div>
            <div>
                <h4 className="panel-label" style={INTEGRATIONS_INFO_CARD_TITLE_STYLE}>
                    {INTEGRATIONS_INFO_CARD.title}
                </h4>
                <p style={INTEGRATIONS_INFO_CARD_TEXT_STYLE}>
                    {INTEGRATIONS_INFO_CARD.message}
                </p>
            </div>
        </div>
    );
}

interface IntegrationIconGlyph {
    letter: string;
    className: string;
}

interface IntegrationConnectionCardProps {
    integration: Integration;
    icon: IntegrationIconGlyph;
    isComingSoon: boolean;
    isConnected: boolean;
    statusBadge: ComponentChildren;
    action?: ComponentChildren;
}

function IntegrationConnectionCard({
    integration,
    icon,
    isComingSoon,
    isConnected,
    statusBadge,
    action,
}: IntegrationConnectionCardProps) {
    return (
        <div
            data-testid={`integration-card-${integration.id}`}
            className={`panel-card ${isComingSoon ? 'panel-card--no-hover' : 'panel-card--interactive'} ${isConnected ? 'integ-card--connected' : ''}`}
            style={getIntegrationConnectionCardStyle(isComingSoon)}
        >
            <div className={icon.className}>{icon.letter}</div>

            <div style={INTEGRATION_CONNECTION_CONTENT_STYLE}>
                <div style={INTEGRATION_CONNECTION_HEADER_ROW_STYLE}>
                    <span style={INTEGRATION_CONNECTION_NAME_STYLE}>
                        {integration.name}
                    </span>
                    {statusBadge}
                </div>
                <p style={INTEGRATION_CONNECTION_DESCRIPTION_STYLE}>
                    {integration.description}
                </p>
                {integration.connectedAt && (
                    <p style={INTEGRATION_CONNECTION_DATE_STYLE}>
                        Ansluten {new Date(integration.connectedAt).toLocaleDateString('sv-SE')}
                    </p>
                )}
            </div>

            {!isComingSoon && action && (
                <div style={INTEGRATION_CONNECTION_ACTION_STYLE}>
                    {action}
                </div>
            )}
        </div>
    );
}

interface ToolBadgeMeta {
    className: string;
    text: string;
}

interface IntegrationToolCardProps {
    tool: ToolDef;
    disabled: boolean;
    badge: ToolBadgeMeta;
    alertBadges?: ComponentChildren;
    onClick: (tool: IntegrationTool) => void;
}

function IntegrationToolCard({
    tool,
    disabled,
    badge,
    alertBadges,
    onClick,
}: IntegrationToolCardProps) {
    return (
        <button
            type="button"
            onClick={() => onClick(tool.id)}
            data-testid={tool.testId}
            disabled={disabled}
            className={`panel-card panel-card--interactive ${disabled ? 'integ-tool-card--disabled' : ''}`}
            style={getIntegrationToolCardStyle(disabled)}
        >
            <div
                className="integ-tool-icon"
                style={getIntegrationToolIconStyle(tool.iconColor)}
            >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" stroke-width="2"
                    stroke-linecap="round" stroke-linejoin="round">
                    <path d={tool.iconPath} />
                </svg>
            </div>

            <div style={INTEGRATION_TOOL_CONTENT_STYLE}>
                <div style={INTEGRATION_TOOL_TITLE_STYLE}>
                    {tool.title}
                </div>
                <div style={INTEGRATION_TOOL_DESCRIPTION_STYLE}>
                    {tool.description}
                </div>
            </div>

            <div style={INTEGRATION_TOOL_BADGE_WRAP_STYLE}>
                {alertBadges}
                <span className={badge.className}>{badge.text}</span>
            </div>
        </button>
    );
}

interface PrimarySectionCardProps {
    section: PrimarySectionDef;
    disabled: boolean;
    badge: ToolBadgeMeta;
    secondaryDisabled: boolean;
    secondaryBadges?: ComponentChildren;
    onOpenTool: (tool: IntegrationTool) => void;
}

function PrimarySectionCard({
    section,
    disabled,
    badge,
    secondaryDisabled,
    secondaryBadges,
    onOpenTool,
}: PrimarySectionCardProps) {
    const secondaryAction = section.secondaryAction;

    const handlePrimaryOpen = () => {
        if (disabled) return;
        onOpenTool(section.primaryTool);
    };

    const handlePrimaryKeyDown = (event: KeyboardEvent) => {
        if (disabled) return;
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onOpenTool(section.primaryTool);
        }
    };

    const handleSecondaryOpen = (event: Event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!secondaryAction || secondaryDisabled) return;
        onOpenTool(secondaryAction.tool);
    };

    return (
        <div
            className={`panel-card panel-card--interactive integ-v2-card ${disabled ? 'integ-v2-card--disabled' : ''}`}
            data-testid={`integration-primary-section-${section.id}`}
            data-disabled={disabled ? 'true' : 'false'}
            role="button"
            tabIndex={disabled ? -1 : 0}
            aria-disabled={disabled}
            onClick={handlePrimaryOpen}
            onKeyDown={handlePrimaryKeyDown as unknown as JSX.KeyboardEventHandler<HTMLDivElement>}
        >
            <div className="integ-v2-card__header">
                <div
                    className="integ-tool-icon"
                    style={getIntegrationToolIconStyle(section.iconColor)}
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" stroke-width="2"
                        stroke-linecap="round" stroke-linejoin="round">
                        <path d={section.iconPath} />
                    </svg>
                </div>
                <div className="integ-v2-card__content">
                    <div className="integ-v2-card__title-row">
                        <div className="integ-v2-card__title">{section.title}</div>
                        <span className={badge.className}>{badge.text}</span>
                    </div>
                    <div className="integ-v2-card__description">{section.description}</div>

                    {secondaryAction && (
                        <div className="integ-v2-card__links">
                            <a
                                href="#"
                                className={`integ-v2-inline-link ${secondaryDisabled ? 'integ-v2-inline-link--disabled' : ''}`}
                                data-testid={`integration-primary-secondary-${secondaryAction.tool}`}
                                aria-disabled={secondaryDisabled}
                                onClick={handleSecondaryOpen as unknown as JSX.MouseEventHandler<HTMLAnchorElement>}
                            >
                                {secondaryAction.label}
                            </a>
                            {secondaryBadges}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function isBlockingSeverity(severity: string | null | undefined): boolean {
    return severity === 'warning' || severity === 'critical';
}

function countBlockingAlerts<T extends { severity?: string | null }>(alerts: T[]): number {
    return alerts.filter((alert) => isBlockingSeverity(alert.severity)).length;
}

function formatAlertCount(count: number): string {
    return count > 9 ? '9+' : String(count);
}

function getToolBadgeMeta(
    tool: Pick<ToolDef, 'badge'>,
    disabled: boolean
): ToolBadgeMeta {
    if (disabled) {
        return { className: 'integ-tool-badge integ-tool-badge--pro', text: 'Pro' };
    }

    if (tool.badge === 'beta') {
        return { className: 'integ-tool-badge integ-tool-badge--beta', text: 'Beta' };
    }

    return { className: 'integ-tool-badge integ-tool-badge--new', text: 'Nytt' };
}

export function IntegrationsModal({ onClose, initialTool }: IntegrationsModalProps) {
    const integrationsIaV2Enabled = parseBooleanEnvFlag(import.meta.env.VITE_INTEGRATIONS_IA_V2_ENABLED);
    const requestedInitialTool = isIntegrationTool(initialTool) ? initialTool : null;
    const pendingInitialToolRef = useRef<IntegrationTool | null>(requestedInitialTool);
    const [integrations, setIntegrations] = useState<Integration[]>([]);
    const [loading, setLoading] = useState(true);
    const [connecting, setConnecting] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [abortController, setAbortController] = useState<AbortController | null>(null);
    const [loadingTimeout, setLoadingTimeout] = useState(false);
    const [activeTool, setActiveTool] = useState<IntegrationTool | null>(
        requestedInitialTool && !isFortnoxTool(requestedInitialTool) ? requestedInitialTool : null
    );
    const [userPlan, setUserPlan] = useState<UserPlan>('free');
    const [isAdmin, setIsAdmin] = useState(false);
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
    const [activeCompanyId, setActiveCompanyId] = useState<string | null>(() => {
        try {
            return companyService.getCurrentId();
        } catch {
            return null;
        }
    });
    const [hasMultipleCompanies, setHasMultipleCompanies] = useState<boolean>(() => {
        try {
            return companyService.getAll().length > 1;
        } catch {
            return false;
        }
    });
    const [advancedToolsExpanded, setAdvancedToolsExpanded] = useState(false);
    const [helpExpanded, setHelpExpanded] = useState(false);
    const [planLoaded, setPlanLoaded] = useState(false);
    const isFortnoxPlanEligible = isFortnoxEligible(userPlan);
    const [guardianBadgeCount, setGuardianBadgeCount] = useState(0);
    const [complianceBadgeCount, setComplianceBadgeCount] = useState(0);

    async function getSessionAccessToken(): Promise<string | null> {
        const { data: { session } } = await supabase.auth.getSession();
        return session?.access_token ?? null;
    }

    function buildAuthHeaders(accessToken: string): Record<string, string> {
        return {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`
        };
    }

    function getActiveCompanyId(): string | null {
        if (activeCompanyId) return activeCompanyId;
        try {
            return companyService.getCurrentId();
        } catch {
            return null;
        }
    }

    function refreshCompanyScope(): string | null {
        let companyId: string | null = null;
        try {
            companyId = companyService.getCurrentId();
        } catch {
            companyId = null;
        }
        setActiveCompanyId(companyId);

        try {
            setHasMultipleCompanies(companyService.getAll().length > 1);
        } catch {
            setHasMultipleCompanies(false);
        }

        return companyId;
    }

    async function postAuthedFunction(
        functionName: 'fortnox' | 'fortnox-oauth',
        accessToken: string,
        body: Record<string, unknown>
    ): Promise<Response> {
        return fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${functionName}`,
            {
                method: 'POST',
                headers: buildAuthHeaders(accessToken),
                body: JSON.stringify(body)
            }
        );
    }

    useEffect(() => {
        const update = () => {
            const notifications = copilotService.getNotifications();
            const guardianNotifications = notifications.filter((notification) => notification.id.startsWith('guardian-'));
            const count = countBlockingAlerts(guardianNotifications);
            setGuardianBadgeCount(count);
        };

        update();
        copilotService.addEventListener('copilot-updated', update as EventListener);
        return () => copilotService.removeEventListener('copilot-updated', update as EventListener);
    }, []);

    useEffect(() => {
        const handler = () => {
            const companyId = refreshCompanyScope();
            void loadIntegrationStatus(companyId);
        };

        window.addEventListener('company-changed', handler as EventListener);
        return () => window.removeEventListener('company-changed', handler as EventListener);
    }, []);

    useEffect(() => {
        if (!currentUserId) {
            setComplianceBadgeCount(0);
            return;
        }
        const companyId = activeCompanyId;
        if (!companyId) {
            setComplianceBadgeCount(0);
            return;
        }

        let cancelled = false;
        void (async () => {
            try {
                const alerts = await financeAgentService.listComplianceAlerts(companyId);
                if (cancelled) return;
                const count = countBlockingAlerts(alerts);
                setComplianceBadgeCount(count);
            } catch (error) {
                logger.warn('Could not load compliance badge', error);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [currentUserId, planLoaded, activeTool, activeCompanyId]);

    useEffect(() => {
        const controller = new AbortController();
        setAbortController(controller);

        const companyId = refreshCompanyScope() ?? getActiveCompanyId();
        void loadIntegrationStatus(companyId);

        // Show "taking longer than usual" after 5 seconds
        const feedbackTimeout = setTimeout(() => {
            setLoadingTimeout(true);
        }, 5000);

        // Cleanup: abort pending requests and clear timeout
        return () => {
            controller.abort();
            clearTimeout(feedbackTimeout);
            setAbortController(null);
        };
    }, []);

    useEffect(() => {
        if (!activeTool) return;
        if (!['bank-import', 'invoice-inbox', 'reconciliation'].includes(activeTool)) return;

        const companyId = companyService.getCurrentId();
        if (!companyId) return;

        void financeAgentService.preloadCompany(companyId);
    }, [activeTool]);

    function openTool(tool: IntegrationTool): void {
        if (isFortnoxTool(tool) && !isFortnoxPlanEligible) {
            setError('Fortnox-funktioner kräver Veridat Pro eller Trial.');
            return;
        }
        setError(null);
        setActiveTool(tool);
    }

    async function loadIntegrationStatus(companyIdOverride?: string | null) {
        setLoading(true);
        setError(null);
        setPlanLoaded(false);
        setIsAdmin(false);
        setCurrentUserId(null);
        setAdvancedToolsExpanded(false);
        setHelpExpanded(false);

        try {
            try {
                setHasMultipleCompanies(companyService.getAll().length > 1);
            } catch {
                setHasMultipleCompanies(false);
            }

            const companyId = companyIdOverride ?? getActiveCompanyId();
            if (!companyId) {
                setUserPlan('free');
                setIsAdmin(false);
                setCurrentUserId(null);
                setPlanLoaded(true);
                setError('Välj ett aktivt bolag för att hantera Fortnox-kopplingen.');
                setLoading(false);
                return;
            }

            // Check Fortnox connection status with timeout (10s for auth)
            const { data: { user } } = await withTimeout(
                supabase.auth.getUser(),
                10000,
                'Tidsgräns för autentisering'
            );

            if (!user) {
                setUserPlan('free');
                setIsAdmin(false);
                setCurrentUserId(null);
                setPlanLoaded(true);
                setError('Du måste vara inloggad för att hantera integreringar.');
                setLoading(false);
                return;
            }

            setCurrentUserId(user.id);

            const profileQuery = supabase
                .from('profiles')
                .select('plan, is_admin')
                .eq('id', user.id)
                .maybeSingle();

            const { data: profile, error: profileError } = await withTimeout(
                profileQuery,
                10000,
                'Tidsgräns för att hämta abonnemang'
            );

            if (profileError) {
                logger.error('Error checking plan status:', profileError);
            }

            const normalizedProfile = profile as { plan?: unknown; is_admin?: unknown } | null;
            const plan = normalizeUserPlan(normalizedProfile?.plan);
            const fortnoxAllowed = isFortnoxEligible(plan);
            setIsAdmin(Boolean(normalizedProfile?.is_admin));
            setUserPlan(plan);
            setPlanLoaded(true);

            if (pendingInitialToolRef.current && isFortnoxTool(pendingInitialToolRef.current)) {
                if (fortnoxAllowed) {
                    setActiveTool(pendingInitialToolRef.current);
                }
                pendingInitialToolRef.current = null;
            }

            // Check if user has Fortnox tokens with timeout (10s for DB query)
            const fortnoxQuery = supabase
                .from('fortnox_tokens')
                .select('created_at, expires_at')
                .eq('user_id', user.id)
                .eq('company_id', companyId)
                .maybeSingle();

            const { data: fortnoxTokens, error: tokenError } = await withTimeout(
                fortnoxQuery,
                10000,
                'Tidsgräns för att hämta Fortnox-status'
            );

            if (tokenError && tokenError.code !== 'PGRST116') {
                logger.error('Error checking Fortnox status:', tokenError);
            }

            // Fire-and-forget: sync Fortnox profile to memory on connection
            if (fortnoxAllowed && fortnoxTokens && user) {
                void (async () => {
                    const accessToken = await getSessionAccessToken();
                    if (!accessToken) return;
                    await postAuthedFunction('fortnox', accessToken, { action: 'sync_profile', companyId });
                })().catch((err) => logger.warn('Fortnox profile sync skipped:', err));
            }

            // Build integrations list with status
            const integrationsWithStatus: Integration[] = INTEGRATIONS_CONFIG.map(config => {
                let status: IntegrationStatus = 'coming_soon';
                let statusMessage: string | undefined;
                let connectedAt: string | undefined;

                if (AVAILABLE_INTEGRATIONS.includes(config.id)) {
                    if (config.id === 'fortnox') {
                        if (!fortnoxAllowed) {
                            status = fortnoxTokens ? 'connected' : 'disconnected';
                            statusMessage = 'Kräver Pro';
                            connectedAt = fortnoxTokens?.created_at ?? undefined;
                        } else if (fortnoxTokens) {
                            status = 'connected';
                            connectedAt = fortnoxTokens.created_at ?? undefined;
                        } else {
                            status = 'disconnected';
                        }
                    } else {
                        status = 'disconnected';
                    }
                } else {
                    statusMessage = 'Kommer snart';
                }

                return {
                    ...config,
                    status,
                    statusMessage,
                    connectedAt: connectedAt || undefined
                };
            });

            setIntegrations(integrationsWithStatus);
        } catch (err) {
            logger.error('Error loading integrations:', err);
            setUserPlan('free');
            setIsAdmin(false);
            setCurrentUserId(null);
            setPlanLoaded(true);

            // Check if component was aborted (unmounted)
            if (abortController?.signal.aborted) {
                return; // Don't show error if user closed modal
            }

            // Specific handling for timeout errors
            if (err instanceof TimeoutError) {
                setError('Tidsgränsen nåddes. Kontrollera din internetanslutning och försök igen.');
            } else {
                setError('Kunde inte ladda integreringar. Försök igen.');
            }
        } finally {
            setLoading(false);
        }
    }

    async function handleConnect(integrationId: string) {
        if (integrationId !== 'fortnox') {
            return; // Only Fortnox is implemented
        }

        const companyId = getActiveCompanyId();
        if (!companyId) {
            setError('Välj ett aktivt bolag innan du ansluter Fortnox.');
            return;
        }

        if (!isFortnoxPlanEligible) {
            setError('Fortnox kräver Veridat Pro eller Trial.');
            return;
        }

        setConnecting(integrationId);
        setError(null);

        try {
            // Get the OAuth authorization URL from our Edge Function
            const accessToken = await withTimeout(
                getSessionAccessToken(),
                10000,
                'Tidsgräns för sessionshämtning'
            );

            if (!accessToken) {
                throw new Error('Not authenticated');
            }

            const response = await withTimeout(
                postAuthedFunction('fortnox-oauth', accessToken, { action: 'initiate', companyId }),
                15000, // Edge function may take longer
                'Tidsgräns för Fortnox-anslutning'
            );

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({})) as { errorCode?: string; error?: string };
                if (errorData.errorCode === 'PLAN_REQUIRED' || errorData.error === 'plan_required') {
                    throw new Error('Fortnox kräver Veridat Pro eller Trial.');
                }
                if (errorData.errorCode === 'COMPANY_ORG_REQUIRED' || errorData.error === 'company_org_required') {
                    throw new Error('Bolaget måste ha organisationsnummer innan Fortnox kan anslutas.');
                }
                if (errorData.errorCode === 'COMPANY_NOT_FOUND' || errorData.error === 'company_not_found') {
                    throw new Error('Det aktiva bolaget hittades inte. Uppdatera sidan och försök igen.');
                }
                if (errorData.errorCode === 'MISSING_COMPANY_ID') {
                    throw new Error('Bolagskontext saknas. Försök igen.');
                }
                throw new Error(errorData.error || 'Failed to initiate OAuth');
            }

            const { authorizationUrl } = await response.json();

            // Redirect to Fortnox OAuth
            window.location.href = authorizationUrl;
        } catch (err) {
            logger.error('Error connecting to Fortnox:', err);

            if (err instanceof TimeoutError) {
                setError('Tidsgränsen nåddes vid anslutning. Försök igen.');
            } else {
                setError(err instanceof Error ? err.message : 'Kunde inte ansluta till Fortnox.');
            }
            setConnecting(null);
        }
    }

    async function handleDisconnect(integrationId: string) {
        if (integrationId !== 'fortnox') {
            return;
        }

        const companyId = getActiveCompanyId();
        if (!companyId) {
            setError('Välj ett aktivt bolag innan du kopplar bort Fortnox.');
            return;
        }

        if (!confirm('Är du säker på att du vill koppla bort Fortnox?')) {
            return;
        }

        setConnecting(integrationId);
        setError(null);

        try {
            const accessToken = await withTimeout(
                getSessionAccessToken(),
                10000,
                'Tidsgräns för sessionshämtning'
            );

            if (!accessToken) throw new Error('Not authenticated');

            const response = await withTimeout(
                postAuthedFunction('fortnox-oauth', accessToken, {
                    action: 'disconnect',
                    companyId,
                }),
                10000,
                'Tidsgräns för bortkoppling'
            );

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({})) as { error?: string };
                throw new Error(errorData.error || 'Kunde inte koppla bort Fortnox.');
            }

            // Refresh the list
            await loadIntegrationStatus(companyId);
        } catch (err) {
            logger.error('Error disconnecting Fortnox:', err);

            if (err instanceof TimeoutError) {
                setError('Tidsgränsen nåddes vid bortkoppling. Försök igen.');
            } else {
                setError('Kunde inte koppla bort Fortnox.');
            }
        } finally {
            setConnecting(null);
        }
    }

    function getStatusBadge(integration: Integration) {
        if (integration.id === 'fortnox' && !isFortnoxPlanEligible) {
            return <span className="integ-badge integ-badge--pro">Kräver Pro</span>;
        }

        const status = connecting === integration.id ? 'connecting' : integration.status;
        return (
            <span className={`integ-badge ${STATUS_CLASS_MAP[status]}`}>
                {STATUS_TEXT_MAP[status]}
            </span>
        );
    }

    function renderDisconnectButton(integrationId: string) {
        const isBusy = connecting === integrationId;
        return (
            <button
                onClick={() => handleDisconnect(integrationId)}
                data-testid={`integration-disconnect-${integrationId}`}
                disabled={isBusy}
                className="integ-btn integ-btn--disconnect"
            >
                {isBusy ? '...' : 'Koppla bort'}
            </button>
        );
    }

    function renderConnectButton(integrationId: string) {
        const isBusy = connecting === integrationId;
        return (
            <button
                onClick={() => handleConnect(integrationId)}
                data-testid={`integration-connect-${integrationId}`}
                disabled={isBusy}
                className="integ-btn integ-btn--connect"
            >
                {isBusy ? 'Ansluter...' : 'Anslut'}
            </button>
        );
    }

    function renderIntegrationAction(integration: Integration) {
        if (integration.status === 'coming_soon') return null;

        const fortnoxNeedsPlan = integration.id === 'fortnox' && !isFortnoxPlanEligible;
        if (fortnoxNeedsPlan && integration.status !== 'connected') {
            return (
                <a
                    href={UPGRADE_TO_PRO_MAILTO}
                    className="integ-btn integ-btn--upgrade"
                >
                    Uppgradera
                </a>
            );
        }

        return integration.status === 'connected'
            ? renderDisconnectButton(integration.id)
            : renderConnectButton(integration.id);
    }

    function renderFortnoxToolAlertBadges(toolId: IntegrationTool) {
        if (toolId !== 'fortnox-panel') {
            return null;
        }

        return (
            <>
                {guardianBadgeCount > 0 && (
                    <span
                        title="Guardian-larm"
                        data-testid="integration-tool-fortnox-guardian-badge"
                        className="integ-alert-count integ-alert-count--critical"
                    >
                        {formatAlertCount(guardianBadgeCount)}
                    </span>
                )}
                {complianceBadgeCount > 0 && (
                    <span
                        title="Compliance-varningar"
                        className="integ-alert-count integ-alert-count--warning"
                    >
                        {formatAlertCount(complianceBadgeCount)}
                    </span>
                )}
            </>
        );
    }

    function getToolDef(toolId: IntegrationTool): ToolDef {
        return TOOL_DEFS_BY_ID[toolId];
    }

    function getAdvancedToolsV2(): ToolDef[] {
        return ADVANCED_TOOLS_V2
            .filter((toolId) => toolId !== 'agency' || hasMultipleCompanies)
            .map((toolId) => getToolDef(toolId));
    }

    function renderToolsV2() {
        const advancedTools = getAdvancedToolsV2();

        return (
            <div className="panel-stagger integ-stagger integ-v2">
                <div>
                    <div className="panel-section-title">Primära sektioner</div>
                    <div className="integ-v2-grid">
                        {PRIMARY_SECTIONS_V2.map((section) => {
                            const primaryTool = getToolDef(section.primaryTool);
                            const disabled = primaryTool.requiresPro === true && !isFortnoxPlanEligible;
                            const badge = getToolBadgeMeta(primaryTool, disabled);
                            const secondaryTool = section.secondaryAction ? getToolDef(section.secondaryAction.tool) : null;
                            const secondaryDisabled = secondaryTool
                                ? secondaryTool.requiresPro === true && !isFortnoxPlanEligible
                                : false;

                            return (
                                <PrimarySectionCard
                                    key={section.id}
                                    section={section}
                                    disabled={disabled}
                                    badge={badge}
                                    secondaryDisabled={secondaryDisabled}
                                    secondaryBadges={section.secondaryAction?.tool === 'fortnox-panel'
                                        ? renderFortnoxToolAlertBadges('fortnox-panel')
                                        : null}
                                    onOpenTool={openTool}
                                />
                            );
                        })}
                    </div>
                </div>

                <div className="integ-v2-advanced">
                    <button
                        type="button"
                        data-testid="integration-advanced-toggle"
                        className="integ-v2-advanced__toggle"
                        aria-expanded={advancedToolsExpanded}
                        onClick={() => setAdvancedToolsExpanded((prev) => !prev)}
                    >
                        <span>Avancerat</span>
                        <span className="integ-v2-advanced__chevron" aria-hidden="true">
                            {advancedToolsExpanded ? '▾' : '▸'}
                        </span>
                    </button>

                    {advancedToolsExpanded && (
                        <div
                            className="integ-v2-advanced__panel"
                            data-testid="integration-advanced-panel"
                        >
                            <div className="integ-v2-advanced__grid">
                                {advancedTools.map((tool) => {
                                    const disabled = tool.requiresPro === true && !isFortnoxPlanEligible;
                                    const badge = getToolBadgeMeta(tool, disabled);

                                    return (
                                        <IntegrationToolCard
                                            key={tool.id}
                                            tool={tool}
                                            disabled={disabled}
                                            badge={badge}
                                            alertBadges={renderFortnoxToolAlertBadges(tool.id)}
                                            onClick={openTool}
                                        />
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>

                <div className="integ-v2-help" data-testid="integration-v2-help-row">
                    <span className="integ-v2-help__text">
                        Anslut Fortnox för att synka kunder, artiklar och bokföringsdata.
                    </span>
                    <button
                        type="button"
                        className="integ-v2-help__link"
                        onClick={() => setHelpExpanded((prev) => !prev)}
                    >
                        {helpExpanded ? 'Dölj' : 'Hur fungerar det?'}
                    </button>
                </div>

                {helpExpanded && (
                    <p className="integ-v2-help__details">
                        {INTEGRATIONS_INFO_CARD.message}
                    </p>
                )}
            </div>
        );
    }

    function renderLegacyToolGroups() {
        return (
            <>
                <div className="panel-stagger integ-stagger" style={TOOL_GROUPS_WRAP_STYLE}>
                    {TOOL_GROUPS.map((group) => (
                        <div key={group.title}>
                            <div className="panel-section-title">{group.title}</div>
                            <div style={TOOL_GROUP_GRID_STYLE}>
                                {group.tools.map((tool) => {
                                    const disabled = tool.requiresPro === true && !isFortnoxPlanEligible;
                                    const toolBadge = getToolBadgeMeta(tool, disabled);

                                    return (
                                        <IntegrationToolCard
                                            key={tool.id}
                                            tool={tool}
                                            disabled={disabled}
                                            badge={toolBadge}
                                            alertBadges={renderFortnoxToolAlertBadges(tool.id)}
                                            onClick={openTool}
                                        />
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
                <IntegrationsInfoCard />
            </>
        );
    }

    function renderActiveToolModal() {
        if (!activeTool) return null;

        const onBack = () => setActiveTool(null);
        const modalConfigByTool: Record<IntegrationTool, {
            title: string;
            subtitle: string;
            maxWidth: string;
            render: () => ComponentChildren;
        }> = {
            dashboard: {
                title: 'Översikt',
                subtitle: 'Din bokföringsöversikt på ett ställe.',
                maxWidth: '1400px',
                render: () => (
                    <DashboardPanel
                        onBack={onBack}
                        onNavigate={(tool) => openTool(tool as IntegrationTool)}
                        isAdmin={isAdmin}
                        userId={currentUserId}
                        timeWindowDays={7}
                    />
                ),
            },
            'bank-import': {
                title: 'Bankimport (CSV)',
                subtitle: 'Importera kontoutdrag och matcha mot Fortnox-fakturor.',
                maxWidth: '1200px',
                render: () => <BankImportPanel onBack={onBack} />,
            },
            agency: {
                title: 'Byråvy (beta)',
                subtitle: 'Hantera klientbolag och byt aktivt bolag snabbt.',
                maxWidth: '1200px',
                render: () => <AgencyPanel onBack={onBack} />,
            },
            reconciliation: {
                title: 'Bankavstämning',
                subtitle: 'Översikt och periodstatus för bankavstämning.',
                maxWidth: '1200px',
                render: () => (
                    <ReconciliationView
                        onBack={onBack}
                        onOpenBankImport={() => openTool('bank-import')}
                    />
                ),
            },
            'bookkeeping-rules': {
                title: 'Bokföringsregler',
                subtitle: 'Hantera automatiska konteringsregler baserade på tidigare bokföringar.',
                maxWidth: '1200px',
                render: () => <BookkeepingRulesPanel onBack={onBack} />,
            },
            'invoice-inbox': {
                title: 'Fakturainkorg',
                subtitle: 'Ladda upp leverantörsfakturor, AI-extrahera och exportera till Fortnox.',
                maxWidth: '1200px',
                render: () => <InvoiceInboxPanel onBack={onBack} />,
            },
            'vat-report': {
                title: 'Momsdeklaration',
                subtitle: 'Momsrapport baserad på din Fortnox-bokföring.',
                maxWidth: '1200px',
                render: () => <VATReportFromFortnoxPanel onBack={onBack} />,
            },
            'fortnox-panel': {
                title: 'Fortnoxpanel',
                subtitle: 'Leverantörsfakturor, status och Copilot på ett ställe.',
                maxWidth: '1200px',
                render: () => <FortnoxPanel onBack={onBack} />,
            },
        };

        const modalConfig = modalConfigByTool[activeTool];
        return (
            <ModalWrapper
                onClose={onClose}
                title={modalConfig.title}
                subtitle={modalConfig.subtitle}
                maxWidth={modalConfig.maxWidth}
            >
                {modalConfig.render()}
            </ModalWrapper>
        );
    }

    if (activeTool && isFortnoxTool(activeTool) && (!planLoaded || !isFortnoxPlanEligible)) {
        return (
            <ModalWrapper
                onClose={onClose}
                title="Fortnox-funktioner"
                subtitle="Tillgängligt i Veridat Pro eller Trial."
                maxWidth="640px"
            >
                <InlineNoticeBanner
                    testId={FORTNOX_PLAN_GATED_BANNER.testId}
                    message={FORTNOX_PLAN_GATED_BANNER.message}
                    style={FORTNOX_PLAN_GATED_BANNER_STYLE}
                />
                <a
                    href={UPGRADE_TO_PRO_MAILTO}
                    data-testid="fortnox-upgrade-link"
                    style={FORTNOX_UPGRADE_LINK_STYLE}
                >
                    Uppgradera till Pro
                </a>
            </ModalWrapper>
        );
    }

    const activeToolModal = renderActiveToolModal();
    if (activeToolModal) return activeToolModal;
    const fortnoxIntegration = integrations.find((integration) => integration.id === 'fortnox');
    const showReconnectBanner = Boolean(
        activeCompanyId
        && isFortnoxPlanEligible
        && fortnoxIntegration?.status === 'disconnected'
    );

    return (
        <ModalWrapper onClose={onClose} title="Integreringar" subtitle="Anslut Veridat till dina bokföringssystem." maxWidth="1200px">
            <div className="panel-stagger" style={INTEGRATIONS_MODAL_BODY_STYLE}>
                {error && (
                    <div style={MODAL_ERROR_BOX_STYLE}>
                        {error}
                    </div>
                )}

                {loading ? (
                    <div style={INTEGRATIONS_LOADING_STYLE}>
                        <div className="modal-spinner" style={MODAL_LOADING_SPINNER_STYLE} role="status" aria-label="Laddar"></div>
                        {loadingTimeout && (
                            <div style={INTEGRATIONS_LOADING_TIMEOUT_STYLE}>
                                Detta tar längre tid än vanligt. Kontrollera din internetanslutning.
                            </div>
                        )}
                    </div>
                ) : (
                    <>
                        {showReconnectBanner && (
                            <InlineNoticeBanner
                                testId={FORTNOX_RECONNECT_BANNER.testId}
                                message={FORTNOX_RECONNECT_BANNER.message}
                                style={FORTNOX_RECONNECT_BANNER_STYLE}
                            />
                        )}

                        {/* Integration Cards (Fortnox, Visma, BankID) */}
                        <div>
                            <div className="panel-section-title">Integrationer</div>
                            <div
                                className="integrations-list"
                                style={INTEGRATIONS_LIST_GRID_STYLE}
                            >
                                {integrations.map((integration) => {
                                    const icon = ICON_MAP[integration.icon] || { letter: '?', className: 'integ-icon' };
                                    const isComingSoon = integration.status === 'coming_soon';
                                    const isConnected = integration.status === 'connected';

                                    return (
                                        <IntegrationConnectionCard
                                            key={integration.id}
                                            integration={integration}
                                            icon={icon}
                                            isComingSoon={isComingSoon}
                                            isConnected={isConnected}
                                            statusBadge={getStatusBadge(integration)}
                                            action={renderIntegrationAction(integration)}
                                        />
                                    );
                                })}
                            </div>
                        </div>
                    </>
                )}

                {!loading && (
                    integrationsIaV2Enabled
                        ? renderToolsV2()
                        : renderLegacyToolGroups()
                )}
            </div>
        </ModalWrapper>
    );
}

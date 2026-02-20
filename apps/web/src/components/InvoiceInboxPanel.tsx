/**
 * InvoiceInboxPanel - Supplier invoice inbox with AI extraction and Fortnox integration.
 *
 * Drag-and-drop PDF/image upload, Gemini-powered data extraction,
 * editable fields, pipeline status tracking, and Fortnox export.
 * Invoice data is persisted via finance-agent (Supabase-backed).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { supabase } from '../lib/supabase';
import { companyService } from '../services/CompanyService';
import { fileService } from '../services/FileService';
import { financeAgentService } from '../services/FinanceAgentService';
import { logger } from '../services/LoggerService';
import type { InvoiceInboxRecord } from '../types/finance';
import { getFortnoxList, getFortnoxObject } from '../utils/fortnoxResponse';
import { InvoicePostingReviewDrawer } from './InvoicePostingReviewDrawer';
import { getInvoicePostingReviewEnabled, invoicePostingReviewService, type InvoicePostingTrace } from '../services/InvoicePostingReviewService';

// =============================================================================
// TYPES
// =============================================================================

type InvoiceStatus = 'ny' | 'granskad' | 'bokford' | 'betald';
type FortnoxSyncStatus = 'not_exported' | 'exported' | 'booked' | 'attested';

type InvoiceSource = 'upload' | 'fortnox';
type InvoiceStatusFilter = InvoiceStatus | 'alla';

interface InvoiceInboxItem {
    id: string;
    fileName: string;
    fileUrl: string;
    filePath: string;
    fileBucket: string;
    uploadedAt: string;
    status: InvoiceStatus;
    source: InvoiceSource;
    // Extracted data
    supplierName: string;
    supplierOrgNr: string;
    invoiceNumber: string;
    invoiceDate: string;
    dueDate: string;
    totalAmount: number | null;
    vatAmount: number | null;
    vatRate: number | null;
    ocrNumber: string;
    basAccount: string;
    basAccountName: string;
    currency: string;
    // Fortnox
    fortnoxSyncStatus: FortnoxSyncStatus;
    fortnoxSupplierNumber: string;
    fortnoxGivenNumber: number | null;
    fortnoxBooked: boolean;
    fortnoxBalance: number | null;
    // AI
    aiExtracted: boolean;
    aiRawResponse: string;
    aiReviewNote: string;
}

interface InvoiceInboxPanelProps {
    onBack: () => void;
}

interface InvoiceSummary {
    total: number;
    ny: number;
    granskad: number;
    bokford: number;
    betald: number;
    totalAmount: number;
}

interface SummaryCard {
    label: string;
    value: string | number;
    color: string;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const STATUS_CONFIG: Record<InvoiceStatus, { label: string; color: string; bg: string }> = {
    ny: { label: 'Ny', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)' },
    granskad: { label: 'Granskad', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.15)' },
    bokford: { label: 'Bokförd', color: '#10b981', bg: 'rgba(16, 185, 129, 0.15)' },
    betald: { label: 'Betald', color: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.15)' },
};

const ALL_STATUSES: InvoiceStatus[] = ['ny', 'granskad', 'bokford', 'betald'];
const FORTNOX_SYNC_STATUS_LABELS: Record<FortnoxSyncStatus, string> = {
    not_exported: 'Ej exporterad',
    exported: 'Exporterad',
    booked: 'Bokförd i Fortnox',
    attested: 'Attesterad i Fortnox',
};
const FORTNOX_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fortnox`;
const GEMINI_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/gemini-chat`;

const INVOICE_CARD_TOP_ROW_STYLE = {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    flexWrap: 'wrap',
    marginBottom: '0.6rem',
} as const;

const INVOICE_CARD_SUPPLIER_WRAP_STYLE = {
    flex: 1,
    minWidth: '120px',
} as const;

const INVOICE_CARD_SUPPLIER_NAME_STYLE = {
    fontWeight: 600,
    color: 'var(--text-primary)',
    fontSize: '0.9rem',
} as const;

const INVOICE_CARD_FILE_NAME_STYLE = {
    fontSize: '0.75rem',
    color: 'var(--text-secondary)',
} as const;

const INVOICE_CARD_AMOUNT_WRAP_STYLE = {
    textAlign: 'right',
} as const;

const INVOICE_CARD_AMOUNT_VALUE_STYLE = {
    fontWeight: 700,
    color: 'var(--text-primary)',
    fontSize: '1rem',
} as const;

const INVOICE_CARD_AMOUNT_META_STYLE = {
    fontSize: '0.72rem',
    color: 'var(--text-secondary)',
} as const;

const INVOICE_CARD_DETAILS_ROW_STYLE = {
    display: 'flex',
    gap: '1.5rem',
    flexWrap: 'wrap',
    fontSize: '0.8rem',
    marginBottom: '0.6rem',
} as const;

const INVOICE_CARD_DETAIL_LABEL_STYLE = {
    color: 'var(--text-secondary)',
} as const;

const INVOICE_CARD_DETAIL_VALUE_STYLE = {
    color: 'var(--text-primary)',
} as const;

const INVOICE_CARD_DETAIL_STRONG_VALUE_STYLE = {
    color: 'var(--text-primary)',
    fontWeight: 600,
} as const;

const INVOICE_CARD_DETAIL_FORTNOX_VALUE_STYLE = {
    color: '#10b981',
    fontWeight: 600,
} as const;

const INVOICE_CARD_AI_REVIEW_STYLE = {
    padding: '0.5rem 0.75rem',
    borderRadius: '8px',
    background: 'rgba(139, 92, 246, 0.08)',
    border: '1px solid rgba(139, 92, 246, 0.2)',
    fontSize: '0.8rem',
    color: 'var(--text-primary)',
    lineHeight: 1.4,
    marginBottom: '0.6rem',
} as const;

const INVOICE_CARD_AI_REVIEW_LABEL_STYLE = {
    fontWeight: 600,
    color: '#8b5cf6',
    fontSize: '0.72rem',
} as const;

const INVOICE_INBOX_ROOT_STYLE = {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
} as const;

const INVOICE_INBOX_HEADER_STYLE = {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
} as const;

const INVOICE_INBOX_BACK_BUTTON_STYLE = {
    background: 'transparent',
    border: '1px solid var(--glass-border)',
    borderRadius: '8px',
    color: 'var(--text-secondary)',
    padding: '0.4rem 0.75rem',
    fontSize: '0.8rem',
    cursor: 'pointer',
} as const;

const INVOICE_INBOX_HEADER_HINT_STYLE = {
    fontSize: '0.85rem',
    color: 'var(--text-secondary)',
} as const;

const INVOICE_INBOX_ERROR_MESSAGE_STYLE = {
    padding: '0.6rem 0.8rem',
    borderRadius: '8px',
    background: 'rgba(239, 68, 68, 0.12)',
    color: '#ef4444',
    fontSize: '0.8rem',
} as const;

const INVOICE_INBOX_SUCCESS_MESSAGE_STYLE = {
    padding: '0.6rem 0.8rem',
    borderRadius: '8px',
    background: 'rgba(16, 185, 129, 0.12)',
    color: '#10b981',
    fontSize: '0.8rem',
} as const;

const INVOICE_UPLOAD_ZONE_BASE_STYLE = {
    padding: '1.5rem',
    textAlign: 'center',
} as const;

const INVOICE_FILE_INPUT_HIDDEN_STYLE = { display: 'none' } as const;

const INVOICE_UPLOAD_TEXT_STYLE = {
    color: 'var(--text-secondary)',
    fontSize: '0.85rem',
} as const;

const INVOICE_UPLOAD_ICON_STYLE = {
    fontSize: '1.5rem',
    marginBottom: '0.4rem',
} as const;

const INVOICE_UPLOAD_TITLE_STYLE = {
    fontWeight: 600,
    color: 'var(--text-primary)',
    fontSize: '0.9rem',
} as const;

const INVOICE_UPLOAD_HINT_STYLE = {
    color: 'var(--text-secondary)',
    fontSize: '0.8rem',
    marginTop: '0.25rem',
} as const;

const INVOICE_SYNC_BUTTON_BASE_STYLE = {
    width: '100%',
    height: '42px',
    borderRadius: '10px',
    border: '1px solid rgba(16, 185, 129, 0.3)',
    background: 'rgba(16, 185, 129, 0.08)',
    color: '#10b981',
    fontSize: '0.85rem',
    fontWeight: 600,
} as const;

const INVOICE_SUMMARY_GRID_STYLE = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
    gap: '0.75rem',
} as const;

const INVOICE_STATUS_FILTER_ROW_STYLE = {
    display: 'flex',
    gap: '0.5rem',
    flexWrap: 'wrap',
} as const;

const INVOICE_EMPTY_STATE_STYLE = {
    textAlign: 'center',
    color: 'var(--text-secondary)',
    fontSize: '0.85rem',
    border: '1px dashed var(--surface-border)',
} as const;

const INVOICE_LIST_GRID_STYLE = {
    display: 'grid',
    gap: '0.75rem',
} as const;

const INVOICE_HELP_CARD_STYLE = {
    fontSize: '0.8rem',
    color: 'var(--text-secondary)',
    lineHeight: 1.5,
} as const;

const INVOICE_HELP_TITLE_STYLE = { color: 'var(--text-primary)' } as const;

const FILTER_BUTTON_BASE_STYLE = {
    height: '34px',
    padding: '0 0.8rem',
    borderRadius: '10px',
    border: '1px solid var(--glass-border)',
    fontSize: '0.78rem',
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '0.35rem',
} as const;

const FILTER_BUTTON_COUNT_STYLE = {
    fontSize: '0.7rem',
    opacity: 0.7,
    fontWeight: 400,
} as const;

const INVOICE_PILL_BASE_STYLE = {
    padding: '0.15rem 0.5rem',
    borderRadius: '999px',
    fontSize: '0.7rem',
    fontWeight: 600,
} as const;

const INVOICE_CARD_ACTIONS_ROW_STYLE = {
    display: 'flex',
    gap: '0.5rem',
    flexWrap: 'wrap',
} as const;

const EDIT_FORM_GRID_STYLE = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: '0.5rem',
    padding: '0.75rem',
    marginBottom: '0.6rem',
    borderRadius: '10px',
    border: '1px solid rgba(255, 255, 255, 0.06)',
    background: 'rgba(255, 255, 255, 0.02)',
} as const;

const EDIT_FORM_LABEL_STYLE = {
    fontSize: '0.72rem',
    color: 'var(--text-secondary)',
    display: 'block',
    marginBottom: '0.15rem',
} as const;

const EDIT_FORM_INPUT_STYLE = {
    width: '100%',
    height: '30px',
    padding: '0 0.5rem',
    borderRadius: '8px',
    border: '1px solid var(--glass-border)',
    background: 'rgba(255, 255, 255, 0.04)',
    color: 'var(--text-primary)',
    fontSize: '0.8rem',
    outline: 'none',
    boxSizing: 'border-box',
} as const;

const ACTION_BUTTON_BASE_STYLE = {
    height: '30px',
    padding: '0 0.7rem',
    borderRadius: '8px',
    border: '1px solid var(--glass-border)',
    background: 'transparent',
    fontSize: '0.75rem',
    fontWeight: 600,
    whiteSpace: 'nowrap',
} as const;

// =============================================================================
// HELPERS
// =============================================================================

function generateId(): string {
    return `inv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getFunctionErrorMessage(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') {
        return null;
    }

    const error = (payload as Record<string, unknown>).error;
    if (typeof error === 'string' && error.trim()) {
        return error;
    }

    const message = (payload as Record<string, unknown>).message;
    if (typeof message === 'string' && message.trim()) {
        return message;
    }

    return null;
}

function generateIdempotencyKey(
    action: string,
    companyId: string,
    item: Pick<InvoiceInboxItem, 'id' | 'invoiceNumber' | 'fortnoxGivenNumber'>
): string {
    const resource = item.fortnoxGivenNumber ?? item.invoiceNumber ?? item.id;
    return `invoice_inbox:${companyId}:${action}:${String(resource)}`;
}

function inferFortnoxSyncStatus(item: Partial<InvoiceInboxItem>): FortnoxSyncStatus {
    if (item.fortnoxSyncStatus) {
        return item.fortnoxSyncStatus;
    }

    if (!item.fortnoxGivenNumber) {
        return 'not_exported';
    }

    if (item.fortnoxBooked) {
        return 'booked';
    }

    return 'exported';
}

function normalizeStatus(status: InvoiceStatus | undefined, fortnoxSyncStatus: FortnoxSyncStatus): InvoiceStatus {
    const nextStatus = status || 'ny';
    if (nextStatus === 'bokford' && (fortnoxSyncStatus === 'not_exported' || fortnoxSyncStatus === 'exported')) {
        return 'granskad';
    }
    return nextStatus;
}

function getBookedStatus(status: InvoiceStatus): InvoiceStatus {
    return status === 'betald' ? 'betald' : 'bokford';
}

function withFortnoxBookedState(
    item: InvoiceInboxItem,
    fortnoxSyncStatus: 'booked' | 'attested'
): InvoiceInboxItem {
    return {
        ...item,
        fortnoxBooked: true,
        fortnoxSyncStatus,
        status: getBookedStatus(item.status),
    };
}

function toInboxItem(item: Partial<InvoiceInboxRecord>): InvoiceInboxItem {
    const fortnoxSyncStatus = inferFortnoxSyncStatus(item as Partial<InvoiceInboxItem>);
    return {
        id: item.id || generateId(),
        fileName: item.fileName || '',
        fileUrl: item.fileUrl || '',
        filePath: item.filePath || '',
        fileBucket: item.fileBucket || '',
        uploadedAt: item.uploadedAt || new Date().toISOString(),
        status: normalizeStatus(item.status as InvoiceStatus | undefined, fortnoxSyncStatus),
        source: (item.source as InvoiceSource | undefined) || 'upload',
        supplierName: item.supplierName || '',
        supplierOrgNr: item.supplierOrgNr || '',
        invoiceNumber: item.invoiceNumber || '',
        invoiceDate: item.invoiceDate || '',
        dueDate: item.dueDate || '',
        totalAmount: item.totalAmount ?? null,
        vatAmount: item.vatAmount ?? null,
        vatRate: item.vatRate ?? null,
        ocrNumber: item.ocrNumber || '',
        basAccount: item.basAccount || '',
        basAccountName: item.basAccountName || '',
        currency: item.currency || 'SEK',
        fortnoxSyncStatus,
        fortnoxSupplierNumber: item.fortnoxSupplierNumber || '',
        fortnoxGivenNumber: item.fortnoxGivenNumber ?? null,
        fortnoxBooked: item.fortnoxBooked === true,
        fortnoxBalance: item.fortnoxBalance ?? null,
        aiExtracted: item.aiExtracted === true,
        aiRawResponse: item.aiRawResponse || '',
        aiReviewNote: item.aiReviewNote || '',
    };
}

function formatAmount(value: number | null): string {
    if (value === null || value === undefined) return '-';
    return value.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(value: string): string {
    if (!value) return '-';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleDateString('sv-SE');
}

function isDueSoon(dueDate: string): boolean {
    if (!dueDate) return false;
    const due = new Date(dueDate);
    const now = new Date();
    const diffDays = (due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    return diffDays >= 0 && diffDays <= 5;
}

function isOverdue(dueDate: string): boolean {
    if (!dueDate) return false;
    const due = new Date(dueDate);
    return due < new Date();
}

function getInvoiceDisplayName(item: InvoiceInboxItem): string {
    return item.supplierName || item.fortnoxSupplierNumber || item.fileName || `Fortnox #${item.fortnoxGivenNumber}`;
}

function getInvoiceCardContainerStyle(overdue: boolean) {
    return {
        border: `1px solid ${overdue ? 'rgba(239, 68, 68, 0.4)' : 'var(--surface-border)'}`,
        background: overdue ? 'rgba(239, 68, 68, 0.04)' : undefined,
    };
}

function getInvoiceDueDateStyle(overdue: boolean) {
    return {
        color: overdue ? '#ef4444' : 'var(--text-primary)',
        fontWeight: overdue ? 600 : 400,
    };
}

function getInvoiceBalanceStyle(balance: number) {
    return {
        color: balance > 0 ? '#f59e0b' : '#10b981',
        fontWeight: 600,
    };
}

function getUploadZoneStyle(dragOver: boolean) {
    return {
        ...INVOICE_UPLOAD_ZONE_BASE_STYLE,
        border: `2px dashed ${dragOver ? '#3b82f6' : 'var(--surface-border)'}`,
        background: dragOver ? 'rgba(59, 130, 246, 0.08)' : 'var(--surface-1)',
    } as const;
}

function getFortnoxSyncButtonStyle(syncing: boolean) {
    return {
        ...INVOICE_SYNC_BUTTON_BASE_STYLE,
        cursor: syncing ? 'wait' : 'pointer',
        opacity: syncing ? 0.6 : 1,
    } as const;
}

function getSummaryStatStyle(color: string) {
    return { color };
}

function getFilterButtonStyle(active: boolean, color?: string) {
    return {
        ...FILTER_BUTTON_BASE_STYLE,
        background: active ? (color ? `${color}20` : 'rgba(255, 255, 255, 0.1)') : 'transparent',
        color: active ? (color || 'var(--text-primary)') : 'var(--text-secondary)',
    } as const;
}

function getInvoicePillStyle(background: string, color: string) {
    return {
        ...INVOICE_PILL_BASE_STYLE,
        background,
        color,
    } as const;
}

function getActionButtonStyle(color: string, disabled = false) {
    return {
        ...ACTION_BUTTON_BASE_STYLE,
        color,
        cursor: disabled ? 'wait' : 'pointer',
        opacity: disabled ? 0.6 : 1,
    } as const;
}

function filterItemsByStatus(items: InvoiceInboxItem[], statusFilter: InvoiceStatusFilter): InvoiceInboxItem[] {
    if (statusFilter === 'alla') {
        return items;
    }
    return items.filter((item) => item.status === statusFilter);
}

function buildInvoiceSummary(items: InvoiceInboxItem[]): InvoiceSummary {
    const summary: InvoiceSummary = {
        total: items.length,
        ny: 0,
        granskad: 0,
        bokford: 0,
        betald: 0,
        totalAmount: 0,
    };

    for (const item of items) {
        summary[item.status] += 1;
        summary.totalAmount += item.totalAmount || 0;
    }

    return summary;
}

function buildSummaryCards(summary: InvoiceSummary): SummaryCard[] {
    return [
        { label: 'Totalt', value: summary.total, color: 'var(--text-primary)' },
        { label: 'Nya', value: summary.ny, color: STATUS_CONFIG.ny.color },
        { label: 'Granskade', value: summary.granskad, color: STATUS_CONFIG.granskad.color },
        { label: 'Bokförda', value: summary.bokford, color: STATUS_CONFIG.bokford.color },
        { label: 'Betalda', value: summary.betald, color: STATUS_CONFIG.betald.color },
        { label: 'Summa', value: `${formatAmount(summary.totalAmount)} kr`, color: 'var(--text-primary)' },
    ];
}

// =============================================================================
// AI EXTRACTION PROMPT
// =============================================================================

const EXTRACTION_PROMPT = `Du är en faktura-OCR-assistent. Analysera dokumentet och extrahera följande fält i JSON-format.
Om ett fält inte hittas, ange tom sträng "" för text och null för nummer.

Returnera ENBART ett JSON-objekt med exakt dessa fält:
{
  "supplierName": "Leverantörens namn",
  "supplierOrgNr": "Organisationsnummer",
  "invoiceNumber": "Fakturanummer",
  "invoiceDate": "YYYY-MM-DD",
  "dueDate": "YYYY-MM-DD (förfallodatum)",
  "totalAmount": 1234.56,
  "vatAmount": 246.91,
  "vatRate": 25,
  "ocrNumber": "OCR/betalningsreferens",
  "currency": "SEK",
  "basAccount": "Föreslaget BAS-kontonummer (t.ex. 6212 för telefoni, 5010 för lokalhyra)",
  "basAccountName": "Kontonamn"
}

VIKTIGT:
- Belopp ska vara nummer utan tusentalsavgränsare
- Datum ska vara YYYY-MM-DD
- Föreslå rätt BAS-konto baserat på typen av kostnad
- Om momssats inte är tydlig men momsbelopp finns, beräkna momssatsen`;

// =============================================================================
// COMPONENT
// =============================================================================

export function InvoiceInboxPanel({ onBack }: InvoiceInboxPanelProps) {
    const [items, setItems] = useState<InvoiceInboxItem[]>([]);
    const [statusFilter, setStatusFilter] = useState<InvoiceStatusFilter>('alla');
    const [uploading, setUploading] = useState(false);
    const [extractingId, setExtractingId] = useState<string | null>(null);
    const [exportingId, setExportingId] = useState<string | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [syncing, setSyncing] = useState(false);
    const [bookingId, setBookingId] = useState<string | null>(null);
    const [reviewingId, setReviewingId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [successMsg, setSuccessMsg] = useState<string | null>(null);
    const [dragOver, setDragOver] = useState(false);
    const [postingDrawerOpen, setPostingDrawerOpen] = useState(false);
    const [postingTraceLoading, setPostingTraceLoading] = useState(false);
    const [postingTraceError, setPostingTraceError] = useState<string | null>(null);
    const [postingTrace, setPostingTrace] = useState<InvoicePostingTrace | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const companyId = companyService.getCurrentId();
    const invoicePostingReviewEnabled = getInvoicePostingReviewEnabled();

    const getSessionAccessToken = useCallback(async (): Promise<string | null> => {
        const { data: { session } } = await supabase.auth.getSession();
        return session?.access_token ?? null;
    }, []);

    const buildAuthHeaders = useCallback((accessToken: string): Record<string, string> => ({
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
    }), []);

    const callFortnox = useCallback(async (
        action: string,
        payload: Record<string, unknown>
    ): Promise<{ ok: true; status: number; data: unknown } | { ok: false; status: number; error: string | null }> => {
        const accessToken = await getSessionAccessToken();
        if (!accessToken) {
            return { ok: false, status: 401, error: 'Du måste vara inloggad.' };
        }

        const response = await fetch(FORTNOX_FUNCTION_URL, {
            method: 'POST',
            headers: buildAuthHeaders(accessToken),
            body: JSON.stringify({
                action,
                companyId,
                payload,
            }),
        });

        const body = await response.json().catch(() => null);
        if (!response.ok) {
            return { ok: false, status: response.status, error: getFunctionErrorMessage(body) };
        }

        return { ok: true, status: response.status, data: body };
    }, [buildAuthHeaders, companyId, getSessionAccessToken]);

    const callGemini = useCallback(async (
        payload: Record<string, unknown>
    ): Promise<{ ok: true; response: Response } | { ok: false; status: number }> => {
        const accessToken = await getSessionAccessToken();
        if (!accessToken) {
            return { ok: false, status: 401 };
        }

        const response = await fetch(GEMINI_FUNCTION_URL, {
            method: 'POST',
            headers: buildAuthHeaders(accessToken),
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            return { ok: false, status: response.status };
        }

        return { ok: true, response };
    }, [buildAuthHeaders, getSessionAccessToken]);

    // Load from finance-agent
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const loaded = await financeAgentService.refreshInvoiceInbox(companyId);
                if (cancelled) return;
                setItems(loaded.map((item) => toInboxItem(item)));
            } catch (err) {
                logger.warn('Failed to load invoice inbox from finance-agent', err);
                if (!cancelled) {
                    setItems(financeAgentService.getCachedInvoiceInbox(companyId).map((item) => toInboxItem(item)));
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [companyId]);

    // Persist changes
    const updateItems = useCallback((updater: (prev: InvoiceInboxItem[]) => InvoiceInboxItem[]) => {
        setItems(prev => {
            const next = updater(prev);
            const prevById = new Map(prev.map((item) => [item.id, item]));
            const nextIds = new Set(next.map((item) => item.id));
            const changedItems = next.filter((item) => JSON.stringify(prevById.get(item.id)) !== JSON.stringify(item));
            const removedIds = prev.filter((item) => !nextIds.has(item.id)).map((item) => item.id);

            for (const item of changedItems) {
                void financeAgentService.upsertInvoiceInboxItem(companyId, item as unknown as InvoiceInboxRecord).catch((err) => {
                    logger.warn('Failed to persist invoice inbox item', { itemId: item.id, err });
                });
            }
            for (const removedId of removedIds) {
                void financeAgentService.deleteInvoiceInboxItem(companyId, removedId, {
                    idempotencyKey: `invoice_inbox:${companyId}:delete:${removedId}`,
                    fingerprint: `delete:${removedId}`,
                }).catch((err) => {
                    logger.warn('Failed to delete invoice inbox item', { removedId, err });
                });
            }
            return next;
        });
    }, [companyId]);

    const updateItemById = useCallback(
        (itemId: string, updater: (item: InvoiceInboxItem) => InvoiceInboxItem): void => {
            updateItems((prev) => prev.map((item) => (
                item.id === itemId ? updater(item) : item
            )));
        },
        [updateItems]
    );

    // Auto-dismiss messages
    useEffect(() => {
        if (successMsg) {
            const t = setTimeout(() => setSuccessMsg(null), 4000);
            return () => clearTimeout(t);
        }
    }, [successMsg]);

    useEffect(() => {
        if (error) {
            const t = setTimeout(() => setError(null), 6000);
            return () => clearTimeout(t);
        }
    }, [error]);

    // =========================================================================
    // FILE UPLOAD
    // =========================================================================

    const handleFiles = useCallback(async (files: FileList | File[]) => {
        const fileArray = Array.from(files).filter(f => {
            const ext = f.name.toLowerCase().split('.').pop();
            return ext === 'pdf' || ['png', 'jpg', 'jpeg', 'webp'].includes(ext || '');
        });

        if (fileArray.length === 0) {
            setError('Ladda upp PDF eller bild (PNG/JPG).');
            return;
        }

        setUploading(true);
        setError(null);

        for (const file of fileArray) {
            try {
                const validation = fileService.validate(file);
                if (!validation.valid) {
                    setError(validation.error || 'Ogiltig fil.');
                    continue;
                }

                const uploaded = await fileService.uploadToStorage(file, 'chat-files', companyId);

                const newItem: InvoiceInboxItem = {
                    id: generateId(),
                    fileName: file.name,
                    fileUrl: uploaded.url,
                    filePath: uploaded.path,
                    fileBucket: uploaded.bucket,
                    uploadedAt: new Date().toISOString(),
                    status: 'ny',
                    source: 'upload',
                    supplierName: '',
                    supplierOrgNr: '',
                    invoiceNumber: '',
                    invoiceDate: '',
                    dueDate: '',
                    totalAmount: null,
                    vatAmount: null,
                    vatRate: null,
                    ocrNumber: '',
                    basAccount: '',
                    basAccountName: '',
                    currency: 'SEK',
                    fortnoxSupplierNumber: '',
                    fortnoxSyncStatus: 'not_exported',
                    fortnoxGivenNumber: null,
                    fortnoxBooked: false,
                    fortnoxBalance: null,
                    aiExtracted: false,
                    aiRawResponse: '',
                    aiReviewNote: '',
                };

                updateItems(prev => [newItem, ...prev]);

                // Auto-extract after upload
                void extractInvoiceData(newItem);
            } catch (err) {
                logger.error('Upload failed:', err);
                setError(`Kunde inte ladda upp ${file.name}.`);
            }
        }

        setUploading(false);
    }, [companyId, updateItems]);

    // Drag & drop handlers
    const onDragOver = useCallback((e: DragEvent) => {
        e.preventDefault();
        setDragOver(true);
    }, []);

    const onDragLeave = useCallback(() => {
        setDragOver(false);
    }, []);

    const onDrop = useCallback((e: DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer?.files) {
            void handleFiles(e.dataTransfer.files);
        }
    }, [handleFiles]);

    // =========================================================================
    // AI EXTRACTION
    // =========================================================================

    const extractInvoiceData = useCallback(async (item: InvoiceInboxItem) => {
        setExtractingId(item.id);
        setError(null);

        try {
            // Download file and convert to base64 for Gemini
            const freshUrl = await fileService.createSignedUrl(item.fileBucket, item.filePath);
            const fileResp = await fetch(freshUrl);
            if (!fileResp.ok) throw new Error('Kunde inte hämta filen från lagring');
            const blob = await fileResp.blob();
            const base64 = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => {
                    const result = reader.result as string;
                    const b64 = result.split(',')[1];
                    if (b64) resolve(b64); else reject(new Error('Base64-konvertering misslyckades'));
                };
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(blob);
            });

            const geminiCall = await callGemini({
                message: EXTRACTION_PROMPT,
                fileData: { data: base64, mimeType: blob.type || 'application/pdf' },
                fileName: item.fileName,
                skipHistory: true,
                stream: false,
            });

            if (!geminiCall.ok) {
                if (geminiCall.status === 401) {
                    setError('Du måste vara inloggad för AI-extraktion.');
                    return;
                }
                throw new Error(`AI-extraktion misslyckades (${geminiCall.status})`);
            }
            const response = geminiCall.response;

            // gemini-chat returns SSE stream - read and collect all text chunks
            let aiText = '';
            const contentType = response.headers.get('Content-Type');
            if (contentType?.includes('text/event-stream')) {
                const reader = response.body?.getReader();
                if (!reader) throw new Error('Inget svar från AI');
                const decoder = new TextDecoder();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    const chunk = decoder.decode(value, { stream: true });
                    for (const line of chunk.split('\n')) {
                        if (!line.startsWith('data: ')) continue;
                        const dataStr = line.slice(6).trim();
                        if (dataStr === '[DONE]') continue;
                        try {
                            const data = JSON.parse(dataStr) as { text?: string };
                            if (data.text) aiText += data.text;
                        } catch { /* skip malformed chunks */ }
                    }
                }
            } else {
                const result = await response.json();
                aiText = result.data || result.response || result.text || '';
            }

            // Parse JSON from AI response (may be wrapped in markdown code block)
            const jsonMatch = aiText.match(/\{[\s\S]*?\}/);
            if (!jsonMatch) {
                setError('AI kunde inte extrahera fakturadata. Fyll i manuellt.');
                updateItemById(item.id, (current) => ({ ...current, aiRawResponse: aiText }));
                return;
            }

            const extracted = JSON.parse(jsonMatch[0]);

            updateItemById(item.id, (current) => ({
                ...current,
                    supplierName: extracted.supplierName || '',
                    supplierOrgNr: extracted.supplierOrgNr || '',
                    invoiceNumber: extracted.invoiceNumber || '',
                    invoiceDate: extracted.invoiceDate || '',
                    dueDate: extracted.dueDate || '',
                    totalAmount: typeof extracted.totalAmount === 'number' ? extracted.totalAmount : null,
                    vatAmount: typeof extracted.vatAmount === 'number' ? extracted.vatAmount : null,
                    vatRate: typeof extracted.vatRate === 'number' ? extracted.vatRate : null,
                    ocrNumber: extracted.ocrNumber || '',
                    basAccount: extracted.basAccount || '',
                    basAccountName: extracted.basAccountName || '',
                    currency: extracted.currency || 'SEK',
                    aiExtracted: true,
                    aiRawResponse: aiText,
                }));

            setSuccessMsg(`Faktura från "${extracted.supplierName || item.fileName}" extraherad.`);
        } catch (err) {
            logger.error('AI extraction failed:', err);
            setError('AI-extraktion misslyckades. Försök igen eller fyll i manuellt.');
        } finally {
            setExtractingId(null);
        }
    }, [callGemini, updateItemById]);

    // =========================================================================
    // FORTNOX EXPORT
    // =========================================================================

    const exportToFortnox = useCallback(async (item: InvoiceInboxItem) => {
        if (!item.supplierName || !item.invoiceNumber || !item.totalAmount) {
            setError('Leverantör, fakturanummer och belopp krävs för export.');
            return;
        }

        setExportingId(item.id);
        setError(null);

        try {
            const supplierInvoice = {
                SupplierNumber: item.fortnoxSupplierNumber || '',
                InvoiceNumber: item.invoiceNumber,
                InvoiceDate: item.invoiceDate || new Date().toISOString().split('T')[0],
                DueDate: item.dueDate || '',
                Total: item.totalAmount,
                VAT: item.vatAmount,
                OCR: item.ocrNumber || undefined,
                Currency: item.currency || 'SEK',
                SupplierInvoiceRows: item.basAccount ? [{
                    Account: parseInt(item.basAccount, 10),
                    Debit: item.totalAmount - (item.vatAmount || 0),
                    TransactionInformation: item.supplierName,
                }] : undefined,
                Comments: `Importerad via Veridat fakturainkorg från ${item.fileName}`,
            };

            const response = await callFortnox('exportSupplierInvoice', {
                idempotencyKey: generateIdempotencyKey('export_supplier_invoice', companyId, item),
                sourceContext: 'invoice-inbox-panel',
                invoice: supplierInvoice,
            });

            if (!response.ok) {
                throw new Error(response.error || `Fortnox-export misslyckades (${response.status})`);
            }

            const supplierInvoiceResult = getFortnoxObject<{ GivenNumber?: number | string }>(response.data, 'SupplierInvoice');
            const givenNumberRaw = supplierInvoiceResult?.GivenNumber;
            const givenNumber = typeof givenNumberRaw === 'number'
                ? givenNumberRaw
                : typeof givenNumberRaw === 'string'
                    ? Number(givenNumberRaw)
                    : null;
            const hasGivenNumber = typeof givenNumber === 'number' && Number.isFinite(givenNumber);

            updateItemById(item.id, (current) => ({
                ...current,
                fortnoxGivenNumber: hasGivenNumber ? givenNumber : null,
                fortnoxSyncStatus: hasGivenNumber ? 'exported' : current.fortnoxSyncStatus,
            }));

            setSuccessMsg(`Faktura ${item.invoiceNumber} exporterad till Fortnox${hasGivenNumber ? ` (Nr ${givenNumber})` : ''}.`);
        } catch (err) {
            logger.error('Fortnox export failed:', err);
            setError(err instanceof Error ? err.message : 'Fortnox-export misslyckades.');
        } finally {
            setExportingId(null);
        }
    }, [callFortnox, companyId, updateItemById]);

    // =========================================================================
    // FORTNOX SYNC
    // =========================================================================

    const syncFromFortnox = useCallback(async () => {
        setSyncing(true);
        setError(null);

        try {
            const response = await callFortnox('getSupplierInvoices', {});
            if (!response.ok) {
                if (response.status === 403) {
                    throw new Error('Saknar behörighet i Fortnox — koppla om med leverantörs-behörighet i Integrationer.');
                }
                if (response.status === 401) {
                    throw new Error('Fortnox-sessionen har gått ut — koppla om i Integrationer.');
                }
                if (response.status === 429) {
                    throw new Error('För många anrop till Fortnox — vänta en stund och försök igen.');
                }
                throw new Error(response.error || `Kunde inte hämta fakturor (${response.status})`);
            }

            const invoices = getFortnoxList<Record<string, unknown>>(response.data, 'SupplierInvoices');

            if (invoices.length === 0) {
                setSuccessMsg('Inga leverantörsfakturor hittades i Fortnox.');
                return;
            }

            updateItems(prev => {
                const existingGivenNumbers = new Set(
                    prev.filter(i => i.fortnoxGivenNumber).map(i => i.fortnoxGivenNumber)
                );

                const newItems: InvoiceInboxItem[] = [];
                const updatedPrev = [...prev];

                for (const inv of invoices) {
                    const gnValue = inv.GivenNumber;
                    const gn = typeof gnValue === 'number'
                        ? gnValue
                        : typeof gnValue === 'string'
                            ? Number(gnValue)
                            : NaN;
                    if (!Number.isFinite(gn)) continue;
                    const fortnoxBooked = inv.Booked === true;
                    const nextSyncStatus: FortnoxSyncStatus = fortnoxBooked ? 'booked' : 'exported';

                    if (existingGivenNumbers.has(gn)) {
                        // Update existing
                        const idx = updatedPrev.findIndex(i => i.fortnoxGivenNumber === gn);
                        if (idx >= 0) {
                            updatedPrev[idx] = {
                                ...updatedPrev[idx],
                                supplierName: typeof inv.SupplierName === 'string' && inv.SupplierName
                                    ? inv.SupplierName
                                    : updatedPrev[idx].supplierName,
                                fortnoxBooked,
                                fortnoxSyncStatus: nextSyncStatus,
                                fortnoxBalance: inv.Balance != null ? Number(inv.Balance) : null,
                                totalAmount: inv.Total != null ? Number(inv.Total) : updatedPrev[idx].totalAmount,
                                vatAmount: inv.VAT != null ? Number(inv.VAT) : updatedPrev[idx].vatAmount,
                                status: fortnoxBooked
                                    ? getBookedStatus(updatedPrev[idx].status)
                                    : normalizeStatus(updatedPrev[idx].status, nextSyncStatus),
                            };
                        }
                    } else {
                        newItems.push({
                            id: `fnx_${gn}`,
                            fileName: '',
                            fileUrl: '',
                            filePath: '',
                            fileBucket: '',
                            uploadedAt: typeof inv.InvoiceDate === 'string' && inv.InvoiceDate
                                ? inv.InvoiceDate
                                : new Date().toISOString(),
                            status: fortnoxBooked ? 'bokford' : 'ny',
                            source: 'fortnox',
                            supplierName: typeof inv.SupplierName === 'string' ? inv.SupplierName : '',
                            supplierOrgNr: '',
                            invoiceNumber: typeof inv.InvoiceNumber === 'string' ? inv.InvoiceNumber : '',
                            invoiceDate: typeof inv.InvoiceDate === 'string' ? inv.InvoiceDate : '',
                            dueDate: typeof inv.DueDate === 'string' ? inv.DueDate : '',
                            totalAmount: inv.Total != null ? Number(inv.Total) : null,
                            vatAmount: inv.VAT != null ? Number(inv.VAT) : null,
                            vatRate: null,
                            ocrNumber: typeof inv.OCR === 'string' ? inv.OCR : '',
                            basAccount: '',
                            basAccountName: '',
                            currency: typeof inv.Currency === 'string' && inv.Currency ? inv.Currency : 'SEK',
                            fortnoxSupplierNumber: typeof inv.SupplierNumber === 'string' ? inv.SupplierNumber : '',
                            fortnoxSyncStatus: nextSyncStatus,
                            fortnoxGivenNumber: gn,
                            fortnoxBooked,
                            fortnoxBalance: inv.Balance != null ? Number(inv.Balance) : null,
                            aiExtracted: false,
                            aiRawResponse: '',
                            aiReviewNote: '',
                        });
                    }
                }

                return [...newItems, ...updatedPrev];
            });

            setSuccessMsg(`${invoices.length} fakturor hämtade från Fortnox.`);
        } catch (err) {
            logger.error('Fortnox sync failed:', err);
            setError(err instanceof Error ? err.message : 'Kunde inte synka från Fortnox.');
        } finally {
            setSyncing(false);
        }
    }, [callFortnox, updateItems]);

    // =========================================================================
    // FORTNOX BOOK / APPROVE
    // =========================================================================

    const bookInFortnox = useCallback(async (item: InvoiceInboxItem) => {
        if (!item.fortnoxGivenNumber) {
            setError('Fakturan har inget Fortnox-nummer.');
            return;
        }

        setBookingId(item.id);
        setError(null);

        try {
            const response = await callFortnox('bookSupplierInvoice', {
                givenNumber: item.fortnoxGivenNumber,
                idempotencyKey: generateIdempotencyKey('book_supplier_invoice', companyId, item),
                sourceContext: 'invoice-inbox-panel',
            });

            if (!response.ok) {
                throw new Error(response.error || `Bokföring misslyckades (${response.status})`);
            }

            updateItemById(item.id, (current) => withFortnoxBookedState(current, 'booked'));
            invoicePostingReviewService.invalidateInvoice(companyId, 'supplier', item.fortnoxGivenNumber);
            setSuccessMsg(`Faktura ${item.invoiceNumber || item.fortnoxGivenNumber} bokförd i Fortnox.`);
        } catch (err) {
            logger.error('Fortnox booking failed:', err);
            setError(err instanceof Error ? err.message : 'Bokföring misslyckades.');
        } finally {
            setBookingId(null);
        }
    }, [callFortnox, companyId, updateItemById]);

    const approveInFortnox = useCallback(async (item: InvoiceInboxItem) => {
        if (!item.fortnoxGivenNumber) return;

        setBookingId(item.id);
        setError(null);

        try {
            const response = await callFortnox('approveSupplierInvoiceBookkeep', {
                givenNumber: item.fortnoxGivenNumber,
                idempotencyKey: generateIdempotencyKey('approve_supplier_invoice_bookkeep', companyId, item),
                sourceContext: 'invoice-inbox-panel',
            });

            if (!response.ok) {
                throw new Error(response.error || `Attestering misslyckades (${response.status})`);
            }

            updateItemById(item.id, (current) => withFortnoxBookedState(current, 'attested'));
            invoicePostingReviewService.invalidateInvoice(companyId, 'supplier', item.fortnoxGivenNumber);
            setSuccessMsg(`Faktura ${item.invoiceNumber || item.fortnoxGivenNumber} attesterad.`);
        } catch (err) {
            logger.error('Fortnox approval failed:', err);
            setError(err instanceof Error ? err.message : 'Attestering misslyckades.');
        } finally {
            setBookingId(null);
        }
    }, [callFortnox, companyId, updateItemById]);

    const openPostingTrace = useCallback(async (item: InvoiceInboxItem) => {
        if (!invoicePostingReviewEnabled) return;
        if (!item.fortnoxGivenNumber) {
            setPostingTraceError('Konteringskontroll finns efter export till Fortnox.');
            setPostingDrawerOpen(true);
            return;
        }

        setPostingDrawerOpen(true);
        setPostingTraceLoading(true);
        setPostingTraceError(null);
        setPostingTrace(null);

        try {
            const trace = await invoicePostingReviewService.fetchPostingTrace({
                companyId,
                invoiceType: 'supplier',
                invoiceId: item.fortnoxGivenNumber,
                forceRefresh: true,
            });
            setPostingTrace(trace);
        } catch (error) {
            setPostingTraceError(error instanceof Error ? error.message : 'Kunde inte hämta kontering.');
            setPostingTrace(null);
        } finally {
            setPostingTraceLoading(false);
        }
    }, [companyId, invoicePostingReviewEnabled]);

    // =========================================================================
    // AI REVIEW
    // =========================================================================

    const reviewAccounting = useCallback(async (item: InvoiceInboxItem) => {
        setReviewingId(item.id);
        setError(null);

        try {
            const prompt = `Granska denna leverantörsfaktura och föreslå BAS-konto. Svara kort (max 3 meningar).

FAKTURA:
- Leverantör: ${item.supplierName || item.fortnoxSupplierNumber || 'okänd'}
- Fakturanr: ${item.invoiceNumber}
- Belopp: ${item.totalAmount} ${item.currency}
- Moms: ${item.vatAmount ?? 'okänd'} (${item.vatRate ?? '?'}%)
- Nuvarande BAS-konto: ${item.basAccount ? `${item.basAccount} ${item.basAccountName}` : 'ej satt'}
- Förfallodatum: ${item.dueDate}

VÄLJ KONTO FRÅN DENNA LISTA (BAS 2024) — gissa inte:

Tillgångar: 1210 Maskiner/inventarier | 1240 Bilar
Varuinköp: 4010 Varuinköp | 4515 Inköp EU | 4516 Import | 4531 Tjänsteimport | 4600 Legoarbeten
Lokal: 5010 Hyra | 5020 El | 5060 Städning | 5070 Reparation
Förbruk: 5400 Förbrukningsinventarier | 5460 Material
Fordon: 5611 Drivmedel | 5615 Billeasing
Resa: 5800 Resekostnader | 5810 Biljetter | 5820 Hotell | 5831 Traktamente inr. | 5832 Traktamente utr.
Mark: 5910 Annonsering | 5930 Reklamtrycksaker
Repr: 6071 Avdragsgill | 6072 Ej avdragsgill
Kontor: 6110 Kontorsmaterial | 6211 Telefon | 6212 Mobil | 6230 Internet | 6250 Porto
Försk: 6310 Företagsförsäkring | 6340 Leasing | 6350 Bilförsäkring
Tjänster: 6420 Frakter | 6423 Löneadmin | 6530 Redovisning | 6540 IT/SaaS
6550 Konsultarvoden | 6560 Serviceavg (Swish/Klarna) | 6570 Bank
6580 Advokat/juridik | 6590 Övriga tjänster | 6800 Inhyrd personal
Övrigt: 6910 Utbildning | 6980 Föreningsavgifter
Finans: 8400 Ränta | 8420 Dröjsmålsränta | 8430 Valutakursförlust

REGLER (BAS 2024):
- Ekonomibyrå/redovisningskonsult/bokslut/revision → 6530
- Programvara/SaaS/hosting → 6540
- Övrig konsult (management, strategi, teknik) → 6550
- Advokat/juridik → 6580
- Bemanningsföretag/inhyrd personal → 6800
- Swish/Klarna/Stripe → 6560 (INTE 6570)
- Dröjsmålsränta → 8420 (INTE 8400)
- EU-varuinköp → 4515 + omvänd moms
- OBS: 6520 = Ritningskostnader — INTE redovisning!

Föreslå korrekt kontering med debet/kredit.`;

            const geminiCall = await callGemini({
                message: prompt,
                skipHistory: true,
                stream: false,
            });

            if (!geminiCall.ok) {
                if (geminiCall.status === 401) {
                    setError('Du måste vara inloggad.');
                    return;
                }
                throw new Error(`AI-granskning misslyckades (${geminiCall.status})`);
            }
            const response = geminiCall.response;

            const result = await response.json();
            const reviewText = result.data || result.response || result.text || '';

            updateItemById(item.id, (current) => ({ ...current, aiReviewNote: reviewText }));
        } catch (err) {
            logger.error('AI review failed:', err);
            setError('AI-granskning misslyckades.');
        } finally {
            setReviewingId(null);
        }
    }, [callGemini, updateItemById]);

    // =========================================================================
    // ITEM ACTIONS
    // =========================================================================

    const updateField = useCallback((itemId: string, field: keyof InvoiceInboxItem, value: string | number | null) => {
        updateItemById(itemId, (current) => ({ ...current, [field]: value }));
    }, [updateItemById]);

    const setStatus = useCallback((itemId: string, status: InvoiceStatus) => {
        updateItemById(itemId, (current) => ({ ...current, status }));
    }, [updateItemById]);

    const removeItem = useCallback((itemId: string) => {
        updateItems(prev => prev.filter(i => i.id !== itemId));
    }, [updateItems]);

    // =========================================================================
    // FILTERING & SUMMARY
    // =========================================================================

    const filtered = useMemo(() => filterItemsByStatus(items, statusFilter), [items, statusFilter]);

    const summary = useMemo(() => buildInvoiceSummary(items), [items]);

    const summaryCards = useMemo(() => buildSummaryCards(summary), [summary]);

    // =========================================================================
    // RENDER
    // =========================================================================

    return (
        <div className="panel-stagger" style={INVOICE_INBOX_ROOT_STYLE}>
            {/* Header */}
            <div style={INVOICE_INBOX_HEADER_STYLE}>
                <button
                    type="button"
                    onClick={onBack}
                    style={INVOICE_INBOX_BACK_BUTTON_STYLE}
                >
                    Tillbaka
                </button>
                <span style={INVOICE_INBOX_HEADER_HINT_STYLE}>
                    Ladda upp leverantörsfakturor. AI extraherar data automatiskt.
                </span>
            </div>

            {/* Messages */}
            {error && (
                <div style={{ ...INVOICE_INBOX_ERROR_MESSAGE_STYLE, display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span style={{ flex: 1 }}>{error}</span>
                    <button
                        type="button"
                        onClick={() => void syncFromFortnox()}
                        style={{ flexShrink: 0, padding: '0.2rem 0.6rem', borderRadius: '6px', border: '1px solid rgba(239,68,68,0.4)', background: 'transparent', color: '#ef4444', fontSize: '0.75rem', cursor: 'pointer' }}
                    >
                        Försök igen
                    </button>
                </div>
            )}
            {successMsg && (
                <div style={INVOICE_INBOX_SUCCESS_MESSAGE_STYLE}>
                    {successMsg}
                </div>
            )}

            {/* Drag-and-drop upload zone */}
            <div
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
                className="panel-card panel-card--interactive"
                style={getUploadZoneStyle(dragOver)}
            >
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,.webp"
                    multiple
                    style={INVOICE_FILE_INPUT_HIDDEN_STYLE}
                    onChange={e => {
                        if (e.currentTarget.files) void handleFiles(e.currentTarget.files);
                        e.currentTarget.value = '';
                    }}
                />
                {uploading ? (
                    <div style={INVOICE_UPLOAD_TEXT_STYLE}>
                        Laddar upp...
                    </div>
                ) : (
                    <>
                        <div style={INVOICE_UPLOAD_ICON_STYLE}>
                            {dragOver ? '+' : ''}
                        </div>
                        <div style={INVOICE_UPLOAD_TITLE_STYLE}>
                            {dragOver ? 'Släpp filerna här' : 'Dra och släpp fakturor här'}
                        </div>
                        <div style={INVOICE_UPLOAD_HINT_STYLE}>
                            eller klicka för att välja filer (PDF, PNG, JPG – max 50 MB)
                        </div>
                    </>
                )}
            </div>

            {/* Fortnox sync button */}
            <button
                type="button"
                onClick={() => void syncFromFortnox()}
                disabled={syncing}
                style={getFortnoxSyncButtonStyle(syncing)}
            >
                {syncing ? 'Hämtar...' : 'Hämta leverantörsfakturor från Fortnox'}
            </button>

            {/* Summary cards */}
            <div className="panel-stagger" style={INVOICE_SUMMARY_GRID_STYLE}>
                {summaryCards.map(card => (
                    <div key={card.label} className="panel-card panel-card--no-hover">
                        <div className="panel-label">{card.label}</div>
                        <div className="panel-stat" style={getSummaryStatStyle(card.color)}>{card.value}</div>
                    </div>
                ))}
            </div>

            {/* Status filter tabs */}
            <div style={INVOICE_STATUS_FILTER_ROW_STYLE}>
                <FilterButton
                    label="Alla"
                    count={summary.total}
                    active={statusFilter === 'alla'}
                    onClick={() => setStatusFilter('alla')}
                />
                {ALL_STATUSES.map(s => (
                    <FilterButton
                        key={s}
                        label={STATUS_CONFIG[s].label}
                        count={summary[s]}
                        color={STATUS_CONFIG[s].color}
                        active={statusFilter === s}
                        onClick={() => setStatusFilter(s)}
                    />
                ))}
            </div>

            {/* Invoice list */}
            {filtered.length === 0 ? (
                <div className="panel-card panel-card--no-hover" style={INVOICE_EMPTY_STATE_STYLE}>
                    {items.length === 0
                        ? 'Inga fakturor än. Dra och släpp en PDF eller hämta från Fortnox.'
                        : 'Inga fakturor matchar filtret.'}
                </div>
            ) : (
                <div className="panel-stagger" style={INVOICE_LIST_GRID_STYLE}>
                    {filtered.map(item => (
                        <InvoiceCard
                            key={item.id}
                            item={item}
                            isExtracting={extractingId === item.id}
                            isExporting={exportingId === item.id}
                            isEditing={editingId === item.id}
                            isBooking={bookingId === item.id}
                            isReviewing={reviewingId === item.id}
                            onExtract={() => void extractInvoiceData(item)}
                            onExport={() => void exportToFortnox(item)}
                            onBook={() => void bookInFortnox(item)}
                            onApprove={() => void approveInFortnox(item)}
                            onReview={() => void reviewAccounting(item)}
                            onViewPosting={() => void openPostingTrace(item)}
                            onEdit={() => setEditingId(editingId === item.id ? null : item.id)}
                            onUpdateField={(field, value) => updateField(item.id, field, value)}
                            onSetStatus={(status) => setStatus(item.id, status)}
                            onRemove={() => removeItem(item.id)}
                            invoicePostingReviewEnabled={invoicePostingReviewEnabled}
                        />
                    ))}
                </div>
            )}

            {/* Help text */}
            <div className="panel-card panel-card--no-hover" style={INVOICE_HELP_CARD_STYLE}>
                <strong style={INVOICE_HELP_TITLE_STYLE}>Arbetsflöde</strong>
                <br />
                1. <strong>Ladda upp</strong> - Dra och släpp PDF/bild. AI extraherar fakturadata automatiskt.
                <br />
                2. <strong>Granska</strong> - Kontrollera extraherade fält, korrigera vid behov. Markera som "Granskad".
                <br />
                3. <strong>Exportera</strong> - Skicka till Fortnox som leverantörsfaktura. Boka och attestera.
                <br />
                4. <strong>Betald</strong> - Markera när fakturan är betald.
            </div>

            <InvoicePostingReviewDrawer
                open={postingDrawerOpen}
                loading={postingTraceLoading}
                error={postingTraceError}
                trace={postingTrace}
                onClose={() => setPostingDrawerOpen(false)}
            />
        </div>
    );
}

// =============================================================================
// SUBCOMPONENTS
// =============================================================================

function FilterButton({
    label, count, color, active, onClick,
}: {
    label: string;
    count: number;
    color?: string;
    active: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            aria-pressed={active}
            onClick={onClick}
            style={getFilterButtonStyle(active, color)}
        >
            {label}
            <span style={FILTER_BUTTON_COUNT_STYLE}>
                {count}
            </span>
        </button>
    );
}

function InvoicePill({
    label,
    background,
    color,
}: {
    label: string;
    background: string;
    color: string;
}) {
    return (
        <span style={getInvoicePillStyle(background, color)}>
            {label}
        </span>
    );
}

function InvoiceCardActions({
    item,
    isExtracting,
    isExporting,
    isEditing,
    isBooking,
    isReviewing,
    canBookInFortnox,
    canApproveInFortnox,
    onExtract,
    onExport,
    onBook,
    onApprove,
    onReview,
    onViewPosting,
    onEdit,
    onSetStatus,
    onRemove,
    invoicePostingReviewEnabled,
}: {
    item: InvoiceInboxItem;
    isExtracting: boolean;
    isExporting: boolean;
    isEditing: boolean;
    isBooking: boolean;
    isReviewing: boolean;
    canBookInFortnox: boolean;
    canApproveInFortnox: boolean;
    onExtract: () => void;
    onExport: () => void;
    onBook: () => void;
    onApprove: () => void;
    onReview: () => void;
    onViewPosting: () => void;
    onEdit: () => void;
    onSetStatus: (status: InvoiceStatus) => void;
    onRemove: () => void;
    invoicePostingReviewEnabled: boolean;
}) {
    return (
        <div style={INVOICE_CARD_ACTIONS_ROW_STYLE}>
            {item.source === 'upload' && !item.aiExtracted && item.status === 'ny' && (
                <ActionButton
                    label={isExtracting ? 'Extraherar...' : 'AI-extrahera'}
                    color="#8b5cf6"
                    disabled={isExtracting}
                    onClick={onExtract}
                />
            )}

            <ActionButton
                label={isReviewing ? 'Granskar...' : 'AI-granska'}
                color="#8b5cf6"
                disabled={isReviewing}
                onClick={onReview}
            />

            {invoicePostingReviewEnabled && item.fortnoxGivenNumber && (
                <ActionButton
                    label="Visa kontering"
                    color="#38bdf8"
                    onClick={onViewPosting}
                    testId={`invoice-view-posting-${item.id}`}
                />
            )}

            <ActionButton
                label={isEditing ? 'Stäng' : 'Redigera'}
                color="var(--text-secondary)"
                onClick={onEdit}
            />

            {item.status === 'ny' && (
                <ActionButton
                    label="Markera som granskad"
                    color={STATUS_CONFIG.granskad.color}
                    testId={`invoice-status-review-${item.id}`}
                    onClick={() => onSetStatus('granskad')}
                />
            )}

            {canBookInFortnox && (
                <ActionButton
                    label={isBooking ? 'Bokför...' : 'Bokför i Fortnox'}
                    color="#10b981"
                    disabled={isBooking}
                    onClick={onBook}
                />
            )}
            {canApproveInFortnox && (
                <ActionButton
                    label={isBooking ? 'Attesterar...' : 'Attestera'}
                    color="#10b981"
                    disabled={isBooking}
                    onClick={onApprove}
                />
            )}

            {item.source === 'upload' && item.status === 'granskad' && !item.fortnoxGivenNumber && (
                <ActionButton
                    label={isExporting ? 'Exporterar...' : 'Exportera till Fortnox'}
                    color={STATUS_CONFIG.bokford.color}
                    disabled={isExporting}
                    onClick={onExport}
                />
            )}

            {(item.status === 'granskad' || item.status === 'bokford') && (
                <ActionButton
                    label="Markera som betald"
                    color={STATUS_CONFIG.betald.color}
                    testId={`invoice-status-paid-${item.id}`}
                    onClick={() => onSetStatus('betald')}
                />
            )}

            {item.source !== 'fortnox' && (
                <ActionButton
                    label="Ta bort"
                    color="#ef4444"
                    onClick={() => {
                        if (window.confirm(`Ta bort faktura "${item.supplierName || item.fileName}"?`)) {
                            onRemove();
                        }
                    }}
                />
            )}
        </div>
    );
}

function InvoiceCardDetails({
    item,
    overdue,
}: {
    item: InvoiceInboxItem;
    overdue: boolean;
}) {
    return (
        <div style={INVOICE_CARD_DETAILS_ROW_STYLE}>
            {item.invoiceNumber && (
                <div>
                    <span style={INVOICE_CARD_DETAIL_LABEL_STYLE}>Faktura: </span>
                    <span style={INVOICE_CARD_DETAIL_STRONG_VALUE_STYLE}>{item.invoiceNumber}</span>
                </div>
            )}
            {item.invoiceDate && (
                <div>
                    <span style={INVOICE_CARD_DETAIL_LABEL_STYLE}>Datum: </span>
                    <span style={INVOICE_CARD_DETAIL_VALUE_STYLE}>{formatDate(item.invoiceDate)}</span>
                </div>
            )}
            {item.dueDate && (
                <div>
                    <span style={INVOICE_CARD_DETAIL_LABEL_STYLE}>Förfaller: </span>
                    <span style={getInvoiceDueDateStyle(overdue)}>
                        {formatDate(item.dueDate)}
                    </span>
                </div>
            )}
            {item.ocrNumber && (
                <div>
                    <span style={INVOICE_CARD_DETAIL_LABEL_STYLE}>OCR: </span>
                    <span style={INVOICE_CARD_DETAIL_VALUE_STYLE}>{item.ocrNumber}</span>
                </div>
            )}
            {item.basAccount && (
                <div>
                    <span style={INVOICE_CARD_DETAIL_LABEL_STYLE}>Konto: </span>
                    <span style={INVOICE_CARD_DETAIL_STRONG_VALUE_STYLE}>
                        {item.basAccount} {item.basAccountName}
                    </span>
                </div>
            )}
            {item.fortnoxGivenNumber && (
                <div>
                    <span style={INVOICE_CARD_DETAIL_LABEL_STYLE}>Fortnox nr: </span>
                    <span style={INVOICE_CARD_DETAIL_FORTNOX_VALUE_STYLE}>{item.fortnoxGivenNumber}</span>
                </div>
            )}
            {item.fortnoxBalance !== null && item.fortnoxBalance !== undefined && (
                <div>
                    <span style={INVOICE_CARD_DETAIL_LABEL_STYLE}>Restsaldo: </span>
                    <span style={getInvoiceBalanceStyle(item.fortnoxBalance)}>
                        {formatAmount(item.fortnoxBalance)} kr
                    </span>
                </div>
            )}
        </div>
    );
}

function InvoiceCard({
    item, isExtracting, isExporting, isEditing, isBooking, isReviewing,
    onExtract, onExport, onBook, onApprove, onReview, onViewPosting, onEdit, onUpdateField, onSetStatus, onRemove, invoicePostingReviewEnabled,
}: {
    item: InvoiceInboxItem;
    isExtracting: boolean;
    isExporting: boolean;
    isEditing: boolean;
    isBooking: boolean;
    isReviewing: boolean;
    onExtract: () => void;
    onExport: () => void;
    onBook: () => void;
    onApprove: () => void;
    onReview: () => void;
    onViewPosting: () => void;
    onEdit: () => void;
    onUpdateField: (field: keyof InvoiceInboxItem, value: string | number | null) => void;
    onSetStatus: (status: InvoiceStatus) => void;
    onRemove: () => void;
    invoicePostingReviewEnabled: boolean;
}) {
    const statusCfg = STATUS_CONFIG[item.status];
    const overdue = item.status !== 'betald' && isOverdue(item.dueDate);
    const dueSoon = !overdue && item.status !== 'betald' && isDueSoon(item.dueDate);
    const hasFortnoxInvoice = Boolean(item.fortnoxGivenNumber);
    const canBookInFortnox = hasFortnoxInvoice && (item.fortnoxSyncStatus === 'exported' || item.fortnoxSyncStatus === 'not_exported');
    const canApproveInFortnox = hasFortnoxInvoice && item.fortnoxSyncStatus !== 'attested';

    return (
        <div
            className="panel-card panel-card--no-hover"
            style={getInvoiceCardContainerStyle(overdue)}
            data-testid={`invoice-card-${item.id}`}
        >
            {/* Top row: status + supplier + actions */}
            <div style={INVOICE_CARD_TOP_ROW_STYLE}>
                {/* Status badge */}
                <InvoicePill label={statusCfg.label} background={statusCfg.bg} color={statusCfg.color} />

                {hasFortnoxInvoice && (
                    <InvoicePill
                        label={FORTNOX_SYNC_STATUS_LABELS[item.fortnoxSyncStatus]}
                        background="rgba(59, 130, 246, 0.15)"
                        color="#3b82f6"
                    />
                )}

                {/* Source badge */}
                {item.source === 'fortnox' && (
                    <InvoicePill label="Fortnox" background="rgba(16, 185, 129, 0.15)" color="#10b981" />
                )}

                {/* Supplier name or filename */}
                <div style={INVOICE_CARD_SUPPLIER_WRAP_STYLE}>
                    <div style={INVOICE_CARD_SUPPLIER_NAME_STYLE}>
                        {getInvoiceDisplayName(item)}
                    </div>
                    {item.supplierName && (
                        <div style={INVOICE_CARD_FILE_NAME_STYLE}>
                            {item.fileName}
                        </div>
                    )}
                </div>

                {/* Amount */}
                {item.totalAmount !== null && (
                    <div style={INVOICE_CARD_AMOUNT_WRAP_STYLE}>
                        <div style={INVOICE_CARD_AMOUNT_VALUE_STYLE}>
                            {formatAmount(item.totalAmount)} kr
                        </div>
                        {item.vatAmount !== null && (
                            <div style={INVOICE_CARD_AMOUNT_META_STYLE}>
                                varav moms {formatAmount(item.vatAmount)} kr ({item.vatRate || '?'}%)
                            </div>
                        )}
                    </div>
                )}

                {/* Overdue warning */}
                {overdue && (
                    <InvoicePill label="Förfallen" background="rgba(239, 68, 68, 0.15)" color="#ef4444" />
                )}
                {dueSoon && (
                    <InvoicePill label="Förfaller snart" background="rgba(245, 158, 11, 0.15)" color="#f59e0b" />
                )}
            </div>

            <InvoiceCardDetails item={item} overdue={overdue} />

            {/* Edit form (shown when editing) */}
            {isEditing && (
                <EditForm item={item} onUpdateField={onUpdateField} />
            )}

            {/* AI review note */}
            {item.aiReviewNote && (
                <div style={INVOICE_CARD_AI_REVIEW_STYLE}>
                    <span style={INVOICE_CARD_AI_REVIEW_LABEL_STYLE}>AI-granskning: </span>
                    {item.aiReviewNote}
                </div>
            )}

            <InvoiceCardActions
                item={item}
                isExtracting={isExtracting}
                isExporting={isExporting}
                isEditing={isEditing}
                isBooking={isBooking}
                isReviewing={isReviewing}
                canBookInFortnox={canBookInFortnox}
                canApproveInFortnox={canApproveInFortnox}
                onExtract={onExtract}
                onExport={onExport}
                onBook={onBook}
                onApprove={onApprove}
                onReview={onReview}
                onViewPosting={onViewPosting}
                onEdit={onEdit}
                onSetStatus={onSetStatus}
                onRemove={onRemove}
                invoicePostingReviewEnabled={invoicePostingReviewEnabled}
            />
        </div>
    );
}

function EditForm({
    item, onUpdateField,
}: {
    item: InvoiceInboxItem;
    onUpdateField: (field: keyof InvoiceInboxItem, value: string | number | null) => void;
}) {
    const fields: Array<{
        field: keyof InvoiceInboxItem;
        label: string;
        type: 'text' | 'number' | 'date';
        placeholder?: string;
    }> = [
        { field: 'supplierName', label: 'Leverantör', type: 'text' },
        { field: 'supplierOrgNr', label: 'Org.nr', type: 'text', placeholder: 'XXXXXX-XXXX' },
        { field: 'invoiceNumber', label: 'Fakturanr', type: 'text' },
        { field: 'invoiceDate', label: 'Fakturadatum', type: 'date' },
        { field: 'dueDate', label: 'Förfallodatum', type: 'date' },
        { field: 'totalAmount', label: 'Totalbelopp', type: 'number' },
        { field: 'vatAmount', label: 'Momsbelopp', type: 'number' },
        { field: 'vatRate', label: 'Momssats (%)', type: 'number' },
        { field: 'ocrNumber', label: 'OCR-nummer', type: 'text' },
        { field: 'basAccount', label: 'BAS-konto', type: 'text', placeholder: 't.ex. 6212' },
        { field: 'basAccountName', label: 'Kontonamn', type: 'text' },
        { field: 'fortnoxSupplierNumber', label: 'Fortnox leverantörsnr', type: 'text' },
    ];

    return (
        <div style={EDIT_FORM_GRID_STYLE}>
            {fields.map(({ field, label, type, placeholder }) => {
                const value = item[field];
                const strValue = value === null || value === undefined ? '' : String(value);

                return (
                    <div key={field}>
                        <label style={EDIT_FORM_LABEL_STYLE}>
                            {label}
                        </label>
                        <input
                            type={type}
                            value={strValue}
                            placeholder={placeholder}
                            onInput={e => {
                                const raw = e.currentTarget.value;
                                if (type === 'number') {
                                    onUpdateField(field, raw === '' ? null : parseFloat(raw));
                                } else {
                                    onUpdateField(field, raw);
                                }
                            }}
                            style={EDIT_FORM_INPUT_STYLE}
                        />
                    </div>
                );
            })}
        </div>
    );
}

function ActionButton({
    label, color, disabled, onClick, testId,
}: {
    label: string;
    color: string;
    disabled?: boolean;
    onClick: () => void;
    testId?: string;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            data-testid={testId}
            style={getActionButtonStyle(color, disabled)}
        >
            {label}
        </button>
    );
}

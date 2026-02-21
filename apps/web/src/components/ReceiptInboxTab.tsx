/**
 * ReceiptInboxTab - Kvittoskanning med AI-extraktion och Fortnox-export.
 *
 * Drag-and-drop bild/PDF → AI extraherar butik, belopp, moms, kategori →
 * redigera → exportera som verifikation till Fortnox.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { supabase } from '../lib/supabase';
import { companyService } from '../services/CompanyService';
import { fileService } from '../services/FileService';
import { financeAgentService } from '../services/FinanceAgentService';
import { logger } from '../services/LoggerService';
import type { ReceiptInboxRecord, ReceiptStatus, ReceiptFortnoxSyncStatus } from '../types/finance';

// =============================================================================
// TYPES
// =============================================================================

type ReceiptStatusFilter = ReceiptStatus | 'alla';

interface ReceiptInboxItem {
    id: string;
    fileName: string;
    fileUrl: string;
    filePath: string;
    fileBucket: string;
    uploadedAt: string;
    status: ReceiptStatus;
    source: 'upload' | 'manual';
    merchantName: string;
    transactionDate: string;
    transactionTime: string;
    totalAmount: number | null;
    vatAmount: number | null;
    vatRate: number | null;
    paymentMethod: string;
    category: string;
    description: string;
    receiptNumber: string;
    currency: string;
    basAccount: string;
    basAccountName: string;
    fortnoxVoucherSeries: string;
    fortnoxVoucherNumber: number | null;
    fortnoxSyncStatus: ReceiptFortnoxSyncStatus;
    aiExtracted: boolean;
    aiRawResponse: string;
    aiReviewNote: string;
}

interface ReceiptSummary {
    total: number;
    ny: number;
    granskad: number;
    bokford: number;
    totalAmount: number;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const STATUS_CONFIG: Record<ReceiptStatus, { label: string; color: string; bg: string }> = {
    ny: { label: 'Ny', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)' },
    granskad: { label: 'Granskad', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.15)' },
    bokford: { label: 'Bokförd', color: '#10b981', bg: 'rgba(16, 185, 129, 0.15)' },
};

const ALL_STATUSES: ReceiptStatus[] = ['ny', 'granskad', 'bokford'];

const CATEGORY_LABELS: Record<string, string> = {
    restaurant: 'Restaurang/Mat',
    transport: 'Transport/Resa',
    hotel: 'Hotell/Logi',
    supplies: 'Kontorsmaterial',
    fuel: 'Drivmedel',
    parking: 'Parkering',
    representation: 'Representation',
    other: 'Övrigt',
};

const GEMINI_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/gemini-chat`;
const FORTNOX_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fortnox`;

// =============================================================================
// STYLES (reusing same pattern as InvoiceInboxPanel)
// =============================================================================

const ROOT_STYLE = { display: 'flex', flexDirection: 'column', gap: '1rem' } as const;

const UPLOAD_ZONE_BASE = { padding: '1.5rem', textAlign: 'center' } as const;
const FILE_INPUT_HIDDEN = { display: 'none' } as const;
const UPLOAD_TITLE = { fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem' } as const;
const UPLOAD_HINT = { color: 'var(--text-secondary)', fontSize: '0.8rem', marginTop: '0.25rem' } as const;
const UPLOAD_TEXT = { color: 'var(--text-secondary)', fontSize: '0.85rem' } as const;

const SUMMARY_GRID = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.75rem' } as const;
const FILTER_ROW = { display: 'flex', gap: '0.5rem', flexWrap: 'wrap' } as const;
const LIST_GRID = { display: 'grid', gap: '0.75rem' } as const;
const EMPTY_STATE = { textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem', border: '1px dashed var(--surface-border)' } as const;

const CARD_TOP_ROW = { display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.6rem' } as const;
const CARD_NAME_WRAP = { flex: 1, minWidth: '120px' } as const;
const CARD_NAME = { fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem' } as const;
const CARD_FILE = { fontSize: '0.75rem', color: 'var(--text-secondary)' } as const;
const CARD_AMOUNT_WRAP = { textAlign: 'right' } as const;
const CARD_AMOUNT = { fontWeight: 700, color: 'var(--text-primary)', fontSize: '1rem' } as const;
const CARD_AMOUNT_META = { fontSize: '0.72rem', color: 'var(--text-secondary)' } as const;
const CARD_DETAILS = { display: 'flex', gap: '1.5rem', flexWrap: 'wrap', fontSize: '0.8rem', marginBottom: '0.6rem' } as const;
const DETAIL_LABEL = { color: 'var(--text-secondary)' } as const;
const DETAIL_VALUE = { color: 'var(--text-primary)' } as const;
const DETAIL_STRONG = { color: 'var(--text-primary)', fontWeight: 600 } as const;
const CARD_ACTIONS = { display: 'flex', gap: '0.5rem', flexWrap: 'wrap' } as const;

const PILL_BASE = { padding: '0.15rem 0.5rem', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 600 } as const;
const FILTER_BTN_BASE = { height: '34px', padding: '0 0.8rem', borderRadius: '10px', border: '1px solid var(--glass-border)', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.35rem' } as const;
const ACTION_BTN_BASE = { height: '30px', padding: '0 0.7rem', borderRadius: '8px', border: '1px solid var(--glass-border)', background: 'transparent', fontSize: '0.75rem', fontWeight: 600, whiteSpace: 'nowrap' } as const;

const EDIT_GRID = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.5rem', padding: '0.75rem', marginBottom: '0.6rem', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.06)', background: 'rgba(255, 255, 255, 0.02)' } as const;
const EDIT_LABEL = { fontSize: '0.72rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.15rem' } as const;
const EDIT_INPUT = { width: '100%', height: '30px', padding: '0 0.5rem', borderRadius: '8px', border: '1px solid var(--glass-border)', background: 'rgba(255, 255, 255, 0.04)', color: 'var(--text-primary)', fontSize: '0.8rem', outline: 'none', boxSizing: 'border-box' } as const;

const AI_REVIEW = { padding: '0.5rem 0.75rem', borderRadius: '8px', background: 'rgba(139, 92, 246, 0.08)', border: '1px solid rgba(139, 92, 246, 0.2)', fontSize: '0.8rem', color: 'var(--text-primary)', lineHeight: 1.4, marginBottom: '0.6rem' } as const;
const AI_REVIEW_LABEL = { fontWeight: 600, color: '#8b5cf6', fontSize: '0.72rem' } as const;

const ERROR_MSG = { padding: '0.6rem 0.8rem', borderRadius: '8px', background: 'rgba(239, 68, 68, 0.12)', color: '#ef4444', fontSize: '0.8rem' } as const;
const SUCCESS_MSG = { padding: '0.6rem 0.8rem', borderRadius: '8px', background: 'rgba(16, 185, 129, 0.12)', color: '#10b981', fontSize: '0.8rem' } as const;
const HELP_CARD = { fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 } as const;
const HELP_TITLE = { color: 'var(--text-primary)' } as const;

// =============================================================================
// HELPERS
// =============================================================================

function generateId(): string {
    return `rcp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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

function toReceiptItem(item: Partial<ReceiptInboxRecord>): ReceiptInboxItem {
    return {
        id: item.id || generateId(),
        fileName: item.fileName || '',
        fileUrl: item.fileUrl || '',
        filePath: item.filePath || '',
        fileBucket: item.fileBucket || '',
        uploadedAt: item.uploadedAt || new Date().toISOString(),
        status: (item.status as ReceiptStatus) || 'ny',
        source: item.source || 'upload',
        merchantName: item.merchantName || '',
        transactionDate: item.transactionDate || '',
        transactionTime: item.transactionTime || '',
        totalAmount: item.totalAmount ?? null,
        vatAmount: item.vatAmount ?? null,
        vatRate: item.vatRate ?? null,
        paymentMethod: item.paymentMethod || '',
        category: item.category || '',
        description: item.description || '',
        receiptNumber: item.receiptNumber || '',
        currency: item.currency || 'SEK',
        basAccount: item.basAccount || '',
        basAccountName: item.basAccountName || '',
        fortnoxVoucherSeries: item.fortnoxVoucherSeries || '',
        fortnoxVoucherNumber: item.fortnoxVoucherNumber ?? null,
        fortnoxSyncStatus: (item.fortnoxSyncStatus as ReceiptFortnoxSyncStatus) || 'not_exported',
        aiExtracted: item.aiExtracted === true,
        aiRawResponse: item.aiRawResponse || '',
        aiReviewNote: item.aiReviewNote || '',
    };
}

function buildSummary(items: ReceiptInboxItem[]): ReceiptSummary {
    const s: ReceiptSummary = { total: items.length, ny: 0, granskad: 0, bokford: 0, totalAmount: 0 };
    for (const item of items) {
        s[item.status] += 1;
        s.totalAmount += item.totalAmount || 0;
    }
    return s;
}

// =============================================================================
// AI EXTRACTION PROMPT
// =============================================================================

const RECEIPT_EXTRACTION_PROMPT = `Du är en kvitto-OCR-assistent för svensk bokföring. Analysera kvittobilden och extrahera följande fält i JSON-format.
Om ett fält inte hittas, ange tom sträng "" för text och null för nummer.

Returnera ENBART ett JSON-objekt med exakt dessa fält:
{
  "merchantName": "Butikens/restaurangens namn",
  "transactionDate": "YYYY-MM-DD",
  "transactionTime": "HH:MM",
  "totalAmount": 250.00,
  "vatAmount": 50.00,
  "vatRate": 25,
  "paymentMethod": "Kort/Kontant/Swish",
  "category": "restaurant|transport|hotel|supplies|fuel|parking|representation|other",
  "description": "Kort beskrivning av köpet",
  "receiptNumber": "Kvittonummer om synligt",
  "currency": "SEK",
  "basAccount": "BAS-kontonummer",
  "basAccountName": "Kontonamn"
}

KONTOREGLER (BAS 2024):
- Restaurang/lunch (ej representation): 6071 Representation avdragsgill (om affärssamtal), annars 7690 Personalens övrigt
- Taxi/parkering: 5800 Resekostnader eller 5611 Drivmedel (bensin/diesel)
- Hotell: 5820 Hotell
- Kontorsmaterial: 6110 Kontorsmaterial
- Drivmedel: 5611 Drivmedel förmånsbilar eller 5612 Drivmedel fritt
- Parkering: 5800 Resekostnader
- Representation (extern med kunder): 6071 Avdragsgill repr. (max 300 kr/person exkl moms)
- Representation (intern personalfest etc): 6072 Ej avdragsgill repr.
- Förbrukningsinventarier (<25 000 kr): 5400

MOMSSATSER: 25% (standard), 12% (livsmedel t.o.m. 2026-03-31, 6% från 2026-04-01), 6% (böcker/tidningar), 0% (sjukvård, utbildning)

VIKTIGT:
- Datum: YYYY-MM-DD
- Tid: HH:MM (om synlig)
- Belopp som nummer utan tusentalsavgränsare
- Föreslå BAS-konto baserat på kategori`;

// =============================================================================
// COMPONENT
// =============================================================================

export function ReceiptInboxTab() {
    const [items, setItems] = useState<ReceiptInboxItem[]>([]);
    const [statusFilter, setStatusFilter] = useState<ReceiptStatusFilter>('alla');
    const [uploading, setUploading] = useState(false);
    const [extractingId, setExtractingId] = useState<string | null>(null);
    const [exportingId, setExportingId] = useState<string | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [reviewingId, setReviewingId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [successMsg, setSuccessMsg] = useState<string | null>(null);
    const [dragOver, setDragOver] = useState(false);
    const [loadingItems, setLoadingItems] = useState(true);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const companyId = companyService.getCurrentId();

    const getSessionAccessToken = useCallback(async (): Promise<string | null> => {
        const { data: { session } } = await supabase.auth.getSession();
        return session?.access_token ?? null;
    }, []);

    const buildAuthHeaders = useCallback((token: string): Record<string, string> => ({
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
    }), []);

    const callGemini = useCallback(async (
        payload: Record<string, unknown>
    ): Promise<{ ok: true; response: Response } | { ok: false; status: number }> => {
        const token = await getSessionAccessToken();
        if (!token) return { ok: false, status: 401 };
        const response = await fetch(GEMINI_FUNCTION_URL, {
            method: 'POST',
            headers: buildAuthHeaders(token),
            body: JSON.stringify(payload),
        });
        if (!response.ok) return { ok: false, status: response.status };
        return { ok: true, response };
    }, [buildAuthHeaders, getSessionAccessToken]);

    const callFortnox = useCallback(async (
        action: string,
        payload: Record<string, unknown>
    ): Promise<{ ok: true; data: unknown } | { ok: false; status: number; error: string | null }> => {
        const token = await getSessionAccessToken();
        if (!token) return { ok: false, status: 401, error: 'Du måste vara inloggad.' };
        const response = await fetch(FORTNOX_FUNCTION_URL, {
            method: 'POST',
            headers: buildAuthHeaders(token),
            body: JSON.stringify({ action, companyId, payload }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
            const msg = body && typeof body === 'object'
                ? (typeof body.error === 'string' ? body.error : typeof body.message === 'string' ? body.message : null)
                : null;
            return { ok: false, status: response.status, error: msg };
        }
        return { ok: true, data: body };
    }, [buildAuthHeaders, companyId, getSessionAccessToken]);

    // Load receipts from backend
    useEffect(() => {
        let cancelled = false;
        setLoadingItems(true);
        void (async () => {
            try {
                const loaded = await financeAgentService.refreshReceiptInbox(companyId);
                if (cancelled) return;
                setItems(loaded.map((r) => toReceiptItem(r)));
            } catch (err) {
                logger.warn('Failed to load receipt inbox', err);
                if (!cancelled) {
                    setItems(financeAgentService.getCachedReceiptInbox(companyId).map((r) => toReceiptItem(r)));
                }
            } finally {
                if (!cancelled) setLoadingItems(false);
            }
        })();
        return () => { cancelled = true; };
    }, [companyId]);

    // Persist changes
    const updateItems = useCallback((updater: (prev: ReceiptInboxItem[]) => ReceiptInboxItem[]) => {
        setItems(prev => {
            const next = updater(prev);
            const prevById = new Map(prev.map((item) => [item.id, item]));
            const nextIds = new Set(next.map((item) => item.id));
            const changed = next.filter((item) => JSON.stringify(prevById.get(item.id)) !== JSON.stringify(item));
            const removed = prev.filter((item) => !nextIds.has(item.id)).map((item) => item.id);

            for (const item of changed) {
                void financeAgentService.upsertReceiptInboxItem(companyId, item as unknown as ReceiptInboxRecord).catch((err) => {
                    logger.warn('Failed to persist receipt item', { itemId: item.id, err });
                });
            }
            for (const removedId of removed) {
                void financeAgentService.deleteReceiptInboxItem(companyId, removedId, {
                    idempotencyKey: `receipt_inbox:${companyId}:delete:${removedId}`,
                    fingerprint: `delete:${removedId}`,
                }).catch((err) => {
                    logger.warn('Failed to delete receipt item', { removedId, err });
                });
            }
            return next;
        });
    }, [companyId]);

    const updateItemById = useCallback(
        (itemId: string, updater: (item: ReceiptInboxItem) => ReceiptInboxItem): void => {
            updateItems((prev) => prev.map((item) => item.id === itemId ? updater(item) : item));
        },
        [updateItems]
    );

    // Auto-dismiss messages
    useEffect(() => {
        if (successMsg) { const t = setTimeout(() => setSuccessMsg(null), 4000); return () => clearTimeout(t); }
    }, [successMsg]);
    useEffect(() => {
        if (error) { const t = setTimeout(() => setError(null), 6000); return () => clearTimeout(t); }
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
            setError('Ladda upp bild eller PDF av kvittot.');
            return;
        }

        setUploading(true);
        setError(null);

        for (const file of fileArray) {
            try {
                const validation = fileService.validate(file);
                if (!validation.valid) { setError(validation.error || 'Ogiltig fil.'); continue; }

                const uploaded = await fileService.uploadToStorage(file, 'chat-files', companyId);
                const newItem: ReceiptInboxItem = {
                    id: generateId(),
                    fileName: file.name,
                    fileUrl: uploaded.url,
                    filePath: uploaded.path,
                    fileBucket: uploaded.bucket,
                    uploadedAt: new Date().toISOString(),
                    status: 'ny',
                    source: 'upload',
                    merchantName: '',
                    transactionDate: '',
                    transactionTime: '',
                    totalAmount: null,
                    vatAmount: null,
                    vatRate: null,
                    paymentMethod: '',
                    category: '',
                    description: '',
                    receiptNumber: '',
                    currency: 'SEK',
                    basAccount: '',
                    basAccountName: '',
                    fortnoxVoucherSeries: '',
                    fortnoxVoucherNumber: null,
                    fortnoxSyncStatus: 'not_exported',
                    aiExtracted: false,
                    aiRawResponse: '',
                    aiReviewNote: '',
                };
                updateItems(prev => [newItem, ...prev]);
                void extractReceiptData(newItem);
            } catch (err) {
                logger.error('Receipt upload failed:', err);
                setError(`Kunde inte ladda upp ${file.name}.`);
            }
        }
        setUploading(false);
    }, [companyId, updateItems]);

    const onDragOver = useCallback((e: DragEvent) => { e.preventDefault(); setDragOver(true); }, []);
    const onDragLeave = useCallback(() => { setDragOver(false); }, []);
    const onDrop = useCallback((e: DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer?.files) void handleFiles(e.dataTransfer.files);
    }, [handleFiles]);

    // =========================================================================
    // AI EXTRACTION
    // =========================================================================

    const extractReceiptData = useCallback(async (item: ReceiptInboxItem) => {
        setExtractingId(item.id);
        setError(null);

        try {
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
                message: RECEIPT_EXTRACTION_PROMPT,
                fileData: { data: base64, mimeType: blob.type || 'image/jpeg' },
                fileName: item.fileName,
                skipHistory: true,
                stream: false,
            });

            if (!geminiCall.ok) {
                if (geminiCall.status === 401) { setError('Du måste vara inloggad för AI-extraktion.'); return; }
                throw new Error(`AI-extraktion misslyckades (${geminiCall.status})`);
            }

            let aiText = '';
            const contentType = geminiCall.response.headers.get('Content-Type');
            if (contentType?.includes('text/event-stream')) {
                const reader = geminiCall.response.body?.getReader();
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
                const result = await geminiCall.response.json();
                aiText = result.data || result.response || result.text || '';
            }

            const jsonMatch = aiText.match(/\{[\s\S]*?\}/);
            if (!jsonMatch) {
                setError('AI kunde inte extrahera kvittodata. Fyll i manuellt.');
                updateItemById(item.id, (cur) => ({ ...cur, aiRawResponse: aiText }));
                return;
            }

            const extracted = JSON.parse(jsonMatch[0]);
            updateItemById(item.id, (cur) => ({
                ...cur,
                merchantName: extracted.merchantName || '',
                transactionDate: extracted.transactionDate || '',
                transactionTime: extracted.transactionTime || '',
                totalAmount: typeof extracted.totalAmount === 'number' ? extracted.totalAmount : null,
                vatAmount: typeof extracted.vatAmount === 'number' ? extracted.vatAmount : null,
                vatRate: typeof extracted.vatRate === 'number' ? extracted.vatRate : null,
                paymentMethod: extracted.paymentMethod || '',
                category: extracted.category || '',
                description: extracted.description || '',
                receiptNumber: extracted.receiptNumber || '',
                currency: extracted.currency || 'SEK',
                basAccount: extracted.basAccount || extracted.suggestedAccount || '',
                basAccountName: extracted.basAccountName || '',
                aiExtracted: true,
                aiRawResponse: aiText,
            }));

            setSuccessMsg(`Kvitto från "${extracted.merchantName || item.fileName}" extraherat.`);
        } catch (err) {
            logger.error('Receipt AI extraction failed:', err);
            setError('AI-extraktion misslyckades. Försök igen eller fyll i manuellt.');
        } finally {
            setExtractingId(null);
        }
    }, [callGemini, updateItemById]);

    // =========================================================================
    // AI REVIEW
    // =========================================================================

    const reviewAccounting = useCallback(async (item: ReceiptInboxItem) => {
        setReviewingId(item.id);
        setError(null);

        try {
            const prompt = `Granska detta kvitto och föreslå BAS-konto. Svara kort (max 3 meningar).

KVITTO:
- Butik: ${item.merchantName || 'okänd'}
- Datum: ${item.transactionDate || 'okänt'}
- Belopp: ${item.totalAmount} ${item.currency}
- Moms: ${item.vatAmount ?? 'okänd'} (${item.vatRate ?? '?'}%)
- Kategori: ${item.category ? (CATEGORY_LABELS[item.category] || item.category) : 'okänd'}
- Beskrivning: ${item.description || '-'}
- Nuvarande BAS-konto: ${item.basAccount ? `${item.basAccount} ${item.basAccountName}` : 'ej satt'}

VANLIGA KVITTOKONTON (BAS 2024):
- 5400 Förbrukningsinventarier (<25 000 kr)
- 5611 Drivmedel
- 5800 Resekostnader (parkering, taxi, kollektivtrafik)
- 5820 Hotell
- 6071 Representation avdragsgill (max 300 kr/person exkl moms)
- 6072 Representation ej avdragsgill
- 6110 Kontorsmaterial
- 6212 Mobiltelefon
- 6540 IT/SaaS-tjänster
- 7690 Personalens övriga kostnader (personallunch utan affärssamtal)

REGLER:
- Representation kräver anteckning om deltagare och syfte
- Max 300 kr/person exkl moms för avdragsgill repr.
- Personalfester: 6072 (ej avdragsgill)

Föreslå korrekt kontering med debet/kredit.`;

            const geminiCall = await callGemini({ message: prompt, skipHistory: true, stream: false });
            if (!geminiCall.ok) {
                if (geminiCall.status === 401) { setError('Du måste vara inloggad.'); return; }
                throw new Error(`AI-granskning misslyckades (${geminiCall.status})`);
            }

            const result = await geminiCall.response.json();
            const reviewText = result.data || result.response || result.text || '';
            updateItemById(item.id, (cur) => ({ ...cur, aiReviewNote: reviewText }));
        } catch (err) {
            logger.error('Receipt AI review failed:', err);
            setError('AI-granskning misslyckades.');
        } finally {
            setReviewingId(null);
        }
    }, [callGemini, updateItemById]);

    // =========================================================================
    // FORTNOX EXPORT (as voucher/verifikation)
    // =========================================================================

    const exportToFortnox = useCallback(async (item: ReceiptInboxItem) => {
        if (!item.merchantName || !item.totalAmount || !item.basAccount) {
            setError('Butik, belopp och BAS-konto krävs för export.');
            return;
        }

        setExportingId(item.id);
        setError(null);

        try {
            const netAmount = item.totalAmount - (item.vatAmount || 0);
            const voucher = {
                Description: `Kvitto: ${item.merchantName}${item.description ? ` - ${item.description}` : ''}`,
                TransactionDate: item.transactionDate || new Date().toISOString().split('T')[0],
                VoucherSeries: 'A',
                VoucherRows: [
                    {
                        Account: parseInt(item.basAccount, 10),
                        Debit: netAmount,
                        Credit: 0,
                        Description: item.merchantName,
                    },
                    ...(item.vatAmount && item.vatAmount > 0 ? [{
                        Account: 2640, // Ingående moms
                        Debit: item.vatAmount,
                        Credit: 0,
                        Description: `Moms ${item.vatRate || 25}%`,
                    }] : []),
                    {
                        Account: 1930, // Företagskonto/bank
                        Debit: 0,
                        Credit: item.totalAmount,
                        Description: `Kvitto ${item.merchantName}`,
                    },
                ],
            };

            const idempotencyKey = `receipt_inbox:${companyId}:export_voucher:${item.id}`;
            const response = await callFortnox('exportVoucher', {
                idempotencyKey,
                sourceContext: 'receipt-inbox-tab',
                voucher,
            });

            if (!response.ok) {
                throw new Error(response.error || `Fortnox-export misslyckades (${response.status})`);
            }

            const data = response.data as Record<string, unknown> | null;
            const voucherResult = data && typeof data === 'object'
                ? (data as Record<string, unknown>).Voucher as Record<string, unknown> | undefined
                : undefined;
            const voucherNumber = voucherResult?.VoucherNumber;

            updateItemById(item.id, (cur) => ({
                ...cur,
                fortnoxVoucherSeries: 'A',
                fortnoxVoucherNumber: typeof voucherNumber === 'number' ? voucherNumber : null,
                fortnoxSyncStatus: 'exported' as ReceiptFortnoxSyncStatus,
                status: 'bokford' as ReceiptStatus,
            }));

            setSuccessMsg(`Kvitto från ${item.merchantName} exporterat till Fortnox${typeof voucherNumber === 'number' ? ` (Verifikation ${voucherNumber})` : ''}.`);
        } catch (err) {
            logger.error('Fortnox receipt export failed:', err);
            setError(err instanceof Error ? err.message : 'Fortnox-export misslyckades.');
        } finally {
            setExportingId(null);
        }
    }, [callFortnox, companyId, updateItemById]);

    // =========================================================================
    // ITEM ACTIONS
    // =========================================================================

    const updateField = useCallback((itemId: string, field: keyof ReceiptInboxItem, value: string | number | null) => {
        updateItemById(itemId, (cur) => ({ ...cur, [field]: value }));
    }, [updateItemById]);

    const setStatus = useCallback((itemId: string, status: ReceiptStatus) => {
        updateItemById(itemId, (cur) => ({ ...cur, status }));
    }, [updateItemById]);

    const removeItem = useCallback((itemId: string) => {
        updateItems(prev => prev.filter(i => i.id !== itemId));
    }, [updateItems]);

    // =========================================================================
    // FILTERING & SUMMARY
    // =========================================================================

    const filtered = useMemo(
        () => statusFilter === 'alla' ? items : items.filter(i => i.status === statusFilter),
        [items, statusFilter]
    );
    const summary = useMemo(() => buildSummary(items), [items]);

    // =========================================================================
    // RENDER
    // =========================================================================

    return (
        <div className="panel-stagger" style={ROOT_STYLE}>
            {/* Messages */}
            {error && <div style={ERROR_MSG}>{error}</div>}
            {successMsg && <div style={SUCCESS_MSG}>{successMsg}</div>}

            {/* Upload zone */}
            <div
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
                className="panel-card panel-card--interactive"
                style={{
                    ...UPLOAD_ZONE_BASE,
                    border: `2px dashed ${dragOver ? '#3b82f6' : 'var(--surface-border)'}`,
                    background: dragOver ? 'rgba(59, 130, 246, 0.08)' : 'var(--surface-1)',
                }}
            >
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,.webp"
                    multiple
                    style={FILE_INPUT_HIDDEN}
                    onChange={e => {
                        if (e.currentTarget.files) void handleFiles(e.currentTarget.files);
                        e.currentTarget.value = '';
                    }}
                />
                {uploading ? (
                    <div style={UPLOAD_TEXT}>Laddar upp...</div>
                ) : (
                    <>
                        <div style={UPLOAD_TITLE}>
                            {dragOver ? 'Släpp kvittot här' : 'Dra och släpp kvitton här'}
                        </div>
                        <div style={UPLOAD_HINT}>
                            eller klicka för att välja filer (PDF, PNG, JPG – max 50 MB)
                        </div>
                    </>
                )}
            </div>

            {/* Summary cards */}
            <div className="panel-stagger" style={SUMMARY_GRID}>
                {[
                    { label: 'Totalt', value: summary.total, color: 'var(--text-primary)' },
                    { label: 'Nya', value: summary.ny, color: STATUS_CONFIG.ny.color },
                    { label: 'Granskade', value: summary.granskad, color: STATUS_CONFIG.granskad.color },
                    { label: 'Bokförda', value: summary.bokford, color: STATUS_CONFIG.bokford.color },
                    { label: 'Summa', value: `${formatAmount(summary.totalAmount)} kr`, color: 'var(--text-primary)' },
                ].map(card => (
                    <div key={card.label} className="panel-card panel-card--no-hover">
                        <div className="panel-label">{card.label}</div>
                        <div className="panel-stat" style={{ color: card.color }}>{card.value}</div>
                    </div>
                ))}
            </div>

            {/* Status filter */}
            <div style={FILTER_ROW}>
                <FilterBtn label="Alla" count={summary.total} active={statusFilter === 'alla'} onClick={() => setStatusFilter('alla')} />
                {ALL_STATUSES.map(s => (
                    <FilterBtn key={s} label={STATUS_CONFIG[s].label} count={summary[s]} color={STATUS_CONFIG[s].color} active={statusFilter === s} onClick={() => setStatusFilter(s)} />
                ))}
            </div>

            {/* Receipt list */}
            {loadingItems ? (
                <div className="panel-stagger" style={LIST_GRID} aria-hidden="true">
                    {[0, 1, 2].map((i) => (
                        <div key={i} className="panel-card panel-card--no-hover" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                            <div className="skeleton skeleton-line" style={{ width: '55%', height: '0.85rem' }} />
                            <div className="skeleton skeleton-line" style={{ width: '80%', height: '0.85rem' }} />
                            <div className="skeleton skeleton-line" style={{ width: '40%', height: '0.85rem' }} />
                        </div>
                    ))}
                </div>
            ) : filtered.length === 0 ? (
                <div className="panel-card panel-card--no-hover" style={EMPTY_STATE}>
                    {items.length === 0
                        ? 'Inga kvitton än. Dra och släpp en bild eller PDF.'
                        : 'Inga kvitton matchar filtret.'}
                </div>
            ) : (
                <div className="panel-stagger" style={LIST_GRID}>
                    {filtered.map(item => (
                        <ReceiptCard
                            key={item.id}
                            item={item}
                            isExtracting={extractingId === item.id}
                            isExporting={exportingId === item.id}
                            isEditing={editingId === item.id}
                            isReviewing={reviewingId === item.id}
                            onExtract={() => void extractReceiptData(item)}
                            onExport={() => void exportToFortnox(item)}
                            onReview={() => void reviewAccounting(item)}
                            onEdit={() => setEditingId(editingId === item.id ? null : item.id)}
                            onUpdateField={(field, value) => updateField(item.id, field, value)}
                            onSetStatus={(status) => setStatus(item.id, status)}
                            onRemove={() => removeItem(item.id)}
                        />
                    ))}
                </div>
            )}

            {/* Help text */}
            <div className="panel-card panel-card--no-hover" style={HELP_CARD}>
                <strong style={HELP_TITLE}>Arbetsflöde</strong>
                <br />
                1. <strong>Fota/ladda upp</strong> - Dra och släpp kvittobild. AI extraherar data automatiskt.
                <br />
                2. <strong>Granska</strong> - Kontrollera butik, belopp, moms och konto. Markera som "Granskad".
                <br />
                3. <strong>Bokför</strong> - Exportera som verifikation till Fortnox.
            </div>
        </div>
    );
}

// =============================================================================
// SUBCOMPONENTS
// =============================================================================

function FilterBtn({ label, count, color, active, onClick }: {
    label: string; count: number; color?: string; active: boolean; onClick: () => void;
}) {
    return (
        <button
            type="button"
            aria-pressed={active}
            onClick={onClick}
            style={{
                ...FILTER_BTN_BASE,
                background: active ? (color ? `${color}20` : 'rgba(255, 255, 255, 0.1)') : 'transparent',
                color: active ? (color || 'var(--text-primary)') : 'var(--text-secondary)',
            }}
        >
            {label}
            <span style={{ fontSize: '0.7rem', opacity: 0.7, fontWeight: 400 }}>{count}</span>
        </button>
    );
}

function ActionBtn({ label, color, disabled, onClick }: {
    label: string; color: string; disabled?: boolean; onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            style={{ ...ACTION_BTN_BASE, color, cursor: disabled ? 'wait' : 'pointer', opacity: disabled ? 0.6 : 1 }}
        >
            {label}
        </button>
    );
}

function ReceiptCard({
    item, isExtracting, isExporting, isEditing, isReviewing,
    onExtract, onExport, onReview, onEdit, onUpdateField, onSetStatus, onRemove,
}: {
    item: ReceiptInboxItem;
    isExtracting: boolean;
    isExporting: boolean;
    isEditing: boolean;
    isReviewing: boolean;
    onExtract: () => void;
    onExport: () => void;
    onReview: () => void;
    onEdit: () => void;
    onUpdateField: (field: keyof ReceiptInboxItem, value: string | number | null) => void;
    onSetStatus: (status: ReceiptStatus) => void;
    onRemove: () => void;
}) {
    const statusCfg = STATUS_CONFIG[item.status];
    const displayName = item.merchantName || item.fileName || 'Okänt kvitto';

    return (
        <div className="panel-card panel-card--no-hover">
            {/* Top row */}
            <div style={CARD_TOP_ROW}>
                <span style={{ ...PILL_BASE, background: statusCfg.bg, color: statusCfg.color }}>{statusCfg.label}</span>

                {item.category && (
                    <span style={{ ...PILL_BASE, background: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6' }}>
                        {CATEGORY_LABELS[item.category] || item.category}
                    </span>
                )}

                {item.fortnoxVoucherNumber && (
                    <span style={{ ...PILL_BASE, background: 'rgba(16, 185, 129, 0.15)', color: '#10b981' }}>
                        Verifikation {item.fortnoxVoucherNumber}
                    </span>
                )}

                <div style={CARD_NAME_WRAP}>
                    <div style={CARD_NAME}>{displayName}</div>
                    {item.merchantName && <div style={CARD_FILE}>{item.fileName}</div>}
                </div>

                {item.totalAmount !== null && (
                    <div style={CARD_AMOUNT_WRAP}>
                        <div style={CARD_AMOUNT}>{formatAmount(item.totalAmount)} kr</div>
                        {item.vatAmount !== null && (
                            <div style={CARD_AMOUNT_META}>
                                varav moms {formatAmount(item.vatAmount)} kr ({item.vatRate || '?'}%)
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Details */}
            <div style={CARD_DETAILS}>
                {item.transactionDate && (
                    <div>
                        <span style={DETAIL_LABEL}>Datum: </span>
                        <span style={DETAIL_VALUE}>{formatDate(item.transactionDate)}</span>
                        {item.transactionTime && <span style={DETAIL_VALUE}> {item.transactionTime}</span>}
                    </div>
                )}
                {item.paymentMethod && (
                    <div>
                        <span style={DETAIL_LABEL}>Betalning: </span>
                        <span style={DETAIL_VALUE}>{item.paymentMethod}</span>
                    </div>
                )}
                {item.basAccount && (
                    <div>
                        <span style={DETAIL_LABEL}>Konto: </span>
                        <span style={DETAIL_STRONG}>{item.basAccount} {item.basAccountName}</span>
                    </div>
                )}
                {item.description && (
                    <div>
                        <span style={DETAIL_LABEL}>Beskrivning: </span>
                        <span style={DETAIL_VALUE}>{item.description}</span>
                    </div>
                )}
            </div>

            {/* Edit form */}
            {isEditing && <ReceiptEditForm item={item} onUpdateField={onUpdateField} />}

            {/* AI review note */}
            {item.aiReviewNote && (
                <div style={AI_REVIEW}>
                    <span style={AI_REVIEW_LABEL}>AI-granskning: </span>
                    {item.aiReviewNote}
                </div>
            )}

            {/* Actions */}
            <div style={CARD_ACTIONS}>
                {!item.aiExtracted && item.status === 'ny' && (
                    <ActionBtn label={isExtracting ? 'Extraherar...' : 'AI-extrahera'} color="#8b5cf6" disabled={isExtracting} onClick={onExtract} />
                )}
                <ActionBtn label={isReviewing ? 'Granskar...' : 'AI-granska'} color="#8b5cf6" disabled={isReviewing} onClick={onReview} />
                <ActionBtn label={isEditing ? 'Stäng' : 'Redigera'} color="var(--text-secondary)" onClick={onEdit} />

                {item.status === 'ny' && (
                    <ActionBtn label="Markera som granskad" color={STATUS_CONFIG.granskad.color} onClick={() => onSetStatus('granskad')} />
                )}

                {item.status === 'granskad' && item.fortnoxSyncStatus === 'not_exported' && (
                    <ActionBtn label={isExporting ? 'Exporterar...' : 'Exportera till Fortnox'} color={STATUS_CONFIG.bokford.color} disabled={isExporting} onClick={onExport} />
                )}

                <ActionBtn
                    label="Ta bort"
                    color="#ef4444"
                    onClick={() => {
                        if (window.confirm(`Ta bort kvitto "${displayName}"?`)) onRemove();
                    }}
                />
            </div>
        </div>
    );
}

function ReceiptEditForm({ item, onUpdateField }: {
    item: ReceiptInboxItem;
    onUpdateField: (field: keyof ReceiptInboxItem, value: string | number | null) => void;
}) {
    const fields: Array<{ field: keyof ReceiptInboxItem; label: string; type: 'text' | 'number' | 'date'; placeholder?: string }> = [
        { field: 'merchantName', label: 'Butik/restaurang', type: 'text' },
        { field: 'transactionDate', label: 'Datum', type: 'date' },
        { field: 'transactionTime', label: 'Tid', type: 'text', placeholder: 'HH:MM' },
        { field: 'totalAmount', label: 'Totalbelopp', type: 'number' },
        { field: 'vatAmount', label: 'Momsbelopp', type: 'number' },
        { field: 'vatRate', label: 'Momssats (%)', type: 'number' },
        { field: 'paymentMethod', label: 'Betalningsmetod', type: 'text', placeholder: 'Kort/Kontant/Swish' },
        { field: 'category', label: 'Kategori', type: 'text', placeholder: 'restaurant/transport/supplies' },
        { field: 'description', label: 'Beskrivning', type: 'text' },
        { field: 'basAccount', label: 'BAS-konto', type: 'text', placeholder: 't.ex. 5800' },
        { field: 'basAccountName', label: 'Kontonamn', type: 'text' },
    ];

    return (
        <div style={EDIT_GRID}>
            {fields.map(({ field, label, type, placeholder }) => {
                const value = item[field];
                const strValue = value === null || value === undefined ? '' : String(value);
                return (
                    <div key={field}>
                        <label style={EDIT_LABEL}>{label}</label>
                        <input
                            type={type}
                            value={strValue}
                            placeholder={placeholder}
                            onInput={e => {
                                const raw = e.currentTarget.value;
                                onUpdateField(field, type === 'number' ? (raw === '' ? null : parseFloat(raw)) : raw);
                            }}
                            style={EDIT_INPUT}
                        />
                    </div>
                );
            })}
        </div>
    );
}

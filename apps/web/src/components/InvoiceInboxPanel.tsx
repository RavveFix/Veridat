/**
 * InvoiceInboxPanel - Supplier invoice inbox with AI extraction and Fortnox integration.
 *
 * Drag-and-drop PDF/image upload, Gemini-powered data extraction,
 * editable fields, pipeline status tracking, and Fortnox export.
 * Invoice data is persisted in localStorage per company.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { supabase } from '../lib/supabase';
import { companyService } from '../services/CompanyService';
import { fileService } from '../services/FileService';

// =============================================================================
// TYPES
// =============================================================================

type InvoiceStatus = 'ny' | 'granskad' | 'bokford' | 'betald';

type InvoiceSource = 'upload' | 'fortnox';

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

// =============================================================================
// CONSTANTS
// =============================================================================

const STORAGE_KEY = 'veridat_invoice_inbox';

const STATUS_CONFIG: Record<InvoiceStatus, { label: string; color: string; bg: string }> = {
    ny: { label: 'Ny', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)' },
    granskad: { label: 'Granskad', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.15)' },
    bokford: { label: 'Bokförd', color: '#10b981', bg: 'rgba(16, 185, 129, 0.15)' },
    betald: { label: 'Betald', color: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.15)' },
};

const ALL_STATUSES: InvoiceStatus[] = ['ny', 'granskad', 'bokford', 'betald'];

// =============================================================================
// HELPERS
// =============================================================================

function generateId(): string {
    return `inv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function loadInbox(companyId: string): InvoiceInboxItem[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const store = JSON.parse(raw) as Record<string, Partial<InvoiceInboxItem>[]>;
        return (store[companyId] || []).map(item => ({
            ...item,
            source: item.source || 'upload',
            fortnoxBalance: item.fortnoxBalance ?? null,
            aiReviewNote: item.aiReviewNote || '',
        })) as InvoiceInboxItem[];
    } catch {
        return [];
    }
}

function saveInbox(companyId: string, items: InvoiceInboxItem[]): void {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const store = raw ? JSON.parse(raw) as Record<string, InvoiceInboxItem[]> : {};
        store[companyId] = items;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {
        // Storage unavailable
    }
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
    const [statusFilter, setStatusFilter] = useState<InvoiceStatus | 'alla'>('alla');
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
    const fileInputRef = useRef<HTMLInputElement>(null);
    const companyId = companyService.getCurrentId();

    // Load from localStorage
    useEffect(() => {
        setItems(loadInbox(companyId));
    }, [companyId]);

    // Persist changes
    const updateItems = useCallback((updater: (prev: InvoiceInboxItem[]) => InvoiceInboxItem[]) => {
        setItems(prev => {
            const next = updater(prev);
            saveInbox(companyId, next);
            return next;
        });
    }, [companyId]);

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
                console.error('Upload failed:', err);
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
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                setError('Du måste vara inloggad för AI-extraktion.');
                return;
            }

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

            const response = await fetch(
                `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/gemini-chat`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${session.access_token}`,
                    },
                    body: JSON.stringify({
                        message: EXTRACTION_PROMPT,
                        fileData: { data: base64, mimeType: blob.type || 'application/pdf' },
                        fileName: item.fileName,
                        skipHistory: true,
                        stream: false,
                    }),
                }
            );

            if (!response.ok) {
                throw new Error(`AI-extraktion misslyckades (${response.status})`);
            }

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
                updateItems(prev => prev.map(i =>
                    i.id === item.id ? { ...i, aiRawResponse: aiText } : i
                ));
                return;
            }

            const extracted = JSON.parse(jsonMatch[0]);

            updateItems(prev => prev.map(i => {
                if (i.id !== item.id) return i;
                return {
                    ...i,
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
                };
            }));

            setSuccessMsg(`Faktura från "${extracted.supplierName || item.fileName}" extraherad.`);
        } catch (err) {
            console.error('AI extraction failed:', err);
            setError('AI-extraktion misslyckades. Försök igen eller fyll i manuellt.');
        } finally {
            setExtractingId(null);
        }
    }, [updateItems]);

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
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                setError('Du måste vara inloggad.');
                return;
            }

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

            const response = await fetch(
                `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fortnox`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${session.access_token}`,
                    },
                    body: JSON.stringify({
                        action: 'exportSupplierInvoice',
                        companyId,
                        payload: { invoice: supplierInvoice },
                    }),
                }
            );

            if (!response.ok) {
                const errData = await response.json().catch(() => null);
                throw new Error(errData?.error || `Fortnox-export misslyckades (${response.status})`);
            }

            const result = await response.json();
            const givenNumber = result?.data?.SupplierInvoice?.GivenNumber;

            updateItems(prev => prev.map(i => {
                if (i.id !== item.id) return i;
                return {
                    ...i,
                    status: 'bokford' as InvoiceStatus,
                    fortnoxGivenNumber: givenNumber || null,
                };
            }));

            setSuccessMsg(`Faktura ${item.invoiceNumber} exporterad till Fortnox${givenNumber ? ` (Nr ${givenNumber})` : ''}.`);
        } catch (err) {
            console.error('Fortnox export failed:', err);
            setError(err instanceof Error ? err.message : 'Fortnox-export misslyckades.');
        } finally {
            setExportingId(null);
        }
    }, [companyId, updateItems]);

    // =========================================================================
    // FORTNOX SYNC
    // =========================================================================

    const syncFromFortnox = useCallback(async () => {
        setSyncing(true);
        setError(null);

        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                setError('Du måste vara inloggad.');
                return;
            }

            const response = await fetch(
                `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fortnox`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${session.access_token}`,
                    },
                    body: JSON.stringify({
                        action: 'getSupplierInvoices',
                        companyId,
                        payload: {},
                    }),
                }
            );

            if (!response.ok) {
                const errData = await response.json().catch(() => null);
                throw new Error(errData?.error || `Kunde inte hämta fakturor (${response.status})`);
            }

            const result = await response.json();
            const invoices = result?.data?.SupplierInvoices || result?.SupplierInvoices || [];

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
                    const gn = inv.GivenNumber;
                    if (existingGivenNumbers.has(gn)) {
                        // Update existing
                        const idx = updatedPrev.findIndex(i => i.fortnoxGivenNumber === gn);
                        if (idx >= 0) {
                            updatedPrev[idx] = {
                                ...updatedPrev[idx],
                                fortnoxBooked: inv.Booked || false,
                                fortnoxBalance: typeof inv.Balance === 'number' ? inv.Balance : null,
                                totalAmount: typeof inv.Total === 'number' ? inv.Total : updatedPrev[idx].totalAmount,
                                status: inv.Booked ? 'bokford' : updatedPrev[idx].status,
                            };
                        }
                    } else {
                        newItems.push({
                            id: `fnx_${gn}`,
                            fileName: '',
                            fileUrl: '',
                            filePath: '',
                            fileBucket: '',
                            uploadedAt: inv.InvoiceDate || new Date().toISOString(),
                            status: inv.Booked ? 'bokford' : 'ny',
                            source: 'fortnox',
                            supplierName: '',
                            supplierOrgNr: '',
                            invoiceNumber: inv.InvoiceNumber || '',
                            invoiceDate: inv.InvoiceDate || '',
                            dueDate: inv.DueDate || '',
                            totalAmount: typeof inv.Total === 'number' ? inv.Total : null,
                            vatAmount: typeof inv.VAT === 'number' ? inv.VAT : null,
                            vatRate: null,
                            ocrNumber: inv.OCR || '',
                            basAccount: '',
                            basAccountName: '',
                            currency: inv.Currency || 'SEK',
                            fortnoxSupplierNumber: inv.SupplierNumber || '',
                            fortnoxGivenNumber: gn,
                            fortnoxBooked: inv.Booked || false,
                            fortnoxBalance: typeof inv.Balance === 'number' ? inv.Balance : null,
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
            console.error('Fortnox sync failed:', err);
            setError(err instanceof Error ? err.message : 'Kunde inte synka från Fortnox.');
        } finally {
            setSyncing(false);
        }
    }, [companyId, updateItems]);

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
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                setError('Du måste vara inloggad.');
                return;
            }

            const response = await fetch(
                `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fortnox`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${session.access_token}`,
                    },
                    body: JSON.stringify({
                        action: 'bookSupplierInvoice',
                        companyId,
                        payload: { givenNumber: item.fortnoxGivenNumber },
                    }),
                }
            );

            if (!response.ok) {
                const errData = await response.json().catch(() => null);
                throw new Error(errData?.error || `Bokföring misslyckades (${response.status})`);
            }

            updateItems(prev => prev.map(i =>
                i.id === item.id ? { ...i, fortnoxBooked: true, status: 'bokford' as InvoiceStatus } : i
            ));
            setSuccessMsg(`Faktura ${item.invoiceNumber || item.fortnoxGivenNumber} bokförd i Fortnox.`);
        } catch (err) {
            console.error('Fortnox booking failed:', err);
            setError(err instanceof Error ? err.message : 'Bokföring misslyckades.');
        } finally {
            setBookingId(null);
        }
    }, [companyId, updateItems]);

    const approveInFortnox = useCallback(async (item: InvoiceInboxItem) => {
        if (!item.fortnoxGivenNumber) return;

        setBookingId(item.id);
        setError(null);

        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                setError('Du måste vara inloggad.');
                return;
            }

            const response = await fetch(
                `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fortnox`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${session.access_token}`,
                    },
                    body: JSON.stringify({
                        action: 'approveSupplierInvoiceBookkeep',
                        companyId,
                        payload: { givenNumber: item.fortnoxGivenNumber },
                    }),
                }
            );

            if (!response.ok) {
                const errData = await response.json().catch(() => null);
                throw new Error(errData?.error || `Attestering misslyckades (${response.status})`);
            }

            updateItems(prev => prev.map(i =>
                i.id === item.id ? { ...i, fortnoxBooked: true, status: 'bokford' as InvoiceStatus } : i
            ));
            setSuccessMsg(`Faktura ${item.invoiceNumber || item.fortnoxGivenNumber} attesterad.`);
        } catch (err) {
            console.error('Fortnox approval failed:', err);
            setError(err instanceof Error ? err.message : 'Attestering misslyckades.');
        } finally {
            setBookingId(null);
        }
    }, [companyId, updateItems]);

    // =========================================================================
    // AI REVIEW
    // =========================================================================

    const reviewAccounting = useCallback(async (item: InvoiceInboxItem) => {
        setReviewingId(item.id);
        setError(null);

        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                setError('Du måste vara inloggad.');
                return;
            }

            const prompt = `Granska denna leverantörsfaktura och ge en kort bedömning (max 2 meningar):
- Leverantör: ${item.supplierName || item.fortnoxSupplierNumber || 'okänd'}
- Fakturanr: ${item.invoiceNumber}
- Belopp: ${item.totalAmount} ${item.currency}
- Moms: ${item.vatAmount ?? 'okänd'} (${item.vatRate ?? '?'}%)
- BAS-konto: ${item.basAccount} ${item.basAccountName}
- Förfallodatum: ${item.dueDate}

Är kontosättningen rimlig? Om BAS-konto saknas eller verkar fel, föreslå rätt konto.`;

            const response = await fetch(
                `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/gemini-chat`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${session.access_token}`,
                    },
                    body: JSON.stringify({
                        message: prompt,
                        skipHistory: true,
                        stream: false,
                    }),
                }
            );

            if (!response.ok) {
                throw new Error(`AI-granskning misslyckades (${response.status})`);
            }

            const result = await response.json();
            const reviewText = result.data || result.response || result.text || '';

            updateItems(prev => prev.map(i =>
                i.id === item.id ? { ...i, aiReviewNote: reviewText } : i
            ));
        } catch (err) {
            console.error('AI review failed:', err);
            setError('AI-granskning misslyckades.');
        } finally {
            setReviewingId(null);
        }
    }, [updateItems]);

    // =========================================================================
    // ITEM ACTIONS
    // =========================================================================

    const updateField = useCallback((itemId: string, field: keyof InvoiceInboxItem, value: string | number | null) => {
        updateItems(prev => prev.map(i =>
            i.id === itemId ? { ...i, [field]: value } : i
        ));
    }, [updateItems]);

    const setStatus = useCallback((itemId: string, status: InvoiceStatus) => {
        updateItems(prev => prev.map(i =>
            i.id === itemId ? { ...i, status } : i
        ));
    }, [updateItems]);

    const removeItem = useCallback((itemId: string) => {
        updateItems(prev => prev.filter(i => i.id !== itemId));
    }, [updateItems]);

    // =========================================================================
    // FILTERING & SUMMARY
    // =========================================================================

    const filtered = useMemo(() => {
        if (statusFilter === 'alla') return items;
        return items.filter(i => i.status === statusFilter);
    }, [items, statusFilter]);

    const summary = useMemo(() => ({
        total: items.length,
        ny: items.filter(i => i.status === 'ny').length,
        granskad: items.filter(i => i.status === 'granskad').length,
        bokford: items.filter(i => i.status === 'bokford').length,
        betald: items.filter(i => i.status === 'betald').length,
        totalAmount: items.reduce((sum, i) => sum + (i.totalAmount || 0), 0),
    }), [items]);

    // =========================================================================
    // RENDER
    // =========================================================================

    return (
        <div className="panel-stagger" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <button
                    type="button"
                    onClick={onBack}
                    style={{
                        background: 'transparent',
                        border: '1px solid var(--glass-border)',
                        borderRadius: '8px',
                        color: 'var(--text-secondary)',
                        padding: '0.4rem 0.75rem',
                        fontSize: '0.8rem',
                        cursor: 'pointer',
                    }}
                >
                    Tillbaka
                </button>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    Ladda upp leverantörsfakturor. AI extraherar data automatiskt.
                </span>
            </div>

            {/* Messages */}
            {error && (
                <div style={{
                    padding: '0.6rem 0.8rem',
                    borderRadius: '8px',
                    background: 'rgba(239, 68, 68, 0.12)',
                    color: '#ef4444',
                    fontSize: '0.8rem',
                }}>
                    {error}
                </div>
            )}
            {successMsg && (
                <div style={{
                    padding: '0.6rem 0.8rem',
                    borderRadius: '8px',
                    background: 'rgba(16, 185, 129, 0.12)',
                    color: '#10b981',
                    fontSize: '0.8rem',
                }}>
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
                style={{
                    padding: '1.5rem',
                    border: `2px dashed ${dragOver ? '#3b82f6' : 'var(--surface-border)'}`,
                    background: dragOver ? 'rgba(59, 130, 246, 0.08)' : 'var(--surface-1)',
                    textAlign: 'center',
                }}
            >
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,.webp"
                    multiple
                    style={{ display: 'none' }}
                    onChange={e => {
                        if (e.currentTarget.files) void handleFiles(e.currentTarget.files);
                        e.currentTarget.value = '';
                    }}
                />
                {uploading ? (
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                        Laddar upp...
                    </div>
                ) : (
                    <>
                        <div style={{ fontSize: '1.5rem', marginBottom: '0.4rem' }}>
                            {dragOver ? '+' : ''}
                        </div>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem' }}>
                            {dragOver ? 'Släpp filerna här' : 'Dra och släpp fakturor här'}
                        </div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginTop: '0.25rem' }}>
                            eller klicka för att välja filer (PDF, PNG, JPG)
                        </div>
                    </>
                )}
            </div>

            {/* Fortnox sync button */}
            <button
                type="button"
                onClick={() => void syncFromFortnox()}
                disabled={syncing}
                style={{
                    width: '100%',
                    height: '42px',
                    borderRadius: '10px',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                    background: 'rgba(16, 185, 129, 0.08)',
                    color: '#10b981',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    cursor: syncing ? 'wait' : 'pointer',
                    opacity: syncing ? 0.6 : 1,
                }}
            >
                {syncing ? 'Hämtar...' : 'Hämta leverantörsfakturor från Fortnox'}
            </button>

            {/* Summary cards */}
            <div className="panel-stagger" style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                gap: '0.75rem',
            }}>
                {[
                    { label: 'Totalt', value: summary.total, color: 'var(--text-primary)' },
                    { label: 'Nya', value: summary.ny, color: STATUS_CONFIG.ny.color },
                    { label: 'Granskade', value: summary.granskad, color: STATUS_CONFIG.granskad.color },
                    { label: 'Bokförda', value: summary.bokford, color: STATUS_CONFIG.bokford.color },
                    { label: 'Betalda', value: summary.betald, color: STATUS_CONFIG.betald.color },
                    { label: 'Summa', value: `${formatAmount(summary.totalAmount)} kr`, color: 'var(--text-primary)' },
                ].map(card => (
                    <div key={card.label} className="panel-card panel-card--no-hover">
                        <div className="panel-label">{card.label}</div>
                        <div className="panel-stat" style={{ color: card.color }}>{card.value}</div>
                    </div>
                ))}
            </div>

            {/* Status filter tabs */}
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
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
                <div className="panel-card panel-card--no-hover" style={{
                    textAlign: 'center',
                    color: 'var(--text-secondary)',
                    fontSize: '0.85rem',
                    border: '1px dashed var(--surface-border)',
                }}>
                    {items.length === 0
                        ? 'Inga fakturor än. Dra och släpp en PDF eller hämta från Fortnox.'
                        : 'Inga fakturor matchar filtret.'}
                </div>
            ) : (
                <div className="panel-stagger" style={{ display: 'grid', gap: '0.75rem' }}>
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
                            onEdit={() => setEditingId(editingId === item.id ? null : item.id)}
                            onUpdateField={(field, value) => updateField(item.id, field, value)}
                            onSetStatus={(status) => setStatus(item.id, status)}
                            onRemove={() => removeItem(item.id)}
                        />
                    ))}
                </div>
            )}

            {/* Help text */}
            <div className="panel-card panel-card--no-hover" style={{
                fontSize: '0.8rem',
                color: 'var(--text-secondary)',
                lineHeight: 1.5,
            }}>
                <strong style={{ color: 'var(--text-primary)' }}>Arbetsflöde</strong>
                <br />
                1. <strong>Ladda upp</strong> - Dra och släpp PDF/bild. AI extraherar fakturadata automatiskt.
                <br />
                2. <strong>Granska</strong> - Kontrollera extraherade fält, korrigera vid behov. Markera som "Granskad".
                <br />
                3. <strong>Exportera</strong> - Skicka till Fortnox som leverantörsfaktura. Boka och attestera.
                <br />
                4. <strong>Betald</strong> - Markera när fakturan är betald.
            </div>
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
            onClick={onClick}
            style={{
                height: '34px',
                padding: '0 0.8rem',
                borderRadius: '10px',
                border: '1px solid var(--glass-border)',
                background: active ? (color ? `${color}20` : 'rgba(255, 255, 255, 0.1)') : 'transparent',
                color: active ? (color || 'var(--text-primary)') : 'var(--text-secondary)',
                fontSize: '0.78rem',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
            }}
        >
            {label}
            <span style={{
                fontSize: '0.7rem',
                opacity: 0.7,
                fontWeight: 400,
            }}>
                {count}
            </span>
        </button>
    );
}

function InvoiceCard({
    item, isExtracting, isExporting, isEditing, isBooking, isReviewing,
    onExtract, onExport, onBook, onApprove, onReview, onEdit, onUpdateField, onSetStatus, onRemove,
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
    onEdit: () => void;
    onUpdateField: (field: keyof InvoiceInboxItem, value: string | number | null) => void;
    onSetStatus: (status: InvoiceStatus) => void;
    onRemove: () => void;
}) {
    const statusCfg = STATUS_CONFIG[item.status];
    const overdue = item.status !== 'betald' && isOverdue(item.dueDate);
    const dueSoon = !overdue && item.status !== 'betald' && isDueSoon(item.dueDate);

    return (
        <div className="panel-card panel-card--no-hover" style={{
            border: `1px solid ${overdue ? 'rgba(239, 68, 68, 0.4)' : 'var(--surface-border)'}`,
            background: overdue ? 'rgba(239, 68, 68, 0.04)' : undefined,
        }}>
            {/* Top row: status + supplier + actions */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
                {/* Status badge */}
                <span style={{
                    padding: '0.15rem 0.5rem',
                    borderRadius: '999px',
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    background: statusCfg.bg,
                    color: statusCfg.color,
                }}>
                    {statusCfg.label}
                </span>

                {/* Source badge */}
                {item.source === 'fortnox' && (
                    <span style={{
                        padding: '0.15rem 0.5rem',
                        borderRadius: '999px',
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        background: 'rgba(16, 185, 129, 0.15)',
                        color: '#10b981',
                    }}>
                        Fortnox
                    </span>
                )}

                {/* Supplier name or filename */}
                <div style={{ flex: 1, minWidth: '120px' }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem' }}>
                        {item.supplierName || item.fortnoxSupplierNumber || item.fileName || `Fortnox #${item.fortnoxGivenNumber}`}
                    </div>
                    {item.supplierName && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                            {item.fileName}
                        </div>
                    )}
                </div>

                {/* Amount */}
                {item.totalAmount !== null && (
                    <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '1rem' }}>
                            {formatAmount(item.totalAmount)} kr
                        </div>
                        {item.vatAmount !== null && (
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                                varav moms {formatAmount(item.vatAmount)} kr ({item.vatRate || '?'}%)
                            </div>
                        )}
                    </div>
                )}

                {/* Overdue warning */}
                {overdue && (
                    <span style={{
                        padding: '0.15rem 0.5rem',
                        borderRadius: '999px',
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        background: 'rgba(239, 68, 68, 0.15)',
                        color: '#ef4444',
                    }}>
                        Förfallen
                    </span>
                )}
                {dueSoon && (
                    <span style={{
                        padding: '0.15rem 0.5rem',
                        borderRadius: '999px',
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        background: 'rgba(245, 158, 11, 0.15)',
                        color: '#f59e0b',
                    }}>
                        Förfaller snart
                    </span>
                )}
            </div>

            {/* Data row */}
            <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', fontSize: '0.8rem', marginBottom: '0.6rem' }}>
                {item.invoiceNumber && (
                    <div>
                        <span style={{ color: 'var(--text-secondary)' }}>Faktura: </span>
                        <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{item.invoiceNumber}</span>
                    </div>
                )}
                {item.invoiceDate && (
                    <div>
                        <span style={{ color: 'var(--text-secondary)' }}>Datum: </span>
                        <span style={{ color: 'var(--text-primary)' }}>{formatDate(item.invoiceDate)}</span>
                    </div>
                )}
                {item.dueDate && (
                    <div>
                        <span style={{ color: 'var(--text-secondary)' }}>Förfaller: </span>
                        <span style={{ color: overdue ? '#ef4444' : 'var(--text-primary)', fontWeight: overdue ? 600 : 400 }}>
                            {formatDate(item.dueDate)}
                        </span>
                    </div>
                )}
                {item.ocrNumber && (
                    <div>
                        <span style={{ color: 'var(--text-secondary)' }}>OCR: </span>
                        <span style={{ color: 'var(--text-primary)' }}>{item.ocrNumber}</span>
                    </div>
                )}
                {item.basAccount && (
                    <div>
                        <span style={{ color: 'var(--text-secondary)' }}>Konto: </span>
                        <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                            {item.basAccount} {item.basAccountName}
                        </span>
                    </div>
                )}
                {item.fortnoxGivenNumber && (
                    <div>
                        <span style={{ color: 'var(--text-secondary)' }}>Fortnox nr: </span>
                        <span style={{ color: '#10b981', fontWeight: 600 }}>{item.fortnoxGivenNumber}</span>
                    </div>
                )}
                {item.fortnoxBalance !== null && item.fortnoxBalance !== undefined && (
                    <div>
                        <span style={{ color: 'var(--text-secondary)' }}>Restsaldo: </span>
                        <span style={{ color: item.fortnoxBalance > 0 ? '#f59e0b' : '#10b981', fontWeight: 600 }}>
                            {formatAmount(item.fortnoxBalance)} kr
                        </span>
                    </div>
                )}
            </div>

            {/* Edit form (shown when editing) */}
            {isEditing && (
                <EditForm item={item} onUpdateField={onUpdateField} />
            )}

            {/* AI review note */}
            {item.aiReviewNote && (
                <div style={{
                    padding: '0.5rem 0.75rem',
                    borderRadius: '8px',
                    background: 'rgba(139, 92, 246, 0.08)',
                    border: '1px solid rgba(139, 92, 246, 0.2)',
                    fontSize: '0.8rem',
                    color: 'var(--text-primary)',
                    lineHeight: 1.4,
                    marginBottom: '0.6rem',
                }}>
                    <span style={{ fontWeight: 600, color: '#8b5cf6', fontSize: '0.72rem' }}>AI-granskning: </span>
                    {item.aiReviewNote}
                </div>
            )}

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {/* AI extract (upload source, not yet extracted) */}
                {item.source === 'upload' && !item.aiExtracted && item.status === 'ny' && (
                    <ActionButton
                        label={isExtracting ? 'Extraherar...' : 'AI-extrahera'}
                        color="#8b5cf6"
                        disabled={isExtracting}
                        onClick={onExtract}
                    />
                )}

                {/* AI review accounting */}
                <ActionButton
                    label={isReviewing ? 'Granskar...' : 'AI-granska'}
                    color="#8b5cf6"
                    disabled={isReviewing}
                    onClick={onReview}
                />

                {/* Edit toggle */}
                <ActionButton
                    label={isEditing ? 'Stäng' : 'Redigera'}
                    color="var(--text-secondary)"
                    onClick={onEdit}
                />

                {/* Status progression */}
                {item.status === 'ny' && (
                    <ActionButton
                        label="Markera som granskad"
                        color={STATUS_CONFIG.granskad.color}
                        onClick={() => onSetStatus('granskad')}
                    />
                )}

                {/* Fortnox actions for synced invoices */}
                {item.source === 'fortnox' && item.fortnoxGivenNumber && !item.fortnoxBooked && (
                    <ActionButton
                        label={isBooking ? 'Bokför...' : 'Bokför i Fortnox'}
                        color="#10b981"
                        disabled={isBooking}
                        onClick={onBook}
                    />
                )}
                {item.source === 'fortnox' && item.fortnoxGivenNumber && (
                    <ActionButton
                        label={isBooking ? 'Attesterar...' : 'Attestera'}
                        color="#10b981"
                        disabled={isBooking}
                        onClick={onApprove}
                    />
                )}

                {/* Export to Fortnox (upload source only) */}
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
                        onClick={() => onSetStatus('betald')}
                    />
                )}

                {/* Delete (only for upload source) */}
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
        <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: '0.5rem',
            padding: '0.75rem',
            marginBottom: '0.6rem',
            borderRadius: '10px',
            border: '1px solid rgba(255, 255, 255, 0.06)',
            background: 'rgba(255, 255, 255, 0.02)',
        }}>
            {fields.map(({ field, label, type, placeholder }) => {
                const value = item[field];
                const strValue = value === null || value === undefined ? '' : String(value);

                return (
                    <div key={field}>
                        <label style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.15rem' }}>
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
                            style={{
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
                            }}
                        />
                    </div>
                );
            })}
        </div>
    );
}

function ActionButton({
    label, color, disabled, onClick,
}: {
    label: string;
    color: string;
    disabled?: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            style={{
                height: '30px',
                padding: '0 0.7rem',
                borderRadius: '8px',
                border: '1px solid var(--glass-border)',
                background: 'transparent',
                color,
                fontSize: '0.75rem',
                fontWeight: 600,
                cursor: disabled ? 'wait' : 'pointer',
                opacity: disabled ? 0.6 : 1,
                whiteSpace: 'nowrap',
            }}
        >
            {label}
        </button>
    );
}

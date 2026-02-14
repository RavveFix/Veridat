import { useEffect, useMemo, useState } from 'preact/hooks';
import { supabase } from '../lib/supabase';
import { companyService } from '../services/CompanyService';
import { bankImportService } from '../services/BankImportService';
import { logger } from '../services/LoggerService';
import type { BankImport, BankImportMapping, BankTransaction } from '../types/bank';
import { BANK_PROFILES, detectBankFromHeaders, getFieldSynonyms, type BankProfile } from '../utils/bankProfiles';
import { getFortnoxList } from '../utils/fortnoxResponse';

type CsvPreview = {
    headers: string[];
    rows: string[][];
    allRows: string[][];
    delimiter: string;
    totalRows: number;
};

interface BankImportPanelProps {
    onBack: () => void;
}

interface SupplierInvoiceSummary {
    GivenNumber: number | string;
    SupplierNumber: string;
    InvoiceNumber: string;
    DueDate: string;
    Total: number | string;
    Balance: number | string;
    Booked: boolean;
    OCR?: string;
    SupplierName?: string;
    OurReference?: string;
    YourReference?: string;
}

interface CustomerInvoiceSummary {
    InvoiceNumber: number;
    CustomerNumber: string;
    DueDate?: string;
    Total?: number | string;
    Balance?: number | string;
    Booked?: boolean;
    Cancelled?: boolean;
    OCR?: string;
    CustomerName?: string;
    OurReference?: string;
    YourReference?: string;
}

type MatchCandidate =
    | { type: 'supplier'; invoice: SupplierInvoiceSummary }
    | { type: 'customer'; invoice: CustomerInvoiceSummary };

interface MatchResult {
    transaction: BankTransaction;
    match?: MatchCandidate;
    confidence?: 'Hög' | 'Medium' | 'Låg';
    note?: string;
}

interface FortnoxPaymentPayload {
    action: 'registerSupplierInvoicePayment' | 'registerInvoicePayment';
    payment: Record<string, unknown>;
    matchMeta: Record<string, unknown>;
}

const SAMPLE_CSV_URL = '/assets/handelsbanken-sample.csv';
const MAX_PREVIEW_ROWS = 12;
const MAX_MATCH_ROWS = 50;

const REQUIRED_FIELDS = {
    date: ['bokforingsdag', 'bokforingsdatum', 'datum'],
    description: ['beskrivning', 'text', 'info', 'transaktionstext'],
    amount: ['belopp', 'summa', 'amount'],
    inflow: ['insattning', 'inbetalning'],
    outflow: ['uttag', 'utbetalning']
};

const OPTIONAL_FIELDS = {
    counterparty: ['motpart', 'betalare', 'avsandare', 'avsandare', 'leverantor'],
    reference: ['referens', 'referensnummer', 'ref'],
    ocr: ['ocr', 'meddelande', 'betalningsreferens'],
    currency: ['valuta', 'currency'],
    account: ['konto', 'kontonummer']
};

function stripBom(value: string): string {
    return value.replace(/^\uFEFF/, '');
}

function normalizeHeader(value: string): string {
    return value
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '');
}

function detectDelimiter(headerLine: string): string {
    const semicolons = (headerLine.match(/;/g) || []).length;
    const commas = (headerLine.match(/,/g) || []).length;
    const tabs = (headerLine.match(/\t/g) || []).length;

    if (semicolons >= commas && semicolons >= tabs) return ';';
    if (commas >= semicolons && commas >= tabs) return ',';
    return '\t';
}

function parseLine(line: string, delimiter: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
        const char = line[i];
        const next = line[i + 1];

        if (char === '"') {
            if (inQuotes && next === '"') {
                current += '"';
                i += 1;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }

        if (char === delimiter && !inQuotes) {
            result.push(current.trim());
            current = '';
            continue;
        }

        current += char;
    }

    result.push(current.trim());
    return result;
}

function parseCsv(text: string): CsvPreview | null {
    const normalized = stripBom(text).trim();
    if (!normalized) return null;

    const lines = normalized.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length === 0) return null;

    const delimiter = detectDelimiter(lines[0]);
    const rows = lines.map((line) => parseLine(line, delimiter));
    const headers = rows[0] || [];
    const allRows = rows.slice(1);
    const previewRows = allRows.slice(0, MAX_PREVIEW_ROWS);

    return {
        headers,
        rows: previewRows,
        allRows,
        delimiter,
        totalRows: Math.max(allRows.length, 0)
    };
}

function findHeader(headers: string[], synonyms: string[]): string | undefined {
    const normalized = headers.map((header) => normalizeHeader(header));
    const target = synonyms.find((key) => normalized.includes(key));
    if (!target) return undefined;
    const index = normalized.indexOf(target);
    return headers[index];
}

function guessMapping(headers: string[], profile?: BankProfile | null): BankImportMapping {
    const getSynonyms = (field: keyof BankProfile['headers'], fallback: string[]): string[] => {
        if (profile) return getFieldSynonyms(profile, field);
        return fallback;
    };

    const mapping: BankImportMapping = {
        date: findHeader(headers, getSynonyms('date', REQUIRED_FIELDS.date)),
        description: findHeader(headers, getSynonyms('description', REQUIRED_FIELDS.description)),
        amount: findHeader(headers, getSynonyms('amount', REQUIRED_FIELDS.amount)),
        inflow: findHeader(headers, getSynonyms('inflow', REQUIRED_FIELDS.inflow)),
        outflow: findHeader(headers, getSynonyms('outflow', REQUIRED_FIELDS.outflow)),
        counterparty: findHeader(headers, getSynonyms('counterparty', OPTIONAL_FIELDS.counterparty)),
        reference: findHeader(headers, getSynonyms('reference', OPTIONAL_FIELDS.reference)),
        ocr: findHeader(headers, getSynonyms('ocr', OPTIONAL_FIELDS.ocr)),
        currency: findHeader(headers, getSynonyms('currency', OPTIONAL_FIELDS.currency)),
        account: findHeader(headers, getSynonyms('account', OPTIONAL_FIELDS.account))
    };

    if (mapping.amount) {
        mapping.inflow = undefined;
        mapping.outflow = undefined;
    }

    return mapping;
}

function parseAmount(value?: string): number | null {
    if (!value) return null;
    const raw = value.trim();
    if (!raw) return null;

    let negative = false;
    let cleaned = raw.replace(/\s|\u00A0/g, '');

    if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
        negative = true;
        cleaned = cleaned.slice(1, -1);
    }

    if (cleaned.startsWith('-')) {
        negative = true;
        cleaned = cleaned.slice(1);
    }

    const hasComma = cleaned.includes(',');
    const hasDot = cleaned.includes('.');

    if (hasComma && hasDot) {
        if (cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
            cleaned = cleaned.replace(/\./g, '').replace(',', '.');
        } else {
            cleaned = cleaned.replace(/,/g, '');
        }
    } else if (hasComma) {
        cleaned = cleaned.replace(',', '.');
    }

    const parsed = Number.parseFloat(cleaned);
    if (Number.isNaN(parsed)) return null;

    return negative ? -parsed : parsed;
}

function normalizeDate(value?: string): string | null {
    if (!value) return null;
    const trimmed = value.trim();
    if (!trimmed) return null;

    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        return trimmed;
    }

    const slashMatch = trimmed.match(/^(\d{2})[./-](\d{2})[./-](\d{4})$/);
    if (slashMatch) {
        const [, day, month, year] = slashMatch;
        return `${year}-${month}-${day}`;
    }

    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString().split('T')[0];
    }

    return null;
}

function formatAmount(value: number): string {
    return value.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function toNumber(value: number | string | null | undefined): number {
    if (typeof value === 'number') return value;
    if (value === null || value === undefined) return 0;
    const normalized = String(value).replace(/\s+/g, '').replace(',', '.');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
}

function getOutstandingInvoiceAmount(
    balance: number | string | null | undefined,
    total: number | string | null | undefined
): number {
    const balanceAmount = toNumber(balance);
    return balanceAmount > 0 ? balanceAmount : toNumber(total);
}

function buildFortnoxPaymentPayload(
    match: MatchCandidate,
    amount: number,
    paymentDate: string,
    reference: string
): FortnoxPaymentPayload {
    if (match.type === 'supplier') {
        const invoice = match.invoice;
        const invoiceNumber = invoice.InvoiceNumber || String(invoice.GivenNumber);
        return {
            action: 'registerSupplierInvoicePayment',
            payment: {
                InvoiceNumber: invoiceNumber,
                Amount: amount,
                PaymentDate: paymentDate,
                Information: reference
            },
            matchMeta: {
                type: 'supplier',
                invoiceNumber,
                supplierNumber: invoice.SupplierNumber,
                supplierName: invoice.SupplierName,
                dueDate: invoice.DueDate,
                total: invoice.Total,
                balance: invoice.Balance,
                ocr: invoice.OCR
            }
        };
    }

    const invoice = match.invoice;
    return {
        action: 'registerInvoicePayment',
        payment: {
            InvoiceNumber: invoice.InvoiceNumber,
            Amount: amount,
            PaymentDate: paymentDate,
            ExternalInvoiceReference1: reference
        },
        matchMeta: {
            type: 'customer',
            invoiceNumber: invoice.InvoiceNumber,
            customerNumber: invoice.CustomerNumber,
            customerName: invoice.CustomerName,
            dueDate: invoice.DueDate,
            total: invoice.Total,
            balance: invoice.Balance,
            ocr: invoice.OCR
        }
    };
}

function normalizeDigits(value?: string): string {
    return (value || '').replace(/\D+/g, '');
}

function normalizeText(value?: string): string {
    return (value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function dayDiff(dateA: string, dateB: string): number {
    const a = new Date(dateA);
    const b = new Date(dateB);
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 999;
    const diff = Math.abs(a.getTime() - b.getTime());
    return Math.round(diff / (1000 * 60 * 60 * 24));
}

function createId(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return `import_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function buildMatchIdempotencyKey(
    companyId: string,
    result: MatchResult
): string {
    if (!result.match) {
        return `bank_match:${companyId}:${result.transaction.id}`;
    }
    if (result.match.type === 'supplier') {
        const invoice = result.match.invoice;
        const invoiceRef = invoice.GivenNumber || invoice.InvoiceNumber;
        return `bank_match:${companyId}:supplier:${result.transaction.id}:${String(invoiceRef)}`;
    }
    const invoice = result.match.invoice;
    return `bank_match:${companyId}:customer:${result.transaction.id}:${String(invoice.InvoiceNumber)}`;
}

function buildMatches(
    transactions: BankTransaction[],
    supplierInvoices: SupplierInvoiceSummary[],
    customerInvoices: CustomerInvoiceSummary[]
): MatchResult[] {
    const supplierCandidates = supplierInvoices.filter((inv) => !inv.Booked && getOutstandingInvoiceAmount(inv.Balance, inv.Total) > 0);
    const customerCandidates = customerInvoices.filter((inv) => !inv.Cancelled && getOutstandingInvoiceAmount(inv.Balance, inv.Total) > 0);
    const amountTolerance = 1;

    const scoreCandidate = (
        tx: BankTransaction,
        invoiceAmount: number,
        dueDate?: string,
        matchInfo?: { ocr?: string; invoiceNumber?: string; counterparty?: string }
    ) => {
        const amountDiff = Math.abs(Math.abs(tx.amount) - invoiceAmount);
        if (amountDiff > amountTolerance) return null;

        const referenceText = `${tx.reference || ''} ${tx.ocr || ''} ${tx.description || ''} ${tx.counterparty || ''}`;
        const referenceDigits = normalizeDigits(referenceText);
        const ocrDigits = normalizeDigits(matchInfo?.ocr);
        const invoiceDigits = normalizeDigits(matchInfo?.invoiceNumber);
        const counterparty = normalizeText(matchInfo?.counterparty);
        const txText = normalizeText(referenceText);

        const ocrMatch = Boolean(ocrDigits && referenceDigits.includes(ocrDigits));
        const numberMatch = Boolean(invoiceDigits && referenceDigits.includes(invoiceDigits));
        const counterpartyMatch = Boolean(counterparty && txText.includes(counterparty));
        const days = dueDate ? dayDiff(tx.date, dueDate) : 999;

        let score = 0;
        score += Math.max(0, 40 - amountDiff * 10);
        if (ocrMatch) score += 40;
        if (numberMatch) score += 25;
        if (counterpartyMatch) score += 15;
        if (days <= 7) score += Math.max(0, 14 - days * 2);

        const reasons: string[] = [];
        if (ocrMatch) reasons.push('OCR');
        if (numberMatch) reasons.push('Fakturanr');
        if (counterpartyMatch) reasons.push('Motpart');
        if (days <= 7) reasons.push('Datum');
        reasons.push('Belopp');

        let confidence: MatchResult['confidence'] = 'Låg';
        if (score >= 85) {
            confidence = 'Hög';
        } else if (score >= 60) {
            confidence = 'Medium';
        }

        return {
            score,
            confidence,
            note: reasons.length > 0 ? `Match: ${reasons.join(', ')}` : undefined
        };
    };

    const findBestInvoiceMatch = <T,>(
        tx: BankTransaction,
        candidates: T[],
        getMatchInfo: (invoice: T) => {
            invoiceAmount: number;
            dueDate?: string;
            matchInfo?: { ocr?: string; invoiceNumber?: string; counterparty?: string };
        }
    ): { invoice: T; confidence: MatchResult['confidence']; note?: string } | null => {
        let best: T | null = null;
        let bestScore = 0;
        let bestConfidence: MatchResult['confidence'] = 'Låg';
        let bestNote: string | undefined;

        for (const invoice of candidates) {
            const { invoiceAmount, dueDate, matchInfo } = getMatchInfo(invoice);
            const scored = scoreCandidate(tx, invoiceAmount, dueDate, matchInfo);
            if (!scored) continue;
            if (scored.score > bestScore) {
                bestScore = scored.score;
                best = invoice;
                bestConfidence = scored.confidence;
                bestNote = scored.note;
            }
        }

        return best
            ? { invoice: best, confidence: bestConfidence, note: bestNote }
            : null;
    };

    return transactions.map((tx) => {
        if (tx.amount === 0) {
            return { transaction: tx, note: 'Belopp 0 (ingen matchning)' };
        }

        if (tx.amount < 0) {
            const bestMatch = findBestInvoiceMatch(tx, supplierCandidates, (invoice) => ({
                invoiceAmount: getOutstandingInvoiceAmount(invoice.Balance, invoice.Total),
                dueDate: invoice.DueDate,
                matchInfo: {
                    ocr: invoice.OCR,
                    invoiceNumber: invoice.InvoiceNumber || String(invoice.GivenNumber),
                    counterparty: invoice.SupplierName
                }
            }));
            if (!bestMatch) {
                return { transaction: tx, note: 'Ingen match hittad' };
            }

            return {
                transaction: tx,
                match: { type: 'supplier', invoice: bestMatch.invoice },
                confidence: bestMatch.confidence,
                note: bestMatch.note
            };
        }

        const bestMatch = findBestInvoiceMatch(tx, customerCandidates, (invoice) => ({
            invoiceAmount: getOutstandingInvoiceAmount(invoice.Balance, invoice.Total),
            dueDate: invoice.DueDate,
            matchInfo: {
                ocr: invoice.OCR,
                invoiceNumber: String(invoice.InvoiceNumber),
                counterparty: invoice.CustomerName
            }
        }));
        if (!bestMatch) {
            return { transaction: tx, note: 'Ingen match hittad' };
        }

        return {
            transaction: tx,
            match: { type: 'customer', invoice: bestMatch.invoice },
            confidence: bestMatch.confidence,
            note: bestMatch.note
        };
    });
}

export function BankImportPanel({ onBack }: BankImportPanelProps) {
    const [preview, setPreview] = useState<CsvPreview | null>(null);
    const [filename, setFilename] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [mapping, setMapping] = useState<BankImportMapping>({});
    const [saveMessage, setSaveMessage] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [matching, setMatching] = useState(false);
    const [matchError, setMatchError] = useState<string | null>(null);
    const [matches, setMatches] = useState<MatchResult[] | null>(null);
    const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [approvedIds, setApprovedIds] = useState<Set<string>>(new Set());
    const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
    const [aiSuggestions, setAiSuggestions] = useState<Map<string, string>>(new Map());
    const [aiLoadingId, setAiLoadingId] = useState<string | null>(null);
    const [selectedBank, setSelectedBank] = useState<string | null>(null);
    const [detectedBank, setDetectedBank] = useState<BankProfile | null>(null);

    const getSessionAccessToken = async (): Promise<string | null> => {
        const { data: { session } } = await supabase.auth.getSession();
        return session?.access_token ?? null;
    };

    const buildAuthHeaders = (accessToken: string): Record<string, string> => ({
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
    });

    const postAuthedFunction = (
        functionName: 'fortnox' | 'gemini-chat',
        accessToken: string,
        body: Record<string, unknown>
    ): Promise<Response> => {
        return fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${functionName}`, {
            method: 'POST',
            headers: buildAuthHeaders(accessToken),
            body: JSON.stringify(body)
        });
    };

    const getResponseErrorMessage = async (response: Response, fallback: string): Promise<string> => {
        const errorData = await response.json().catch(() => ({} as { error?: unknown }));
        return typeof errorData.error === 'string' ? errorData.error : fallback;
    };

    const setAiSuggestionMessage = (transactionId: string, message: string): void => {
        setAiSuggestions(prev => {
            const next = new Map(prev);
            next.set(transactionId, message);
            return next;
        });
    };

    const activeProfile = useMemo(() => {
        if (selectedBank === 'auto' || selectedBank === null) return detectedBank;
        return BANK_PROFILES.find(p => p.id === selectedBank) ?? null;
    }, [selectedBank, detectedBank]);

    useEffect(() => {
        if (!preview) return;
        const detected = detectBankFromHeaders(preview.headers);
        setDetectedBank(detected);
        if (!selectedBank || selectedBank === 'auto') {
            setSelectedBank('auto');
        }
        setMapping(guessMapping(preview.headers, detected));
    }, [preview]);

    // Re-map when user manually switches bank
    useEffect(() => {
        if (!preview || !selectedBank || selectedBank === 'auto') return;
        setMapping(guessMapping(preview.headers, activeProfile));
    }, [selectedBank]);

    const missingMapping = useMemo(() => {
        const missing: string[] = [];
        if (!mapping.date) missing.push('Bokföringsdag');
        if (!mapping.description) missing.push('Beskrivning');
        if (!mapping.amount && !(mapping.inflow || mapping.outflow)) {
            missing.push('Belopp (eller Insättning/Uttag)');
        }
        return missing;
    }, [mapping]);

    const normalizedTransactions = useMemo(() => {
        if (!preview || missingMapping.length > 0) return [];

        const indexMap = new Map<string, number>();
        preview.headers.forEach((header, index) => {
            indexMap.set(header, index);
        });

        const getValue = (row: string[], header?: string): string => {
            if (!header) return '';
            const index = indexMap.get(header);
            if (index === undefined) return '';
            return row[index] || '';
        };

        const transactions: BankTransaction[] = [];

        preview.allRows.forEach((row, rowIndex) => {
            const rawDate = getValue(row, mapping.date);
            const normalizedDate = normalizeDate(rawDate);
            const description = getValue(row, mapping.description).trim();

            let amount: number | null = null;
            if (mapping.amount) {
                amount = parseAmount(getValue(row, mapping.amount));
            } else {
                const inflow = parseAmount(getValue(row, mapping.inflow));
                const outflow = parseAmount(getValue(row, mapping.outflow));
                if (inflow !== null || outflow !== null) {
                    amount = (inflow || 0) - (outflow || 0);
                }
            }

            if (!normalizedDate || !description || amount === null) return;

            const raw: Record<string, string> = {};
            preview.headers.forEach((header, index) => {
                raw[header] = row[index] || '';
            });

            transactions.push({
                id: `tx_${rowIndex}_${createId()}`,
                date: normalizedDate,
                description,
                amount,
                currency: getValue(row, mapping.currency) || undefined,
                counterparty: getValue(row, mapping.counterparty) || undefined,
                reference: getValue(row, mapping.reference) || undefined,
                ocr: getValue(row, mapping.ocr) || undefined,
                account: getValue(row, mapping.account) || undefined,
                raw
            });
        });

        return transactions;
    }, [preview, mapping, missingMapping.length]);

    const handleFileSelect = async (file: File) => {
        setError(null);
        setSaveMessage(null);
        setMatchError(null);
        setMatches(null);
        setFilename(file.name);

        try {
            const text = await file.text();
            const parsed = parseCsv(text);
            if (!parsed) {
                setError('Kunde inte läsa CSV-filen. Kontrollera formatet.');
                setPreview(null);
                return;
            }
            setPreview(parsed);
        } catch (err) {
            logger.error('CSV parse failed', err);
            setError('Ett fel uppstod vid läsning av CSV-filen.');
            setPreview(null);
        }
    };

    const handleSaveImport = async () => {
        if (!preview || normalizedTransactions.length === 0) {
            setError('Inga transaktioner kunde tolkas. Kontrollera mappningen.');
            return;
        }

        setSaving(true);
        setError(null);
        setSaveMessage(null);

        try {
            const companyId = companyService.getCurrentId();
            const importData: BankImport = {
                id: createId(),
                companyId,
                filename: filename || 'bankimport.csv',
                importedAt: new Date().toISOString(),
                rowCount: normalizedTransactions.length,
                mapping,
                transactions: normalizedTransactions
            };

            await bankImportService.saveImport(companyId, importData);
            setSaveMessage(`Import sparad (${normalizedTransactions.length} transaktioner).`);
        } catch (err) {
            logger.error('Failed to save import', err);
            const message = err instanceof Error ? err.message : '';
            if (message.includes('name resolution failed')) {
                setError('Kunde inte nå lokala Edge Functions. Kör "npm run supabase:serve" och försök igen.');
            } else if (message.includes('does not exist')) {
                setError('Lokala databasmigrationer saknas. Kör "npm run supabase:setup" och försök igen.');
            } else if (message) {
                setError(`Kunde inte spara importen: ${message}`);
            } else {
                setError('Kunde inte spara importen.');
            }
        } finally {
            setSaving(false);
        }
    };

    const handleMatchSuggestions = async () => {
        if (normalizedTransactions.length === 0) {
            setMatchError('Inga transaktioner att matcha.');
            return;
        }

        setMatching(true);
        setMatchError(null);
        setMatches(null);
        setActionError(null);

        try {
            const accessToken = await getSessionAccessToken();
            if (!accessToken) {
                setMatchError('Du måste vara inloggad för att hämta Fortnox-data.');
                return;
            }

            const [supplierResponse, customerResponse] = await Promise.all([
                postAuthedFunction('fortnox', accessToken, { action: 'getSupplierInvoices' }),
                postAuthedFunction('fortnox', accessToken, { action: 'getInvoices' })
            ]);

            const errors: string[] = [];

            let supplierInvoices: SupplierInvoiceSummary[] = [];
            if (!supplierResponse.ok) {
                errors.push(await getResponseErrorMessage(supplierResponse, 'Kunde inte hämta leverantörsfakturor.'));
            } else {
                const result = await supplierResponse.json();
                supplierInvoices = getFortnoxList<SupplierInvoiceSummary>(result, 'SupplierInvoices');
            }

            let customerInvoices: CustomerInvoiceSummary[] = [];
            if (!customerResponse.ok) {
                errors.push(await getResponseErrorMessage(customerResponse, 'Kunde inte hämta kundfakturor.'));
            } else {
                const result = await customerResponse.json();
                customerInvoices = getFortnoxList<CustomerInvoiceSummary>(result, 'Invoices');
            }

            if (supplierInvoices.length === 0 && customerInvoices.length === 0) {
                setMatchError(errors[0] || 'Kunde inte hämta Fortnox-data.');
                return;
            }

            const matchResults = buildMatches(normalizedTransactions, supplierInvoices, customerInvoices);
            setMatches(matchResults);
            if (errors.length > 0) {
                setMatchError(errors.join(' '));
            }
        } catch (err) {
            logger.error('Match suggestions failed', err);
            setMatchError('Ett fel uppstod vid matchning.');
        } finally {
            setMatching(false);
        }
    };

    const handleApproveMatch = async (result: MatchResult) => {
        if (!result.match) return;
        setActionLoadingId(result.transaction.id);
        setActionError(null);

        try {
            const accessToken = await getSessionAccessToken();
            if (!accessToken) {
                setActionError('Du måste vara inloggad för att skapa bokning.');
                return;
            }

            const companyId = companyService.getCurrentId();
            const amount = Math.abs(result.transaction.amount);
            const paymentDate = result.transaction.date;
            const reference = result.transaction.reference || result.transaction.ocr || result.transaction.description;
            const approvedAt = new Date().toISOString();
            const { action, payment, matchMeta } = buildFortnoxPaymentPayload(
                result.match,
                amount,
                paymentDate,
                reference
            );

            const baseTransactionMeta = {
                transactionId: result.transaction.id,
                source: 'bank_import',
                sourceFilename: filename,
                approvedAt,
                transaction: {
                    date: result.transaction.date,
                    amount: result.transaction.amount,
                    description: result.transaction.description,
                    counterparty: result.transaction.counterparty,
                    reference: result.transaction.reference,
                    ocr: result.transaction.ocr,
                    account: result.transaction.account,
                    raw: result.transaction.raw
                },
                confidence: result.confidence,
                note: result.note,
                approvalMethod: 'manual_ok'
            };

            const meta = { ...baseTransactionMeta, match: matchMeta };

            const response = await postAuthedFunction('fortnox', accessToken, {
                action,
                companyId,
                payload: {
                    idempotencyKey: buildMatchIdempotencyKey(companyId, result),
                    sourceContext: 'bank-import-panel',
                    payment,
                    meta,
                }
            });

            if (!response.ok) {
                setActionError(await getResponseErrorMessage(response, 'Kunde inte skapa bokning i Fortnox.'));
                return;
            }

            setApprovedIds((prev) => {
                const next = new Set(prev);
                next.add(result.transaction.id);
                return next;
            });
        } catch (err) {
            logger.error('Approve match failed', err);
            setActionError('Ett fel uppstod vid bokning.');
        } finally {
            setActionLoadingId(null);
        }
    };

    const handleDismissMatch = (result: MatchResult) => {
        setDismissedIds((prev) => {
            const next = new Set(prev);
            next.add(result.transaction.id);
            return next;
        });
    };

    const handleAiSuggestion = async (tx: BankTransaction) => {
        setAiLoadingId(tx.id);
        try {
            const accessToken = await getSessionAccessToken();
            if (!accessToken) {
                setAiSuggestionMessage(tx.id, 'Du maste vara inloggad.');
                return;
            }

            const prompt = `Du ar en svensk bokforingsexpert. Foreslå BAS-konto och momssats for denna banktransaktion. Svara kort, max 2 rader.\n\nDatum: ${tx.date}\nBeskrivning: ${tx.description}\nBelopp: ${tx.amount} SEK${tx.counterparty ? `\nMotpart: ${tx.counterparty}` : ''}${tx.reference ? `\nReferens: ${tx.reference}` : ''}`;

            const response = await postAuthedFunction('gemini-chat', accessToken, {
                message: prompt,
                skipHistory: true
            });

            if (!response.ok) {
                setAiSuggestionMessage(tx.id, 'Kunde inte hamta AI-forslag.');
                return;
            }

            const result = await response.json();
            const suggestion = result.reply || result.message || 'Inget forslag.';
            setAiSuggestionMessage(tx.id, suggestion);
        } catch (err) {
            logger.error('AI suggestion failed', err);
            setAiSuggestionMessage(tx.id, 'Ett fel uppstod.');
        } finally {
            setAiLoadingId(null);
        }
    };

    const mappingOptions = preview?.headers || [];
    const visibleMatches = useMemo(() => {
        if (!matches) return null;
        return matches.filter((result) => !dismissedIds.has(result.transaction.id));
    }, [matches, dismissedIds]);

    return (
        <div className="panel-stagger" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
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
                        cursor: 'pointer'
                    }}
                >
                    Tillbaka
                </button>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    Importera kontoutdrag (CSV) och matcha mot Fortnox.
                </span>
            </div>

            {/* Bank selector */}
            <div className="panel-card panel-card--no-hover" style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                    <div>
                        <div className="panel-section-title" style={{ margin: 0 }}>Välj bank</div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                            {activeProfile
                                ? `${activeProfile.name}: ${activeProfile.description}`
                                : 'Välj bank eller låt oss auto-detektera från filen.'}
                        </div>
                    </div>
                    <a
                        href={SAMPLE_CSV_URL}
                        download
                        style={{
                            padding: '0.45rem 0.9rem',
                            borderRadius: '8px',
                            background: '#2563eb',
                            color: '#fff',
                            textDecoration: 'none',
                            fontSize: '0.85rem',
                            fontWeight: 700,
                            boxShadow: 'none'
                        }}
                        onMouseOver={(e) => (e.currentTarget.style.background = '#1d4ed8')}
                        onMouseOut={(e) => (e.currentTarget.style.background = '#2563eb')}
                    >
                        Ladda ner mall
                    </a>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <button
                        type="button"
                        onClick={() => {
                            setSelectedBank('auto');
                            if (preview) {
                                const detected = detectBankFromHeaders(preview.headers);
                                setDetectedBank(detected);
                                setMapping(guessMapping(preview.headers, detected));
                            }
                        }}
                        style={{
                            height: '34px',
                            padding: '0 0.8rem',
                            borderRadius: '10px',
                            border: (!selectedBank || selectedBank === 'auto') ? 'none' : '1px solid var(--surface-border)',
                            background: (!selectedBank || selectedBank === 'auto') ? '#2563eb' : 'var(--surface-2)',
                            color: (!selectedBank || selectedBank === 'auto') ? '#fff' : 'var(--text-primary)',
                            fontSize: '0.78rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            boxShadow: 'none'
                        }}
                        onMouseOver={(e) => {
                            if (!selectedBank || selectedBank === 'auto') {
                                e.currentTarget.style.background = '#1d4ed8';
                            } else {
                                e.currentTarget.style.background = 'var(--surface-3)';
                            }
                        }}
                        onMouseOut={(e) => {
                            if (!selectedBank || selectedBank === 'auto') {
                                e.currentTarget.style.background = '#2563eb';
                            } else {
                                e.currentTarget.style.background = 'var(--surface-2)';
                            }
                        }}
                    >
                        Auto-detektera{detectedBank && selectedBank === 'auto' ? ` (${detectedBank.name})` : ''}
                    </button>
                    {BANK_PROFILES.map(profile => (
                        <button
                            key={profile.id}
                            type="button"
                            onClick={() => setSelectedBank(profile.id)}
                            style={{
                                height: '34px',
                                padding: '0 0.8rem',
                                borderRadius: '10px',
                                border: selectedBank === profile.id ? 'none' : '1px solid var(--surface-border)',
                                background: selectedBank === profile.id ? '#2563eb' : 'var(--surface-2)',
                                color: selectedBank === profile.id ? '#fff' : 'var(--text-primary)',
                                fontSize: '0.78rem',
                                fontWeight: 700,
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                boxShadow: 'none'
                            }}
                            onMouseOver={(e) => {
                                if (selectedBank === profile.id) {
                                    e.currentTarget.style.background = '#1d4ed8';
                                } else {
                                    e.currentTarget.style.background = 'var(--surface-3)';
                                }
                            }}
                            onMouseOut={(e) => {
                                if (selectedBank === profile.id) {
                                    e.currentTarget.style.background = '#2563eb';
                                } else {
                                    e.currentTarget.style.background = 'var(--surface-2)';
                                }
                            }}
                        >
                            {profile.name}
                        </button>
                    ))}
                </div>
            </div>

            <div className="panel-card panel-card--no-hover" style={{
                border: '1px dashed var(--surface-border)'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                    <input
                        type="file"
                        accept=".csv,text/csv"
                        data-testid="bank-import-file-input"
                        onChange={(event) => {
                            const file = event.currentTarget.files?.[0];
                            if (file) {
                                void handleFileSelect(file);
                            }
                        }}
                        style={{ color: 'var(--text-secondary)' }}
                    />
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        Välj din bankfil for forhandsvisning.
                    </span>
                </div>
                {filename && (
                    <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        Fil: {filename}
                    </div>
                )}
            </div>

            {error && (
                <div style={{
                    padding: '0.8rem',
                    borderRadius: '8px',
                    background: 'var(--status-danger-bg)',
                    color: 'var(--status-danger)',
                    border: '1px solid var(--status-danger-border)',
                    fontSize: '0.85rem'
                }}>
                    {error}
                </div>
            )}

            {preview && (
                <div className="panel-card panel-card--no-hover" style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.75rem'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                        <div className="panel-section-title" style={{ margin: 0 }}>Förhandsvisning</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                            {preview.totalRows} transaktioner • Avgränsare: "{preview.delimiter}"
                        </div>
                    </div>

                    <div style={{
                        padding: '0.75rem',
                        borderRadius: '10px',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        background: 'rgba(255, 255, 255, 0.02)',
                        display: 'grid',
                        gap: '0.75rem'
                    }}>
                        <div className="panel-section-title" style={{ margin: 0 }}>Kolumnmappning</div>
                        <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
                            <label style={{ display: 'grid', gap: '0.3rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                Bokföringsdag
                                <select
                                    value={mapping.date || ''}
                                    onChange={(event) => setMapping({ ...mapping, date: event.currentTarget.value || undefined })}
                                >
                                    <option value="">Välj kolumn</option>
                                    {mappingOptions.map((option) => (
                                        <option key={`date-${option}`} value={option}>{option}</option>
                                    ))}
                                </select>
                            </label>
                            <label style={{ display: 'grid', gap: '0.3rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                Beskrivning
                                <select
                                    value={mapping.description || ''}
                                    onChange={(event) => setMapping({ ...mapping, description: event.currentTarget.value || undefined })}
                                >
                                    <option value="">Välj kolumn</option>
                                    {mappingOptions.map((option) => (
                                        <option key={`desc-${option}`} value={option}>{option}</option>
                                    ))}
                                </select>
                            </label>
                            <label style={{ display: 'grid', gap: '0.3rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                Belopp
                                <select
                                    value={mapping.amount || ''}
                                    onChange={(event) => setMapping({
                                        ...mapping,
                                        amount: event.currentTarget.value || undefined,
                                        inflow: event.currentTarget.value ? undefined : mapping.inflow,
                                        outflow: event.currentTarget.value ? undefined : mapping.outflow
                                    })}
                                >
                                    <option value="">Välj kolumn</option>
                                    {mappingOptions.map((option) => (
                                        <option key={`amount-${option}`} value={option}>{option}</option>
                                    ))}
                                </select>
                            </label>
                            {!mapping.amount && (
                                <>
                                    <label style={{ display: 'grid', gap: '0.3rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                        Insättning
                                        <select
                                            value={mapping.inflow || ''}
                                            onChange={(event) => setMapping({ ...mapping, inflow: event.currentTarget.value || undefined })}
                                        >
                                            <option value="">Välj kolumn</option>
                                            {mappingOptions.map((option) => (
                                                <option key={`in-${option}`} value={option}>{option}</option>
                                            ))}
                                        </select>
                                    </label>
                                    <label style={{ display: 'grid', gap: '0.3rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                        Uttag
                                        <select
                                            value={mapping.outflow || ''}
                                            onChange={(event) => setMapping({ ...mapping, outflow: event.currentTarget.value || undefined })}
                                        >
                                            <option value="">Välj kolumn</option>
                                            {mappingOptions.map((option) => (
                                                <option key={`out-${option}`} value={option}>{option}</option>
                                            ))}
                                        </select>
                                    </label>
                                </>
                            )}
                        </div>
                        {missingMapping.length > 0 && (
                            <div style={{
                                padding: '0.5rem 0.75rem',
                                borderRadius: '8px',
                                background: 'rgba(245, 158, 11, 0.15)',
                                color: '#f59e0b',
                                fontSize: '0.8rem'
                            }}>
                                Saknade fält: {missingMapping.join(', ')}
                            </div>
                        )}
                    </div>

                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                            <thead>
                                <tr>
                                    {preview.headers.map((header) => (
                                        <th
                                            key={header}
                                            style={{
                                                textAlign: 'left',
                                                padding: '0.4rem 0.5rem',
                                                borderBottom: '1px solid var(--glass-border)',
                                                color: 'var(--text-secondary)',
                                                fontWeight: 600,
                                                whiteSpace: 'nowrap'
                                            }}
                                        >
                                            {header || '—'}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {preview.rows.map((row, rowIndex) => (
                                    <tr key={`${rowIndex}-${row.join('-')}`}>
                                        {preview.headers.map((_, cellIndex) => (
                                            <td
                                                key={`${rowIndex}-${cellIndex}`}
                                                style={{
                                                    padding: '0.35rem 0.5rem',
                                                    borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                                                    color: 'var(--text-primary)',
                                                    whiteSpace: 'nowrap'
                                                }}
                                            >
                                                {row[cellIndex] || '—'}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                            Tolkade {normalizedTransactions.length} transaktioner.
                        </div>
                        <button
                            type="button"
                            onClick={handleSaveImport}
                            disabled={saving || missingMapping.length > 0 || normalizedTransactions.length === 0}
                            data-testid="bank-import-save-button"
                            style={{
                                padding: '0.5rem 1rem',
                                borderRadius: '8px',
                                border: 'none',
                                background: missingMapping.length > 0 || normalizedTransactions.length === 0
                                    ? 'var(--surface-3)'
                                    : '#2563eb',
                                color: missingMapping.length > 0 || normalizedTransactions.length === 0
                                    ? 'var(--text-secondary)'
                                    : '#fff',
                                cursor: missingMapping.length > 0 || normalizedTransactions.length === 0
                                    ? 'not-allowed'
                                    : 'pointer',
                                fontSize: '0.85rem',
                                fontWeight: 700,
                                boxShadow: 'none'
                            }}
                            onMouseOver={(e) => {
                                if (!(missingMapping.length > 0 || normalizedTransactions.length === 0)) {
                                    e.currentTarget.style.background = '#1d4ed8';
                                }
                            }}
                            onMouseOut={(e) => {
                                if (!(missingMapping.length > 0 || normalizedTransactions.length === 0)) {
                                    e.currentTarget.style.background = '#2563eb';
                                }
                            }}
                        >
                            {saving ? 'Sparar...' : 'Spara import'}
                        </button>
                    </div>

                    {saveMessage && (
                        <div style={{
                            padding: '0.6rem 0.8rem',
                            borderRadius: '8px',
                            background: 'rgba(16, 185, 129, 0.12)',
                            color: '#10b981',
                            fontSize: '0.8rem'
                        }}>
                            {saveMessage}
                        </div>
                    )}
                </div>
            )}

            {preview && (
                <div className="panel-card panel-card--no-hover" style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.75rem'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                        <div className="panel-section-title" style={{ margin: 0 }}>Matchningsförslag</div>
                        <button
                            type="button"
                            onClick={handleMatchSuggestions}
                            disabled={matching || normalizedTransactions.length === 0}
                            style={{
                                padding: '0.45rem 0.9rem',
                                borderRadius: '8px',
                                border: '1px solid var(--surface-border)',
                                background: 'var(--surface-2)',
                                color: 'var(--text-primary)',
                                cursor: matching ? 'wait' : 'pointer',
                                fontSize: '0.8rem',
                                fontWeight: 600,
                                boxShadow: 'none'
                            }}
                            onMouseOver={(e) => {
                                if (!matching) e.currentTarget.style.background = 'var(--surface-3)';
                            }}
                            onMouseOut={(e) => {
                                if (!matching) e.currentTarget.style.background = 'var(--surface-2)';
                            }}
                        >
                            {matching ? 'Hämtar...' : 'Hämta från Fortnox'}
                        </button>
                    </div>

                    {matchError && (
                        <div style={{
                            padding: '0.6rem 0.8rem',
                            borderRadius: '8px',
                            background: 'rgba(239, 68, 68, 0.12)',
                            color: '#ef4444',
                            fontSize: '0.8rem'
                        }}>
                            {matchError}
                        </div>
                    )}

                    {actionError && (
                        <div style={{
                            padding: '0.6rem 0.8rem',
                            borderRadius: '8px',
                            background: 'rgba(239, 68, 68, 0.12)',
                            color: '#ef4444',
                            fontSize: '0.8rem'
                        }}>
                            {actionError}
                        </div>
                    )}

                    {visibleMatches && (
                        <>
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                Visar {Math.min(visibleMatches.length, MAX_MATCH_ROWS)} av {visibleMatches.length} transaktioner.
                            </div>
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                                    <thead>
                                        <tr>
                                            <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem', color: 'var(--text-secondary)' }}>Datum</th>
                                            <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem', color: 'var(--text-secondary)' }}>Beskrivning</th>
                                            <th style={{ textAlign: 'right', padding: '0.4rem 0.5rem', color: 'var(--text-secondary)' }}>Belopp</th>
                                            <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem', color: 'var(--text-secondary)' }}>Match</th>
                                            <th style={{ textAlign: 'right', padding: '0.4rem 0.5rem', color: 'var(--text-secondary)' }}>Åtgärd</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {visibleMatches.slice(0, MAX_MATCH_ROWS).map((result) => {
                                            const isApproved = approvedIds.has(result.transaction.id);
                                            const isLoading = actionLoadingId === result.transaction.id;

                                            return (
                                                <tr key={result.transaction.id}>
                                                <td style={{ padding: '0.35rem 0.5rem', whiteSpace: 'nowrap' }}>{result.transaction.date}</td>
                                                <td style={{ padding: '0.35rem 0.5rem' }}>{result.transaction.description}</td>
                                                <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                                    {formatAmount(result.transaction.amount)}
                                                </td>
                                                <td style={{ padding: '0.35rem 0.5rem' }}>
                                                    {result.match ? (
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                                                            <span>
                                                                {result.match.type === 'supplier' ? 'Leverantörsfaktura' : 'Kundfaktura'}{' '}
                                                                {result.match.type === 'supplier'
                                                                    ? `${result.match.invoice.InvoiceNumber || result.match.invoice.GivenNumber}`
                                                                    : `${result.match.invoice.InvoiceNumber}`}{' '}
                                                                • {result.match.type === 'supplier'
                                                                    ? `Lev.nr ${result.match.invoice.SupplierNumber}`
                                                                    : `Kund.nr ${result.match.invoice.CustomerNumber}`}
                                                            </span>
                                                            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                                                Förfallo: {result.match.type === 'supplier'
                                                                    ? result.match.invoice.DueDate
                                                                    : result.match.invoice.DueDate || '—'}{' '}
                                                                • Belopp: {formatAmount(toNumber(result.match.type === 'supplier'
                                                                    ? result.match.invoice.Total
                                                                    : result.match.invoice.Total))}
                                                            </span>
                                                            {result.note && (
                                                                <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                                                                    {result.note}
                                                                </span>
                                                            )}
                                                            <span style={{
                                                                alignSelf: 'flex-start',
                                                                padding: '0.1rem 0.5rem',
                                                                borderRadius: '999px',
                                                                background: 'rgba(59, 130, 246, 0.15)',
                                                                color: '#3b82f6',
                                                                fontSize: '0.7rem',
                                                                fontWeight: 600
                                                            }}>
                                                                {result.confidence || 'Låg'}
                                                            </span>
                                                        </div>
                                                    ) : (
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                                                            <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                                                                {result.note || 'Ingen match'}
                                                            </span>
                                                            {aiSuggestions.has(result.transaction.id) && (
                                                                <div style={{
                                                                    padding: '0.4rem 0.6rem',
                                                                    borderRadius: '8px',
                                                                    background: 'rgba(168, 85, 247, 0.1)',
                                                                    border: '1px solid rgba(168, 85, 247, 0.2)',
                                                                    fontSize: '0.75rem',
                                                                    color: 'var(--text-primary)',
                                                                    lineHeight: 1.4,
                                                                    maxWidth: '300px'
                                                                }}>
                                                                    <span style={{ fontWeight: 600, color: '#a855f7', fontSize: '0.7rem' }}>AI-forslag: </span>
                                                                    {aiSuggestions.get(result.transaction.id)}
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </td>
                                                <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                                    {result.match ? (
                                                        <div style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center' }}>
                                                            <button
                                                                type="button"
                                                                onClick={() => void handleApproveMatch(result)}
                                                                disabled={isLoading || isApproved}
                                                                style={{
                                                                    height: '30px',
                                                                    padding: '0 0.75rem',
                                                                    borderRadius: '8px',
                                                                    border: '1px solid var(--glass-border)',
                                                                    background: isApproved ? 'rgba(16, 185, 129, 0.18)' : 'rgba(16, 185, 129, 0.12)',
                                                                    color: '#10b981',
                                                                    fontSize: '0.75rem',
                                                                    fontWeight: 600,
                                                                    cursor: isLoading || isApproved ? 'not-allowed' : 'pointer'
                                                                }}
                                                            >
                                                                {isApproved ? 'Skapad' : isLoading ? 'Skapar...' : 'OK'}
                                                            </button>
                                                            {!isApproved && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleDismissMatch(result)}
                                                                    disabled={isLoading}
                                                                    style={{
                                                                        height: '30px',
                                                                        padding: '0 0.7rem',
                                                                        borderRadius: '8px',
                                                                        border: '1px solid var(--surface-border)',
                                                                        background: 'var(--surface-2)',
                                                                        color: 'var(--text-secondary)',
                                                                        fontSize: '0.72rem',
                                                                        cursor: isLoading ? 'not-allowed' : 'pointer',
                                                                        boxShadow: 'none'
                                                                    }}
                                                                    onMouseOver={(e) => {
                                                                        if (!isLoading) e.currentTarget.style.background = 'var(--surface-3)';
                                                                    }}
                                                                    onMouseOut={(e) => {
                                                                        if (!isLoading) e.currentTarget.style.background = 'var(--surface-2)';
                                                                    }}
                                                                >
                                                                    Avvisa
                                                                </button>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <button
                                                            type="button"
                                                            onClick={() => void handleAiSuggestion(result.transaction)}
                                                            disabled={aiLoadingId === result.transaction.id || aiSuggestions.has(result.transaction.id)}
                                                            style={{
                                                                height: '30px',
                                                                padding: '0 0.75rem',
                                                                borderRadius: '8px',
                                                                border: '1px solid var(--surface-border)',
                                                                background: aiSuggestions.has(result.transaction.id)
                                                                    ? 'rgba(168, 85, 247, 0.12)'
                                                                    : 'var(--surface-2)',
                                                                color: '#a855f7',
                                                                fontSize: '0.72rem',
                                                                fontWeight: 700,
                                                                cursor: aiLoadingId === result.transaction.id || aiSuggestions.has(result.transaction.id) ? 'not-allowed' : 'pointer',
                                                                boxShadow: 'none'
                                                            }}
                                                            onMouseOver={(e) => {
                                                                if (!(aiLoadingId === result.transaction.id || aiSuggestions.has(result.transaction.id))) {
                                                                    e.currentTarget.style.background = 'var(--surface-3)';
                                                                }
                                                            }}
                                                            onMouseOut={(e) => {
                                                                if (!(aiLoadingId === result.transaction.id || aiSuggestions.has(result.transaction.id))) {
                                                                    e.currentTarget.style.background = 'var(--surface-2)';
                                                                }
                                                            }}
                                                        >
                                                            {aiLoadingId === result.transaction.id
                                                                ? 'Tanker...'
                                                                : aiSuggestions.has(result.transaction.id)
                                                                    ? 'Foreslaget'
                                                                    : 'AI-forslag'}
                                                        </button>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

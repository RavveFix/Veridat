import { useEffect, useMemo, useState } from 'preact/hooks';
import { supabase } from '../lib/supabase';
import { companyService } from '../services/CompanyService';
import { bankImportService } from '../services/BankImportService';
import type { BankImport, BankImportMapping, BankTransaction } from '../types/bank';

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
    GivenNumber: number;
    SupplierNumber: string;
    InvoiceNumber: string;
    DueDate: string;
    Total: number;
    Balance: number;
    Booked: boolean;
}

interface MatchResult {
    transaction: BankTransaction;
    match?: SupplierInvoiceSummary;
    confidence?: 'Hög' | 'Medium' | 'Låg';
    note?: string;
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

function guessMapping(headers: string[]): BankImportMapping {
    const mapping: BankImportMapping = {
        date: findHeader(headers, REQUIRED_FIELDS.date),
        description: findHeader(headers, REQUIRED_FIELDS.description),
        amount: findHeader(headers, REQUIRED_FIELDS.amount),
        inflow: findHeader(headers, REQUIRED_FIELDS.inflow),
        outflow: findHeader(headers, REQUIRED_FIELDS.outflow),
        counterparty: findHeader(headers, OPTIONAL_FIELDS.counterparty),
        reference: findHeader(headers, OPTIONAL_FIELDS.reference),
        ocr: findHeader(headers, OPTIONAL_FIELDS.ocr),
        currency: findHeader(headers, OPTIONAL_FIELDS.currency),
        account: findHeader(headers, OPTIONAL_FIELDS.account)
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

function buildMatches(transactions: BankTransaction[], invoices: SupplierInvoiceSummary[]): MatchResult[] {
    const candidates = invoices.filter((inv) => !inv.Booked && (inv.Balance ?? inv.Total) > 0);

    return transactions.map((tx) => {
        if (tx.amount >= 0) {
            return { transaction: tx, note: 'Inbetalning (ej leverantörsfaktura)' };
        }

        const amount = Math.abs(tx.amount);
        let best: SupplierInvoiceSummary | undefined;
        let bestScore = Number.POSITIVE_INFINITY;
        let bestDiff = Number.POSITIVE_INFINITY;
        let bestDayDiff = 999;

        for (const invoice of candidates) {
            const invoiceAmount = invoice.Balance > 0 ? invoice.Balance : invoice.Total;
            const diff = Math.abs(amount - invoiceAmount);
            if (diff > 5) continue;

            const days = invoice.DueDate ? dayDiff(tx.date, invoice.DueDate) : 999;
            const score = diff * 10 + days;
            if (score < bestScore) {
                bestScore = score;
                best = invoice;
                bestDiff = diff;
                bestDayDiff = days;
            }
        }

        if (!best) {
            return { transaction: tx, note: 'Ingen match hittad' };
        }

        let confidence: MatchResult['confidence'] = 'Låg';
        if (bestDiff <= 0.1 && bestDayDiff <= 3) {
            confidence = 'Hög';
        } else if (bestDiff <= 1 && bestDayDiff <= 7) {
            confidence = 'Medium';
        }

        return { transaction: tx, match: best, confidence };
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

    useEffect(() => {
        if (!preview) return;
        setMapping(guessMapping(preview.headers));
    }, [preview]);

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
            console.error('CSV parse failed', err);
            setError('Ett fel uppstod vid läsning av CSV-filen.');
            setPreview(null);
        }
    };

    const handleSaveImport = () => {
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

            bankImportService.saveImport(companyId, importData);
            setSaveMessage(`Import sparad (${normalizedTransactions.length} transaktioner).`);
        } catch (err) {
            console.error('Failed to save import', err);
            setError('Kunde inte spara importen.');
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

        try {
            const { data: session } = await supabase.auth.getSession();
            const accessToken = session?.session?.access_token;
            if (!accessToken) {
                setMatchError('Du måste vara inloggad för att hämta Fortnox-data.');
                return;
            }

            const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fortnox`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${accessToken}`
                },
                body: JSON.stringify({ action: 'getSupplierInvoices' })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                setMatchError(errorData.error || 'Kunde inte hämta leverantörsfakturor.');
                return;
            }

            const result = await response.json();
            const invoices = ((result.data?.SupplierInvoices ?? result.SupplierInvoices) || []) as SupplierInvoiceSummary[];
            const matchResults = buildMatches(normalizedTransactions, invoices);
            setMatches(matchResults);
        } catch (err) {
            console.error('Match suggestions failed', err);
            setMatchError('Ett fel uppstod vid matchning.');
        } finally {
            setMatching(false);
        }
    };

    const mappingOptions = preview?.headers || [];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
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
                    Importera kontoutdrag från Handelsbanken (CSV).
                </span>
            </div>

            <div style={{
                padding: '1rem',
                borderRadius: '12px',
                border: '1px solid var(--glass-border)',
                background: 'rgba(255, 255, 255, 0.04)'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                    <div>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>CSV-mall (Handelsbanken)</div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                            Semikolonseparerad, decimal-komma, datumformat YYYY-MM-DD.
                        </div>
                    </div>
                    <a
                        href={SAMPLE_CSV_URL}
                        download
                        style={{
                            padding: '0.45rem 0.9rem',
                            borderRadius: '8px',
                            background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
                            color: '#fff',
                            textDecoration: 'none',
                            fontSize: '0.85rem',
                            fontWeight: 600
                        }}
                    >
                        Ladda ner mall
                    </a>
                </div>
            </div>

            <div style={{
                padding: '1rem',
                borderRadius: '12px',
                border: '1px dashed var(--glass-border)',
                background: 'rgba(255, 255, 255, 0.02)'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                    <input
                        type="file"
                        accept=".csv,text/csv"
                        onChange={(event) => {
                            const file = event.currentTarget.files?.[0];
                            if (file) {
                                void handleFileSelect(file);
                            }
                        }}
                        style={{ color: 'var(--text-secondary)' }}
                    />
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        Välj din bankfil för förhandsvisning.
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
                <div style={{
                    padding: '1rem',
                    borderRadius: '12px',
                    border: '1px solid var(--glass-border)',
                    background: 'rgba(255, 255, 255, 0.04)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.75rem'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Förhandsvisning</div>
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
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Kolumnmappning</div>
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
                            style={{
                                padding: '0.5rem 1rem',
                                borderRadius: '8px',
                                border: 'none',
                                background: missingMapping.length > 0 || normalizedTransactions.length === 0
                                    ? 'rgba(255, 255, 255, 0.1)'
                                    : 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
                                color: missingMapping.length > 0 || normalizedTransactions.length === 0
                                    ? 'var(--text-secondary)'
                                    : '#fff',
                                cursor: missingMapping.length > 0 || normalizedTransactions.length === 0
                                    ? 'not-allowed'
                                    : 'pointer',
                                fontSize: '0.85rem',
                                fontWeight: 600
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
                <div style={{
                    padding: '1rem',
                    borderRadius: '12px',
                    border: '1px solid var(--glass-border)',
                    background: 'rgba(255, 255, 255, 0.04)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.75rem'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Matchningsförslag</div>
                        <button
                            type="button"
                            onClick={handleMatchSuggestions}
                            disabled={matching || normalizedTransactions.length === 0}
                            style={{
                                padding: '0.45rem 0.9rem',
                                borderRadius: '8px',
                                border: '1px solid var(--glass-border)',
                                background: 'transparent',
                                color: 'var(--text-secondary)',
                                cursor: matching ? 'wait' : 'pointer',
                                fontSize: '0.8rem'
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

                    {matches && (
                        <>
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                Visar {Math.min(matches.length, MAX_MATCH_ROWS)} av {matches.length} transaktioner.
                            </div>
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                                    <thead>
                                        <tr>
                                            <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem', color: 'var(--text-secondary)' }}>Datum</th>
                                            <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem', color: 'var(--text-secondary)' }}>Beskrivning</th>
                                            <th style={{ textAlign: 'right', padding: '0.4rem 0.5rem', color: 'var(--text-secondary)' }}>Belopp</th>
                                            <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem', color: 'var(--text-secondary)' }}>Match</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {matches.slice(0, MAX_MATCH_ROWS).map((result) => (
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
                                                                Faktura {result.match.InvoiceNumber || result.match.GivenNumber} • Lev.nr {result.match.SupplierNumber}
                                                            </span>
                                                            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                                                Förfallo: {result.match.DueDate} • Belopp: {formatAmount(result.match.Total)}
                                                            </span>
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
                                                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                                                            {result.note || 'Ingen match'}
                                                        </span>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
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

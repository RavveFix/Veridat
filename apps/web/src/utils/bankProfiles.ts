/**
 * Bank CSV format profiles for Swedish banks.
 *
 * Each profile defines known header synonyms, delimiter, date format,
 * and a detection function to auto-identify the bank from CSV headers.
 */

export interface BankProfile {
    id: string;
    name: string;
    description: string;
    delimiter: string;
    dateFormat: string;
    /** Header synonyms keyed by semantic field */
    headers: {
        date: string[];
        description: string[];
        amount: string[];
        inflow: string[];
        outflow: string[];
        counterparty: string[];
        reference: string[];
        ocr: string[];
        currency: string[];
        account: string[];
    };
    /** Unique header names that identify this bank */
    fingerprint: string[];
}

export const BANK_PROFILES: BankProfile[] = [
    {
        id: 'handelsbanken',
        name: 'Handelsbanken',
        description: 'Semikolonseparerad, decimal-komma, YYYY-MM-DD.',
        delimiter: ';',
        dateFormat: 'YYYY-MM-DD',
        headers: {
            date: ['bokforingsdag', 'bokforingsdatum', 'datum', 'transaktionsdatum'],
            description: ['beskrivning', 'text', 'info', 'transaktionstext'],
            amount: ['belopp', 'summa', 'amount'],
            inflow: ['insattning', 'inbetalning'],
            outflow: ['uttag', 'utbetalning'],
            counterparty: ['motpart', 'betalare', 'avsandare', 'leverantor'],
            reference: ['referens', 'referensnummer', 'ref'],
            ocr: ['ocr', 'meddelande', 'betalningsreferens'],
            currency: ['valuta', 'currency'],
            account: ['konto', 'kontonummer']
        },
        fingerprint: ['bokforingsdag', 'transaktionstyp']
    },
    {
        id: 'seb',
        name: 'SEB',
        description: 'Semikolonseparerad, decimal-komma, YYYY-MM-DD.',
        delimiter: ';',
        dateFormat: 'YYYY-MM-DD',
        headers: {
            date: ['bokforingsdatum', 'bokforingsdag', 'datum', 'valutadag'],
            description: ['text', 'textmottagare', 'beskrivning', 'betalningstext'],
            amount: ['belopp', 'summa'],
            inflow: ['kredit', 'insattning'],
            outflow: ['debet', 'uttag'],
            counterparty: ['textmottagare', 'motpart', 'mottagare'],
            reference: ['referens', 'referensnummer'],
            ocr: ['ocr', 'meddelande'],
            currency: ['valuta'],
            account: ['konto', 'kontonummer']
        },
        fingerprint: ['valutadag', 'textmottagare']
    },
    {
        id: 'nordea',
        name: 'Nordea',
        description: 'Semikolonseparerad, decimal-komma, YYYY-MM-DD.',
        delimiter: ';',
        dateFormat: 'YYYY-MM-DD',
        headers: {
            date: ['bokforingsdag', 'bokforingsdatum', 'datum', 'transaktionsdag'],
            description: ['transaktion', 'beskrivning', 'text', 'betalningstyp'],
            amount: ['belopp', 'summa'],
            inflow: ['insattning', 'inbetalning'],
            outflow: ['uttag', 'utbetalning'],
            counterparty: ['avsandaremottagare', 'motpart', 'betalare', 'avsandare'],
            reference: ['referens', 'meddelande', 'ref'],
            ocr: ['egnareferenser', 'betalningsreferens', 'ocr'],
            currency: ['valuta'],
            account: ['konto', 'kontonummer', 'kontonr']
        },
        fingerprint: ['avsandaremottagare', 'egnareferenser']
    },
    {
        id: 'swedbank',
        name: 'Swedbank',
        description: 'Semikolonseparerad, decimal-komma, YYYY-MM-DD.',
        delimiter: ';',
        dateFormat: 'YYYY-MM-DD',
        headers: {
            date: ['transaktionsdag', 'clearingdag', 'bokforingsdag', 'datum'],
            description: ['beskrivning', 'transaktionstyp', 'text', 'transaktion'],
            amount: ['belopp', 'summa'],
            inflow: ['insattning', 'inbetalning'],
            outflow: ['uttag', 'utbetalning'],
            counterparty: ['motpart', 'mottagare', 'betalare'],
            reference: ['referens', 'meddelandeinformation', 'ref'],
            ocr: ['ocr', 'meddelandeinformation'],
            currency: ['valuta'],
            account: ['kontonummer', 'konto']
        },
        fingerprint: ['clearingdag', 'meddelandeinformation']
    }
];

function normalizeForMatch(value: string): string {
    return value
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '');
}

/**
 * Auto-detect bank from CSV header row.
 * Returns the best-matching profile, or null if no fingerprint matches.
 */
export function detectBankFromHeaders(rawHeaders: string[]): BankProfile | null {
    const normalized = rawHeaders.map(normalizeForMatch);

    let bestProfile: BankProfile | null = null;
    let bestScore = 0;

    for (const profile of BANK_PROFILES) {
        let score = 0;
        for (const fp of profile.fingerprint) {
            if (normalized.some(h => h.includes(fp))) {
                score += 1;
            }
        }
        if (score > bestScore) {
            bestScore = score;
            bestProfile = profile;
        }
    }

    return bestScore > 0 ? bestProfile : null;
}

/**
 * Get all header synonyms for a given field, merging the selected profile's
 * synonyms with a fallback set.
 */
export function getFieldSynonyms(
    profile: BankProfile | null,
    field: keyof BankProfile['headers']
): string[] {
    if (!profile) {
        // Combine all synonyms from all profiles (deduped)
        const all = new Set<string>();
        for (const p of BANK_PROFILES) {
            for (const syn of p.headers[field]) {
                all.add(syn);
            }
        }
        return [...all];
    }
    return profile.headers[field];
}

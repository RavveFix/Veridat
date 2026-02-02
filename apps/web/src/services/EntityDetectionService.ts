/**
 * EntityDetectionService - Detect Fortnox entities in AI responses
 *
 * Parses AI text for references to customers, suppliers, invoices,
 * accounts, and amounts. Matches against cached Fortnox data for
 * high-confidence entity identification.
 */

import { fortnoxContextService, type FortnoxEntityType } from './FortnoxContextService';

// --- Types ---

export interface DetectedEntity {
    type: FortnoxEntityType;
    name: string;
    fortnoxId: string | null;
    confidence: number; // 0-1
    matchedText: string; // The original text that was matched
}

// --- Patterns ---

// Swedish + English patterns for entity detection
const CUSTOMER_PATTERNS = [
    /(?:kund|customer|faktura(?:n)?\s+till|fakturera)\s+["']?([A-ZÅÄÖ][a-zåäöA-ZÅÄÖ\s&]+?(?:\s+(?:AB|HB|KB|Oy|AS|ApS|GmbH|Ltd|Inc))?)["']?(?:\s|,|\.|$)/g,
    /(?:kund(?:nummer|nr)?)\s*[:=]?\s*["']?(\d{1,6})["']?/gi,
];

const SUPPLIER_PATTERNS = [
    /(?:leverantör|leverantor|från|faktura\s+från)\s+["']?([A-ZÅÄÖ][a-zåäöA-ZÅÄÖ\s&]+?(?:\s+(?:AB|HB|KB|Oy|AS|ApS|GmbH|Ltd|Inc))?)["']?(?:\s|,|\.|$)/g,
    /(?:leverantör(?:snummer|snr)?)\s*[:=]?\s*["']?(\d{1,6})["']?/gi,
];

const INVOICE_PATTERNS = [
    /(?:faktura|invoice)\s*#?\s*[:=]?\s*["']?([A-Z]?\d{3,8})["']?/gi,
];

const ACCOUNT_PATTERNS = [
    /(?:konto|account)\s*[:=]?\s*(\d{4})\b/gi,
    /\b([12345678]\d{3})\s+(?:[A-ZÅÄÖ][a-zåäö]+)/g, // 4-digit number followed by capitalized word
];

const VOUCHER_PATTERNS = [
    /(?:verifikat(?:ion)?|voucher)\s*#?\s*[:=]?\s*["']?([A-Z]-?\d{1,6})["']?/gi,
    /\b(VERIDAT-\d{4}-\d{2}-\d{3,})\b/g,
];

// --- Service ---

class EntityDetectionServiceClass {

    /**
     * Detect Fortnox entities in a text string.
     * Matches against cached data for higher confidence.
     */
    detect(text: string): DetectedEntity[] {
        const entities: DetectedEntity[] = [];

        this.detectCustomers(text, entities);
        this.detectSuppliers(text, entities);
        this.detectInvoices(text, entities);
        this.detectAccounts(text, entities);
        this.detectVouchers(text, entities);

        // Sort by confidence (highest first), deduplicate by name+type
        const seen = new Set<string>();
        return entities
            .sort((a, b) => b.confidence - a.confidence)
            .filter(e => {
                const key = `${e.type}:${e.name.toLowerCase()}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
    }

    private detectCustomers(text: string, entities: DetectedEntity[]): void {
        for (const pattern of CUSTOMER_PATTERNS) {
            pattern.lastIndex = 0;
            let match: RegExpExecArray | null;
            while ((match = pattern.exec(text)) !== null) {
                const name = match[1].trim();
                if (name.length < 2) continue;

                // Try to match against cached customers
                const cached = fortnoxContextService.findCustomerByName(name);
                entities.push({
                    type: 'customer',
                    name: cached ? cached.Name : name,
                    fortnoxId: cached?.CustomerNumber || null,
                    confidence: cached ? 0.9 : 0.5,
                    matchedText: match[0].trim()
                });
            }
        }
    }

    private detectSuppliers(text: string, entities: DetectedEntity[]): void {
        for (const pattern of SUPPLIER_PATTERNS) {
            pattern.lastIndex = 0;
            let match: RegExpExecArray | null;
            while ((match = pattern.exec(text)) !== null) {
                const name = match[1].trim();
                if (name.length < 2) continue;

                const cached = fortnoxContextService.findSupplierByName(name);
                entities.push({
                    type: 'supplier',
                    name: cached ? cached.Name : name,
                    fortnoxId: cached?.SupplierNumber || null,
                    confidence: cached ? 0.9 : 0.5,
                    matchedText: match[0].trim()
                });
            }
        }
    }

    private detectInvoices(text: string, entities: DetectedEntity[]): void {
        for (const pattern of INVOICE_PATTERNS) {
            pattern.lastIndex = 0;
            let match: RegExpExecArray | null;
            while ((match = pattern.exec(text)) !== null) {
                entities.push({
                    type: 'invoice',
                    name: `Faktura ${match[1]}`,
                    fortnoxId: match[1],
                    confidence: 0.7,
                    matchedText: match[0].trim()
                });
            }
        }
    }

    private detectAccounts(text: string, entities: DetectedEntity[]): void {
        for (const pattern of ACCOUNT_PATTERNS) {
            pattern.lastIndex = 0;
            let match: RegExpExecArray | null;
            while ((match = pattern.exec(text)) !== null) {
                const accountNumber = match[1];
                // BAS accounts are 1000-8999
                const num = parseInt(accountNumber, 10);
                if (num < 1000 || num > 8999) continue;

                entities.push({
                    type: 'account',
                    name: `Konto ${accountNumber}`,
                    fortnoxId: accountNumber,
                    confidence: 0.6,
                    matchedText: match[0].trim()
                });
            }
        }
    }

    private detectVouchers(text: string, entities: DetectedEntity[]): void {
        for (const pattern of VOUCHER_PATTERNS) {
            pattern.lastIndex = 0;
            let match: RegExpExecArray | null;
            while ((match = pattern.exec(text)) !== null) {
                entities.push({
                    type: 'voucher',
                    name: `Verifikat ${match[1]}`,
                    fortnoxId: match[1],
                    confidence: 0.8,
                    matchedText: match[0].trim()
                });
            }
        }
    }
}

export const entityDetectionService = new EntityDetectionServiceClass();

import { describe, expect, it } from 'vitest';
import { getFortnoxList, getFortnoxObject } from './fortnoxResponse';

describe('fortnoxResponse', () => {
    it('reads list from top-level response', () => {
        const result = { SupplierInvoices: [{ GivenNumber: 1 }, { GivenNumber: 2 }] };
        const list = getFortnoxList<{ GivenNumber: number }>(result, 'SupplierInvoices');
        expect(list).toHaveLength(2);
        expect(list[0].GivenNumber).toBe(1);
    });

    it('reads list from wrapped data response', () => {
        const result = { data: { SupplierInvoices: [{ GivenNumber: 10 }] } };
        const list = getFortnoxList<{ GivenNumber: number }>(result, 'SupplierInvoices');
        expect(list).toHaveLength(1);
        expect(list[0].GivenNumber).toBe(10);
    });

    it('reads object from top-level or wrapped response', () => {
        const topLevel = { SupplierInvoice: { GivenNumber: 22 } };
        const wrapped = { data: { SupplierInvoice: { GivenNumber: 33 } } };

        expect(getFortnoxObject<{ GivenNumber: number }>(topLevel, 'SupplierInvoice')?.GivenNumber).toBe(22);
        expect(getFortnoxObject<{ GivenNumber: number }>(wrapped, 'SupplierInvoice')?.GivenNumber).toBe(33);
    });

    it('returns empty defaults for invalid responses', () => {
        expect(getFortnoxList<unknown>(null, 'Invoices')).toEqual([]);
        expect(getFortnoxObject<unknown>(null, 'Invoice')).toBeNull();
        expect(getFortnoxList<unknown>({ data: {} }, 'Invoices')).toEqual([]);
    });
});

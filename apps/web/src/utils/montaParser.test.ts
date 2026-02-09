import { describe, it, expect } from 'vitest';

/**
 * Monta EV Charging Parser Logic Tests
 *
 * Tests the column-mapping and transaction-categorization logic
 * used by the analyze-excel-ai Edge Function for Monta exports.
 */

const MONTA_MAPPING = {
    amount: 'amount',
    net_amount: 'subAmount',
    vat_amount: 'vat',
    vat_rate: 'vatRate',
    kwh: 'kWh',
    date: 'startTime',
    description: 'chargePointName',
    roaming_operator: 'roamingOperator',
    roaming_price_group: 'roamingPriceGroupName',
};

const COLUMNS = [
    'transactionId', 'startTime', 'endTime', 'kWh',
    'subAmount', 'vat', 'vatRate', 'amount',
    'chargePointName', 'roamingOperator', 'roamingPriceGroupName',
];

function colIdx(name: string): number {
    return COLUMNS.indexOf(name);
}

interface ParsedTransaction {
    id: number;
    amount: number;
    net_amount: number;
    vat_amount: number;
    vat_rate: number;
    description: string;
    date: string;
    kwh: number;
    is_roaming: boolean;
    roaming_operator: string;
    type: 'sale' | 'cost';
    bas_account: string;
}

function parseMontaRows(rows: unknown[][]): ParsedTransaction[] {
    return rows.map((row, index) => {
        const r = row as string[];
        const amount = parseFloat(r[colIdx(MONTA_MAPPING.amount)] || '0');
        const roamingOp = r[colIdx(MONTA_MAPPING.roaming_operator)] || '';
        const isRoaming = !!roamingOp;
        const isCost = amount < 0;

        let basAccount: string;
        if (isCost) {
            const note = r[colIdx(MONTA_MAPPING.description)] || '';
            if (note.toLowerCase().includes('subscription')) basAccount = '6540';
            else basAccount = '6590';
        } else if (isRoaming) {
            basAccount = '3011';
        } else {
            basAccount = '3010';
        }

        return {
            id: index + 1,
            amount,
            net_amount: parseFloat(r[colIdx(MONTA_MAPPING.net_amount)] || '0'),
            vat_amount: parseFloat(r[colIdx(MONTA_MAPPING.vat_amount)] || '0'),
            vat_rate: parseFloat(r[colIdx(MONTA_MAPPING.vat_rate)] || '0'),
            description: r[colIdx(MONTA_MAPPING.description)] || 'Laddning',
            date: r[colIdx(MONTA_MAPPING.date)],
            kwh: parseFloat(r[colIdx(MONTA_MAPPING.kwh)] || '0'),
            is_roaming: isRoaming,
            roaming_operator: roamingOp,
            type: isCost ? 'cost' : 'sale',
            bas_account: basAccount,
        };
    });
}

describe('Monta EV Charging Parser', () => {
    describe('regular charging (private)', () => {
        const row = [
            '123', '2025-10-01T10:00:00Z', '2025-10-01T11:00:00Z', '20.5',
            '100.00', '25.00', '25', '125.00',
            'Hemma Laddare', '', '',
        ];

        it('parses amounts correctly', () => {
            const [tx] = parseMontaRows([row]);
            expect(tx.amount).toBe(125);
            expect(tx.net_amount).toBe(100);
            expect(tx.vat_amount).toBe(25);
            expect(tx.vat_rate).toBe(25);
        });

        it('detects as non-roaming sale', () => {
            const [tx] = parseMontaRows([row]);
            expect(tx.is_roaming).toBe(false);
            expect(tx.type).toBe('sale');
        });

        it('assigns BAS account 3010 (private charging)', () => {
            const [tx] = parseMontaRows([row]);
            expect(tx.bas_account).toBe('3010');
        });

        it('parses kWh', () => {
            const [tx] = parseMontaRows([row]);
            expect(tx.kwh).toBe(20.5);
        });
    });

    describe('roaming charging', () => {
        const row = [
            '456', '2025-10-02T12:00:00Z', '2025-10-02T13:00:00Z', '40.0',
            '200.00', '0.00', '0', '200.00',
            'Publik Laddare', 'Ionity', 'Roaming Group A',
        ];

        it('parses amounts correctly (0% VAT)', () => {
            const [tx] = parseMontaRows([row]);
            expect(tx.amount).toBe(200);
            expect(tx.net_amount).toBe(200);
            expect(tx.vat_amount).toBe(0);
            expect(tx.vat_rate).toBe(0);
        });

        it('detects as roaming sale', () => {
            const [tx] = parseMontaRows([row]);
            expect(tx.is_roaming).toBe(true);
            expect(tx.roaming_operator).toBe('Ionity');
            expect(tx.type).toBe('sale');
        });

        it('assigns BAS account 3011 (roaming export)', () => {
            const [tx] = parseMontaRows([row]);
            expect(tx.bas_account).toBe('3011');
        });
    });

    describe('cost transactions (negative amount)', () => {
        it('detects subscription fees (BAS 6540)', () => {
            const row = [
                '789', '2025-10-15T00:00:00Z', '', '0',
                '-99.00', '-24.75', '25', '-123.75',
                'SUBSCRIPTION fee', '', '',
            ];
            const [tx] = parseMontaRows([row]);
            expect(tx.type).toBe('cost');
            expect(tx.bas_account).toBe('6540');
            expect(tx.amount).toBe(-123.75);
        });

        it('detects platform fees (BAS 6590)', () => {
            const row = [
                '790', '2025-10-15T00:00:00Z', '', '0',
                '-50.00', '0.00', '0', '-50.00',
                'Platform fee', '', '',
            ];
            const [tx] = parseMontaRows([row]);
            expect(tx.type).toBe('cost');
            expect(tx.bas_account).toBe('6590');
        });
    });

    describe('batch parsing', () => {
        it('correctly parses mixed transactions', () => {
            const rows = [
                ['1', '2025-10-01T10:00:00Z', '', '20.5', '100.00', '25.00', '25', '125.00', 'Hemma', '', ''],
                ['2', '2025-10-02T12:00:00Z', '', '40.0', '200.00', '0.00', '0', '200.00', 'Publik', 'Ionity', 'Group A'],
                ['3', '2025-10-15T00:00:00Z', '', '0', '-99.00', '-24.75', '25', '-123.75', 'SUBSCRIPTION', '', ''],
            ];

            const transactions = parseMontaRows(rows);
            expect(transactions).toHaveLength(3);

            const sales = transactions.filter(t => t.type === 'sale');
            const costs = transactions.filter(t => t.type === 'cost');
            expect(sales).toHaveLength(2);
            expect(costs).toHaveLength(1);

            const roaming = transactions.filter(t => t.is_roaming);
            expect(roaming).toHaveLength(1);
            expect(roaming[0].roaming_operator).toBe('Ionity');
        });

        it('assigns sequential IDs', () => {
            const rows = [
                ['1', '', '', '0', '100', '25', '25', '125', 'A', '', ''],
                ['2', '', '', '0', '200', '0', '0', '200', 'B', 'Op', ''],
            ];
            const transactions = parseMontaRows(rows);
            expect(transactions[0].id).toBe(1);
            expect(transactions[1].id).toBe(2);
        });
    });

    describe('edge cases', () => {
        it('handles missing/empty values', () => {
            const row = ['', '', '', '', '', '', '', '', '', '', ''];
            const [tx] = parseMontaRows([row]);
            expect(tx.amount).toBe(0);
            expect(tx.net_amount).toBe(0);
            expect(tx.kwh).toBe(0);
            expect(tx.is_roaming).toBe(false);
        });

        it('handles empty rows array', () => {
            const transactions = parseMontaRows([]);
            expect(transactions).toHaveLength(0);
        });
    });
});

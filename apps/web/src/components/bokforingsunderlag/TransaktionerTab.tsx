import { FunctionComponent } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import type { VATReportData } from '../../types/vat';

interface TransaktionerTabProps {
    data: VATReportData;
}

interface FlatTransaction {
    type: 'sale' | 'cost';
    description: string;
    net: number;
    vat: number;
    gross: number;
    rate: number;
}

const fmt = (v: number) => v.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const TransaktionerTab: FunctionComponent<TransaktionerTabProps> = ({ data }) => {
    const [filter, setFilter] = useState<'all' | 'sale' | 'cost'>('all');
    const [searchQuery, setSearchQuery] = useState('');

    const allTransactions = useMemo((): FlatTransaction[] => {
        const sales: FlatTransaction[] = data.sales.map(s => ({
            type: 'sale' as const,
            description: s.description,
            net: s.net,
            vat: s.vat,
            gross: s.net + s.vat,
            rate: s.rate,
        }));

        const costs: FlatTransaction[] = data.costs.map(c => ({
            type: 'cost' as const,
            description: c.description,
            net: -Math.abs(c.net),
            vat: -Math.abs(c.vat),
            gross: -(Math.abs(c.net) + Math.abs(c.vat)),
            rate: c.rate,
        }));

        return [...sales, ...costs];
    }, [data]);

    const filtered = useMemo(() => {
        let result = allTransactions;
        if (filter !== 'all') {
            result = result.filter(t => t.type === filter);
        }
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            result = result.filter(t => t.description.toLowerCase().includes(q));
        }
        return result;
    }, [allTransactions, filter, searchQuery]);

    const totals = useMemo(() => ({
        net: filtered.reduce((sum, t) => sum + t.net, 0),
        vat: filtered.reduce((sum, t) => sum + t.vat, 0),
        gross: filtered.reduce((sum, t) => sum + t.gross, 0),
    }), [filtered]);

    return (
        <div class="bfu-transaktioner">
            {/* Filter bar */}
            <div class="bfu-tx-filters">
                <div class="bfu-tx-filter-buttons">
                    <button
                        class={`bfu-tx-filter-btn ${filter === 'all' ? 'active' : ''}`}
                        onClick={() => setFilter('all')}
                    >
                        Alla ({allTransactions.length})
                    </button>
                    <button
                        class={`bfu-tx-filter-btn ${filter === 'sale' ? 'active' : ''}`}
                        onClick={() => setFilter('sale')}
                    >
                        Intäkter ({allTransactions.filter(t => t.type === 'sale').length})
                    </button>
                    <button
                        class={`bfu-tx-filter-btn ${filter === 'cost' ? 'active' : ''}`}
                        onClick={() => setFilter('cost')}
                    >
                        Kostnader ({allTransactions.filter(t => t.type === 'cost').length})
                    </button>
                </div>
                <input
                    type="text"
                    class="bfu-tx-search"
                    placeholder="Sök transaktion..."
                    value={searchQuery}
                    onInput={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
                />
            </div>

            {/* Table */}
            <div class="bfu-tx-table-wrapper">
                <table class="bfu-tx-table">
                    <thead>
                        <tr>
                            <th class="col-type">Typ</th>
                            <th class="col-desc">Beskrivning</th>
                            <th class="col-amount">Netto</th>
                            <th class="col-amount">Moms</th>
                            <th class="col-amount">Brutto</th>
                            <th class="col-rate">%</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filtered.map((tx, i) => (
                            <tr key={i} class={tx.type === 'cost' ? 'row-cost' : 'row-sale'}>
                                <td class="col-type">
                                    <span class={`bfu-tx-type-badge ${tx.type}`}>
                                        {tx.type === 'sale' ? 'Intäkt' : 'Kostnad'}
                                    </span>
                                </td>
                                <td class="col-desc">{tx.description}</td>
                                <td class="col-amount">{fmt(tx.net)} kr</td>
                                <td class="col-amount">{fmt(tx.vat)} kr</td>
                                <td class="col-amount">{fmt(tx.gross)} kr</td>
                                <td class="col-rate">{tx.rate}%</td>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot>
                        <tr class="bfu-tx-total">
                            <td></td>
                            <td>Totalt ({filtered.length} transaktioner)</td>
                            <td class="col-amount">{fmt(totals.net)} kr</td>
                            <td class="col-amount">{fmt(totals.vat)} kr</td>
                            <td class="col-amount">{fmt(totals.gross)} kr</td>
                            <td></td>
                        </tr>
                    </tfoot>
                </table>
            </div>

            {filtered.length === 0 && (
                <div class="bfu-empty">
                    {searchQuery ? 'Inga transaktioner matchade din sökning.' : 'Inga transaktioner hittades.'}
                </div>
            )}
        </div>
    );
};

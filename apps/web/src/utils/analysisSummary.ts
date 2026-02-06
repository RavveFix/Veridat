import type { AnalysisSummary } from '../types/vat';

export function buildAnalysisSummary(
    transactions: Array<Record<string, unknown>>,
    metadata?: Record<string, unknown>
): AnalysisSummary | undefined {
    if (!transactions || transactions.length === 0) return undefined;

    const categoryLabels: Record<string, string> = {
        private_charging: 'Privatladdning',
        roaming_export: 'Inkommande roaming (CPO)',
        subscription: 'Operatörsabonnemang',
        operator_fee: 'Laddningsavgift (%)',
        platform_fee: 'Transaktionsavgifter',
        roaming_fee: 'Roamingavgifter'
    };

    const costMap = new Map<string, { amount: number; count: number }>();
    const revenueMap = new Map<string, { amount: number; count: number }>();

    let costCount = 0;
    let revenueCount = 0;
    let zeroVatCount = 0;
    let zeroVatAmount = 0;

    let montaSummary: AnalysisSummary['monta'] | undefined;

    const addToMap = (map: Map<string, { amount: number; count: number }>, label: string, amount: number) => {
        const existing = map.get(label);
        if (existing) {
            existing.amount += amount;
            existing.count += 1;
        } else {
            map.set(label, { amount, count: 1 });
        }
    };

    const normalizeLabel = (tx: Record<string, unknown>): string => {
        const rawCategory = String(tx.category || '').trim();
        if (rawCategory && categoryLabels[rawCategory]) {
            return categoryLabels[rawCategory];
        }
        const desc = String(tx.description || tx.transactionName || tx.note || 'Okänd').trim();
        if (!desc) return 'Okänd';
        return desc.length > 48 ? `${desc.slice(0, 45)}…` : desc;
    };

    const hasMonta = transactions.some(tx => {
        const category = String(tx.category || '');
        return category in categoryLabels;
    }) || String(metadata?.file_type || '').includes('monta');

    if (hasMonta) {
        montaSummary = {
            platform_fee: 0,
            operator_fee: 0,
            subscription: 0,
            roaming_revenue: 0,
            charging_revenue: 0,
            zero_vat_amount: 0
        };
    }

    for (const tx of transactions) {
        const amount = Number(tx.amount ?? 0);
        const netAmount = Number(tx.net_amount ?? amount ?? 0);
        const vatAmount = Number(tx.vat_amount ?? 0);
        const vatRate = Number(tx.vat_rate ?? 0);
        const isCost = tx.type === 'cost' || amount < 0 || netAmount < 0;
        const absoluteNet = Math.abs(netAmount || amount || 0);
        const label = normalizeLabel(tx);

        if (isCost) {
            costCount += 1;
            addToMap(costMap, label, absoluteNet);
        } else {
            revenueCount += 1;
            addToMap(revenueMap, label, absoluteNet);
        }

        if (Math.abs(vatAmount) < 0.0001 || vatRate === 0) {
            zeroVatCount += 1;
            zeroVatAmount += absoluteNet;
            if (montaSummary) {
                montaSummary.zero_vat_amount += absoluteNet;
            }
        }

        if (montaSummary) {
            const category = String(tx.category || '');
            if (category === 'platform_fee') {
                montaSummary.platform_fee += absoluteNet;
            } else if (category === 'operator_fee') {
                montaSummary.operator_fee += absoluteNet;
            } else if (category === 'subscription') {
                montaSummary.subscription += absoluteNet;
            } else if (category === 'roaming_export') {
                montaSummary.roaming_revenue += absoluteNet;
            } else if (category === 'private_charging') {
                montaSummary.charging_revenue += absoluteNet;
            }
        }
    }

    const toTopList = (map: Map<string, { amount: number; count: number }>) =>
        Array.from(map.entries())
            .map(([label, values]) => ({
                label,
                amount: Number(values.amount.toFixed(2)),
                count: values.count
            }))
            .sort((a, b) => b.amount - a.amount)
            .slice(0, 4);

    return {
        total_transactions: transactions.length,
        cost_transactions: costCount,
        revenue_transactions: revenueCount,
        zero_vat_count: zeroVatCount,
        zero_vat_amount: Number(zeroVatAmount.toFixed(2)),
        top_costs: toTopList(costMap),
        top_revenues: toTopList(revenueMap),
        monta: montaSummary
    };
}

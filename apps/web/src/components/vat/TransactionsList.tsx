import { FunctionComponent } from 'preact';
import type { SalesTransaction, CostTransaction } from '../../types/vat';

export const TransactionsList: FunctionComponent<{
    transactions: SalesTransaction[] | CostTransaction[]
}> = ({ transactions }) => {
    if (!transactions || transactions.length === 0) {
        return <div class="no-transactions">Inga transaktioner</div>;
    }

    return (
        <>
            {transactions.map((t, index) => (
                <div key={index} class="transaction-row">
                    <span class="transaction-desc">{t.description}</span>
                    <span class="transaction-amount">
                        {t.net.toFixed(2)} SEK ({t.rate}% moms)
                    </span>
                </div>
            ))}
        </>
    );
};

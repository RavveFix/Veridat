import { FunctionComponent } from 'preact';
import type { JournalEntry } from '../../types/vat';
import { BAS_ACCOUNT_INFO } from '../../types/vat';

export const JournalEntriesList: FunctionComponent<{
    entries: JournalEntry[]
}> = ({ entries }) => {
    if (!entries || entries.length === 0) {
        return <div class="no-transactions">Inga bokföringsförslag</div>;
    }

    return (
        <div class="journal-entries">
            <div class="journal-header">
                <span>Konto</span>
                <span>Namn</span>
                <span>Debet</span>
                <span>Kredit</span>
            </div>
            {entries.map((entry, index) => (
                <div key={index} class="journal-row">
                    <span
                        class="account-with-tooltip"
                        title={BAS_ACCOUNT_INFO[entry.account] || entry.name}
                    >
                        {entry.account}
                        {BAS_ACCOUNT_INFO[entry.account] && <span class="tooltip-icon">i</span>}
                    </span>
                    <span class="journal-name">{entry.name}</span>
                    <span class="journal-debit">
                        {entry.debit > 0 ? entry.debit.toFixed(2) : '-'}
                    </span>
                    <span class="journal-credit">
                        {entry.credit > 0 ? entry.credit.toFixed(2) : '-'}
                    </span>
                </div>
            ))}
        </div>
    );
};

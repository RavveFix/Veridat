import { FunctionComponent } from 'preact';
import { useState } from 'preact/hooks';
import { BorderBeam } from '@/registry/magicui/border-beam';

export interface JournalEntry {
    account: string;
    accountName: string;
    debit: number;
    credit: number;
    description: string;
}

export interface JournalValidation {
    balanced: boolean;
    totalDebit: number;
    totalCredit: number;
    difference: number;
}

export interface JournalTransaction {
    type: 'revenue' | 'expense';
    gross_amount: number;
    vat_rate: number;
    description: string;
}

interface JournalEntryCardProps {
    verificationId: string;
    entries: JournalEntry[];
    validation: JournalValidation;
    transaction: JournalTransaction;
}

const formatAmount = (amount: number): string => {
    return new Intl.NumberFormat('sv-SE', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(amount);
};

const JOURNAL_ACTION_CONTENT_STYLE = {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
};

export const JournalEntryCard: FunctionComponent<JournalEntryCardProps> = ({
    verificationId,
    entries,
    validation,
    transaction,
}) => {
    const [copied, setCopied] = useState(false);
    const [isHovered, setIsHovered] = useState(false);

    const typeLabel = transaction.type === 'revenue' ? 'Intäkt' : 'Kostnad';

    const handleCopy = () => {
        const header = `Verifikat: ${verificationId}\n${typeLabel}: ${formatAmount(transaction.gross_amount)} kr inkl moms (${transaction.vat_rate}%)\n\n`;
        const tableHeader = 'Konto\tKontonamn\tDebet\tKredit\n';
        const rows = entries.map(e =>
            `${e.account}\t${e.accountName}\t${e.debit > 0 ? formatAmount(e.debit) : ''}\t${e.credit > 0 ? formatAmount(e.credit) : ''}`
        ).join('\n');
        const footer = `\nSumma\t\t${formatAmount(validation.totalDebit)}\t${formatAmount(validation.totalCredit)}`;

        navigator.clipboard.writeText(header + tableHeader + rows + footer);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div
            class={`journal-entry-card ${isHovered ? 'hovered' : ''}`}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            <BorderBeam
                size={120}
                duration={10}
                delay={0}
                colorFrom="var(--accent-primary)"
                colorTo="var(--accent-secondary)"
            />

            {/* Header */}
            <div class="journal-entry-header">
                <div class="journal-entry-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                </div>
                <div class="journal-entry-title-area">
                    <span class="journal-entry-title">Verifikat {verificationId}</span>
                    <span class="journal-entry-subtitle">
                        {typeLabel} {formatAmount(transaction.gross_amount)} kr inkl moms ({transaction.vat_rate}%)
                    </span>
                </div>
            </div>

            {/* Table */}
            <div class="journal-table-wrapper">
                <table class="journal-table">
                    <thead>
                        <tr>
                            <th class="col-account">Konto</th>
                            <th class="col-name">Kontonamn</th>
                            <th class="col-amount">Debet</th>
                            <th class="col-amount">Kredit</th>
                        </tr>
                    </thead>
                    <tbody>
                        {entries.map((entry, i) => (
                            <tr key={i}>
                                <td class="col-account">{entry.account}</td>
                                <td class="col-name">{entry.accountName}</td>
                                <td class="col-amount">
                                    {entry.debit > 0 ? formatAmount(entry.debit) : '\u2014'}
                                </td>
                                <td class="col-amount">
                                    {entry.credit > 0 ? formatAmount(entry.credit) : '\u2014'}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot>
                        <tr class="journal-total-row">
                            <td class="col-account"></td>
                            <td class="col-name">
                                <strong>Summa</strong>
                                {validation.balanced ? (
                                    <span class="journal-balance-ok">Balanserad</span>
                                ) : (
                                    <span class="journal-balance-error">Ej balanserad</span>
                                )}
                            </td>
                            <td class="col-amount"><strong>{formatAmount(validation.totalDebit)}</strong></td>
                            <td class="col-amount"><strong>{formatAmount(validation.totalCredit)}</strong></td>
                        </tr>
                    </tfoot>
                </table>
            </div>

            {/* Actions */}
            <div class="journal-entry-actions">
                <button class="journal-action-btn" onClick={handleCopy}>
                    {copied ? (
                        <span style={JOURNAL_ACTION_CONTENT_STYLE}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                                <polyline points="20 6 9 17 4 12"></polyline>
                            </svg>
                            Kopierat
                        </span>
                    ) : (
                        <span style={JOURNAL_ACTION_CONTENT_STYLE}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                            Kopiera
                        </span>
                    )}
                </button>
            </div>
        </div>
    );
};

export default JournalEntryCard;

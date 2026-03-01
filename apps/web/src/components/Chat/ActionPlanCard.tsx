import { FunctionComponent } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { BorderBeam } from '@/registry/magicui/border-beam';

export interface PostingRow {
    account: string;
    accountName: string;
    debit: number;
    credit: number;
    comment?: string;
}

export interface ActionPlanAction {
    id: string;
    action_type: string;
    description: string;
    parameters: Record<string, unknown>;
    posting_rows?: PostingRow[];
    confidence?: number;
    status: 'pending' | 'approved' | 'executed' | 'failed';
}

export interface ActionPlanData {
    type: 'action_plan';
    plan_id: string;
    status: 'pending' | 'approved' | 'rejected' | 'executed' | 'partial';
    summary: string;
    actions: ActionPlanAction[];
    assumptions?: string[];
    execution_results?: Array<{
        action_id: string;
        success: boolean;
        result?: string;
        error?: string;
    }>;
}

interface ActionPlanCardProps {
    plan: ActionPlanData;
    onRespond: (planId: string, decision: 'approved' | 'rejected', modifications?: Record<string, unknown>) => void;
}

const formatAmount = (amount: number): string => {
    if (!amount || amount === 0) return '\u2014';
    return new Intl.NumberFormat('sv-SE', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(amount);
};

const ACTION_TYPE_LABELS: Record<string, string> = {
    create_supplier_invoice: 'Skapa leverantörsfaktura',
    create_invoice: 'Skapa kundfaktura',
    export_journal_to_fortnox: 'Exportera verifikat',
    book_invoice: 'Bokför verifikat',
    book_supplier_invoice: 'Bokför faktura',
    create_supplier: 'Skapa leverantör',
    register_payment: 'Registrera betalning',
};

const STATUS_LABELS: Record<string, string> = {
    pending: 'Väntar på godkännande',
    approved: 'Godkänd',
    rejected: 'Avbruten',
    executed: 'Utförd',
    partial: 'Delvis utförd',
};

const friendlyError = (error: string): string => {
    if (error.includes('CustomerNumber')) return 'Kundnummer saknas — kontrollera att kunden finns i Fortnox';
    if (error.includes('SupplierNumber')) return 'Leverantörsnummer saknas';
    if (error.includes('InvoiceRows')) return 'Fakturarader saknas';
    if (error.includes('rate limit')) return 'För många anrop — försök igen om en stund';
    if (error.includes('token')) return 'Fortnox-anslutningen har gått ut — återanslut i inställningar';
    return error;
};

const FLEX_CENTER_STYLE = {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
};

export const ActionPlanCard: FunctionComponent<ActionPlanCardProps> = ({
    plan,
    onRespond,
}) => {
    const [isHovered, setIsHovered] = useState(false);
    const [responding, setResponding] = useState(false);

    const isPending = plan.status === 'pending';
    const isExecuted = plan.status === 'executed';
    const isRejected = plan.status === 'rejected';

    // Collect all posting rows from all actions
    const allPostingRows = plan.actions.flatMap(a => a.posting_rows || []);
    const totalDebit = allPostingRows.reduce((sum, r) => sum + (r.debit || 0), 0);
    const totalCredit = allPostingRows.reduce((sum, r) => sum + (r.credit || 0), 0);
    const isBalanced = Math.abs(totalDebit - totalCredit) < 0.02;

    // Reset responding when plan status changes (executed/rejected) or on timeout
    useEffect(() => {
        if (!isPending && responding) {
            setResponding(false);
        }
    }, [plan.status]);

    useEffect(() => {
        if (!responding) return;
        const timeout = setTimeout(() => setResponding(false), 15000);
        return () => clearTimeout(timeout);
    }, [responding]);

    const handleApprove = () => {
        if (responding) return;
        setResponding(true);
        onRespond(plan.plan_id, 'approved');
    };

    const handleReject = () => {
        if (responding) return;
        setResponding(true);
        onRespond(plan.plan_id, 'rejected');
    };

    const statusClass = isExecuted ? 'status-executed' : isRejected ? 'status-rejected' : '';

    return (
        <div
            class={`action-plan-card ${statusClass} ${isHovered ? 'hovered' : ''}`}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            <BorderBeam
                size={120}
                duration={10}
                delay={0}
                colorFrom={isPending ? '#f59e0b' : isExecuted ? '#10b981' : '#6b7280'}
                colorTo={isPending ? '#f97316' : isExecuted ? '#059669' : '#9ca3af'}
            />

            {/* Header */}
            <div class="action-plan-header">
                <div class="action-plan-icon">
                    {isPending ? (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                            <line x1="16" y1="13" x2="8" y2="13" />
                            <line x1="16" y1="17" x2="8" y2="17" />
                        </svg>
                    ) : isExecuted ? (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                            <polyline points="20 6 9 17 4 12" />
                        </svg>
                    ) : (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10" />
                            <line x1="15" y1="9" x2="9" y2="15" />
                            <line x1="9" y1="9" x2="15" y2="15" />
                        </svg>
                    )}
                </div>
                <div class="action-plan-title-area">
                    <span class="action-plan-title">
                        {isPending ? 'Handlingsplan' : STATUS_LABELS[plan.status] || plan.status}
                        {plan.actions[0]?.confidence != null && (
                            <span class={`confidence-pill ${plan.actions[0].confidence >= 0.8 ? 'high' : plan.actions[0].confidence >= 0.5 ? 'medium' : 'low'}`}>
                                {Math.round(plan.actions[0].confidence * 100)}% säkerhet
                            </span>
                        )}
                    </span>
                    <span class="action-plan-subtitle">{plan.summary}</span>
                </div>
            </div>

            {/* Steps */}
            {plan.actions.length > 1 && (
                <div class="action-plan-steps">
                    {plan.actions.map((action, i) => {
                        const execResult = plan.execution_results?.find(r => r.action_id === action.id);
                        return (
                            <div key={action.id} class="action-plan-step">
                                <span class="step-number">
                                    {execResult?.success ? (
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5">
                                            <polyline points="20 6 9 17 4 12" />
                                        </svg>
                                    ) : execResult && !execResult.success ? (
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2">
                                            <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                                        </svg>
                                    ) : (
                                        <span class="step-number-text">{i + 1}</span>
                                    )}
                                </span>
                                <span class="step-label">
                                    {ACTION_TYPE_LABELS[action.action_type] || action.action_type}: {action.description}
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Posting Table */}
            {allPostingRows.length > 0 && (
                <div class="journal-table-wrapper">
                    <table class="journal-table">
                        <thead>
                            <tr>
                                <th class="col-account">Konto</th>
                                <th class="col-name">Kontonamn</th>
                                <th class="col-amount">Debet</th>
                                <th class="col-amount">Kredit</th>
                                <th class="col-comment">Kommentar</th>
                            </tr>
                        </thead>
                        <tbody>
                            {allPostingRows.map((row, i) => (
                                <tr key={i}>
                                    <td class="col-account">{row.account}</td>
                                    <td class="col-name">{row.accountName}</td>
                                    <td class="col-amount">{formatAmount(row.debit)}</td>
                                    <td class="col-amount">{formatAmount(row.credit)}</td>
                                    <td class="col-comment">{row.comment || '\u2014'}</td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr class="journal-total-row">
                                <td class="col-account" />
                                <td class="col-name">
                                    <strong>Summa</strong>
                                    {isBalanced ? (
                                        <span class="journal-balance-ok">Balanserad</span>
                                    ) : (
                                        <span class="journal-balance-error">Ej balanserad</span>
                                    )}
                                </td>
                                <td class="col-amount"><strong>{formatAmount(totalDebit)}</strong></td>
                                <td class="col-amount"><strong>{formatAmount(totalCredit)}</strong></td>
                                <td class="col-comment" />
                            </tr>
                        </tfoot>
                    </table>
                </div>
            )}

            {/* Assumptions */}
            {plan.assumptions && plan.assumptions.length > 0 && (
                <div class="action-plan-assumptions">
                    <span class="assumptions-label">Antaganden:</span>
                    <ul class="assumptions-list">
                        {plan.assumptions.map((assumption, i) => (
                            <li key={i}>{assumption}</li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Execution Results */}
            {plan.execution_results && plan.execution_results.length > 0 && (() => {
                const successCount = plan.execution_results!.filter(r => r.success).length;
                const errors = plan.execution_results!.filter(r => !r.success);
                const successes = plan.execution_results!.filter(r => r.success);
                return (
                    <div class="action-plan-results">
                        <span class="results-summary">
                            {successCount} av {plan.execution_results!.length} åtgärder lyckades
                        </span>
                        {errors.map((result) => (
                            <div key={result.action_id} class="result-item error">
                                {friendlyError(result.error || 'Okänt fel')}
                            </div>
                        ))}
                        {successes.map((result) => (
                            <div key={result.action_id} class="result-item success">
                                {result.result}
                            </div>
                        ))}
                    </div>
                );
            })()}

            {/* Actions */}
            {isPending && (
                <div class="action-plan-actions">
                    <button
                        class="action-plan-btn approve"
                        onClick={handleApprove}
                        disabled={responding}
                    >
                        {responding ? (
                            <span style={FLEX_CENTER_STYLE}>
                                <span class="btn-spinner-small" />
                                Utför...
                            </span>
                        ) : (
                            <span style={FLEX_CENTER_STYLE}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                                    <polyline points="20 6 9 17 4 12" />
                                </svg>
                                Godkänn
                            </span>
                        )}
                    </button>
                    <button
                        class="action-plan-btn reject"
                        onClick={handleReject}
                        disabled={responding}
                    >
                        <span style={FLEX_CENTER_STYLE}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                            Avbryt
                        </span>
                    </button>
                </div>
            )}
        </div>
    );
};

export default ActionPlanCard;

/**
 * ReportsPage - Sammanslår VATReportFromFortnoxPanel och FinancialStatementsPanel
 * i en flik-baserad vy.
 */

import { FunctionComponent } from 'preact';
import { useState } from 'preact/hooks';
import { VATReportFromFortnoxPanel } from '../VATReportFromFortnoxPanel';
import { FinancialStatementsPanel } from '../FinancialStatementsPanel';

type ReportsTab = 'vat' | 'financial';

interface TabConfig {
    id: ReportsTab;
    label: string;
}

const TABS: TabConfig[] = [
    { id: 'vat', label: 'Moms' },
    { id: 'financial', label: 'Resultat & Balans' },
];

export const ReportsPage: FunctionComponent = () => {
    const [activeTab, setActiveTab] = useState<ReportsTab>('vat');

    return (
        <div class="page-wrapper">
            <div class="page-tab-bar">
                {TABS.map((tab) => (
                    <button
                        key={tab.id}
                        class={`page-tab${activeTab === tab.id ? ' page-tab--active' : ''}`}
                        onClick={() => setActiveTab(tab.id)}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>
            <div class="page-content">
                {activeTab === 'vat' && <VATReportFromFortnoxPanel />}
                {activeTab === 'financial' && <FinancialStatementsPanel />}
            </div>
        </div>
    );
};

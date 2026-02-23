/**
 * BankPage - Sammanslår BankImportPanel och ReconciliationView
 * i en flik-baserad vy.
 */

import { FunctionComponent } from 'preact';
import { useState } from 'preact/hooks';
import { BankImportPanel } from '../BankImportPanel';
import { ReconciliationView } from '../ReconciliationView';

type BankTab = 'import' | 'reconciliation';

interface TabConfig {
    id: BankTab;
    label: string;
}

const TABS: TabConfig[] = [
    { id: 'import', label: 'Importera' },
    { id: 'reconciliation', label: 'Avstämning' },
];

export const BankPage: FunctionComponent = () => {
    const [activeTab, setActiveTab] = useState<BankTab>('import');

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
                {activeTab === 'import' && <BankImportPanel />}
                {activeTab === 'reconciliation' && (
                    <ReconciliationView onOpenBankImport={() => setActiveTab('import')} />
                )}
            </div>
        </div>
    );
};

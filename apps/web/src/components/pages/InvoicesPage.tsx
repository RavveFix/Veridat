/**
 * InvoicesPage - Sammanslår FortnoxPanel, InvoiceInboxPanel och ReceiptInboxTab
 * i en flik-baserad vy.
 */

import { FunctionComponent } from 'preact';
import { useState } from 'preact/hooks';
import { FortnoxPanel } from '../FortnoxPanel';
import { InvoiceInboxPanel } from '../InvoiceInboxPanel';
import { ReceiptInboxTab } from '../ReceiptInboxTab';

type InvoicesTab = 'fortnox' | 'upload' | 'receipts';

interface TabConfig {
    id: InvoicesTab;
    label: string;
}

const TABS: TabConfig[] = [
    { id: 'fortnox', label: 'Fakturor' },
    { id: 'upload', label: 'Ladda upp' },
    { id: 'receipts', label: 'Kvitton' },
];

export const InvoicesPage: FunctionComponent = () => {
    const [activeTab, setActiveTab] = useState<InvoicesTab>('fortnox');

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
                {activeTab === 'fortnox' && <FortnoxPanel />}
                {activeTab === 'upload' && <InvoiceInboxPanel embedded />}
                {activeTab === 'receipts' && <ReceiptInboxTab />}
            </div>
        </div>
    );
};

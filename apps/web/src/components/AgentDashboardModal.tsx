/**
 * AgentDashboardModal — Standalone modal for the simplified Agent Dashboard.
 */

import { ModalWrapper } from './ModalWrapper';
import { AgentDashboard } from './settings/AgentDashboard';

interface AgentDashboardModalProps {
    onClose: () => void;
}

export function AgentDashboardModal({ onClose }: AgentDashboardModalProps) {
    return (
        <ModalWrapper
            onClose={onClose}
            title="Bokföringsstatus"
            subtitle="Se status och varningar för din bokföring."
            maxWidth="700px"
        >
            <AgentDashboard />
        </ModalWrapper>
    );
}

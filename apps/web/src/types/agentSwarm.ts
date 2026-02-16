/**
 * Agent Swarm Types — Frontend type definitions
 */

export type AgentType = 'faktura' | 'bank' | 'moms' | 'bokforings' | 'guardian' | 'agi';

export type TaskStatus = 'pending' | 'claimed' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface AgentTask {
    id: string;
    agent_type: AgentType;
    status: TaskStatus;
    priority: number;
    input_payload: Record<string, unknown>;
    output_payload: Record<string, unknown> | null;
    error_code: string | null;
    error_message: string | null;
    retry_count: number;
    max_retries: number;
    scheduled_at: string;
    started_at: string | null;
    finished_at: string | null;
    parent_task_id: string | null;
    ai_decision_id: string | null;
    created_at: string;
}

export interface AgentRegistryEntry {
    agent_type: AgentType;
    display_name: string;
    description: string;
    edge_function: string;
    schedule_cron: string | null;
    enabled: boolean;
    config: Record<string, unknown>;
    last_run_at: string | null;
    created_at: string;
}

export interface AgentDispatchRequest {
    agent_type: AgentType;
    company_id?: string;
    input_payload?: Record<string, unknown>;
    priority?: number;
}

export interface AgentTasksFilter {
    agent_type?: AgentType;
    status?: TaskStatus;
    limit?: number;
    company_id?: string;
}

export const AGENT_DISPLAY_INFO: Record<AgentType, { icon: string; color: string }> = {
    faktura: { icon: '📄', color: '#4A90D9' },
    bank: { icon: '🏦', color: '#50C878' },
    moms: { icon: '📊', color: '#FFB347' },
    bokforings: { icon: '📒', color: '#87CEEB' },
    guardian: { icon: '🛡️', color: '#DA70D6' },
    agi: { icon: '📋', color: '#F0E68C' },
};

export const STATUS_DISPLAY: Record<TaskStatus, { label: string; color: string }> = {
    pending: { label: 'Väntar', color: '#888' },
    claimed: { label: 'Claimad', color: '#FFB347' },
    running: { label: 'Kör', color: '#4A90D9' },
    succeeded: { label: 'Klar', color: '#50C878' },
    failed: { label: 'Misslyckad', color: '#E74C3C' },
    cancelled: { label: 'Avbruten', color: '#999' },
};

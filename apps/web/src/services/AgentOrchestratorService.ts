/**
 * Agent Orchestrator Service — Frontend client for agent swarm
 */

import { supabase } from '../lib/supabase';
import { logger } from './LoggerService';
import type {
    AgentType,
    TaskStatus,
    AgentTask,
    AgentRegistryEntry,
    AgentDispatchRequest,
    AgentTasksFilter,
} from '../types/agentSwarm';

const ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/agent-orchestrator`;

interface OrchestratorPayload {
    action: string;
    agent_type?: AgentType;
    company_id?: string;
    task_id?: string;
    input_payload?: Record<string, unknown>;
    priority?: number;
    enabled?: boolean;
    status?: TaskStatus;
    limit?: number;
}

class AgentOrchestratorService {
    private async request<T>(payload: OrchestratorPayload): Promise<T> {
        const {
            data: { session },
        } = await supabase.auth.getSession();

        if (!session) {
            throw new Error('Inte inloggad.');
        }

        const response = await fetch(ENDPOINT, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${session.access_token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;

        if (!response.ok) {
            const message = typeof body.error === 'string' ? body.error : 'Agent-begäran misslyckades';
            logger.warn('Agent orchestrator request failed', { payload: payload.action, message });
            throw new Error(message);
        }

        return body as T;
    }

    /**
     * Dispatch a new task for an agent
     */
    async dispatch(req: AgentDispatchRequest): Promise<{ ok: boolean; task: AgentTask }> {
        return this.request({
            action: 'dispatch',
            agent_type: req.agent_type,
            company_id: req.company_id,
            input_payload: req.input_payload,
            priority: req.priority,
        });
    }

    /**
     * List tasks with optional filters
     */
    async listTasks(filter?: AgentTasksFilter): Promise<{ tasks: AgentTask[] }> {
        return this.request({
            action: 'list_tasks',
            agent_type: filter?.agent_type,
            status: filter?.status,
            limit: filter?.limit,
            company_id: filter?.company_id,
        });
    }

    /**
     * List all registered agents
     */
    async listAgents(): Promise<{ agents: AgentRegistryEntry[] }> {
        return this.request({ action: 'list_agents' });
    }

    /**
     * Toggle agent enabled/disabled (admin only)
     */
    async toggleAgent(agentType: AgentType, enabled: boolean): Promise<{ ok: boolean; agent: AgentRegistryEntry }> {
        return this.request({
            action: 'toggle_agent',
            agent_type: agentType,
            enabled,
        });
    }

    /**
     * Cancel a pending task
     */
    async cancelTask(taskId: string): Promise<{ ok: boolean; task: { id: string; status: string } }> {
        return this.request({
            action: 'cancel_task',
            task_id: taskId,
        });
    }

    /**
     * Retry a failed task
     */
    async retryTask(taskId: string): Promise<{ ok: boolean; task: { id: string; status: string; retry_count: number } }> {
        return this.request({
            action: 'retry_task',
            task_id: taskId,
        });
    }
}

export const agentOrchestratorService = new AgentOrchestratorService();

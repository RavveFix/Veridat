import { supabase } from '../lib/supabase';
import { logger } from './LoggerService';
import type { SkillApproval, SkillDefinition, SkillRun, SkillRunStatus, SkillStatus } from '../types/skills';

type CreateSkillInput = {
    name: string;
    description?: string;
    kind?: 'skill' | 'automation';
    status?: SkillStatus;
    scope?: 'user' | 'company' | 'org';
    visibility?: 'private' | 'company' | 'org';
    input_schema?: Record<string, unknown>;
    output_schema?: Record<string, unknown>;
    allowed_actions?: string[];
    requires_approval?: boolean;
};

type UpdateSkillInput = Partial<CreateSkillInput>;

type CreateRunInput = {
    input_payload: Record<string, unknown>;
    preview_output?: Record<string, unknown> | null;
    status?: SkillRunStatus;
    triggered_by?: 'user' | 'ai' | 'schedule' | 'system';
    ai_decision_id?: string | null;
};

type UpdateRunInput = {
    status?: SkillRunStatus;
    preview_output?: Record<string, unknown> | null;
    output_payload?: Record<string, unknown> | null;
    error_code?: string | null;
    error_message?: string | null;
    finished_at?: string | null;
};

type RequestApprovalInput = {
    required_role?: string;
    required_count?: number;
    expires_at?: string | null;
};

type ApprovalDecisionInput = {
    comment?: string | null;
};

interface SkillsResponse {
    skills?: SkillDefinition[];
    skill?: SkillDefinition;
    runs?: SkillRun[];
    run?: SkillRun;
    approval?: SkillApproval;
    approvals?: SkillApproval[];
    error?: string;
}

const SKILLS_ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/skills-service`;

class SkillServiceClass {
    private async request(body: Record<string, unknown>): Promise<SkillsResponse> {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
            throw new Error('Not authenticated');
        }

        const response = await fetch(SKILLS_ENDPOINT, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${session.access_token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        const payload = await response.json().catch(() => ({})) as SkillsResponse;

        if (!response.ok) {
            const message = payload.error || 'Skills service error';
            logger.warn('Skills service request failed', { message, body });
            throw new Error(message);
        }

        return payload;
    }

    async listSkills(companyId: string, status?: SkillStatus): Promise<SkillDefinition[]> {
        const response = await this.request({
            action: 'list_skills',
            company_id: companyId,
            status
        });
        return response.skills ?? [];
    }

    async listHub(companyId: string): Promise<{ skills: SkillDefinition[]; runs: SkillRun[]; approvals: SkillApproval[] }> {
        const response = await this.request({
            action: 'list_hub',
            company_id: companyId
        });
        return {
            skills: response.skills ?? [],
            runs: response.runs ?? [],
            approvals: response.approvals ?? []
        };
    }

    async getSkill(skillId: string): Promise<SkillDefinition> {
        const response = await this.request({
            action: 'get_skill',
            skill_id: skillId
        });
        if (!response.skill) {
            throw new Error('Skill not found');
        }
        return response.skill;
    }

    async createSkill(companyId: string, input: CreateSkillInput): Promise<SkillDefinition> {
        const response = await this.request({
            action: 'create_skill',
            company_id: companyId,
            payload: input
        });
        if (!response.skill) {
            throw new Error('Skill creation failed');
        }
        return response.skill;
    }

    async updateSkill(skillId: string, input: UpdateSkillInput): Promise<SkillDefinition> {
        const response = await this.request({
            action: 'update_skill',
            skill_id: skillId,
            payload: input
        });
        if (!response.skill) {
            throw new Error('Skill update failed');
        }
        return response.skill;
    }

    async archiveSkill(skillId: string): Promise<SkillDefinition> {
        const response = await this.request({
            action: 'archive_skill',
            skill_id: skillId
        });
        if (!response.skill) {
            throw new Error('Skill archive failed');
        }
        return response.skill;
    }

    async listRuns(companyId: string, options?: { skillId?: string; status?: SkillRunStatus }): Promise<SkillRun[]> {
        const response = await this.request({
            action: 'list_runs',
            company_id: companyId,
            skill_id: options?.skillId,
            status: options?.status
        });
        return response.runs ?? [];
    }

    async listApprovals(companyId: string, options?: { runId?: string; status?: SkillApproval['status'] }): Promise<SkillApproval[]> {
        const response = await this.request({
            action: 'list_approvals',
            company_id: companyId,
            run_id: options?.runId,
            status: options?.status
        });
        return response.approvals ?? [];
    }

    async createRun(companyId: string, skillId: string, input: CreateRunInput): Promise<SkillRun> {
        const response = await this.request({
            action: 'create_run',
            company_id: companyId,
            skill_id: skillId,
            payload: input
        });
        if (!response.run) {
            throw new Error('Skill run creation failed');
        }
        return response.run;
    }

    async updateRun(runId: string, input: UpdateRunInput): Promise<SkillRun> {
        const response = await this.request({
            action: 'update_run',
            run_id: runId,
            payload: input
        });
        if (!response.run) {
            throw new Error('Skill run update failed');
        }
        return response.run;
    }

    async requestApproval(runId: string, input?: RequestApprovalInput): Promise<SkillApproval> {
        const response = await this.request({
            action: 'request_approval',
            run_id: runId,
            payload: input ?? {}
        });
        if (!response.approval) {
            throw new Error('Approval request failed');
        }
        return response.approval;
    }

    async approveRun(approvalId: string, input?: ApprovalDecisionInput): Promise<SkillApproval> {
        const response = await this.request({
            action: 'approve_run',
            approval_id: approvalId,
            payload: input ?? {}
        });
        if (!response.approval) {
            throw new Error('Approval update failed');
        }
        return response.approval;
    }

    async rejectRun(approvalId: string, input?: ApprovalDecisionInput): Promise<SkillApproval> {
        const response = await this.request({
            action: 'reject_run',
            approval_id: approvalId,
            payload: input ?? {}
        });
        if (!response.approval) {
            throw new Error('Approval rejection failed');
        }
        return response.approval;
    }
}

export const skillService = new SkillServiceClass();

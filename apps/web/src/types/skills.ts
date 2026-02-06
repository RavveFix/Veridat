export type SkillStatus = 'draft' | 'active' | 'deprecated' | 'archived';
export type SkillScope = 'user' | 'company' | 'org';
export type SkillVisibility = 'private' | 'company' | 'org';
export type SkillKind = 'skill' | 'automation';

export type SkillRunStatus = 'preview' | 'pending_approval' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type SkillTrigger = 'user' | 'ai' | 'schedule' | 'system';

export type SkillApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface SkillDefinition {
    id: string;
    user_id: string;
    company_id: string;
    name: string;
    description: string;
    status: SkillStatus;
    kind?: SkillKind;
    scope: SkillScope;
    visibility: SkillVisibility;
    input_schema: Record<string, unknown>;
    output_schema: Record<string, unknown>;
    allowed_actions: string[];
    requires_approval: boolean;
    created_at: string;
    updated_at: string;
}

export interface SkillRun {
    id: string;
    skill_id: string;
    user_id: string;
    company_id: string;
    triggered_by: SkillTrigger;
    status: SkillRunStatus;
    input_payload: Record<string, unknown>;
    preview_output: Record<string, unknown> | null;
    output_payload: Record<string, unknown> | null;
    input_hash: string | null;
    preview_hash: string | null;
    ai_decision_id: string | null;
    error_code: string | null;
    error_message: string | null;
    started_at: string | null;
    finished_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface SkillApproval {
    id: string;
    run_id: string;
    user_id: string;
    company_id: string;
    status: SkillApprovalStatus;
    required_role: string;
    required_count: number;
    approved_by: string | null;
    approved_at: string | null;
    comment: string | null;
    input_hash: string | null;
    preview_hash: string | null;
    expires_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface SkillDraft {
    name: string;
    description: string;
    schedule?: string | null;
    requires_approval?: boolean;
    data_needed?: string[];
}

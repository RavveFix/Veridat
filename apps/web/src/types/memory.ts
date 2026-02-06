export type MemoryCategory = 'work_context' | 'preferences' | 'history' | 'top_of_mind' | 'user_defined';
export type MemoryScope = 'user' | 'company' | 'org';
export type MemoryType = 'explicit' | 'inferred' | 'policy';
export type MemoryStatus = 'draft' | 'approved' | 'active' | 'expired' | 'rejected';
export type MemorySourceType = 'conversation' | 'skill_run' | 'manual' | 'system' | 'import' | 'other';
export type MemoryCreatedBy = 'user' | 'ai' | 'system';

export interface MemoryItem {
    id: string;
    user_id: string;
    company_id: string;
    scope: MemoryScope;
    category: MemoryCategory;
    memory_type: MemoryType;
    status: MemoryStatus;
    content: string;
    metadata: Record<string, unknown>;
    importance: number;
    confidence: number;
    source_type: MemorySourceType;
    source_id: string | null;
    created_by: MemoryCreatedBy;
    last_used_at: string | null;
    expires_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface MemoryItemInput {
    content: string;
    category?: MemoryCategory;
    scope?: MemoryScope;
    memory_type?: MemoryType;
    status?: MemoryStatus;
    metadata?: Record<string, unknown>;
    importance?: number;
    confidence?: number;
    source_type?: MemorySourceType;
    source_id?: string | null;
    created_by?: MemoryCreatedBy;
    expires_at?: string | null;
}

export interface MemoryItemPatch {
    content?: string;
    category?: MemoryCategory;
    scope?: MemoryScope;
    memory_type?: MemoryType;
    status?: MemoryStatus;
    metadata?: Record<string, unknown>;
    importance?: number;
    confidence?: number;
    source_type?: MemorySourceType;
    source_id?: string | null;
    created_by?: MemoryCreatedBy;
    expires_at?: string | null;
}

export interface MemoryUsage {
    id: string;
    memory_id: string;
    skill_run_id: string | null;
    conversation_id: string | null;
    used_at: string;
}

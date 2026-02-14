export type TestSuiteId = 'core_ui' | 'core_api' | 'security' | 'billing' | 'guardian';
export type TestRunMode = 'manual' | 'scheduled';
export type TestRunStatus = 'running' | 'succeeded' | 'failed';
export type TestCheckStatus = 'passed' | 'failed';

export interface TestSuiteDefinition {
    id: TestSuiteId;
    label: string;
    description: string;
}

export interface TestCheckResult {
    id: string;
    status: TestCheckStatus;
    message: string;
    details?: Record<string, unknown>;
}

export interface TestRunSummary {
    passed: number;
    failed: number;
    duration_ms: number;
}

export interface TestOrchestratorRunResponse {
    ok: boolean;
    run_id: string;
    status: TestRunStatus;
    summary: TestRunSummary;
    checks: TestCheckResult[];
}

export interface TestOrchestratorListResponse {
    ok: boolean;
    suites: TestSuiteDefinition[];
}

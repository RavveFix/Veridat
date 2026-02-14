import { supabase } from '../lib/supabase';
import { logger } from './LoggerService';
import type {
    TestOrchestratorListResponse,
    TestOrchestratorRunResponse,
    TestRunMode,
    TestSuiteId,
} from '../types/testOrchestrator';

const TEST_ORCHESTRATOR_ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/test-orchestrator`;

interface TestOrchestratorPayload {
    action: 'list_suites' | 'run_suite' | 'get_run' | 'run_all';
    company_id?: string;
    suite?: TestSuiteId;
    mode?: TestRunMode;
    run_id?: string;
}

class TestOrchestratorService {
    private async request<T>(payload: TestOrchestratorPayload): Promise<T> {
        const {
            data: { session },
        } = await supabase.auth.getSession();

        if (!session) {
            throw new Error('Not authenticated');
        }

        const response = await fetch(TEST_ORCHESTRATOR_ENDPOINT, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${session.access_token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;

        if (!response.ok) {
            const message = typeof body.error === 'string' ? body.error : 'Test orchestrator request failed';
            logger.warn('Test orchestrator request failed', { payload, message });
            throw new Error(message);
        }

        return body as T;
    }

    async listSuites(): Promise<TestOrchestratorListResponse> {
        return this.request<TestOrchestratorListResponse>({ action: 'list_suites' });
    }

    async runSuite(companyId: string, suite: TestSuiteId, mode: TestRunMode = 'manual'): Promise<TestOrchestratorRunResponse> {
        return this.request<TestOrchestratorRunResponse>({
            action: 'run_suite',
            company_id: companyId,
            suite,
            mode,
        });
    }

    async runAll(companyId: string, mode: TestRunMode = 'manual'): Promise<TestOrchestratorRunResponse> {
        return this.request<TestOrchestratorRunResponse>({
            action: 'run_all',
            company_id: companyId,
            mode,
        });
    }

    async getRun(runId: string): Promise<TestOrchestratorRunResponse> {
        return this.request<TestOrchestratorRunResponse>({
            action: 'get_run',
            run_id: runId,
        });
    }
}

export const testOrchestratorService = new TestOrchestratorService();

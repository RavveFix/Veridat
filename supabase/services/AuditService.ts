/**
 * Audit Service for BFL Compliance
 *
 * Provides centralized audit logging for:
 * - General audit trail (audit_logs)
 * - AI decisions tracking (ai_decisions)
 * - Fortnox sync logging (fortnox_sync_log)
 *
 * Legal Reference: BFL 7 kap - Arkivering och dokumentation
 */

/// <reference path="../functions/types/deno.d.ts" />

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { createLogger } from './LoggerService.ts';

const logger = createLogger('audit');

// ============================================================================
// TYPES
// ============================================================================

export type ActorType = 'user' | 'system' | 'ai' | 'fortnox_sync';

export type AIProvider = 'gemini' | 'openai' | 'claude';

export type FortnoxOperation =
    | 'export_voucher'
    | 'export_supplier_invoice'
    | 'create_supplier'
    | 'create_customer'
    | 'create_article'
    | 'update_voucher'
    | 'import_vouchers'
    | 'import_supplier_invoices';

export type SyncStatus = 'pending' | 'in_progress' | 'success' | 'failed' | 'cancelled';

export interface AuditLogEntry {
    userId?: string;
    actorType: ActorType;
    action: string;
    resourceType: string;
    resourceId: string;
    companyId?: string;
    previousState?: Record<string, unknown>;
    newState?: Record<string, unknown>;
    aiModel?: string;
    aiConfidence?: number;
    aiDecisionId?: string;
    bflReference?: string;
    ipAddress?: string;
    userAgent?: string;
}

export interface AIDecisionEntry {
    userId: string;
    companyId?: string;
    aiProvider: AIProvider;
    aiModel: string;
    aiFunction: string;
    inputData: Record<string, unknown>;
    outputData: Record<string, unknown>;
    confidence: number;
    processingTimeMs?: number;
}

export interface FortnoxSyncEntry {
    userId: string;
    companyId: string;
    operation: FortnoxOperation;
    vatReportId?: string;
    transactionId?: string;
    aiDecisionId?: string;
    requestPayload: Record<string, unknown>;
}

export interface FortnoxSyncResult {
    fortnoxDocumentNumber?: string;
    fortnoxVoucherSeries?: string;
    fortnoxSupplierNumber?: string;
    fortnoxInvoiceNumber?: string;
    responsePayload?: Record<string, unknown>;
}

// ============================================================================
// AUDIT SERVICE CLASS
// ============================================================================

export class AuditService {
    private supabase: SupabaseClient;

    constructor(supabaseClient: SupabaseClient) {
        this.supabase = supabaseClient;
    }

    /**
     * Compute SHA-256 hash of input data for deduplication
     */
    private async computeInputHash(inputData: Record<string, unknown>): Promise<string> {
        const encoder = new TextEncoder();
        const data = encoder.encode(JSON.stringify(inputData));
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    }

    /**
     * Log an audit event to audit_logs table
     */
    async log(entry: AuditLogEntry): Promise<string> {
        try {
            const { data, error } = await this.supabase
                .from('audit_logs')
                .insert({
                    user_id: entry.userId || null,
                    actor_type: entry.actorType,
                    action: entry.action,
                    resource_type: entry.resourceType,
                    resource_id: entry.resourceId,
                    company_id: entry.companyId,
                    previous_state: entry.previousState,
                    new_state: entry.newState,
                    ai_model: entry.aiModel,
                    ai_confidence: entry.aiConfidence,
                    ai_decision_id: entry.aiDecisionId,
                    bfl_reference: entry.bflReference || 'BFL 7:1',
                    ip_address: entry.ipAddress,
                    user_agent: entry.userAgent,
                })
                .select('id')
                .single();

            if (error) {
                logger.error('Failed to create audit log', error);
                throw error;
            }

            logger.info('Audit log created', {
                id: data.id,
                action: entry.action,
                resourceType: entry.resourceType,
            });

            return data.id;
        } catch (error) {
            logger.error('Audit logging failed', error);
            // Don't throw - audit logging should not break the main flow
            return '';
        }
    }

    /**
     * Log an AI decision to ai_decisions table
     */
    async logAIDecision(entry: AIDecisionEntry): Promise<string> {
        try {
            const inputHash = await this.computeInputHash(entry.inputData);

            const { data, error } = await this.supabase
                .from('ai_decisions')
                .insert({
                    user_id: entry.userId,
                    company_id: entry.companyId,
                    ai_provider: entry.aiProvider,
                    ai_model: entry.aiModel,
                    ai_function: entry.aiFunction,
                    input_hash: inputHash,
                    input_data: entry.inputData,
                    output_data: entry.outputData,
                    confidence: entry.confidence,
                    processing_time_ms: entry.processingTimeMs,
                })
                .select('id')
                .single();

            if (error) {
                logger.error('Failed to log AI decision', error);
                throw error;
            }

            logger.info('AI decision logged', {
                id: data.id,
                provider: entry.aiProvider,
                function: entry.aiFunction,
                confidence: entry.confidence,
            });

            // Also create an audit log entry
            await this.log({
                userId: entry.userId,
                actorType: 'ai',
                action: `ai_${entry.aiFunction}`,
                resourceType: 'ai_decision',
                resourceId: data.id,
                companyId: entry.companyId,
                aiModel: entry.aiModel,
                aiConfidence: entry.confidence,
                aiDecisionId: data.id,
                newState: entry.outputData,
            });

            return data.id;
        } catch (error) {
            logger.error('AI decision logging failed', error);
            return '';
        }
    }

    /**
     * Record when a user overrides an AI decision
     */
    async recordOverride(
        aiDecisionId: string,
        userId: string,
        reason: string
    ): Promise<void> {
        try {
            // Use the database function for atomic update
            const { error } = await this.supabase.rpc('record_ai_decision_override', {
                p_decision_id: aiDecisionId,
                p_user_id: userId,
                p_reason: reason,
            });

            if (error) {
                logger.error('Failed to record AI decision override', error);
                throw error;
            }

            logger.info('AI decision override recorded', {
                aiDecisionId,
                userId,
            });
        } catch (error) {
            logger.error('Override recording failed', error);
        }
    }

    /**
     * Start a Fortnox sync operation (creates pending record)
     */
    async startFortnoxSync(entry: FortnoxSyncEntry): Promise<string> {
        try {
            const { data, error } = await this.supabase
                .from('fortnox_sync_log')
                .insert({
                    user_id: entry.userId,
                    company_id: entry.companyId,
                    operation: entry.operation,
                    vat_report_id: entry.vatReportId,
                    transaction_id: entry.transactionId,
                    ai_decision_id: entry.aiDecisionId,
                    status: 'pending',
                    request_payload: entry.requestPayload,
                })
                .select('id')
                .single();

            if (error) {
                logger.error('Failed to start Fortnox sync log', error);
                throw error;
            }

            logger.info('Fortnox sync started', {
                id: data.id,
                operation: entry.operation,
            });

            return data.id;
        } catch (error) {
            logger.error('Fortnox sync start failed', error);
            return '';
        }
    }

    /**
     * Update Fortnox sync to in_progress status
     */
    async updateFortnoxSyncInProgress(syncId: string): Promise<void> {
        try {
            const { error } = await this.supabase
                .from('fortnox_sync_log')
                .update({ status: 'in_progress' })
                .eq('id', syncId);

            if (error) {
                logger.error('Failed to update Fortnox sync to in_progress', error);
            }
        } catch (error) {
            logger.error('Fortnox sync update failed', error);
        }
    }

    /**
     * Complete a Fortnox sync operation (success)
     */
    async completeFortnoxSync(
        syncId: string,
        result: FortnoxSyncResult
    ): Promise<void> {
        try {
            const { error } = await this.supabase
                .from('fortnox_sync_log')
                .update({
                    status: 'success',
                    fortnox_document_number: result.fortnoxDocumentNumber,
                    fortnox_voucher_series: result.fortnoxVoucherSeries,
                    fortnox_supplier_number: result.fortnoxSupplierNumber,
                    fortnox_invoice_number: result.fortnoxInvoiceNumber,
                    response_payload: result.responsePayload,
                    completed_at: new Date().toISOString(),
                })
                .eq('id', syncId);

            if (error) {
                logger.error('Failed to complete Fortnox sync', error);
                throw error;
            }

            logger.info('Fortnox sync completed', {
                syncId,
                documentNumber: result.fortnoxDocumentNumber,
            });

            // Also create audit log
            const { data: syncData } = await this.supabase
                .from('fortnox_sync_log')
                .select('user_id, company_id, operation')
                .eq('id', syncId)
                .single();

            if (syncData) {
                await this.log({
                    userId: syncData.user_id,
                    actorType: 'fortnox_sync',
                    action: `fortnox_${syncData.operation}_success`,
                    resourceType: 'fortnox_sync',
                    resourceId: syncId,
                    companyId: syncData.company_id,
                    newState: result as unknown as Record<string, unknown>,
                });
            }
        } catch (error) {
            logger.error('Fortnox sync completion failed', error);
        }
    }

    /**
     * Fail a Fortnox sync operation
     */
    async failFortnoxSync(
        syncId: string,
        errorCode: string,
        errorMessage: string,
        responsePayload?: Record<string, unknown>
    ): Promise<void> {
        try {
            // Get current retry count
            const { data: current } = await this.supabase
                .from('fortnox_sync_log')
                .select('retry_count, user_id, company_id, operation')
                .eq('id', syncId)
                .single();

            const newRetryCount = (current?.retry_count || 0) + 1;

            const { error } = await this.supabase
                .from('fortnox_sync_log')
                .update({
                    status: 'failed',
                    error_code: errorCode,
                    error_message: errorMessage,
                    response_payload: responsePayload,
                    retry_count: newRetryCount,
                    completed_at: new Date().toISOString(),
                })
                .eq('id', syncId);

            if (error) {
                logger.error('Failed to mark Fortnox sync as failed', error);
                throw error;
            }

            logger.warn('Fortnox sync failed', {
                syncId,
                errorCode,
                errorMessage,
                retryCount: newRetryCount,
            });

            // Also create audit log
            if (current) {
                await this.log({
                    userId: current.user_id,
                    actorType: 'fortnox_sync',
                    action: `fortnox_${current.operation}_failed`,
                    resourceType: 'fortnox_sync',
                    resourceId: syncId,
                    companyId: current.company_id,
                    newState: { errorCode, errorMessage, retryCount: newRetryCount },
                });
            }
        } catch (error) {
            logger.error('Fortnox sync failure logging failed', error);
        }
    }

    /**
     * Get sync status for a VAT report
     */
    async getVATReportSyncStatus(vatReportId: string): Promise<{
        status: SyncStatus | null;
        fortnoxDocumentNumber: string | null;
        fortnoxVoucherSeries: string | null;
        syncedAt: string | null;
    }> {
        try {
            const { data, error } = await this.supabase
                .from('fortnox_sync_log')
                .select('status, fortnox_document_number, fortnox_voucher_series, completed_at')
                .eq('vat_report_id', vatReportId)
                .eq('operation', 'export_voucher')
                .order('created_at', { ascending: false })
                .limit(1)
                .single();

            if (error || !data) {
                return {
                    status: null,
                    fortnoxDocumentNumber: null,
                    fortnoxVoucherSeries: null,
                    syncedAt: null,
                };
            }

            return {
                status: data.status as SyncStatus,
                fortnoxDocumentNumber: data.fortnox_document_number,
                fortnoxVoucherSeries: data.fortnox_voucher_series,
                syncedAt: data.completed_at,
            };
        } catch (error) {
            logger.error('Failed to get VAT report sync status', error);
            return {
                status: null,
                fortnoxDocumentNumber: null,
                fortnoxVoucherSeries: null,
                syncedAt: null,
            };
        }
    }

    /**
     * Get audit trail for a resource
     */
    async getAuditTrail(
        resourceType: string,
        resourceId: string
    ): Promise<Array<{
        id: string;
        actorType: ActorType;
        action: string;
        createdAt: string;
        previousState?: Record<string, unknown>;
        newState?: Record<string, unknown>;
    }>> {
        try {
            const { data, error } = await this.supabase
                .from('audit_logs')
                .select('id, actor_type, action, created_at, previous_state, new_state')
                .eq('resource_type', resourceType)
                .eq('resource_id', resourceId)
                .order('created_at', { ascending: false });

            if (error) {
                logger.error('Failed to get audit trail', error);
                return [];
            }

            return (data || []).map((row) => ({
                id: row.id,
                actorType: row.actor_type as ActorType,
                action: row.action,
                createdAt: row.created_at,
                previousState: row.previous_state,
                newState: row.new_state,
            }));
        } catch (error) {
            logger.error('Audit trail retrieval failed', error);
            return [];
        }
    }
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Create an audit service instance with a Supabase client
 */
export function createAuditService(supabaseClient: SupabaseClient): AuditService {
    return new AuditService(supabaseClient);
}

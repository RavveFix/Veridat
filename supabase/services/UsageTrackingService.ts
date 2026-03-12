// Usage Tracking Service for Supabase Edge Functions
// Logs AI and Fortnox usage events for monthly analytics/billing.
// Separate from RateLimiterService which handles hourly/daily burst limits.
/// <reference path="../functions/types/deno.d.ts" />

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

type EventType = 'ai_message' | 'fortnox_read' | 'fortnox_write';

interface LogEventParams {
    userId: string;
    companyId?: string | null;
    eventType: EventType;
    toolName?: string | null;
    tokensUsed?: number | null;
}

interface PlanLimits {
    ai_messages_per_month: number;
    fortnox_reads_per_month: number;
    fortnox_writes_per_month: number;
}

export class UsageTrackingService {
    constructor(private supabase: SupabaseClient) {}

    /**
     * Fire-and-forget: logs a usage event. Never throws, never blocks.
     */
    logEvent(params: LogEventParams): void {
        this.supabase
            .from('usage_tracking')
            .insert({
                user_id: params.userId,
                company_id: params.companyId ?? null,
                event_type: params.eventType,
                tool_name: params.toolName ?? null,
                tokens_used: params.tokensUsed ?? null,
            })
            .then(({ error }) => {
                if (error) {
                    console.error('[UsageTracking] insert failed:', error.message);
                }
            });
    }

    /**
     * Query current month usage counts by event_type.
     * Returns e.g. { ai_message: 42, fortnox_read: 10 }
     */
    async getMonthlyUsage(userId: string): Promise<Record<string, number>> {
        const { data, error } = await this.supabase
            .rpc('get_monthly_usage', { p_user_id: userId });

        if (error) {
            console.error('[UsageTracking] getMonthlyUsage failed:', error.message);
            return {};
        }

        const result: Record<string, number> = {};
        for (const row of data ?? []) {
            result[row.event_type] = Number(row.count);
        }
        return result;
    }

    /**
     * Fetch plan limits for a given plan tier.
     */
    async getPlanLimits(plan: string): Promise<PlanLimits | null> {
        const { data, error } = await this.supabase
            .from('plan_limits')
            .select('ai_messages_per_month, fortnox_reads_per_month, fortnox_writes_per_month')
            .eq('plan', plan)
            .maybeSingle();

        if (error || !data) {
            console.error('[UsageTracking] getPlanLimits failed:', error?.message);
            return null;
        }
        return data as PlanLimits;
    }
}

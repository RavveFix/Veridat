// Deno-compatible Rate Limiter Service for Supabase Edge Functions
/// <reference path="../types/deno.d.ts" />

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

interface RateLimitConfig {
    requestsPerDay: number;
    requestsPerHour: number;
}

interface RateLimitResult {
    allowed: boolean;
    remaining: number;
    resetAt: Date;
    message?: string;
}

interface UsageRecord {
    id: string;
    user_id: string;
    endpoint: string;
    hourly_count: number;
    daily_count: number;
    hourly_reset: string;
    daily_reset: string;
    // Legacy columns (kept for backwards compatibility)
    request_count?: number;
    last_reset?: string;
}

export class RateLimiterService {
    private config: RateLimitConfig = {
        requestsPerDay: 50,
        requestsPerHour: 10
    };

    constructor(
        private supabase: SupabaseClient,
        config?: Partial<RateLimitConfig>
    ) {
        if (config) {
            this.config = { ...this.config, ...config };
        }
    }

    async checkAndIncrement(
        userId: string,
        endpoint: string
    ): Promise<RateLimitResult> {
        const now = new Date();
        const oneHourMs = 60 * 60 * 1000;
        const oneDayMs = 24 * oneHourMs;

        try {
            // Get usage record
            const { data: usage, error: fetchError } = await this.supabase
                .from('api_usage')
                .select('*')
                .eq('user_id', userId)
                .eq('endpoint', endpoint)
                .maybeSingle() as { data: UsageRecord | null; error: Error | null };

            if (fetchError) {
                console.error('Error fetching usage:', fetchError);
                throw new Error(`Failed to check rate limit: ${fetchError.message}`);
            }

            if (!usage) {
                // Create new record with separate counters
                const { error: insertError } = await this.supabase
                    .from('api_usage')
                    .insert({
                        user_id: userId,
                        endpoint: endpoint,
                        hourly_count: 1,
                        daily_count: 1,
                        hourly_reset: now.toISOString(),
                        daily_reset: now.toISOString(),
                        // Legacy columns
                        request_count: 1,
                        last_reset: now.toISOString()
                    });

                if (insertError) {
                    console.error('Error creating usage record:', insertError);
                    throw new Error('Rate limit tracking failed');
                }

                return {
                    allowed: true,
                    remaining: this.config.requestsPerHour - 1,
                    resetAt: new Date(now.getTime() + oneHourMs)
                };
            }

            // Calculate FIXED time windows (not rolling) to prevent timing attacks
            const currentHourWindow = Math.floor(now.getTime() / oneHourMs) * oneHourMs;
            const currentDayWindow = Math.floor(now.getTime() / oneDayMs) * oneDayMs;

            const hourlyReset = new Date(usage.hourly_reset || usage.last_reset || new Date(0).toISOString());
            const dailyReset = new Date(usage.daily_reset || usage.last_reset || new Date(0).toISOString());

            const hourlyResetWindow = Math.floor(hourlyReset.getTime() / oneHourMs) * oneHourMs;
            const dailyResetWindow = Math.floor(dailyReset.getTime() / oneDayMs) * oneDayMs;

            // Determine if we've moved to a new window (not just >= 1 hour passed)
            const isNewHourlyWindow = currentHourWindow > hourlyResetWindow;
            const isNewDailyWindow = currentDayWindow > dailyResetWindow;

            // Reset counts if we're in a new window
            let newHourlyCount = isNewHourlyWindow ? 1 : (usage.hourly_count || 0) + 1;
            let newDailyCount = isNewDailyWindow ? 1 : (usage.daily_count || 0) + 1;

            let newHourlyReset = isNewHourlyWindow ? new Date(currentHourWindow).toISOString() : usage.hourly_reset;
            let newDailyReset = isNewDailyWindow ? new Date(currentDayWindow).toISOString() : usage.daily_reset;

            // Check limits BEFORE incrementing (use previous count + 1 to avoid off-by-one)
            const wouldExceedHourly = !isNewHourlyWindow && (usage.hourly_count || 0) >= this.config.requestsPerHour;
            const wouldExceedDaily = !isNewDailyWindow && (usage.daily_count || 0) >= this.config.requestsPerDay;

            if (wouldExceedHourly) {
                const resetAt = new Date(hourlyResetWindow + oneHourMs);
                return {
                    allowed: false,
                    remaining: 0,
                    resetAt: resetAt,
                    message: `Timgräns nådd (${this.config.requestsPerHour} förfrågningar/timme). Försök igen om ${Math.ceil((resetAt.getTime() - now.getTime()) / 60000)} minuter.`
                };
            }

            if (wouldExceedDaily) {
                const resetAt = new Date(dailyResetWindow + oneDayMs);
                return {
                    allowed: false,
                    remaining: 0,
                    resetAt: resetAt,
                    message: `Dagsgräns nådd (${this.config.requestsPerDay} förfrågningar/dag). Försök igen imorgon.`
                };
            }

            // Update record with new counts
            const { error: updateError } = await this.supabase
                .from('api_usage')
                .update({
                    hourly_count: newHourlyCount,
                    daily_count: newDailyCount,
                    hourly_reset: newHourlyReset,
                    daily_reset: newDailyReset,
                    // Also update legacy columns for backwards compatibility
                    request_count: newDailyCount,
                    last_reset: newDailyReset
                })
                .eq('user_id', userId)
                .eq('endpoint', endpoint);

            if (updateError) {
                console.error('Error updating usage record:', updateError);
                throw new Error('Rate limit tracking failed');
            }

            // Calculate remaining requests (use the more restrictive limit)
            const remainingHourly = this.config.requestsPerHour - newHourlyCount;
            const remainingDaily = this.config.requestsPerDay - newDailyCount;
            const remaining = Math.min(remainingHourly, remainingDaily);

            // Return the soonest reset time
            const hourlyResetAt = new Date(new Date(newHourlyReset).getTime() + oneHourMs);
            const dailyResetAt = new Date(new Date(newDailyReset).getTime() + oneDayMs);
            const resetAt = remainingHourly <= remainingDaily ? hourlyResetAt : dailyResetAt;

            return {
                allowed: true,
                remaining: Math.max(0, remaining),
                resetAt: resetAt
            };

        } catch (error) {
            console.error('Rate limiter error:', error);
            throw new Error('Rate limiting unavailable');
        }
    }

    async getUsage(userId: string, endpoint: string) {
        const { data, error } = await this.supabase
            .from('api_usage')
            .select('*')
            .eq('user_id', userId)
            .eq('endpoint', endpoint)
            .maybeSingle() as { data: UsageRecord | null; error: Error | null };

        if (error) {
            throw new Error(`Failed to get usage: ${error.message}`);
        }

        if (!data) {
            return {
                daily: { used: 0, limit: this.config.requestsPerDay, remaining: this.config.requestsPerDay },
                hourly: { used: 0, limit: this.config.requestsPerHour, remaining: this.config.requestsPerHour }
            };
        }

        const now = new Date();
        const oneHourMs = 60 * 60 * 1000;
        const oneDayMs = 24 * oneHourMs;

        // Calculate FIXED time windows (same logic as checkAndIncrement)
        const currentHourWindow = Math.floor(now.getTime() / oneHourMs) * oneHourMs;
        const currentDayWindow = Math.floor(now.getTime() / oneDayMs) * oneDayMs;

        const hourlyReset = new Date(data.hourly_reset || data.last_reset || now.toISOString());
        const dailyReset = new Date(data.daily_reset || data.last_reset || now.toISOString());

        const hourlyResetWindow = Math.floor(hourlyReset.getTime() / oneHourMs) * oneHourMs;
        const dailyResetWindow = Math.floor(dailyReset.getTime() / oneDayMs) * oneDayMs;

        const isNewHourlyWindow = currentHourWindow > hourlyResetWindow;
        const isNewDailyWindow = currentDayWindow > dailyResetWindow;

        // Reset counts if we're in a new window
        const hourlyUsed = isNewHourlyWindow ? 0 : (data.hourly_count || 0);
        const dailyUsed = isNewDailyWindow ? 0 : (data.daily_count || 0);

        return {
            daily: {
                used: dailyUsed,
                limit: this.config.requestsPerDay,
                remaining: Math.max(0, this.config.requestsPerDay - dailyUsed)
            },
            hourly: {
                used: hourlyUsed,
                limit: this.config.requestsPerHour,
                remaining: Math.max(0, this.config.requestsPerHour - hourlyUsed)
            }
        };
    }
}

// Deno-compatible Rate Limiter Service for Supabase Edge Functions
/// <reference path="../types/deno.d.ts" />

// @ts-expect-error - Deno npm: specifier not recognized by VSCode but works in Deno runtime
import { SupabaseClient } from 'npm:@supabase/supabase-js@2';

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
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
        const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        try {
            // Get usage record
            const { data: usage, error: fetchError } = await this.supabase
                .from('api_usage')
                .select('*')
                .eq('user_id', userId)
                .eq('endpoint', endpoint)
                .maybeSingle();

            if (fetchError) {
                console.error('Error fetching usage:', fetchError);
                throw new Error(`Failed to check rate limit: ${fetchError.message}`);
            }

            let hourlyCount = 0;
            let dailyCount = 0;
            let resetAt = new Date(now.getTime() + 60 * 60 * 1000);

            if (!usage) {
                // Create new record
                const { error: insertError } = await this.supabase
                    .from('api_usage')
                    .insert({
                        user_id: userId,
                        endpoint: endpoint,
                        request_count: 1,
                        last_reset: now.toISOString()
                    });

                if (insertError) {
                    console.error('Error creating usage record:', insertError);
                    // Fallback: allow the request even if we can't track it
                    return {
                        allowed: true,
                        remaining: this.config.requestsPerHour - 1,
                        resetAt: resetAt
                    };
                }

                return {
                    allowed: true,
                    remaining: this.config.requestsPerHour - 1,
                    resetAt: resetAt
                };
            }

            const lastReset = new Date(usage.last_reset);
            const hoursSinceReset = (now.getTime() - lastReset.getTime()) / (60 * 60 * 1000);
            const daysSinceReset = hoursSinceReset / 24;

            // Determine if we need to reset counters
            if (daysSinceReset >= 1) {
                // Reset daily counter
                dailyCount = 1;
                hourlyCount = 1;
                resetAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

                await this.supabase
                    .from('api_usage')
                    .update({
                        request_count: 1,
                        last_reset: now.toISOString()
                    })
                    .eq('user_id', userId)
                    .eq('endpoint', endpoint);

            } else if (hoursSinceReset >= 1) {
                // Reset hourly counter, keep daily
                hourlyCount = 1;
                dailyCount = usage.request_count + 1;
                resetAt = new Date(now.getTime() + 60 * 60 * 1000);

                // Check daily limit before incrementing
                if (dailyCount > this.config.requestsPerDay) {
                    return {
                        allowed: false,
                        remaining: 0,
                        resetAt: new Date(lastReset.getTime() + 24 * 60 * 60 * 1000),
                        message: `Daily limit reached (${this.config.requestsPerDay} requests/day)`
                    };
                }

                await this.supabase
                    .from('api_usage')
                    .update({
                        request_count: dailyCount
                    })
                    .eq('user_id', userId)
                    .eq('endpoint', endpoint);

            } else {
                // Increment both counters
                const newCount = usage.request_count + 1;
                hourlyCount = newCount;
                dailyCount = newCount;
                resetAt = new Date(lastReset.getTime() + 60 * 60 * 1000);

                // Check hourly limit
                if (hourlyCount > this.config.requestsPerHour) {
                    return {
                        allowed: false,
                        remaining: 0,
                        resetAt: resetAt,
                        message: `Hourly limit reached (${this.config.requestsPerHour} requests/hour)`
                    };
                }

                // Check daily limit
                if (dailyCount > this.config.requestsPerDay) {
                    return {
                        allowed: false,
                        remaining: 0,
                        resetAt: new Date(lastReset.getTime() + 24 * 60 * 60 * 1000),
                        message: `Daily limit reached (${this.config.requestsPerDay} requests/day)`
                    };
                }

                await this.supabase
                    .from('api_usage')
                    .update({
                        request_count: newCount
                    })
                    .eq('user_id', userId)
                    .eq('endpoint', endpoint);
            }

            // Calculate remaining requests
            const remainingHourly = this.config.requestsPerHour - hourlyCount;
            const remainingDaily = this.config.requestsPerDay - dailyCount;
            const remaining = Math.min(remainingHourly, remainingDaily);

            return {
                allowed: true,
                remaining: Math.max(0, remaining),
                resetAt: resetAt
            };

        } catch (error) {
            console.error('Rate limiter error:', error);
            // Fail open: allow the request if rate limiting fails
            return {
                allowed: true,
                remaining: this.config.requestsPerHour,
                resetAt: new Date(now.getTime() + 60 * 60 * 1000)
            };
        }
    }

    async getUsage(userId: string, endpoint: string) {
        const { data, error } = await this.supabase
            .from('api_usage')
            .select('*')
            .eq('user_id', userId)
            .eq('endpoint', endpoint)
            .maybeSingle();

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
        const lastReset = new Date(data.last_reset);
        const hoursSinceReset = (now.getTime() - lastReset.getTime()) / (60 * 60 * 1000);

        const used = hoursSinceReset >= 1 ? 0 : data.request_count;

        return {
            daily: {
                used: Math.min(used, this.config.requestsPerDay),
                limit: this.config.requestsPerDay,
                remaining: Math.max(0, this.config.requestsPerDay - used)
            },
            hourly: {
                used: Math.min(used, this.config.requestsPerHour),
                limit: this.config.requestsPerHour,
                remaining: Math.max(0, this.config.requestsPerHour - used)
            }
        };
    }
}

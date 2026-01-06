// Plan Service for Supabase Edge Functions
// Manual Free/Pro plan resolution + rate limit config
/// <reference path="../types/deno.d.ts" />

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { createLogger } from './LoggerService.ts';

const logger = createLogger('plan');

export type UserPlan = 'free' | 'pro';

type ProfilePlanRow = {
    plan?: string | null;
};

function normalizeUserPlan(value: unknown): UserPlan {
    return value === 'pro' ? 'pro' : 'free';
}

function parsePositiveIntEnv(key: string, fallback: number): number {
    const raw = Deno.env.get(key);
    if (!raw) return fallback;

    const value = Number(raw);
    if (!Number.isFinite(value)) return fallback;

    const floored = Math.floor(value);
    if (floored <= 0) return fallback;

    return floored;
}

export function getRateLimitConfigForPlan(plan: UserPlan): { requestsPerDay: number; requestsPerHour: number } {
    const defaults = plan === 'pro'
        ? { requestsPerDay: 200, requestsPerHour: 40 }
        : { requestsPerDay: 50, requestsPerHour: 10 };

    const prefix = plan === 'pro' ? 'RATE_LIMIT_PRO' : 'RATE_LIMIT_FREE';

    return {
        requestsPerDay: parsePositiveIntEnv(`${prefix}_DAILY`, defaults.requestsPerDay),
        requestsPerHour: parsePositiveIntEnv(`${prefix}_HOURLY`, defaults.requestsPerHour)
    };
}

export async function getUserPlan(supabase: SupabaseClient, userId: string): Promise<UserPlan> {
    try {
        const { data, error } = await supabase
            .from('profiles')
            .select('plan')
            .eq('id', userId)
            .maybeSingle() as { data: ProfilePlanRow | null; error: Error | null };

        if (error) {
            logger.warn('Failed to load plan; defaulting to free', { userId, error: error.message });
            return 'free';
        }

        return normalizeUserPlan(data?.plan);
    } catch (error) {
        logger.warn('Failed to load plan; defaulting to free', { userId });
        return 'free';
    }
}


export type UserPlan = 'free' | 'pro' | 'trial';

export function normalizeUserPlan(value: unknown): UserPlan {
    if (value === 'pro' || value === 'trial') {
        return value;
    }
    return 'free';
}

export function isFortnoxEligible(plan: UserPlan): boolean {
    return plan === 'pro' || plan === 'trial';
}

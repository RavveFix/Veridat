import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type UserPlan = 'free' | 'pro' | 'trial';

export interface ProfileFlags {
    isAdmin?: boolean;
    plan?: UserPlan;
}

export function getAdminClient(): SupabaseClient {
    if (!SUPABASE_SERVICE_ROLE_KEY) {
        throw new Error(
            'SUPABASE_SERVICE_ROLE_KEY saknas. Kör "npm run supabase:setup" och försök igen.'
        );
    }

    return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
        },
    });
}

export async function upsertProfile(userId: string, updates: Record<string, unknown>): Promise<void> {
    const admin = getAdminClient();
    const { error } = await admin
        .from('profiles')
        .upsert({ id: userId, ...updates }, { onConflict: 'id' });

    if (error) {
        throw new Error(`Kunde inte uppdatera profil för ${userId}: ${error.message}`);
    }
}

export async function getProfile(userId: string): Promise<Record<string, unknown> | null> {
    const admin = getAdminClient();
    const { data, error } = await admin
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

    if (error) {
        throw new Error(`Kunde inte läsa profil för ${userId}: ${error.message}`);
    }

    return data as Record<string, unknown> | null;
}

export async function deleteLegalAcceptancesForVersion(userId: string, version: string): Promise<void> {
    const admin = getAdminClient();
    const { error } = await admin
        .from('legal_acceptances')
        .delete()
        .eq('user_id', userId)
        .eq('version', version);

    if (error) {
        throw new Error(`Kunde inte radera legal_acceptances för ${userId}: ${error.message}`);
    }
}

export async function countLegalAcceptances(userId: string, version: string, docs: string[]): Promise<number> {
    const admin = getAdminClient();
    const { count, error } = await admin
        .from('legal_acceptances')
        .select('doc_type', { head: true, count: 'exact' })
        .eq('user_id', userId)
        .eq('version', version)
        .in('doc_type', docs);

    if (error) {
        throw new Error(`Kunde inte läsa legal_acceptances för ${userId}: ${error.message}`);
    }

    return count ?? 0;
}

export async function waitForProfile(
    userId: string,
    matcher: (profile: Record<string, unknown> | null) => boolean,
    timeoutMs = 8000
): Promise<Record<string, unknown> | null> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        const profile = await getProfile(userId);
        if (matcher(profile)) {
            return profile;
        }
        await sleep(250);
    }

    throw new Error(`Profilmatchning timeout för user ${userId}`);
}

export async function setProfileFlags(userId: string, flags: ProfileFlags): Promise<void> {
    const updates: Record<string, unknown> = { id: userId };

    if (typeof flags.isAdmin === 'boolean') {
        updates.is_admin = flags.isAdmin;
    }

    if (typeof flags.plan === 'string') {
        updates.plan = flags.plan;
    }

    if (Object.keys(updates).length === 1) {
        return;
    }

    await upsertProfile(userId, updates);

    for (let i = 0; i < 12; i += 1) {
        const profile = await getProfile(userId);

        const isAdminMatch = typeof flags.isAdmin === 'boolean'
            ? profile?.is_admin === flags.isAdmin
            : true;

        const planMatch = typeof flags.plan === 'string'
            ? profile?.plan === flags.plan
            : true;

        if (isAdminMatch && planMatch) {
            return;
        }

        await sleep(250);
    }

    throw new Error(`Profile-flaggor slog inte igenom inom timeout för user ${userId}`);
}

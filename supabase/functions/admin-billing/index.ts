/// <reference path="../types/deno.d.ts" />

import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
    getCorsHeaders,
    createOptionsResponse,
    isOriginAllowed,
    createForbiddenOriginResponse
} from '../../services/CorsService.ts';
import { createLogger } from '../../services/LoggerService.ts';

const logger = createLogger('admin-billing');

const DEFAULT_PERIOD_DAYS = 30;
const DEFAULT_TRIAL_DAYS = 14;
const DEFAULT_GRACE_DAYS = 14;

const ALLOWED_PLANS = new Set(['free', 'pro', 'trial']);
const ALLOWED_STATUSES = new Set(['active', 'past_due', 'suspended']);

interface AdminProfile {
    id: string;
    full_name: string | null;
    is_admin: boolean | null;
}

interface ProfileRow {
    id: string;
    full_name: string | null;
    plan: string;
    billing_status: string | null;
    period_end: string | null;
    grace_until: string | null;
    trial_end: string | null;
    invoice_id: string | null;
    invoice_due_date: string | null;
    paid_at: string | null;
}

interface CompanyRow {
    user_id: string | null;
    name: string | null;
}

type AdminSupabaseClient = SupabaseClient<any, any, any, any, any>;

function jsonResponse(status: number, body: Record<string, unknown>) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...getCorsHeaders(), 'Content-Type': 'application/json' }
    });
}

function parseIsoDate(value: unknown): string | null {
    if (typeof value !== 'string' || value.trim().length === 0) return null;
    return value;
}

function parsePositiveInt(value: unknown, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    const floored = Math.floor(parsed);
    if (floored <= 0) return fallback;
    return floored;
}

function addDays(base: Date, days: number): Date {
    return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

async function requireAdmin(supabaseAdmin: AdminSupabaseClient, token: string) {
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) {
        return { error: jsonResponse(401, { error: 'Unauthorized' }) } as const;
    }

    const { data: profile, error: profileError } = await supabaseAdmin
        .from('profiles')
        .select('id, full_name, is_admin')
        .eq('id', user.id)
        .maybeSingle() as { data: AdminProfile | null; error: Error | null };

    if (profileError || !profile) {
        return { error: jsonResponse(403, { error: 'Admin access required' }) } as const;
    }

    if (!profile.is_admin) {
        return { error: jsonResponse(403, { error: 'Admin access required' }) } as const;
    }

    return { user } as const;
}

async function findUsersById(
    supabaseAdmin: AdminSupabaseClient,
    userIds: string[]
): Promise<Map<string, { email: string | null }>> {
    const target = new Set(userIds);
    const result = new Map<string, { email: string | null }>();

    let page = 1;
    const perPage = 1000;

    while (target.size > 0) {
        const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
        if (error) {
            logger.warn('Failed to list users', { error: error.message });
            break;
        }

        for (const user of data.users ?? []) {
            if (!user?.id) continue;
            if (!target.has(user.id)) continue;
            result.set(user.id, { email: user.email ?? null });
            target.delete(user.id);
        }

        if (!data.nextPage || data.nextPage === page) {
            break;
        }

        page = data.nextPage;
    }

    return result;
}

async function findUserByEmail(
    supabaseAdmin: AdminSupabaseClient,
    email: string
): Promise<{ id: string; email: string | null } | null> {
    let page = 1;
    const perPage = 1000;
    const needle = email.trim().toLowerCase();

    while (page > 0) {
        const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
        if (error) {
            logger.warn('Failed to list users for email lookup', { error: error.message });
            return null;
        }

        for (const user of data.users ?? []) {
            if (!user?.email) continue;
            if (user.email.toLowerCase() === needle) {
                return { id: user.id, email: user.email };
            }
        }

        if (!data.nextPage || data.nextPage === page) {
            break;
        }

        page = data.nextPage;
    }

    return null;
}

async function listAccounts(supabaseAdmin: AdminSupabaseClient) {
    const { data: profiles, error } = await supabaseAdmin
        .from('profiles')
        .select('id, full_name, plan, billing_status, period_end, grace_until, trial_end, invoice_id, invoice_due_date, paid_at')
        .order('updated_at', { ascending: false }) as { data: ProfileRow[] | null; error: Error | null };

    if (error || !profiles) {
        logger.error('Failed to list profiles', { error: error?.message });
        return jsonResponse(500, { error: 'Failed to load accounts' });
    }

    const userIds = profiles.map((row) => row.id);
    const [emailMap, companies] = await Promise.all([
        findUsersById(supabaseAdmin, userIds),
        supabaseAdmin
            .from('companies')
            .select('user_id, name')
            .in('user_id', userIds)
    ]);

    const companyMap = new Map<string, string>();
    if (!companies.error && companies.data) {
        const companyRows = companies.data as CompanyRow[];
        for (const company of companyRows) {
            if (!company.user_id || companyMap.has(company.user_id)) continue;
            companyMap.set(company.user_id, company.name ?? '—');
        }
    }

    const accounts = profiles.map((profile) => ({
        id: profile.id,
        company: companyMap.get(profile.id) ?? '—',
        contact: profile.full_name ?? '—',
        email: emailMap.get(profile.id)?.email ?? '—',
        plan: profile.plan,
        status: profile.billing_status ?? 'active',
        period_end: profile.period_end,
        grace_until: profile.grace_until,
        trial_end: profile.trial_end,
        invoice_id: profile.invoice_id,
        invoice_due_date: profile.invoice_due_date,
        paid_at: profile.paid_at
    }));

    return jsonResponse(200, { accounts });
}

async function inviteUser(supabaseAdmin: AdminSupabaseClient, payload: Record<string, unknown>) {
    const email = typeof payload.email === 'string' ? payload.email.trim() : '';
    const fullName = typeof payload.fullName === 'string' ? payload.fullName.trim() : '';
    const plan = typeof payload.plan === 'string' ? payload.plan : 'free';
    const periodDays = parsePositiveInt(payload.periodDays, plan === 'trial' ? DEFAULT_TRIAL_DAYS : DEFAULT_PERIOD_DAYS);
    const invoiceId = typeof payload.invoiceId === 'string' ? payload.invoiceId.trim() : null;
    const invoiceDueDate = parseIsoDate(payload.invoiceDueDate);

    if (!email) {
        return jsonResponse(400, { error: 'Email is required' });
    }

    if (!ALLOWED_PLANS.has(plan)) {
        return jsonResponse(400, { error: 'Invalid plan' });
    }

    let userId: string | null = null;

    const existing = await findUserByEmail(supabaseAdmin, email);
    if (existing) {
        userId = existing.id;
    } else {
        const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
            data: {
                full_name: fullName
            }
        });
        if (error || !data.user) {
            return jsonResponse(400, { error: 'Could not invite user' });
        }
        userId = data.user.id;
    }

    if (!userId) {
        return jsonResponse(400, { error: 'Missing user id' });
    }

    const now = new Date();
    const updatePayload: Record<string, unknown> = {
        full_name: fullName || undefined,
        plan,
        billing_status: 'active',
        billing_provider: 'manual',
        grace_until: null,
        invoice_id: invoiceId,
        invoice_due_date: invoiceDueDate,
        paid_at: null
    };

    if (plan === 'pro') {
        updatePayload.period_end = addDays(now, periodDays).toISOString();
        updatePayload.trial_end = null;
    } else if (plan === 'trial') {
        updatePayload.trial_end = addDays(now, periodDays).toISOString();
        updatePayload.period_end = null;
    } else {
        updatePayload.period_end = null;
        updatePayload.trial_end = null;
    }

    const { error: updateError } = await (supabaseAdmin
        .from('profiles') as any)
        .upsert({ id: userId, ...updatePayload }, { onConflict: 'id' });

    if (updateError) {
        logger.error('Failed to update profile for invite', { error: updateError.message });
        return jsonResponse(500, { error: 'Failed to update profile' });
    }

    return jsonResponse(200, { success: true, userId });
}

async function updateAccount(supabaseAdmin: AdminSupabaseClient, payload: Record<string, unknown>) {
    const userId = typeof payload.userId === 'string' ? payload.userId : '';
    if (!userId) {
        return jsonResponse(400, { error: 'userId is required' });
    }

    const plan = typeof payload.plan === 'string' ? payload.plan : undefined;
    const billingStatus = typeof payload.billingStatus === 'string' ? payload.billingStatus : undefined;

    if (plan && !ALLOWED_PLANS.has(plan)) {
        return jsonResponse(400, { error: 'Invalid plan' });
    }

    if (billingStatus && !ALLOWED_STATUSES.has(billingStatus)) {
        return jsonResponse(400, { error: 'Invalid billing status' });
    }

    const periodDays = parsePositiveInt(payload.periodDays, DEFAULT_PERIOD_DAYS);
    const invoiceId = typeof payload.invoiceId === 'string' ? payload.invoiceId.trim() : null;
    const invoiceDueDate = parseIsoDate(payload.invoiceDueDate);

    const now = new Date();
    const updatePayload: Record<string, unknown> = {
        invoice_id: invoiceId,
        invoice_due_date: invoiceDueDate
    };

    if (plan) {
        updatePayload.plan = plan;
        if (plan === 'pro') {
            updatePayload.period_end = addDays(now, periodDays).toISOString();
            updatePayload.trial_end = null;
        } else if (plan === 'trial') {
            updatePayload.trial_end = addDays(now, periodDays).toISOString();
            updatePayload.period_end = null;
        } else {
            updatePayload.period_end = null;
            updatePayload.trial_end = null;
            updatePayload.grace_until = null;
        }
    }

    if (billingStatus) {
        updatePayload.billing_status = billingStatus;
        if (billingStatus === 'past_due') {
            updatePayload.grace_until = addDays(now, DEFAULT_GRACE_DAYS).toISOString();
        }
        if (billingStatus === 'active' || billingStatus === 'suspended') {
            updatePayload.grace_until = null;
        }
    }

    const { error } = await (supabaseAdmin
        .from('profiles') as any)
        .update(updatePayload)
        .eq('id', userId);

    if (error) {
        logger.error('Failed to update account', { error: error.message });
        return jsonResponse(500, { error: 'Failed to update account' });
    }

    return jsonResponse(200, { success: true });
}

async function markPaid(supabaseAdmin: AdminSupabaseClient, payload: Record<string, unknown>) {
    const userId = typeof payload.userId === 'string' ? payload.userId : '';
    if (!userId) {
        return jsonResponse(400, { error: 'userId is required' });
    }

    const periodDays = parsePositiveInt(payload.periodDays, DEFAULT_PERIOD_DAYS);

    const { data: profile, error } = await (supabaseAdmin
        .from('profiles') as any)
        .select('period_end')
        .eq('id', userId)
        .maybeSingle() as { data: Pick<ProfileRow, 'period_end'> | null; error: Error | null };

    if (error) {
        logger.error('Failed to load profile for mark_paid', { error: error.message });
        return jsonResponse(500, { error: 'Failed to load profile' });
    }

    const now = new Date();
    const currentEnd = profile?.period_end ? new Date(profile.period_end) : null;
    const base = currentEnd && currentEnd > now ? currentEnd : now;
    const newPeriodEnd = addDays(base, periodDays).toISOString();

    const { error: updateError } = await (supabaseAdmin
        .from('profiles') as any)
        .update({
            plan: 'pro',
            billing_status: 'active',
            period_end: newPeriodEnd,
            grace_until: null,
            trial_end: null,
            paid_at: now.toISOString()
        })
        .eq('id', userId);

    if (updateError) {
        logger.error('Failed to mark paid', { error: updateError.message });
        return jsonResponse(500, { error: 'Failed to update account' });
    }

    return jsonResponse(200, { success: true, period_end: newPeriodEnd });
}

Deno.serve(async (req: Request) => {
    const requestOrigin = req.headers.get('origin') || req.headers.get('Origin');
    const corsHeaders = getCorsHeaders(requestOrigin);

    if (req.method === 'OPTIONS') {
        return createOptionsResponse(req);
    }

    if (requestOrigin && !isOriginAllowed(requestOrigin)) {
        return createForbiddenOriginResponse(requestOrigin);
    }

    if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
            status: 405,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }

    const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
    if (!authHeader) {
        return jsonResponse(401, { error: 'Unauthorized' });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!supabaseUrl || !supabaseServiceKey) {
        return jsonResponse(500, { error: 'Server configuration error' });
    }

    const token = authHeader.replace(/^Bearer\s+/i, '');
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const adminResult = await requireAdmin(supabaseAdmin as AdminSupabaseClient, token);
    if ('error' in adminResult && adminResult.error) {
        return adminResult.error;
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = typeof body.action === 'string' ? body.action : '';
    const payload = (body.payload ?? {}) as Record<string, unknown>;

    try {
        switch (action) {
            case 'list':
                return await listAccounts(supabaseAdmin);
            case 'invite':
                return await inviteUser(supabaseAdmin, payload);
            case 'update':
                return await updateAccount(supabaseAdmin, payload);
            case 'mark_paid':
                return await markPaid(supabaseAdmin, payload);
            default:
                return jsonResponse(400, { error: 'Unknown action' });
        }
    } catch (error) {
        logger.error('Unhandled admin billing error', { error });
        return jsonResponse(500, { error: 'Unexpected error' });
    }
});

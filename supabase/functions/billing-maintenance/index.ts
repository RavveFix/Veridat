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

const logger = createLogger('billing-maintenance');

type AdminProfile = {
    id: string;
    is_admin: boolean | null;
};

type AdminSupabaseClient = SupabaseClient<any, any, any, any, any>;

function jsonResponse(status: number, body: Record<string, unknown>) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...getCorsHeaders(), 'Content-Type': 'application/json' }
    });
}

async function authorizeRequest(
    supabaseAdmin: AdminSupabaseClient,
    req: Request
): Promise<{ allowed: true; mode: 'admin' | 'cron' } | { allowed: false; response: Response }> {
    const cronSecret = Deno.env.get('BILLING_CRON_SECRET');
    const cronHeader = req.headers.get('x-cron-secret') || req.headers.get('X-Cron-Secret');

    if (!req.headers.get('authorization') && cronSecret && cronHeader === cronSecret) {
        return { allowed: true, mode: 'cron' };
    }

    const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
    if (!authHeader) {
        return { allowed: false, response: jsonResponse(401, { error: 'Unauthorized' }) };
    }

    const token = authHeader.replace(/^Bearer\s+/i, '');
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) {
        return { allowed: false, response: jsonResponse(401, { error: 'Unauthorized' }) };
    }

    const { data: profile, error: profileError } = await supabaseAdmin
        .from('profiles')
        .select('id, is_admin')
        .eq('id', user.id)
        .maybeSingle() as { data: AdminProfile | null; error: Error | null };

    if (profileError || !profile?.is_admin) {
        return { allowed: false, response: jsonResponse(403, { error: 'Admin access required' }) };
    }

    return { allowed: true, mode: 'admin' };
}

Deno.serve(async (req: Request) => {
    const requestOrigin = req.headers.get('origin') || req.headers.get('Origin');

    if (req.method === 'OPTIONS') {
        return createOptionsResponse(req);
    }

    if (requestOrigin && !isOriginAllowed(requestOrigin)) {
        return createForbiddenOriginResponse(requestOrigin);
    }

    if (req.method !== 'POST') {
        return jsonResponse(405, { error: 'Method not allowed' });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!supabaseUrl || !supabaseServiceKey) {
        return jsonResponse(500, { error: 'Server configuration error' });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const auth = await authorizeRequest(supabaseAdmin as AdminSupabaseClient, req);
    if (!auth.allowed) {
        return auth.response;
    }

    try {
        const { data, error } = await supabaseAdmin.rpc('run_billing_maintenance');
        if (error) {
            logger.error('Billing maintenance failed', { error: error.message });
            return jsonResponse(500, { error: 'Billing maintenance failed' });
        }

        return jsonResponse(200, {
            ok: true,
            mode: auth.mode,
            result: data
        });
    } catch (error) {
        logger.error('Unhandled billing maintenance error', { error });
        return jsonResponse(500, { error: 'Unexpected error' });
    }
});

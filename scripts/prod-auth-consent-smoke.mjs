#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const execFileAsync = promisify(execFile);

const SITE_URL = process.env.PROD_SITE_URL || 'https://veridat.se';
const VERCEL_URL = process.env.PROD_VERCEL_URL || 'https://veridat.vercel.app';
const IMAP_PORT = Number(process.env.SMOKE_IMAP_PORT || '993');
const IMAP_TLS = process.env.SMOKE_IMAP_TLS !== 'false';
const MAGICLINK_TIMEOUT_MS = Number(process.env.SMOKE_MAGIC_LINK_TIMEOUT_MS || '90000');
const MAGICLINK_MAX_ATTEMPTS = Number(process.env.SMOKE_MAGIC_LINK_MAX_ATTEMPTS || '4');
const MAGICLINK_RETRY_BASE_MS = Number(process.env.SMOKE_MAGIC_LINK_RETRY_BASE_MS || '15000');
const MAGICLINK_RETRY_MAX_MS = Number(process.env.SMOKE_MAGIC_LINK_RETRY_MAX_MS || '120000');
const DEFAULT_IMAP_MAILBOXES = 'INBOX,INBOX.Spam,INBOX.Junk,Spam,Junk';
const SHOW_PROGRESS = process.env.SMOKE_LOG_PROGRESS
    ? process.env.SMOKE_LOG_PROGRESS !== 'false'
    : Boolean(process.stdout.isTTY);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function ok(name, details = {}) {
    return { name, ok: true, details };
}

function fail(name, error, details = {}) {
    return {
        name,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        details
    };
}

function skipped(name, reason, details = {}) {
    return { name, ok: true, skipped: true, reason, details };
}

function progress(message) {
    if (!SHOW_PROGRESS) return;
    const ts = new Date().toISOString();
    console.log(`[smoke ${ts}] ${message}`);
}

function isEmailRateLimitError(message) {
    return /email rate limit exceeded|too many requests|rate limit/i.test(message);
}

function parseImapMailboxes() {
    const raw = process.env.SMOKE_IMAP_MAILBOXES || DEFAULT_IMAP_MAILBOXES;
    return raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
}

function parseProjectRefFromConfig() {
    const configPath = 'supabase/config.toml';
    if (!existsSync(configPath)) return null;
    const raw = readFileSync(configPath, 'utf8');
    const match = raw.match(/^project_id\s*=\s*"([^"]+)"/m);
    return match?.[1] ?? null;
}

async function resolveSupabaseKeys() {
    if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY) {
        return {
            supabaseUrl: process.env.SUPABASE_URL,
            anonKey: process.env.SUPABASE_ANON_KEY,
            serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
            source: 'env'
        };
    }

    const projectRef = process.env.SUPABASE_PROJECT_REF || parseProjectRefFromConfig();
    if (!projectRef) {
        throw new Error('Missing SUPABASE_PROJECT_REF and no project_id in supabase/config.toml');
    }

    const { stdout } = await execFileAsync('supabase', [
        'projects',
        'api-keys',
        '--project-ref',
        projectRef,
        '--output',
        'json'
    ]);

    const keys = JSON.parse(stdout);
    const anonKey = keys.find((k) => k.name === 'anon')?.api_key;
    const serviceRoleKey = keys.find((k) => k.name === 'service_role')?.api_key;
    if (!anonKey || !serviceRoleKey) {
        throw new Error('Could not resolve anon/service_role keys via Supabase CLI');
    }

    return {
        supabaseUrl: `https://${projectRef}.supabase.co`,
        anonKey,
        serviceRoleKey,
        source: 'supabase-cli'
    };
}

async function checkHostRedirect() {
    const res = await fetch(`${VERCEL_URL}/login`, { method: 'HEAD', redirect: 'manual' });
    const location = res.headers.get('location');
    if (![301, 302, 307, 308].includes(res.status)) {
        throw new Error(`Expected redirect status, got ${res.status}`);
    }
    if (location !== `${SITE_URL}/login`) {
        throw new Error(`Unexpected redirect location: ${location}`);
    }
    return { status: res.status, location };
}

async function checkLoginCopy() {
    const res = await fetch(`${SITE_URL}/login`);
    const html = await res.text();
    if (!res.ok) {
        throw new Error(`Expected 200 from /login, got ${res.status}`);
    }
    const hasDpaLink = html.includes('href="/dpa"');
    const hasDpaCopy = html.includes('godkänna användarvillkor, integritetspolicy och DPA');
    if (!hasDpaLink || !hasDpaCopy) {
        throw new Error('Login page missing DPA consent text/link');
    }
    return { hasDpaLink, hasDpaCopy, status: res.status };
}

async function checkLoginLocalStorageDocs() {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const email = `prod.smoke.${Date.now()}@gmail.com`;

    try {
        await page.goto(`${SITE_URL}/login`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#login-form', { timeout: 15000 });

        await page.evaluate(() => {
            const originalFetch = window.fetch.bind(window);
            window.__otpIntercepted = false;
            window.fetch = async (input, init) => {
                const url = typeof input === 'string'
                    ? input
                    : input instanceof URL
                        ? input.toString()
                        : input.url;

                if (url.includes('/auth/v1/otp')) {
                    window.__otpIntercepted = true;
                    return new Response(JSON.stringify({ user: null, session: null }), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' }
                    });
                }

                return originalFetch(input, init);
            };
        });

        const checkboxCount = await page.locator('#login-form input[type="checkbox"]').count();
        if (checkboxCount !== 1) {
            throw new Error(`Expected one consent checkbox, got ${checkboxCount}`);
        }

        await page.fill('#full-name', 'Prod Smoke User');
        await page.fill('#email', email);
        await page.check('#consent-terms');
        await page.click('#submit-btn');

        await page.waitForSelector('#message.success', { timeout: 15000 });

        const raw = await page.evaluate(() => localStorage.getItem('legal_acceptances_local'));
        const parsed = raw ? JSON.parse(raw) : null;
        const docs = Array.isArray(parsed?.docs) ? parsed.docs : [];
        const hasAll = docs.includes('terms') && docs.includes('privacy') && docs.includes('dpa');
        if (!hasAll) {
            throw new Error(`Missing docs in localStorage: ${JSON.stringify(docs)}`);
        }

        const otpIntercepted = await page.evaluate(() => Boolean(window.__otpIntercepted));
        if (!otpIntercepted) {
            throw new Error('OTP request was not intercepted');
        }

        return { email, docs };
    } finally {
        await browser.close();
    }
}

async function cleanupUserArtifacts(admin, userId) {
    if (!userId) return;
    await admin.from('legal_acceptances').delete().eq('user_id', userId);
    await admin.from('companies').delete().eq('user_id', userId);
    await admin.from('profiles').delete().eq('id', userId);
    await admin.auth.admin.deleteUser(userId);
}

async function checkDbConstraint(supabaseUrl, serviceRoleKey) {
    const admin = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false }
    });

    const email = `prod-db-smoke-${Date.now()}@example.com`;
    const version = `prod-db-smoke-${Date.now()}`;
    let userId = null;

    try {
        const { data: created, error: createError } = await admin.auth.admin.createUser({
            email,
            email_confirm: true
        });
        if (createError) throw new Error(`createUser failed: ${createError.message}`);
        userId = created.user?.id || null;
        if (!userId) throw new Error('createUser returned no user id');

        const { error: insertOkError } = await admin.from('legal_acceptances').insert({
            user_id: userId,
            doc_type: 'dpa',
            version,
            accepted_at: new Date().toISOString(),
            accepted_from: 'prelogin',
            dpa_authorized: false,
            company_id: 'company-smoke',
            company_org_number: '556677-8899'
        });
        if (insertOkError) throw new Error(`DPA insert with company context failed: ${insertOkError.message}`);

        const { data: row, error: rowError } = await admin
            .from('legal_acceptances')
            .select('company_org_number')
            .eq('user_id', userId)
            .eq('doc_type', 'dpa')
            .eq('version', version)
            .single();
        if (rowError) throw new Error(`Read-back failed: ${rowError.message}`);
        if (row.company_org_number !== '556677-8899') {
            throw new Error(`Unexpected company_org_number: ${row.company_org_number}`);
        }

        const { error: insertBadError } = await admin.from('legal_acceptances').insert({
            user_id: userId,
            doc_type: 'dpa',
            version: `${version}-missing-company`,
            accepted_at: new Date().toISOString(),
            accepted_from: 'prelogin',
            dpa_authorized: false,
            company_id: null
        });
        if (!insertBadError) {
            throw new Error('Expected DPA insert without company_id to fail');
        }
        if (!/legal_acceptances_dpa_requires_company_context|check constraint/i.test(insertBadError.message)) {
            throw new Error(`Unexpected constraint error: ${insertBadError.message}`);
        }

        return { companyOrgNumberStored: true, constraintBlockedInvalidInsert: true };
    } finally {
        if (userId) {
            await cleanupUserArtifacts(admin, userId);
        }
    }
}

async function checkMagicLinkRedirectResolution(supabaseUrl, serviceRoleKey) {
    const admin = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false }
    });

    const results = [];
    const requestedRedirects = [`${SITE_URL}/login`, `${VERCEL_URL}/login`];
    const createdUserIds = new Set();

    try {
        for (const requested of requestedRedirects) {
            const email = `prod-redirect-smoke-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
            const { data, error } = await admin.auth.admin.generateLink({
                type: 'magiclink',
                email,
                options: { redirectTo: requested }
            });
            if (error) throw new Error(`generateLink failed for ${requested}: ${error.message}`);
            const actionLink = data?.properties?.action_link;
            if (!actionLink) throw new Error(`Missing action_link for ${requested}`);

            const generatedUserId = data?.user?.id ?? null;
            if (generatedUserId) {
                createdUserIds.add(generatedUserId);
            }

            const parsed = new URL(actionLink);
            results.push({
                requested,
                effective: parsed.searchParams.get('redirect_to')
            });
        }

        const canonical = results.find((r) => r.requested === `${SITE_URL}/login`);
        const alias = results.find((r) => r.requested === `${VERCEL_URL}/login`);
        if (!canonical || canonical.effective !== `${SITE_URL}/login`) {
            throw new Error(`Canonical redirect mismatch: ${JSON.stringify(canonical)}`);
        }
        if (!alias || !alias.effective?.startsWith(SITE_URL)) {
            throw new Error(`Alias redirect mismatch: ${JSON.stringify(alias)}`);
        }

        return results;
    } finally {
        for (const userId of createdUserIds) {
            await cleanupUserArtifacts(admin, userId);
        }
    }
}

function decodeQuotedPrintable(text) {
    return text
        .replace(/=\r?\n/g, '')
        .replace(/=([A-Fa-f0-9]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function extractMagicLink(raw, marker) {
    const normalized = decodeQuotedPrintable(raw).replace(/&amp;/g, '&');
    const urls = normalized.match(/https:\/\/[^\s<>"')]+/g) || [];
    const candidates = urls.filter((u) => u.includes('/auth/v1/verify'));
    if (!marker) return candidates[0] || null;
    return candidates.find((u) => u.includes(marker)) || null;
}

async function waitForInboxMagicLink({ host, port, secure, user, pass, marker, timeoutMs }) {
    const { ImapFlow } = await import('imapflow');
    const mailboxCandidates = parseImapMailboxes();
    progress(`Connecting to IMAP ${host}:${port} as ${user}`);
    const client = new ImapFlow({
        host,
        port,
        secure,
        logger: false,
        auth: { user, pass }
    });

    await client.connect();
    progress(`IMAP connected, polling mailboxes: ${mailboxCandidates.join(', ')}`);
    const startedAt = Date.now();
    const since = new Date(Date.now() - 10 * 60 * 1000);
    const missingMailboxes = new Set();

    try {
        while (Date.now() - startedAt < timeoutMs) {
            for (const mailbox of mailboxCandidates) {
                if (missingMailboxes.has(mailbox)) continue;

                let lock = null;
                try {
                    lock = await client.getMailboxLock(mailbox);
                    const ids = await client.search({ since });
                    const recent = ids.slice(-30).reverse();

                    for (const id of recent) {
                        const message = await client.fetchOne(id, { source: true, envelope: true, internalDate: true });
                        if (!message?.source) continue;
                        const source = message.source.toString('utf8');
                        if (marker && !source.includes(marker)) continue;

                        const link = extractMagicLink(source, marker);
                        if (!link) continue;

                        return {
                            id,
                            mailbox,
                            link,
                            subject: message.envelope?.subject || null,
                            date: message.internalDate ? message.internalDate.toISOString() : null
                        };
                    }
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    if (/does not exist|mailbox.*not found|unknown mailbox|can't open mailbox/i.test(message)) {
                        missingMailboxes.add(mailbox);
                        progress(`Mailbox '${mailbox}' not found, skipping`);
                    } else {
                        throw error;
                    }
                } finally {
                    if (lock) {
                        lock.release();
                    }
                }
            }

            const elapsed = Math.round((Date.now() - startedAt) / 1000);
            progress(`Inbox poll: no matching link yet (${elapsed}s/${Math.round(timeoutMs / 1000)}s)`);
            await sleep(2000);
        }
    } finally {
        await client.logout();
    }

    throw new Error(`Timed out waiting for magic link in inbox (${timeoutMs}ms)`);
}

async function requestMagicLinkWithRetry(anon, { email, redirectTo }) {
    let lastError = null;
    let attempt = 0;

    for (attempt = 1; attempt <= MAGICLINK_MAX_ATTEMPTS; attempt += 1) {
        progress(`Requesting OTP email (attempt ${attempt}/${MAGICLINK_MAX_ATTEMPTS})`);
        const { error } = await anon.auth.signInWithOtp({
            email,
            options: {
                emailRedirectTo: redirectTo
            }
        });

        if (!error) {
            progress(`OTP request accepted on attempt ${attempt}`);
            return { attempts: attempt };
        }

        const message = `signInWithOtp failed: ${error.message}`;
        lastError = new Error(message);
        if (!isEmailRateLimitError(message) || attempt >= MAGICLINK_MAX_ATTEMPTS) {
            progress(`OTP request failed without retry: ${message}`);
            break;
        }

        const waitMs = Math.min(
            MAGICLINK_RETRY_BASE_MS * (2 ** (attempt - 1)),
            MAGICLINK_RETRY_MAX_MS
        );
        progress(`Rate-limited. Waiting ${Math.round(waitMs / 1000)}s before retry`);
        await sleep(waitMs);
    }

    if (lastError) {
        lastError.message = `${lastError.message} (attempts=${attempt}/${MAGICLINK_MAX_ATTEMPTS})`;
    }
    throw lastError || new Error('signInWithOtp failed: unknown error');
}

async function checkRealInboxMagicLinkFlow(supabaseUrl, anonKey) {
    const host = process.env.SMOKE_IMAP_HOST;
    const user = process.env.SMOKE_IMAP_USER;
    const pass = process.env.SMOKE_IMAP_PASS;
    const targetEmail = process.env.SMOKE_TEST_EMAIL || user;
    if (!host || !user || !pass || !targetEmail) {
        throw new Error('Missing SMOKE_IMAP_HOST/SMOKE_IMAP_USER/SMOKE_IMAP_PASS/SMOKE_TEST_EMAIL');
    }

    const anon = createClient(supabaseUrl, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false }
    });

    const smokeId = `smoke-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const redirectTo = `${SITE_URL}/login?smoke_id=${encodeURIComponent(smokeId)}`;

    const requestDetails = await requestMagicLinkWithRetry(anon, {
        email: targetEmail,
        redirectTo
    });

    const inboxHit = await waitForInboxMagicLink({
        host,
        port: IMAP_PORT,
        secure: IMAP_TLS,
        user,
        pass,
        marker: smokeId,
        timeoutMs: MAGICLINK_TIMEOUT_MS
    });

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
        await page.goto(inboxHit.link, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(8000);
        const finalUrl = page.url();
        const final = new URL(finalUrl);
        const expectedHost = new URL(SITE_URL).host;
        if (final.host !== expectedHost) {
            throw new Error(`Magic link resolved to unexpected host: ${final.host}`);
        }
        if (!final.pathname.startsWith('/login') && !final.pathname.startsWith('/app')) {
            throw new Error(`Magic link resolved to unexpected path: ${final.pathname}`);
        }

        return {
            email: targetEmail,
            smokeId,
            signInAttempts: requestDetails.attempts,
            mailboxMessageId: inboxHit.id,
            mailbox: inboxHit.mailbox || null,
            mailboxSubject: inboxHit.subject,
            finalUrl
        };
    } finally {
        await browser.close();
    }
}

async function main() {
    const summary = {
        startedAt: new Date().toISOString(),
        status: 'ok',
        config: {
            siteUrl: SITE_URL,
            vercelUrl: VERCEL_URL
        },
        checks: []
    };

    try {
        const keys = await resolveSupabaseKeys();
        summary.config.supabaseUrl = keys.supabaseUrl;
        summary.config.keysSource = keys.source;

        try {
            progress('Running check: host_redirect');
            const details = await checkHostRedirect();
            summary.checks.push(ok('host_redirect', details));
        } catch (error) {
            summary.checks.push(fail('host_redirect', error));
        }

        try {
            progress('Running check: login_copy');
            const details = await checkLoginCopy();
            summary.checks.push(ok('login_copy', details));
        } catch (error) {
            summary.checks.push(fail('login_copy', error));
        }

        try {
            progress('Running check: login_local_storage_docs');
            const details = await checkLoginLocalStorageDocs();
            summary.checks.push(ok('login_local_storage_docs', details));
        } catch (error) {
            summary.checks.push(fail('login_local_storage_docs', error));
        }

        try {
            progress('Running check: db_dpa_constraint_and_org_number');
            const details = await checkDbConstraint(keys.supabaseUrl, keys.serviceRoleKey);
            summary.checks.push(ok('db_dpa_constraint_and_org_number', details));
        } catch (error) {
            summary.checks.push(fail('db_dpa_constraint_and_org_number', error));
        }

        try {
            progress('Running check: magic_link_redirect_resolution');
            const details = await checkMagicLinkRedirectResolution(keys.supabaseUrl, keys.serviceRoleKey);
            summary.checks.push(ok('magic_link_redirect_resolution', details));
        } catch (error) {
            summary.checks.push(fail('magic_link_redirect_resolution', error));
        }

        const hasImapConfig = Boolean(
            process.env.SMOKE_IMAP_HOST && process.env.SMOKE_IMAP_USER && process.env.SMOKE_IMAP_PASS
        );
        summary.config.imapConfigured = hasImapConfig;

        if (hasImapConfig) {
            try {
                progress('Running check: real_inbox_magic_link_flow');
                const details = await checkRealInboxMagicLinkFlow(keys.supabaseUrl, keys.anonKey);
                summary.checks.push(ok('real_inbox_magic_link_flow', details));
            } catch (error) {
                summary.checks.push(fail('real_inbox_magic_link_flow', error));
            }
        } else {
            progress('Skipping check: real_inbox_magic_link_flow (missing IMAP env)');
            summary.checks.push(skipped(
                'real_inbox_magic_link_flow',
                'Set SMOKE_IMAP_HOST, SMOKE_IMAP_USER and SMOKE_IMAP_PASS to enable'
            ));
        }
    } catch (error) {
        summary.checks.push(fail('bootstrap', error));
    }

    const failed = summary.checks.filter((c) => !c.ok);
    summary.status = failed.length > 0 ? 'failed' : 'ok';
    summary.finishedAt = new Date().toISOString();
    console.log(JSON.stringify(summary, null, 2));
    if (failed.length > 0) {
        process.exit(1);
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});

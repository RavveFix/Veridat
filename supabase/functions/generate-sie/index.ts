/// <reference path="../types/deno.d.ts" />

import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, createOptionsResponse } from "../../services/CorsService.ts";
import { RateLimiterService } from "../../services/RateLimiterService.ts";
import { createLogger } from "../../services/LoggerService.ts";

const logger = createLogger('generate-sie');

// ============================================================================
// SIE4 Generator - TypeScript port of .skills/svensk-ekonomi/scripts/sie_export.py
// ============================================================================

interface SIETransaction {
    account: string;
    debit: number;
    credit: number;
}

interface SIEVerification {
    number: number;
    date: string; // YYYYMMDD
    description: string;
    transactions: SIETransaction[];
}

interface SIEExporterOptions {
    companyName: string;
    orgNumber: string;
    fiscalYearStart?: string; // MMDD, default "0101"
    fiscalYearEnd?: string;   // MMDD, default "1231"
}

// Standard BAS accounts used in VAT reports
const STANDARD_ACCOUNTS: Record<string, string> = {
    '1510': 'Kundfordringar',
    '2440': 'Leverantörsskulder',
    '2611': 'Utgående moms 25%',
    '2621': 'Utgående moms 12%',
    '2631': 'Utgående moms 6%',
    '2641': 'Ingående moms',
    '2650': 'Momsredovisning',
    '3010': 'Försäljning tjänster 25%',
    '3011': 'Försäljning tjänster momsfri',
    '3012': 'Roaming-intäkter',
    '6540': 'IT-tjänster',
    '6590': 'Övriga externa tjänster',
    '6591': 'Plattformsavgifter',
    '6592': 'Abonnemangskostnader',
};

function cleanOrgNumber(orgNr: string): string {
    return orgNr.replace(/[^0-9]/g, '');
}

function formatAmount(amount: number): string {
    // SIE uses dot as decimal separator
    return amount.toFixed(2);
}

function formatDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
}

function generateSIE4(
    options: SIEExporterOptions,
    accounts: Record<string, string>,
    verifications: SIEVerification[],
    openingBalances: Record<string, number>,
    year: number,
): string {
    const { companyName, orgNumber, fiscalYearStart = '0101', fiscalYearEnd = '1231' } = options;
    const cleanOrg = cleanOrgNumber(orgNumber);
    const genDate = formatDate(new Date());

    const lines: string[] = [];

    // Header
    lines.push('#FLAGGA 0');
    lines.push('#FORMAT PC8');
    lines.push('#SIETYP 4');
    lines.push('#PROGRAM "Veridat" 1.0');
    lines.push(`#GEN ${genDate}`);
    lines.push(`#FNAMN "${companyName}"`);
    lines.push(`#ORGNR ${cleanOrg}`);
    lines.push(`#RAR 0 ${year}${fiscalYearStart} ${year}${fiscalYearEnd}`);
    lines.push('#KPTYP BAS2024');
    lines.push('');

    // Chart of accounts
    const sortedAccounts = Object.entries(accounts).sort(([a], [b]) => a.localeCompare(b));
    if (sortedAccounts.length > 0) {
        lines.push('# Kontoplan');
        for (const [num, name] of sortedAccounts) {
            lines.push(`#KONTO ${num} "${name}"`);
        }
        lines.push('');
    }

    // Opening balances
    const sortedBalances = Object.entries(openingBalances).sort(([a], [b]) => a.localeCompare(b));
    if (sortedBalances.length > 0) {
        lines.push('# Ingående balanser');
        for (const [account, balance] of sortedBalances) {
            lines.push(`#IB 0 ${account} ${formatAmount(balance)}`);
        }
        lines.push('');
    }

    // Verifications
    if (verifications.length > 0) {
        lines.push('# Verifikationer');
        for (const ver of verifications) {
            const desc = ver.description.replace(/"/g, "'");
            lines.push(`#VER "" ${ver.number} ${ver.date} "${desc}"`);
            lines.push('{');

            for (const trans of ver.transactions) {
                const amount = trans.debit - trans.credit;
                if (amount !== 0) {
                    lines.push(`    #TRANS ${trans.account} {} ${formatAmount(amount)}`);
                }
            }

            lines.push('}');
        }
        lines.push('');
    }

    return lines.join('\n');
}

// ============================================================================
// Request / Response types
// ============================================================================

interface JournalEntry {
    account: string;
    name?: string;
    debit: number;
    credit: number;
}

interface GenerateSIERequest {
    company: {
        name: string;
        org_number: string;
    };
    period: string;
    year?: number;
    journal_entries: JournalEntry[];
}

// ============================================================================
// Edge Function handler
// ============================================================================

Deno.serve(async (req: Request) => {
    const corsHeaders = getCorsHeaders();

    if (req.method === 'OPTIONS') {
        return createOptionsResponse();
    }

    try {
        if (req.method !== 'POST') {
            return new Response(
                JSON.stringify({ error: 'Method not allowed' }),
                { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
        if (!authHeader) {
            return new Response(
                JSON.stringify({ error: 'Unauthorized' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

        if (!supabaseUrl || !supabaseServiceKey) {
            return new Response(
                JSON.stringify({ error: 'Server configuration error' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const token = authHeader.replace(/^Bearer\s+/i, '');
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
        const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
        if (userError || !user) {
            return new Response(
                JSON.stringify({ error: 'Unauthorized' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const rateLimiter = new RateLimiterService(supabaseAdmin);
        const rateLimit = await rateLimiter.checkAndIncrement(user.id, 'fortnox');
        if (!rateLimit.allowed) {
            return new Response(
                JSON.stringify({
                    error: 'rate_limit_exceeded',
                    message: rateLimit.message,
                    remaining: rateLimit.remaining,
                    resetAt: rateLimit.resetAt.toISOString(),
                }),
                {
                    status: 429,
                    headers: {
                        ...corsHeaders,
                        'Content-Type': 'application/json',
                        'X-RateLimit-Remaining': String(rateLimit.remaining),
                        'X-RateLimit-Reset': rateLimit.resetAt.toISOString(),
                    },
                }
            );
        }

        const body = await req.json() as GenerateSIERequest;

        if (!body.company?.name || !body.company?.org_number || !body.journal_entries?.length) {
            return new Response(
                JSON.stringify({ error: 'Missing required fields: company (name, org_number), journal_entries' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const year = body.year || new Date().getFullYear();

        // Collect all accounts used in journal entries + standard accounts
        const accounts: Record<string, string> = { ...STANDARD_ACCOUNTS };
        for (const entry of body.journal_entries) {
            if (!accounts[entry.account] && entry.name) {
                accounts[entry.account] = entry.name;
            }
        }

        // Build transactions
        const transactions: SIETransaction[] = body.journal_entries.map(e => ({
            account: e.account,
            debit: e.debit || 0,
            credit: e.credit || 0,
        }));

        // Create a single verification from the journal entries
        const verDate = formatDate(new Date());
        const verifications: SIEVerification[] = [{
            number: 1,
            date: verDate,
            description: `Momsredovisning ${body.period}`,
            transactions,
        }];

        const sieContent = generateSIE4(
            { companyName: body.company.name, orgNumber: body.company.org_number },
            accounts,
            verifications,
            {}, // No opening balances for VAT report SIE
            year,
        );

        const filename = `SIE4_${body.company.org_number.replace(/[^0-9]/g, '')}_${body.period.replace(/\s+/g, '_')}.se`;

        logger.info('SIE4 file generated', {
            userId: user.id,
            company: body.company.name,
            period: body.period,
            entries: body.journal_entries.length,
        });

        return new Response(
            JSON.stringify({ content: sieContent, filename }),
            {
                status: 200,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
        );

    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error('generate-sie error', error);
        return new Response(
            JSON.stringify({ error: errorMessage }),
            { status: 400, headers: { ...getCorsHeaders(), 'Content-Type': 'application/json' } }
        );
    }
});

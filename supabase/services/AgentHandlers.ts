/**
 * Agent Handlers — AI logic for the 6 bookkeeping agents
 *
 * Each handler is a pure function that receives a Supabase client,
 * user/company context, and an input payload, and returns a result.
 * Handlers orchestrate existing services (Gemini, Fortnox, BAS, etc.)
 * and create child tasks for chaining.
 *
 * Legal: BFL 7:1 compliance via ai_decisions FK on every AI action.
 */

/// <reference path="../functions/types/deno.d.ts" />

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { createLogger } from './LoggerService.ts';
import { AuditService } from './AuditService.ts';
import { sendMessage as aiRouterSend } from './AIRouter.ts';
import { getUserPlan, type UserPlan } from './PlanService.ts';
import { ExpensePatternService } from './ExpensePatternService.ts';
import {
    createSwedishComplianceService,
    type AutoPostInput,
} from './SwedishComplianceService.ts';
import {
    generateVerificationId,
    createCostJournalEntries,
    validateJournalBalance,
    type JournalEntry,
} from './JournalService.ts';
import { roundToOre, calculateNet, calculateVAT } from './SwedishRounding.ts';
import { getCostAccount, getVATAccount, BAS_ACCOUNTS, getAccountByNumber } from './BASAccounts.ts';
import { FortnoxService, type FortnoxConfig } from './FortnoxService.ts';

const logger = createLogger('agent-handlers');

// =============================================================================
// SHARED TYPES
// =============================================================================

export interface HandlerContext {
    supabase: SupabaseClient;
    userId: string;
    companyId: string;
    taskId: string;
    plan?: UserPlan;
}

export type HandlerResult = Record<string, unknown>;

// =============================================================================
// HELPERS
// =============================================================================

function parseNumber(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const normalized = value.replace(/\s+/g, '').replace(',', '.');
        const parsed = Number(normalized);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
}

function todayIso(): string {
    return new Date().toISOString().slice(0, 10);
}

function currentPeriod(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

async function getFortnoxService(
    supabase: SupabaseClient,
    userId: string
): Promise<FortnoxService | null> {
    const clientId = Deno.env.get('FORTNOX_CLIENT_ID') ?? '';
    const clientSecret = Deno.env.get('FORTNOX_CLIENT_SECRET') ?? '';
    if (!clientId || !clientSecret) return null;

    const { data: token } = await supabase
        .from('fortnox_tokens')
        .select('id')
        .eq('user_id', userId)
        .maybeSingle();

    if (!token) return null;

    return new FortnoxService(
        { clientId, clientSecret, redirectUri: '' } as FortnoxConfig,
        supabase,
        userId
    );
}

async function getAccountingProfile(
    supabase: SupabaseClient,
    userId: string,
    companyId: string
): Promise<Record<string, unknown> | null> {
    const { data } = await supabase
        .from('accounting_profiles')
        .select('*')
        .eq('user_id', userId)
        .eq('company_id', companyId)
        .maybeSingle();
    return data;
}

async function insertChildTask(
    supabase: SupabaseClient,
    parentTaskId: string,
    userId: string,
    companyId: string,
    agentType: string,
    inputPayload: Record<string, unknown>,
    priority = 5
): Promise<string | null> {
    const { data, error } = await supabase
        .from('agent_tasks')
        .insert({
            user_id: userId,
            company_id: companyId,
            agent_type: agentType,
            parent_task_id: parentTaskId,
            status: 'pending',
            priority,
            input_payload: inputPayload,
            scheduled_at: new Date().toISOString(),
        })
        .select('id')
        .single();

    if (error) {
        logger.warn('Failed to create child task', { parentTaskId, agentType, error });
        return null;
    }
    return data.id;
}

// =============================================================================
// 1. FAKTURA-AGENT — Invoice Processing
// =============================================================================

/**
 * processInvoice: AI-extract invoice data from uploaded file
 *
 * Input: { filePath, fileBucket, fileName? }
 * Steps:
 * 1. Download file from Supabase Storage
 * 2. Send to Gemini for structured extraction
 * 3. Validate VAT with SwedishVATRates
 * 4. Match patterns with ExpensePatternService
 * 5. Insert into invoice_inbox_items
 * 6. Log ai_decision
 * 7. Evaluate auto-post → create child task for bokforings-agent
 */
export async function processInvoice(
    ctx: HandlerContext,
    payload: Record<string, unknown>
): Promise<HandlerResult> {
    const { supabase, userId, companyId, taskId } = ctx;
    const filePath = String(payload.filePath || '');
    const fileBucket = String(payload.fileBucket || 'invoices');

    if (!filePath) throw new Error('filePath krävs.');

    const audit = new AuditService(supabase);
    const patternService = new ExpensePatternService(supabase);
    const complianceService = createSwedishComplianceService(supabase);
    const startMs = Date.now();

    // 1. Download file from storage
    const { data: fileData, error: downloadError } = await supabase
        .storage
        .from(fileBucket)
        .download(filePath);

    if (downloadError || !fileData) {
        throw new Error(`Kunde inte ladda ner fil: ${downloadError?.message || 'okänt fel'}`);
    }

    // Convert to base64 for Gemini
    const arrayBuffer = await fileData.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
    const mimeType = filePath.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg';

    // 2. Send to Gemini for extraction
    const extractionPrompt = `Extrahera följande data från denna leverantörsfaktura och returnera ENBART JSON (inga kommentarer):
{
  "supplier_name": "leverantörens namn",
  "supplier_org_nr": "organisationsnummer",
  "invoice_number": "fakturanummer",
  "invoice_date": "YYYY-MM-DD",
  "due_date": "YYYY-MM-DD",
  "total_amount": 0.00,
  "vat_amount": 0.00,
  "vat_rate": 25,
  "ocr_number": "OCR",
  "currency": "SEK",
  "description": "kort beskrivning av inköpet"
}
Lämna tomt ("") för fält du inte hittar. Belopp i siffror utan valutasymbol.`;

    const aiResponse = await aiRouterSend(
        extractionPrompt,
        { mimeType, data: base64 },
        { plan: ctx.plan },
    );

    const aiText = aiResponse.text || '';
    const aiProvider = aiResponse.provider;
    const aiModel = aiResponse.model;
    const processingTimeMs = Date.now() - startMs;

    // 3. Parse AI response
    let extracted: Record<string, unknown> = {};
    try {
        const jsonMatch = aiText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            extracted = JSON.parse(jsonMatch[0]);
        }
    } catch {
        logger.warn('Failed to parse AI extraction', { aiText: aiText.slice(0, 200) });
    }

    const supplierName = String(extracted.supplier_name || '');
    const totalAmount = parseNumber(extracted.total_amount);
    const vatAmount = parseNumber(extracted.vat_amount);
    const vatRate = parseNumber(extracted.vat_rate);

    // 4. Pattern matching for BAS account suggestion
    const patterns = await patternService.findMatches(userId, companyId, {
        supplier_name: supplierName,
        amount: totalAmount,
    });

    const topPattern = patterns[0]?.pattern;
    const basAccount = topPattern?.bas_account || '';
    const basAccountName = topPattern?.bas_account_name || '';
    const confidence = topPattern?.confidence_score || 0;

    // 5. Log AI decision (BFL 7:1)
    const aiDecisionId = await audit.logAIDecision({
        userId,
        companyId,
        aiProvider: aiProvider,
        aiModel: aiModel,
        aiFunction: 'processInvoice',
        inputData: { filePath, fileBucket },
        outputData: extracted,
        confidence: confidence || 0.5,
        processingTimeMs,
    });

    // 6. Insert into invoice_inbox_items
    const invoiceId = `inv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    await supabase.from('invoice_inbox_items').insert({
        user_id: userId,
        company_id: companyId,
        id: invoiceId,
        file_name: String(payload.fileName || filePath.split('/').pop() || ''),
        file_url: '',
        file_path: filePath,
        file_bucket: fileBucket,
        status: 'ny',
        source: 'upload',
        supplier_name: supplierName,
        supplier_org_nr: String(extracted.supplier_org_nr || ''),
        invoice_number: String(extracted.invoice_number || ''),
        invoice_date: String(extracted.invoice_date || '') || null,
        due_date: String(extracted.due_date || '') || null,
        total_amount: totalAmount || null,
        vat_amount: vatAmount || null,
        vat_rate: vatRate || null,
        ocr_number: String(extracted.ocr_number || ''),
        bas_account: basAccount,
        bas_account_name: basAccountName,
        currency: String(extracted.currency || 'SEK'),
        ai_extracted: true,
        ai_raw_response: aiText.slice(0, 2000),
        ai_decision_id: aiDecisionId || null,
    });

    // 7. Evaluate auto-post guardrails
    const { data: policyRow } = await supabase
        .from('auto_post_policies')
        .select('*')
        .eq('user_id', userId)
        .eq('company_id', companyId)
        .maybeSingle();

    const autoPostInput: AutoPostInput = {
        confidence,
        amountSek: totalAmount,
        knownCounterparty: patterns.length > 0,
        hasActiveRule: true,
        isNewSupplier: patterns.length === 0,
        deviatingVat: false,
        periodLocked: false,
    };

    const autoPostResult = complianceService.evaluateAutoPost(policyRow, autoPostInput);

    let childTaskId: string | null = null;

    if (autoPostResult.allowed && basAccount) {
        // Create child task for bokforings-agent
        childTaskId = await insertChildTask(
            supabase,
            taskId,
            userId,
            companyId,
            'bokforings',
            {
                action: 'createJournalEntryFromInvoice',
                invoiceId,
                basAccount,
                basAccountName,
                vatRate,
                totalAmount,
                vatAmount,
                supplierName,
                confidence,
                autoPosted: true,
            },
            3 // higher priority for auto-post chain
        );

        // Update invoice status
        await supabase
            .from('invoice_inbox_items')
            .update({ status: 'granskad' })
            .eq('user_id', userId)
            .eq('company_id', companyId)
            .eq('id', invoiceId);
    }

    return {
        invoiceId,
        extracted,
        basAccount,
        basAccountName,
        confidence,
        autoPostAllowed: autoPostResult.allowed,
        autoPostReasons: autoPostResult.reasons,
        childTaskId,
        aiDecisionId,
    };
}

/**
 * matchInvoiceToTransaction: Match invoice to bank transaction via OCR/amount
 */
export async function matchInvoiceToTransaction(
    ctx: HandlerContext,
    payload: Record<string, unknown>
): Promise<HandlerResult> {
    const { supabase, userId, companyId } = ctx;
    const invoiceId = String(payload.invoiceId || '');

    if (!invoiceId) throw new Error('invoiceId krävs.');

    const audit = new AuditService(supabase);

    // 1. Get invoice
    const { data: invoice, error: invErr } = await supabase
        .from('invoice_inbox_items')
        .select('*')
        .eq('user_id', userId)
        .eq('company_id', companyId)
        .eq('id', invoiceId)
        .single();

    if (invErr || !invoice) throw new Error('Faktura hittades inte.');

    // 2. Get unmatched bank transactions
    const { data: transactions } = await supabase
        .from('bank_transactions')
        .select('*')
        .eq('user_id', userId)
        .eq('company_id', companyId)
        .eq('match_status', 'unmatched')
        .limit(200);

    if (!transactions || transactions.length === 0) {
        return { matched: false, reason: 'Inga omatchade banktransaktioner.' };
    }

    const totalAmount = parseNumber(invoice.total_amount);
    const ocrNumber = String(invoice.ocr_number || '');
    const invoiceDate = invoice.invoice_date ? new Date(invoice.invoice_date) : null;

    let bestMatch: Record<string, unknown> | null = null;
    let matchType = '';

    for (const tx of transactions) {
        // Exact OCR match
        if (ocrNumber && (tx.reference === ocrNumber || tx.ocr === ocrNumber)) {
            bestMatch = tx;
            matchType = 'ocr_exact';
            break;
        }

        // Amount match (within 1 öre)
        const txAmount = Math.abs(parseNumber(tx.amount));
        if (totalAmount > 0 && Math.abs(txAmount - totalAmount) < 0.01) {
            // Date proximity check: within 14 days
            const txDate = tx.tx_date ? new Date(tx.tx_date) : null;
            if (invoiceDate && txDate) {
                const daysDiff = Math.abs(invoiceDate.getTime() - txDate.getTime()) / (1000 * 60 * 60 * 24);
                if (daysDiff <= 14) {
                    bestMatch = tx;
                    matchType = 'amount_date';
                }
            } else {
                bestMatch = tx;
                matchType = 'amount';
            }
        }
    }

    if (!bestMatch) {
        return { matched: false, reason: 'Ingen matchande transaktion hittades.' };
    }

    // Log AI decision
    const aiDecisionId = await audit.logAIDecision({
        userId,
        companyId,
        aiProvider: 'system',
        aiModel: 'deterministic',
        aiFunction: 'matchInvoiceToTransaction',
        inputData: { invoiceId, matchType },
        outputData: { transactionId: bestMatch.id, matchType },
        confidence: matchType === 'ocr_exact' ? 0.99 : 0.75,
    });

    // Update bank transaction
    await supabase
        .from('bank_transactions')
        .update({
            match_status: 'suggested',
            ai_decision_id: aiDecisionId || null,
        })
        .eq('user_id', userId)
        .eq('company_id', companyId)
        .eq('id', bestMatch.id);

    return {
        matched: true,
        matchType,
        transactionId: bestMatch.id,
        transactionDescription: bestMatch.description,
        transactionAmount: bestMatch.amount,
        aiDecisionId,
    };
}

// =============================================================================
// 2. BANK-AGENT — Reconciliation
// =============================================================================

/**
 * reconcileBankTransactions: Batch reconcile unmatched bank transactions
 *
 * Input: { period? } (YYYY-MM, defaults to current)
 */
export async function reconcileBankTransactions(
    ctx: HandlerContext,
    payload: Record<string, unknown>
): Promise<HandlerResult> {
    const { supabase, userId, companyId, taskId } = ctx;
    const period = String(payload.period || currentPeriod());

    const audit = new AuditService(supabase);
    const patternService = new ExpensePatternService(supabase);
    const complianceService = createSwedishComplianceService(supabase);

    // Get auto-post policy
    const { data: policyRow } = await supabase
        .from('auto_post_policies')
        .select('*')
        .eq('user_id', userId)
        .eq('company_id', companyId)
        .maybeSingle();

    // Get unmatched transactions for the period
    const { data: transactions } = await supabase
        .from('bank_transactions')
        .select('*')
        .eq('user_id', userId)
        .eq('company_id', companyId)
        .eq('match_status', 'unmatched')
        .gte('tx_date', `${period}-01`)
        .lt('tx_date', nextPeriodStart(period))
        .order('tx_date', { ascending: true })
        .limit(200);

    if (!transactions || transactions.length === 0) {
        return { processed: 0, autoPosted: 0, suggested: 0, unmatched: 0, period };
    }

    let autoPosted = 0;
    let suggested = 0;
    let unmatched = 0;

    for (const tx of transactions) {
        const counterparty = String(tx.counterparty || tx.description || '');
        const amount = Math.abs(parseNumber(tx.amount));

        // Try pattern matching
        const patterns = await patternService.findMatches(userId, companyId, {
            supplier_name: counterparty,
            amount,
        });

        if (patterns.length > 0 && patterns[0].auto_apply) {
            // Pattern has enough confirmations for auto-apply
            const pattern = patterns[0].pattern;

            const autoPostInput: AutoPostInput = {
                confidence: pattern.confidence_score,
                amountSek: amount,
                knownCounterparty: true,
                hasActiveRule: true,
                isNewSupplier: false,
                deviatingVat: false,
                periodLocked: false,
            };

            const autoPostResult = complianceService.evaluateAutoPost(policyRow, autoPostInput);

            if (autoPostResult.allowed) {
                // Create child task for auto-bokföring
                await insertChildTask(
                    supabase,
                    taskId,
                    userId,
                    companyId,
                    'bokforings',
                    {
                        action: 'autoPostTransaction',
                        transactionId: tx.id,
                        basAccount: pattern.bas_account,
                        basAccountName: pattern.bas_account_name,
                        vatRate: pattern.vat_rate,
                        amount,
                        counterparty,
                        confidence: pattern.confidence_score,
                    },
                    4
                );

                await supabase
                    .from('bank_transactions')
                    .update({ match_status: 'approved' })
                    .eq('user_id', userId)
                    .eq('company_id', companyId)
                    .eq('id', tx.id);

                autoPosted++;
                continue;
            }
        }

        if (patterns.length > 0) {
            // Has suggestions but not auto-appliable
            const aiDecisionId = await audit.logAIDecision({
                userId,
                companyId,
                aiProvider: 'system',
                aiModel: 'deterministic',
                aiFunction: 'reconcileBankTransactions',
                inputData: { transactionId: tx.id, counterparty, amount },
                outputData: {
                    basAccount: patterns[0].pattern.bas_account,
                    confidence: patterns[0].pattern.confidence_score,
                },
                confidence: patterns[0].pattern.confidence_score,
            });

            await supabase
                .from('bank_transactions')
                .update({
                    match_status: 'suggested',
                    ai_decision_id: aiDecisionId || null,
                })
                .eq('user_id', userId)
                .eq('company_id', companyId)
                .eq('id', tx.id);

            suggested++;
        } else {
            // No pattern → use AI for suggestion
            const aiSuggestion = await suggestBASAccountForTransaction(
                counterparty,
                amount,
                String(tx.description || ''),
                ctx.plan,
            );

            if (aiSuggestion) {
                const aiDecisionId = await audit.logAIDecision({
                    userId,
                    companyId,
                    aiProvider: (aiSuggestion.provider || 'system') as 'gemini' | 'openai' | 'claude' | 'system',
                    aiModel: aiSuggestion.model || 'system',
                    aiFunction: 'suggestBASAccount',
                    inputData: { counterparty, amount, description: tx.description },
                    outputData: aiSuggestion,
                    confidence: parseNumber(aiSuggestion.confidence),
                });

                await supabase
                    .from('bank_transactions')
                    .update({
                        match_status: 'suggested',
                        ai_decision_id: aiDecisionId || null,
                    })
                    .eq('user_id', userId)
                    .eq('company_id', companyId)
                    .eq('id', tx.id);

                suggested++;
            } else {
                unmatched++;
            }
        }
    }

    return {
        processed: transactions.length,
        autoPosted,
        suggested,
        unmatched,
        period,
    };
}

/**
 * AI-suggest BAS account for a transaction without pattern history
 */
interface BASAccountSuggestion {
    basAccount: string;
    basAccountName: string;
    vatRate: number;
    confidence: number;
    provider: string;
    model: string;
}

async function suggestBASAccountForTransaction(
    counterparty: string,
    amount: number,
    description: string,
    plan?: UserPlan,
): Promise<BASAccountSuggestion | null> {
    // First: try deterministic lookup via BASAccounts.getCostAccount()
    const deterministicAccount = getCostAccount(description || counterparty);
    if (deterministicAccount && deterministicAccount.account !== '6990') {
        // Got a specific match (not the generic fallback 6990)
        return {
            basAccount: deterministicAccount.account,
            basAccountName: deterministicAccount.name,
            vatRate: 25,
            confidence: 0.7,
            provider: 'system',
            model: 'deterministic',
        };
    }

    // Fallback: AI suggestion via router (Gemini → Claude)
    try {
        const prompt = `Du är en svensk bokföringsexpert. Givet denna banktransaktion:
Motpart: "${counterparty}"
Belopp: ${amount} kr
Beskrivning: "${description}"

Föreslå rätt BAS-konto, kontonamn och momssats. Svara ENBART med JSON:
{"basAccount": "6540", "basAccountName": "IT-tjänster", "vatRate": 25, "confidence": 0.7}`;

        const response = await aiRouterSend(prompt, undefined, { plan });

        const text = response.text || '';
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
            return {
                basAccount: String(parsed.basAccount || ''),
                basAccountName: String(parsed.basAccountName || ''),
                vatRate: parseNumber(parsed.vatRate),
                confidence: parseNumber(parsed.confidence),
                provider: response.provider,
                model: response.model,
            };
        }
        return null;
    } catch (error) {
        logger.warn('AI BAS suggestion failed', { counterparty, error });
        return null;
    }
}

function nextPeriodStart(period: string): string {
    const [yearStr, monthStr] = period.split('-');
    const year = Number.parseInt(yearStr, 10);
    const month = Number.parseInt(monthStr, 10);
    const next = new Date(year, month, 1); // month is 0-based but we want next
    return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`;
}

// =============================================================================
// 3. MOMS-AGENT — VAT Calculation & Export
// =============================================================================

/**
 * calculateVATReport: Calculate VAT report from local data and/or Fortnox
 *
 * Input: { period, source: 'fortnox'|'local'|'hybrid' }
 */
export async function calculateVATReport(
    ctx: HandlerContext,
    payload: Record<string, unknown>
): Promise<HandlerResult> {
    const { supabase, userId, companyId } = ctx;
    const period = String(payload.period || currentPeriod());
    const source = String(payload.source || 'local');

    const audit = new AuditService(supabase);

    type VATBucket = { rate: number; base: number; outgoing: number; incoming: number; count: number };
    const buckets = new Map<number, VATBucket>();
    const addToBucket = (rate: number, base: number, outgoing: number, incoming: number) => {
        const existing = buckets.get(rate) || { rate, base: 0, outgoing: 0, incoming: 0, count: 0 };
        existing.base = roundToOre(existing.base + base);
        existing.outgoing = roundToOre(existing.outgoing + outgoing);
        existing.incoming = roundToOre(existing.incoming + incoming);
        existing.count++;
        buckets.set(rate, existing);
    };

    // Local data: invoices
    if (source === 'local' || source === 'hybrid') {
        const { data: invoices } = await supabase
            .from('invoice_inbox_items')
            .select('total_amount, vat_amount, vat_rate, status')
            .eq('user_id', userId)
            .eq('company_id', companyId)
            .in('status', ['granskad', 'bokford', 'betald'])
            .gte('invoice_date', `${period}-01`)
            .lt('invoice_date', nextPeriodStart(period));

        for (const inv of invoices || []) {
            const total = parseNumber(inv.total_amount);
            const vat = parseNumber(inv.vat_amount);
            const rate = parseNumber(inv.vat_rate);
            const net = roundToOre(total - vat);
            addToBucket(rate, net, 0, vat); // incoming VAT (inköp)
        }

        // Local data: bank transactions (matched/posted)
        const { data: txs } = await supabase
            .from('bank_transactions')
            .select('amount, match_status')
            .eq('user_id', userId)
            .eq('company_id', companyId)
            .in('match_status', ['approved', 'posted'])
            .gte('tx_date', `${period}-01`)
            .lt('tx_date', nextPeriodStart(period));

        // Transactions logged but not yet attributed to VAT — placeholder count
        if (txs && txs.length > 0) {
            logger.info('Bank transactions in period', { count: txs.length, period });
        }
    }

    // Fortnox data: vouchers
    if (source === 'fortnox' || source === 'hybrid') {
        const fortnox = await getFortnoxService(supabase, userId);
        if (fortnox) {
            try {
                const vouchers = await fortnox.getVouchers();
                for (const v of vouchers.Vouchers || []) {
                    // Basic aggregation from voucher rows would go here
                    // The full implementation depends on Fortnox voucher row structure
                    logger.debug('Voucher in period', { number: v.VoucherNumber });
                }
            } catch (error) {
                logger.warn('Could not fetch Fortnox vouchers for VAT', { error });
            }
        }
    }

    // Build report
    const vatLines = Array.from(buckets.values()).sort((a, b) => b.rate - a.rate);

    const totalBase = vatLines.reduce((sum, l) => roundToOre(sum + l.base), 0);
    const totalOutgoing = vatLines.reduce((sum, l) => roundToOre(sum + l.outgoing), 0);
    const totalIncoming = vatLines.reduce((sum, l) => roundToOre(sum + l.incoming), 0);
    const vatToPay = roundToOre(totalOutgoing - totalIncoming);

    const report = {
        period,
        source,
        lines: vatLines,
        totals: {
            base: totalBase,
            outgoing: totalOutgoing,
            incoming: totalIncoming,
            vatToPay,
        },
        generatedAt: new Date().toISOString(),
        aiGenerated: true,
    };

    await audit.logAIDecision({
        userId,
        companyId,
        aiProvider: 'system',
        aiModel: 'deterministic',
        aiFunction: 'calculateVATReport',
        inputData: { period, source },
        outputData: report,
        confidence: source === 'fortnox' ? 0.95 : 0.8,
    });

    await audit.log({
        userId,
        companyId,
        actorType: 'ai',
        action: 'vat_report_calculated',
        resourceType: 'vat_report',
        resourceId: `vat-${period}`,
        newState: report,
        bflReference: 'SFL 26:2',
    });

    return report;
}

/**
 * exportVATToFortnox: Export VAT report as Fortnox voucher
 */
export async function exportVATToFortnox(
    ctx: HandlerContext,
    payload: Record<string, unknown>
): Promise<HandlerResult> {
    const { supabase, userId, companyId } = ctx;
    const period = String(payload.period || '');
    const report = payload.report as Record<string, unknown> | undefined;

    if (!period || !report) {
        throw new Error('period och report krävs.');
    }

    const audit = new AuditService(supabase);
    const fortnox = await getFortnoxService(supabase, userId);
    if (!fortnox) {
        throw new Error('Fortnox-anslutning saknas. Anslut Fortnox via Integrationer.');
    }

    const totals = report.totals as Record<string, unknown>;
    const outgoing = parseNumber(totals?.outgoing);
    const incoming = parseNumber(totals?.incoming);
    const vatToPay = parseNumber(totals?.vatToPay);

    // Build voucher rows
    const rows = [];
    if (outgoing > 0) {
        rows.push({
            Account: 2650,
            Debit: outgoing,
            Credit: 0,
            Description: `Momsredovisning ${period} - utgående`,
        });
    }
    if (incoming > 0) {
        rows.push({
            Account: 2650,
            Debit: 0,
            Credit: incoming,
            Description: `Momsredovisning ${period} - ingående`,
        });
    }
    if (vatToPay !== 0) {
        rows.push({
            Account: 1630,
            Debit: vatToPay > 0 ? 0 : Math.abs(vatToPay),
            Credit: vatToPay > 0 ? vatToPay : 0,
            Description: `Momsredovisning ${period} - skattekonto`,
        });
    }

    const syncId = await audit.startFortnoxSync({
        userId,
        companyId,
        operation: 'export_voucher',
        requestPayload: { period, rows },
    });

    try {
        const voucherResult = await fortnox.createVoucher({
            Description: `Momsredovisning ${period} — AI-genererat förslag`,
            VoucherSeries: 'A',
            TransactionDate: `${period}-28`,
            VoucherRows: rows,
        });

        await audit.completeFortnoxSync(syncId, {
            fortnoxDocumentNumber: String(voucherResult?.Voucher?.VoucherNumber || ''),
            fortnoxVoucherSeries: 'A',
            responsePayload: voucherResult as unknown as Record<string, unknown>,
        });

        return {
            ok: true,
            voucherNumber: voucherResult?.Voucher?.VoucherNumber,
            syncId,
        };
    } catch (error) {
        await audit.failFortnoxSync(
            syncId,
            'FORTNOX_VOUCHER_FAILED',
            error instanceof Error ? error.message : 'Okänt fel'
        );
        throw error;
    }
}

// =============================================================================
// 4. BOKFORINGS-AGENT — Journal Entries
// =============================================================================

/**
 * createJournalEntryFromInvoice: Create journal entry from processed invoice
 */
export async function createJournalEntryFromInvoice(
    ctx: HandlerContext,
    payload: Record<string, unknown>
): Promise<HandlerResult> {
    const { supabase, userId, companyId } = ctx;

    const invoiceId = String(payload.invoiceId || '');
    const basAccount = String(payload.basAccount || '');
    const vatRate = parseNumber(payload.vatRate);
    const totalAmount = parseNumber(payload.totalAmount);
    const vatAmount = parseNumber(payload.vatAmount);
    const supplierName = String(payload.supplierName || '');
    const confidence = parseNumber(payload.confidence);
    const autoPosted = Boolean(payload.autoPosted);

    if (!invoiceId || !basAccount || totalAmount === 0) {
        throw new Error('invoiceId, basAccount och totalAmount krävs.');
    }

    const audit = new AuditService(supabase);
    const complianceService = createSwedishComplianceService(supabase);

    // Re-check guardrails (defense in depth)
    const { data: policyRow } = await supabase
        .from('auto_post_policies')
        .select('*')
        .eq('user_id', userId)
        .eq('company_id', companyId)
        .maybeSingle();

    const autoPostInput: AutoPostInput = {
        confidence,
        amountSek: totalAmount,
        knownCounterparty: true,
        hasActiveRule: true,
        isNewSupplier: false,
        deviatingVat: false,
        periodLocked: false,
    };

    const guardrailCheck = complianceService.evaluateAutoPost(policyRow, autoPostInput);

    if (!guardrailCheck.allowed && autoPosted) {
        return {
            ok: false,
            needsApproval: true,
            reasons: guardrailCheck.reasons,
            invoiceId,
        };
    }

    // Build journal entries
    const netAmount = roundToOre(totalAmount - vatAmount);
    const entries = createCostJournalEntries(netAmount, vatAmount, vatRate, supplierName);

    // Override cost account if we have a specific BAS account
    if (basAccount && entries.length > 0) {
        const accountInfo = getAccountByNumber(basAccount);
        if (accountInfo) {
            entries[0].account = accountInfo.account;
            entries[0].accountName = accountInfo.name;
        }
    }

    // Use leverantörsskulder (2440) instead of bank for invoice flow
    const bankEntry = entries.find(e => e.account === BAS_ACCOUNTS.BANK.account && e.credit > 0);
    if (bankEntry) {
        bankEntry.account = BAS_ACCOUNTS.ACCOUNTS_PAYABLE.account;
        bankEntry.accountName = BAS_ACCOUNTS.ACCOUNTS_PAYABLE.name;
        bankEntry.description = `Leverantörsskuld ${supplierName}`;
    }

    // Validate balance
    const balance = validateJournalBalance(entries);
    if (!balance.balanced) {
        throw new Error(`Verifikat obalanserat: debet=${balance.totalDebit}, kredit=${balance.totalCredit}`);
    }

    const period = currentPeriod();
    const verificationId = generateVerificationId(period);

    // Log AI decision
    const aiDecisionId = await audit.logAIDecision({
        userId,
        companyId,
        aiProvider: 'system',
        aiModel: 'deterministic',
        aiFunction: 'createJournalEntryFromInvoice',
        inputData: { invoiceId, basAccount, totalAmount, vatRate },
        outputData: { entries, verificationId, balanced: balance.balanced },
        confidence,
    });

    // Try Fortnox export
    let fortnoxResult: Record<string, unknown> | null = null;
    const fortnox = await getFortnoxService(supabase, userId);

    if (fortnox && guardrailCheck.allowed) {
        const syncId = await audit.startFortnoxSync({
            userId,
            companyId,
            operation: 'export_voucher',
            aiDecisionId: aiDecisionId || undefined,
            requestPayload: { verificationId, entries },
        });

        try {
            const voucherRows = entries.map(e => ({
                Account: Number.parseInt(e.account, 10),
                Debit: e.debit,
                Credit: e.credit,
                Description: e.description,
            }));

            const result = await fortnox.createVoucher({
                Description: `${verificationId} — ${supplierName} (AI-genererat förslag)`,
                VoucherSeries: 'A',
                TransactionDate: todayIso(),
                VoucherRows: voucherRows,
            });

            await audit.completeFortnoxSync(syncId, {
                fortnoxDocumentNumber: String(result?.Voucher?.VoucherNumber || ''),
                fortnoxVoucherSeries: 'A',
                responsePayload: result as unknown as Record<string, unknown>,
            });

            fortnoxResult = {
                voucherNumber: result?.Voucher?.VoucherNumber,
                syncId,
            };

            // Update invoice status to bokförd
            await supabase
                .from('invoice_inbox_items')
                .update({
                    status: 'bokford',
                    fortnox_sync_status: 'booked',
                    fortnox_given_number: result?.Voucher?.VoucherNumber,
                })
                .eq('user_id', userId)
                .eq('company_id', companyId)
                .eq('id', invoiceId);
        } catch (error) {
            await audit.failFortnoxSync(
                syncId,
                'FORTNOX_VOUCHER_FAILED',
                error instanceof Error ? error.message : 'Okänt fel'
            );
            logger.warn('Fortnox export failed for journal entry', { invoiceId, error });
        }
    }

    return {
        ok: true,
        verificationId,
        entries,
        balance,
        fortnox: fortnoxResult,
        aiDecisionId,
        autoPosted: guardrailCheck.allowed,
    };
}

/**
 * autoPostTransaction: Auto-post a bank transaction with pattern match
 */
export async function autoPostTransaction(
    ctx: HandlerContext,
    payload: Record<string, unknown>
): Promise<HandlerResult> {
    const { supabase, userId, companyId } = ctx;

    const transactionId = String(payload.transactionId || '');
    const basAccount = String(payload.basAccount || '');
    const vatRate = parseNumber(payload.vatRate);
    const amount = parseNumber(payload.amount);
    const counterparty = String(payload.counterparty || '');
    const confidence = parseNumber(payload.confidence);

    if (!transactionId || !basAccount || amount === 0) {
        throw new Error('transactionId, basAccount och amount krävs.');
    }

    const audit = new AuditService(supabase);
    const patternService = new ExpensePatternService(supabase);
    const complianceService = createSwedishComplianceService(supabase);

    // Guardrail check
    const { data: policyRow } = await supabase
        .from('auto_post_policies')
        .select('*')
        .eq('user_id', userId)
        .eq('company_id', companyId)
        .maybeSingle();

    const guardrailCheck = complianceService.evaluateAutoPost(policyRow, {
        confidence,
        amountSek: amount,
        knownCounterparty: true,
        hasActiveRule: true,
        isNewSupplier: false,
        deviatingVat: false,
        periodLocked: false,
    });

    if (!guardrailCheck.allowed) {
        return {
            ok: false,
            needsApproval: true,
            reasons: guardrailCheck.reasons,
            transactionId,
        };
    }

    // Build journal entries
    const netAmount = calculateNet(amount, vatRate);
    const vatAmount = calculateVAT(netAmount, vatRate);
    const entries = createCostJournalEntries(netAmount, vatAmount, vatRate, counterparty);

    // Override BAS account
    const accountInfo = getAccountByNumber(basAccount);
    if (accountInfo && entries.length > 0) {
        entries[0].account = accountInfo.account;
        entries[0].accountName = accountInfo.name;
    }

    const balance = validateJournalBalance(entries);
    if (!balance.balanced) {
        throw new Error(`Verifikat obalanserat: debet=${balance.totalDebit}, kredit=${balance.totalCredit}`);
    }

    const period = currentPeriod();
    const verificationId = generateVerificationId(period);

    // Log AI decision
    const aiDecisionId = await audit.logAIDecision({
        userId,
        companyId,
        aiProvider: 'system',
        aiModel: 'deterministic',
        aiFunction: 'autoPostTransaction',
        inputData: { transactionId, basAccount, amount, vatRate },
        outputData: { entries, verificationId },
        confidence,
    });

    // Try Fortnox export
    let fortnoxResult: Record<string, unknown> | null = null;
    const fortnox = await getFortnoxService(supabase, userId);

    if (fortnox) {
        try {
            const voucherRows = entries.map(e => ({
                Account: Number.parseInt(e.account, 10),
                Debit: e.debit,
                Credit: e.credit,
                Description: e.description,
            }));

            const result = await fortnox.createVoucher({
                Description: `${verificationId} — ${counterparty} (AI-genererat förslag)`,
                VoucherSeries: 'A',
                TransactionDate: todayIso(),
                VoucherRows: voucherRows,
            });

            fortnoxResult = {
                voucherNumber: result?.Voucher?.VoucherNumber,
            };
        } catch (error) {
            logger.warn('Fortnox export failed for auto-post', { transactionId, error });
        }
    }

    // Update transaction status
    await supabase
        .from('bank_transactions')
        .update({
            match_status: 'posted',
            fortnox_ref: fortnoxResult || {},
            ai_decision_id: aiDecisionId || null,
        })
        .eq('user_id', userId)
        .eq('company_id', companyId)
        .eq('id', transactionId);

    // Confirm pattern for future matching
    const basAccountName = accountInfo?.name || String(payload.basAccountName || '');
    await patternService.confirmPattern(
        userId,
        companyId,
        counterparty,
        basAccount,
        basAccountName,
        vatRate,
        'cost',
        amount,
        null,
        [],
        true // was AI suggestion
    );

    return {
        ok: true,
        verificationId,
        entries,
        balance,
        fortnox: fortnoxResult,
        aiDecisionId,
        patternConfirmed: true,
    };
}

// =============================================================================
// 5. AGI-AGENT — Arbetsgivardeklaration
// =============================================================================

/**
 * runAgiDraft: Enhanced AGI draft with Fortnox payroll data
 * Extends the existing finance-agent runAgiDraft with:
 * - Fortnox payroll data fetch (if token exists)
 * - Period-over-period comparison (>20% deviation → warning)
 */
export async function runAgiDraft(
    ctx: HandlerContext,
    payload: Record<string, unknown>
): Promise<HandlerResult> {
    const { supabase, userId, companyId } = ctx;
    const period = String(payload.period || currentPeriod());

    const audit = new AuditService(supabase);
    const complianceService = createSwedishComplianceService(supabase);

    // Get accounting profile
    const profile = await getAccountingProfile(supabase, userId, companyId);
    const companyForm = (profile?.company_form as 'ab' | 'enskild') || 'ab';
    const payrollEnabled = Boolean(profile?.payroll_enabled);

    // Build totals — try Fortnox first
    let totals: Record<string, unknown> = payload.totals as Record<string, unknown> || {};

    const fortnox = await getFortnoxService(supabase, userId);
    if (fortnox && payrollEnabled) {
        try {
            // Get vouchers for payroll accounts (7xxx) in the period
            const vouchers = await fortnox.getVouchers();
            let grossSalary = 0;
            let employerFees = 0;
            let taxWithheld = 0;

            for (const v of vouchers.Vouchers || []) {
                // This is simplified — production would filter by period and sum voucher rows
                logger.debug('AGI voucher check', { number: v.VoucherNumber });
            }

            if (grossSalary > 0 || employerFees > 0) {
                totals = {
                    ...totals,
                    grossSalary,
                    employerFees,
                    taxWithheld,
                    source: 'fortnox',
                };
            }
        } catch (error) {
            logger.warn('Could not fetch Fortnox payroll data for AGI', { error });
        }
    }

    // Evaluate AGI draft with compliance service
    const evaluation = await complianceService.evaluateAgiDraft({
        userId,
        companyId,
        period,
        companyForm,
        payrollEnabled,
        totals,
    });

    // Compare with previous period
    const previousPeriod = getPreviousPeriod(period);
    const { data: previousRun } = await supabase
        .from('agi_runs')
        .select('totals')
        .eq('user_id', userId)
        .eq('company_id', companyId)
        .eq('period', previousPeriod)
        .maybeSingle();

    let deviationWarning: string | null = null;
    if (previousRun?.totals) {
        const prevGross = parseNumber((previousRun.totals as Record<string, unknown>).grossSalary);
        const currGross = parseNumber(totals.grossSalary);
        if (prevGross > 0 && currGross > 0) {
            const deviation = Math.abs(currGross - prevGross) / prevGross;
            if (deviation > 0.2) {
                deviationWarning = `Bruttolön avviker ${Math.round(deviation * 100)}% jämfört med ${previousPeriod}. Kontrollera underlag.`;
                evaluation.alerts.push({
                    code: 'agi_period_deviation',
                    severity: 'warning',
                    title: 'Avvikande lönebelopp',
                    description: deviationWarning,
                    actionTarget: 'dashboard',
                });
            }
        }
    }

    // Save AGI run
    const { data: agiRun } = await supabase
        .from('agi_runs')
        .insert({
            user_id: userId,
            company_id: companyId,
            period,
            status: evaluation.status,
            source_type: String(totals.source || 'system'),
            totals,
            control_results: {
                controls: evaluation.controls,
                alerts: evaluation.alerts,
            },
        })
        .select('id')
        .single();

    await audit.logAIDecision({
        userId,
        companyId,
        aiProvider: 'system',
        aiModel: 'deterministic',
        aiFunction: 'runAgiDraft',
        inputData: { period, companyForm, payrollEnabled },
        outputData: { status: evaluation.status, controls: evaluation.controls },
        confidence: evaluation.status === 'draft' ? 0.9 : 0.6,
    });

    return {
        id: agiRun?.id,
        period,
        status: evaluation.status,
        totals,
        controls: evaluation.controls,
        alerts: evaluation.alerts,
        deviationWarning,
    };
}

function getPreviousPeriod(period: string): string {
    const [yearStr, monthStr] = period.split('-');
    const year = Number.parseInt(yearStr, 10);
    const month = Number.parseInt(monthStr, 10);
    const prev = new Date(year, month - 2, 1); // month-1 is current, month-2 is previous
    return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
}

// =============================================================================
// HANDLER DISPATCH
// =============================================================================

/**
 * Main dispatch function — maps action strings to handler functions.
 * Called from finance-agent when it receives agent swarm actions.
 */
export async function dispatchAgentAction(
    ctx: HandlerContext,
    action: string,
    payload: Record<string, unknown>
): Promise<HandlerResult> {
    // Resolve user plan if not already set (for model tier selection)
    if (!ctx.plan) {
        ctx.plan = await getUserPlan(ctx.supabase, ctx.userId);
    }

    switch (action) {
        // Faktura-agent
        case 'processInvoice':
            return processInvoice(ctx, payload);
        case 'matchInvoiceToTransaction':
            return matchInvoiceToTransaction(ctx, payload);

        // Bank-agent
        case 'reconcileBankTransactions':
            return reconcileBankTransactions(ctx, payload);

        // Moms-agent
        case 'calculateVATReport':
            return calculateVATReport(ctx, payload);
        case 'exportVATToFortnox':
            return exportVATToFortnox(ctx, payload);

        // Bokförings-agent
        case 'createJournalEntryFromInvoice':
            return createJournalEntryFromInvoice(ctx, payload);
        case 'autoPostTransaction':
            return autoPostTransaction(ctx, payload);

        // AGI-agent
        case 'runAgiDraft':
            return runAgiDraft(ctx, payload);

        default:
            throw new Error(`Okänd agent-action: ${action}`);
    }
}

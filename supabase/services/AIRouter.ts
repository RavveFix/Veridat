/**
 * AI Router — Gemini primary, Claude fallback
 *
 * Provides a unified interface for agent handlers.
 * Tries Gemini first; on rate limit, timeout, or server error
 * falls back to Claude. Tracks which provider actually responded.
 *
 * Usage:
 *   const result = await aiRouter.sendMessage(prompt, fileData);
 *   result.text    — AI response text
 *   result.provider — 'gemini' | 'claude'
 *   result.model   — actual model used
 */

/// <reference path="../functions/types/deno.d.ts" />

import { createLogger } from './LoggerService.ts';
import {
    sendMessageToGemini,
    GeminiRateLimitError,
    type FileData,
} from './GeminiService.ts';
import {
    sendMessageToClaude,
    ClaudeRateLimitError,
    type ClaudeFileData,
} from './ClaudeService.ts';
import type { AIProvider } from './AuditService.ts';
import type { UserPlan } from './PlanService.ts';

const logger = createLogger('ai-router');

/**
 * Gemini model selection based on user plan.
 * Free → Flash (fast, cheap). Pro/trial → Pro (better quality).
 */
const GEMINI_MODELS: Record<UserPlan, string> = {
    free: 'gemini-3-flash-preview',
    trial: 'gemini-3-pro-preview',
    pro: 'gemini-3-pro-preview',
};

export function resolveGeminiModel(plan?: UserPlan): string {
    if (plan && plan in GEMINI_MODELS) return GEMINI_MODELS[plan];
    return Deno.env.get('GEMINI_MODEL') || GEMINI_MODELS.free;
}

export interface AIRouterResponse {
    text: string;
    provider: AIProvider;
    model: string;
}

export interface AIRouterFileData {
    mimeType: string;
    data: string; // base64
}

export interface AIRouterOptions {
    /** User's plan — determines Gemini model tier */
    plan?: UserPlan;
    /** Optional system prompt for Claude fallback */
    systemPrompt?: string;
}

/**
 * Errors that should trigger Claude fallback
 */
function shouldFallback(error: unknown): boolean {
    // Gemini rate limit
    if (error instanceof GeminiRateLimitError) return true;

    if (error instanceof Error) {
        const msg = error.message.toLowerCase();

        // HTTP 429 / 500 / 502 / 503
        if (/\b(429|500|502|503)\b/.test(msg)) return true;

        // Timeout
        if (/timeout|timed?\s*out|aborted/i.test(msg)) return true;

        // Resource exhausted (Google quota)
        if (/resource.*exhausted|quota.*exceeded/i.test(msg)) return true;
    }

    return false;
}

/**
 * Send message with Gemini-first, Claude-fallback strategy.
 *
 * @param message - The prompt text
 * @param fileData - Optional base64-encoded file (image/PDF)
 * @param options - Plan (for model tier) + optional system prompt
 */
export async function sendMessage(
    message: string,
    fileData?: AIRouterFileData,
    options?: AIRouterOptions | string,
): Promise<AIRouterResponse> {
    // Backwards compat: if options is a string, treat as systemPrompt
    const opts: AIRouterOptions = typeof options === 'string'
        ? { systemPrompt: options }
        : (options || {});

    const geminiModel = resolveGeminiModel(opts.plan);

    // --- Try Gemini first ---
    try {
        const geminiFile: FileData | undefined = fileData
            ? { mimeType: fileData.mimeType, data: fileData.data }
            : undefined;

        const geminiResponse = await sendMessageToGemini(
            message,
            geminiFile,
            undefined, // history
            undefined, // apiKey
            geminiModel,
            { disableTools: true },
        );

        return {
            text: geminiResponse.text || '',
            provider: 'gemini',
            model: geminiModel,
        };
    } catch (geminiError) {
        if (!shouldFallback(geminiError)) {
            throw geminiError;
        }

        logger.warn('Gemini failed, falling back to Claude', {
            model: geminiModel,
            error: geminiError instanceof Error ? geminiError.message : String(geminiError),
        });
    }

    // --- Fallback to Claude ---
    const claudeApiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!claudeApiKey) {
        throw new Error(
            'Gemini är otillgänglig och ANTHROPIC_API_KEY saknas. Kan inte fortsätta.',
        );
    }

    const claudeFile: ClaudeFileData | undefined = fileData
        ? { mimeType: fileData.mimeType, data: fileData.data }
        : undefined;

    const claudeResponse = await sendMessageToClaude(
        message,
        claudeFile,
        opts.systemPrompt || 'Du är en svensk bokföringsexpert. Svara alltid på svenska.',
    );

    return {
        text: claudeResponse.text,
        provider: 'claude',
        model: claudeResponse.model,
    };
}

/**
 * Convenience: re-export for external use
 */
export const aiRouter = { sendMessage };

/**
 * Claude Service — Lightweight Anthropic API client for Deno Edge Functions
 *
 * Used as fallback when Gemini is rate-limited or unavailable.
 * Returns the same { text } shape as GeminiResponse for compatibility.
 */

/// <reference path="../functions/types/deno.d.ts" />

import { createLogger } from './LoggerService.ts';

const logger = createLogger('claude');

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 2048;
const TIMEOUT_MS = 30_000;

export interface ClaudeResponse {
    text: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
}

export interface ClaudeFileData {
    mimeType: string;
    data: string; // base64
}

/**
 * Send a message to Claude API with optional file (image/PDF).
 * Returns structured text response — no tool use.
 */
export async function sendMessageToClaude(
    message: string,
    fileData?: ClaudeFileData,
    systemPrompt?: string,
): Promise<ClaudeResponse> {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
        throw new Error('ANTHROPIC_API_KEY not found in environment');
    }

    const model = Deno.env.get('CLAUDE_MODEL') || DEFAULT_MODEL;

    // Build content blocks
    const content: Array<Record<string, unknown>> = [];

    // Add file if present (image or PDF as base64)
    if (fileData?.data && fileData?.mimeType) {
        if (fileData.mimeType === 'application/pdf') {
            content.push({
                type: 'document',
                source: {
                    type: 'base64',
                    media_type: fileData.mimeType,
                    data: fileData.data,
                },
            });
        } else {
            content.push({
                type: 'image',
                source: {
                    type: 'base64',
                    media_type: fileData.mimeType,
                    data: fileData.data,
                },
            });
        }
    }

    content.push({ type: 'text', text: message });

    const body: Record<string, unknown> = {
        model,
        max_tokens: MAX_TOKENS,
        messages: [{ role: 'user', content }],
    };

    if (systemPrompt) {
        body.system = systemPrompt;
    }

    logger.info('Calling Claude API', { model, hasFile: !!fileData });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const response = await fetch(ANTHROPIC_API_URL, {
            method: 'POST',
            headers: {
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json',
            },
            body: JSON.stringify(body),
            signal: controller.signal,
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            const isRateLimit = response.status === 429;

            if (isRateLimit) {
                throw new ClaudeRateLimitError(
                    `Claude API rate limit (429): ${errorText}`,
                );
            }

            throw new Error(`Claude API error (${response.status}): ${errorText || response.statusText}`);
        }

        const data = await response.json() as {
            content?: Array<{ type: string; text?: string }>;
            model?: string;
            usage?: { input_tokens?: number; output_tokens?: number };
        };

        const textBlock = data.content?.find((b) => b.type === 'text');
        const text = textBlock?.text || '';

        return {
            text,
            model: data.model || model,
            inputTokens: data.usage?.input_tokens || 0,
            outputTokens: data.usage?.output_tokens || 0,
        };
    } finally {
        clearTimeout(timeoutId);
    }
}

/**
 * Claude-specific rate limit error
 */
export class ClaudeRateLimitError extends Error {
    public readonly isRateLimit = true;

    constructor(message: string) {
        super(message);
        this.name = 'ClaudeRateLimitError';
    }
}

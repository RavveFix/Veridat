/**
 * Typed application event bus with legacy event compatibility.
 *
 * During migration, canonical "app.*" events are emitted together with
 * legacy event names so older listeners continue to work.
 */

export type RateLimitPayload = {
    remaining?: number;
    resetAt?: string | null;
    message?: string | null;
};

export type AppEventMap = {
    'app.chat.refresh': undefined;
    'app.chat.error': { message: string };
    'app.chat.rateLimit': { remaining: number; resetAt: string | null; message?: string | null };
    'app.chat.rateLimit.active': RateLimitPayload;
    'app.chat.rateLimit.cleared': undefined;
    'app.chat.streaming.chunk': { chunk: string; isNewResponse?: boolean };
    'app.chat.optimisticMessage.add': { content: string; file_name?: string | null; file_url?: string | null };
    'app.conversation.loading': { loading: boolean; conversationId?: string | null };
    'app.conversation.messagesLoaded': { count: number; conversationId?: string | null };
    'app.conversation.list.refresh': { force?: boolean };
};

type AppEventName = keyof AppEventMap;

const LEGACY_EVENT_NAMES: Partial<Record<AppEventName, string>> = {
    'app.chat.refresh': 'chat-refresh',
    'app.chat.error': 'chat-error',
    'app.chat.rateLimit': 'chat-rate-limit',
    'app.chat.rateLimit.active': 'rate-limit-active',
    'app.chat.rateLimit.cleared': 'rate-limit-cleared',
    'app.chat.streaming.chunk': 'chat-streaming-chunk',
    'app.chat.optimisticMessage.add': 'add-optimistic-message',
    'app.conversation.loading': 'conversation-loading',
    'app.conversation.messagesLoaded': 'chat-messages-loaded',
    'app.conversation.list.refresh': 'refresh-conversation-list'
};

type AppEventOptions = {
    emitLegacy?: boolean;
    listenLegacy?: boolean;
};

function dispatchCustomEvent(name: string, detail: unknown): void {
    if (detail === undefined) {
        window.dispatchEvent(new CustomEvent(name));
        return;
    }
    window.dispatchEvent(new CustomEvent(name, { detail }));
}

export function emitAppEvent<K extends AppEventName>(
    eventName: K,
    detail: AppEventMap[K],
    options: AppEventOptions = {}
): void {
    const { emitLegacy = true } = options;

    dispatchCustomEvent(eventName, detail);

    if (!emitLegacy) return;

    const legacyEventName = LEGACY_EVENT_NAMES[eventName];
    if (!legacyEventName) return;
    dispatchCustomEvent(legacyEventName, detail);
}

export function onAppEvent<K extends AppEventName>(
    eventName: K,
    handler: (detail: AppEventMap[K]) => void,
    options: AppEventOptions = {}
): () => void {
    const { listenLegacy = false } = options;

    const listener = (event: Event) => {
        handler((event as CustomEvent<AppEventMap[K]>).detail);
    };

    window.addEventListener(eventName, listener as EventListener);

    const legacyEventName = LEGACY_EVENT_NAMES[eventName];
    if (listenLegacy && legacyEventName) {
        window.addEventListener(legacyEventName, listener as EventListener);
    }

    return () => {
        window.removeEventListener(eventName, listener as EventListener);
        if (listenLegacy && legacyEventName) {
            window.removeEventListener(legacyEventName, listener as EventListener);
        }
    };
}

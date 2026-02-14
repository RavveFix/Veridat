type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return null;
    }
    return value as UnknownRecord;
}

/**
 * Fortnox edge responses are sometimes top-level and sometimes wrapped in `data`.
 * This helper returns the first matching payload object from either shape.
 */
function resolvePayload(result: unknown): UnknownRecord | null {
    const root = asRecord(result);
    if (!root) return null;

    const data = asRecord(root.data);
    if (data) return { ...root, ...data };

    return root;
}

function getPayloadValue(result: unknown, key: string): unknown {
    const payload = resolvePayload(result);
    return payload ? payload[key] : undefined;
}

export function getFortnoxList<T>(result: unknown, key: string): T[] {
    const value = getPayloadValue(result, key);
    return Array.isArray(value) ? (value as T[]) : [];
}

export function getFortnoxObject<T>(result: unknown, key: string): T | null {
    const value = getPayloadValue(result, key);
    const record = asRecord(value);
    return record ? (record as T) : null;
}

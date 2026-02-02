/**
 * Veridat Test Setup
 *
 * This file configures the test environment for Vitest/Jest.
 * Import this in vitest.config.ts or jest.config.js.
 */

// Mock browser APIs that don't exist in Node
if (typeof window === 'undefined') {
    // @ts-ignore
    global.window = {
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => true,
        localStorage: {
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {},
            clear: () => {},
            length: 0,
            key: () => null
        }
    };
}

// Mock Supabase client
export const mockSupabase = {
    from: (table: string) => ({
        select: () => Promise.resolve({ data: [], error: null }),
        insert: () => Promise.resolve({ data: null, error: null }),
        update: () => Promise.resolve({ data: null, error: null }),
        delete: () => Promise.resolve({ data: null, error: null }),
        eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) })
    }),
    auth: {
        getSession: () => Promise.resolve({ data: { session: null }, error: null }),
        signOut: () => Promise.resolve({ error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } })
    },
    storage: {
        from: () => ({
            upload: () => Promise.resolve({ data: null, error: null }),
            getPublicUrl: () => ({ data: { publicUrl: 'https://example.com/file.xlsx' } })
        })
    }
};

// Mock import.meta.env
if (typeof import.meta === 'undefined') {
    // @ts-ignore
    global.import = { meta: { env: { DEV: true } } };
}

export default {};

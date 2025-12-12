export interface User {
    id: string;
    email: string;
    // From Supabase Auth
    aud?: string;
    role?: string;
    created_at?: string;
    updated_at?: string;
}


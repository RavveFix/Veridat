// Shared type declarations for Deno runtime in Supabase Edge Functions

declare global {
    const Deno: {
        serve: (handler: (request: Request) => Response | Promise<Response>) => void;
        env: {
            get: (key: string) => string | undefined;
        };
    };
}

export { };

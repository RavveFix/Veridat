// Minimal ambient declarations for the Deno runtime in Supabase Edge Functions.
//
// Why this exists:
// - VSCode's TypeScript server may typecheck these files without Deno's built-in types,
//   which leads to `Cannot find name 'Deno'`.
// - When Deno types are available (e.g. `deno check`), these declarations safely merge
//   into the existing `Deno` namespace (no duplicate global `const Deno`).

declare namespace Deno {
    function serve(handler: (request: Request) => Response | Promise<Response>): void;

    namespace env {
        function get(key: string): string | undefined;
    }
}

export {};

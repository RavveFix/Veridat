import { defineConfig } from 'vite';
import { resolve } from 'path';
import preact from '@preact/preset-vite';

export default defineConfig({
    // Run Vite with a stable root regardless of where the command is executed from.
    root: __dirname,

    // Keep env files at the repo root (e.g. `.env`, `.env.example`).
    envDir: resolve(__dirname, '../..'),

    // Preact support
    plugins: [
        preact(),
        {
            name: 'html-rewrite',
            configureServer(server) {
                server.middlewares.use(rewriteHtmlRequests);
            },
            configurePreviewServer(server) {
                server.middlewares.use(rewriteHtmlRequests);
            },
        },
    ],

    // Multi-page app setup
    build: {
        // Keep the build output in the repo root for existing deploy configs.
        outDir: resolve(__dirname, '../../dist'),
        emptyOutDir: true,
        sourcemap: true,
        rollupOptions: {
            input: {
                main: resolve(__dirname, 'index.html'),
                login: resolve(__dirname, 'login.html'),
                app: resolve(__dirname, 'app/index.html'),
                admin: resolve(__dirname, 'admin.html'),
                privacy: resolve(__dirname, 'privacy.html'),
                terms: resolve(__dirname, 'terms.html'),
                dpa: resolve(__dirname, 'dpa.html'),
                security: resolve(__dirname, 'security.html'),
                manifest: resolve(__dirname, 'manifest.html'),
            },
            output: {
                manualChunks: {
                    'vendor-ui': ['@heroui/react', 'framer-motion'],
                    'vendor-supabase': ['@supabase/supabase-js'],
                },
            },
        },
    },

    // Server configuration
    server: {
        port: 5173,
        open: true,
    },

    // Environment variables prefix
    envPrefix: 'VITE_',

    // Resolve configuration
    resolve: {
        alias: {
            '@': resolve(__dirname, './src'),
            'react': 'preact/compat',
            'react-dom': 'preact/compat',
        },
    },
});

function rewriteHtmlRequests(req: { url?: string }, _res: unknown, next: () => void) {
    const rawUrl = req.url || '/';
    const pathOnly = rawUrl.split('?')[0] || rawUrl;

    if (pathOnly === '/login') {
        req.url = '/login.html';
    } else if (pathOnly === '/admin') {
        req.url = '/admin.html';
    } else if (pathOnly === '/privacy') {
        req.url = '/privacy.html';
    } else if (pathOnly === '/terms') {
        req.url = '/terms.html';
    } else if (pathOnly === '/dpa') {
        req.url = '/dpa.html';
    } else if (pathOnly === '/security') {
        req.url = '/security.html';
    } else if (pathOnly === '/manifest') {
        req.url = '/manifest.html';
    } else if (
        (pathOnly === '/app' || pathOnly === '/app/' || pathOnly.startsWith('/app/')) &&
        !pathOnly.split('/').pop()?.includes('.')
    ) {
        req.url = '/app/index.html';
    }
    next();
}

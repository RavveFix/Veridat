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
                server.middlewares.use((req, res, next) => {
                    const rawUrl = req.url || '/';
                    const pathOnly = rawUrl.split('?')[0] || rawUrl;

                    if (pathOnly === '/login') {
                        req.url = '/login.html';
                    } else if (pathOnly === '/privacy') {
                        req.url = '/privacy.html';
                    } else if (pathOnly === '/terms') {
                        req.url = '/terms.html';
                    } else if (
                        // App "routes" (no file extension) should resolve to the app shell.
                        (pathOnly === '/app' || pathOnly === '/app/' || pathOnly.startsWith('/app/')) &&
                        // Don't rewrite real files under /app (manifest, icons, etc).
                        !pathOnly.split('/').pop()?.includes('.')
                    ) {
                        req.url = '/app/index.html';
                    }
                    next();
                });
            },
        },
    ],

    // Multi-page app setup
    build: {
        // Keep the build output in the repo root for existing deploy configs.
        outDir: resolve(__dirname, '../../dist'),
        emptyOutDir: true,
        rollupOptions: {
            input: {
                main: resolve(__dirname, 'index.html'),
                login: resolve(__dirname, 'login.html'),
                app: resolve(__dirname, 'app/index.html'),
                privacy: resolve(__dirname, 'privacy.html'),
                terms: resolve(__dirname, 'terms.html'),
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
        },
    },
});

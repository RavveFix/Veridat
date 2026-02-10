import { defineConfig } from 'vite';
import { resolve } from 'path';
import preact from '@preact/preset-vite';
import { visualizer } from 'rollup-plugin-visualizer';

const ANALYZE_BUNDLE = process.env.VITE_BUNDLE_ANALYZE === 'true';
const SENTRY_ENABLED = Boolean(process.env.VITE_SENTRY_DSN);

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
        // Do not publish production source maps by default.
        // Can be re-enabled with VITE_SOURCEMAP=true when needed.
        sourcemap: process.env.VITE_SOURCEMAP === 'true',
        rollupOptions: {
            plugins: ANALYZE_BUNDLE
                ? [
                    visualizer({
                        filename: resolve(__dirname, '../../dist/bundle-stats.html'),
                        template: 'treemap',
                        gzipSize: true,
                        brotliSize: true,
                    }),
                ]
                : [],
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
                manualChunks(id: string) {
                    if (!id.includes('node_modules')) return undefined;

                    if (id.includes('/node_modules/xlsx/')) return 'vendor-xlsx';
                    if (id.includes('/node_modules/pdfjs-dist/')) return 'vendor-pdf';
                    if (id.includes('/node_modules/@supabase/')) return 'vendor-supabase';

                    if (
                        id.includes('/node_modules/@heroui/') ||
                        id.includes('/node_modules/@react-aria/') ||
                        id.includes('/node_modules/@react-stately/') ||
                        id.includes('/node_modules/@react-types/') ||
                        id.includes('/node_modules/@internationalized/') ||
                        id.includes('/node_modules/framer-motion/') ||
                        id.includes('/node_modules/motion/') ||
                        id.includes('/node_modules/motion-dom/') ||
                        id.includes('/node_modules/motion-utils/')
                    ) {
                        return 'vendor-ui';
                    }

                    if (id.includes('/preact/') || id.includes('preact/')) {
                        return 'vendor-preact';
                    }

                    if (
                        SENTRY_ENABLED &&
                        (
                            id.includes('/node_modules/@sentry/') ||
                            id.includes('/node_modules/@sentry-internal/')
                        )
                    ) {
                        return 'vendor-sentry';
                    }

                    if (
                        id.includes('/node_modules/clsx/') ||
                        id.includes('/node_modules/tailwind-merge/') ||
                        id.includes('/node_modules/dompurify/')
                    ) {
                        return 'vendor-utils';
                    }

                    return 'vendor-misc';
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

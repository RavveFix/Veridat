import { defineConfig } from 'vite';
import { resolve } from 'path';
import preact from '@preact/preset-vite';

export default defineConfig({
    // Preact support
    plugins: [
        preact(),
        {
            name: 'html-rewrite',
            configureServer(server) {
                server.middlewares.use((req, res, next) => {
                    if (req.url === '/login') {
                        req.url = '/login.html';
                    } else if (req.url === '/app') {
                        req.url = '/app/index.html';
                    } else if (req.url === '/privacy') {
                        req.url = '/privacy.html';
                    } else if (req.url === '/terms') {
                        req.url = '/terms.html';
                    }
                    next();
                });
            },
        },
    ],

    // Multi-page app setup
    build: {
        rollupOptions: {
            input: {
                main: resolve(__dirname, 'index.html'),
                login: resolve(__dirname, 'login.html'),
                app: resolve(__dirname, 'app/index.html'),
                news: resolve(__dirname, 'app/nyheter.html'),
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

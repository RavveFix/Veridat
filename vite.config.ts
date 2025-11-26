import { defineConfig } from 'vite';
import { resolve } from 'path';
import preact from '@preact/preset-vite';

export default defineConfig({
    // Preact support
    plugins: [preact()],

    // Multi-page app setup
    build: {
        rollupOptions: {
            input: {
                main: resolve(__dirname, 'index.html'),
                login: resolve(__dirname, 'login.html'),
                app: resolve(__dirname, 'app/index.html'),
                news: resolve(__dirname, 'app/nyheter.html'),
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

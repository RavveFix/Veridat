import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['tests/unit/**/*.test.ts', 'shared/**/*.test.ts'],
        passWithNoTests: true,
        globals: true,
    },
});

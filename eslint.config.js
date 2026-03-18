import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    {
        ignores: ['dist/**', 'node_modules/**', '_archive/**', 'apps/**', '**/*.js']
    },
    {
        files: ['shared/**/*.ts', 'tests/**/*.ts'],
        languageOptions: {
            parserOptions: {
                ecmaVersion: 2020,
                sourceType: 'module'
            }
        },
        rules: {
            // Warnings (will not fail CI)
            '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/ban-ts-comment': 'warn',
            'no-console': 'off'
        }
    }
);

import eslint from '@eslint/js';

export default [
  eslint.configs.recommended,
  {
    files: ['**/*.mjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  },
];

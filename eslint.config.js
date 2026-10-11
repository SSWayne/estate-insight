// ESLint 設定：只做正確性檢查（未定義、未使用變數、可疑寫法），不強制排版風格。
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'dist/**', 'public/vendor/**'] },
  js.configs.recommended,
  {
    files: ['js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser, Chart: 'readonly', lucide: 'readonly' },
    },
    rules: {
      'no-unused-vars': ['error', { args: 'after-used', argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_', ignoreRestSiblings: true }],
      'no-shadow': 'warn',
      eqeqeq: ['error', 'always'],
      'no-implicit-globals': 'error',
      'prefer-const': 'warn',
      // 介面文字中刻意使用全形空白（U+3000）；其他不可見字元一律禁止
      'no-irregular-whitespace': ['error', { skipStrings: true, skipTemplates: true, skipRegExps: false, skipComments: true }],
    },
  },
  {
    files: ['src-sw/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: { ...globals.serviceworker, __PRECACHE_LIST__: 'readonly' },
    },
  },
  {
    files: ['tests/**/*.js', 'scripts/**/*.mjs', 'eslint.config.js', 'vite.config.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node } },
  },
];

import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

// JSX identifiers must be marked as "used", otherwise no-unused-vars reports
// every imported component as unused.
const jsxUsedVars = { 'react/jsx-uses-vars': 'error' }

export default defineConfig([
  globalIgnores(['dist', 'node_modules']),
  // Application source is .js/.jsx — these files must be linted too, otherwise
  // `npm run lint` silently checks nothing.
  {
    files: ['**/*.{js,jsx}'],
    plugins: { react },
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      ...jsxUsedVars,
      'react-refresh/only-export-components': 'warn',
      // Deliberate `try { ... } catch {}` fallbacks (optional integrations,
      // best-effort metadata) are used throughout the API layer.
      'no-empty': ['error', { allowEmptyCatch: true }],
      // The app loads data via the classic fetch-inside-useEffect pattern.
      // Migrating to a data-loading library is a larger refactor than a bug fix,
      // so this stays advisory rather than blocking.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { react },
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    rules: jsxUsedVars,
  },
])

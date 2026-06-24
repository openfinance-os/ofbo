import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['**/dist/**', '**/.next/**', '**/.open-next/**', '**/next-env.d.ts', '**/*.generated.ts', '**/node_modules/**', '.remember/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // Profile selection is config-only and lives in packages/ports getAdapter()
      // (CLAUDE.md §3.1: application core code NEVER branches on profile). This makes a
      // stray `…DEPLOY_PROFILE` read a lint error instead of a review-time catch.
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[property.name='DEPLOY_PROFILE']",
          message: 'Do not read or branch on DEPLOY_PROFILE outside packages/ports — profile selection lives in getAdapter(); code against the port interface (CLAUDE.md §3.1).'
        }
      ]
    }
  },
  // The sanctioned profile-selection point (the ports registry) and the destructive
  // db:reset guard legitimately read the deploy profile; tests set it to drive scenarios.
  {
    files: ['packages/ports/**', 'packages/db/src/reset.ts', '**/test/**', '**/*.spec.ts', '**/*.spec.tsx'],
    rules: { 'no-restricted-syntax': 'off' }
  },
  // Stray console.* risks leaking PII into operational logs (hard stop: zero PII in
  // logs/telemetry). Request-path/business code must route through the redacting logger;
  // CLI entry points (scripts, db tooling) keep their console output and are not in scope.
  {
    files: ['services/bff/src/**/*.ts', 'apps/portal/src/**/*.{ts,tsx}'],
    rules: { 'no-console': ['error', { allow: ['warn', 'error'] }] }
  },
  {
    // Discovery harness is plain-JS Node tooling (gate validator + renderer CLIs + tests) —
    // grant Node globals.
    files: ['discovery/**/*.mjs'],
    languageOptions: { globals: { console: 'readonly', process: 'readonly' } }
  }
)

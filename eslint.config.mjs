import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    // Worktrees are full nested checkouts and lint themselves. The billing prototype is a
    // self-contained browser/Node reference artefact with its own executable verifier;
    // production linting starts at the packages/services implementation.
    ignores: ['**/dist/**', '**/.next/**', '**/.open-next/**', '**/next-env.d.ts', '**/*.generated.ts', '**/node_modules/**', '.remember/**', '.claude/worktrees/**', 'docs/prototypes/billing/**']
  },
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
  // `@ofbo/contracts/spec` reads specs/backoffice-openapi.yaml off disk with node:fs. That is a
  // BUILD/TEST-time surface — `packages/contracts/src/spec.ts` says so in its first line, and the
  // Workers runtime has no filesystem, so an import from runtime code breaks the bundle rather
  // than degrading. It used to be protected by being awkward to reach: runtime code would have had
  // to path into another package's src/. BACKOFFICE-91 added a `./spec` subpath export so a test
  // could bind a contract value, which also made the wrong import one clean line away. The comment
  // that documents the boundary is not a control, so this is.
  {
    files: ['services/*/src/**/*.ts', 'apps/*/src/**/*.{ts,tsx}', 'packages/*/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@ofbo/contracts/spec',
              message:
                'Build/test-time only — it reads the OpenAPI file with node:fs and the Workers runtime has no filesystem. Runtime code uses the generated artifacts from @ofbo/contracts instead (packages/contracts/src/spec.ts).'
            }
          ]
        }
      ]
    }
  },
  {
    // Discovery harness is plain-JS Node tooling (gate validator + renderer CLIs + tests) —
    // grant Node globals.
    files: ['discovery/**/*.mjs'],
    languageOptions: { globals: { console: 'readonly', process: 'readonly', Buffer: 'readonly' } }
  },
  {
    // Harness gate scripts are plain-JS Node CLIs. They import `node:` builtins explicitly, so
    // only `fetch` needs granting — it is a Node >=18 global with no importable module form,
    // and package.json engines already require node >=22.
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { fetch: 'readonly' } }
  }
)

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
  // The sanctioned profile-selection point (the ports registry) and reset.ts's non-prod guard
  // legitimately read the deploy profile; tests set it to drive scenarios.
  //
  // reset.ts's exemption covers the guard AND its callers — ruled intended by the repository owner
  // on 2026-08-28, recorded in docs/adrs/0035-non-prod-guard-exemption-covers-its-callers.md with the
  // four options put to them and the reasoning the ruling rests on.
  //
  // The ADR exists because THIS COMMENT was not enough: the advisory reviewer raised the rule-7
  // question three times and said the third time that it could not verify the ruling — "it is a claim
  // in a comment" — and that a real, recorded ruling closes it. A comment asserting a human decision
  // with nothing behind it is the defect class the branch this landed on was opened to remove.
  //
  // `assertNonProdBulkMutation` is exported from reset.ts and the three seed entry points call it,
  // so those modules refuse to run outside the demo profile without reading the variable. This rule
  // matches READS, so it cannot see them. The alternatives are worse: copying the guard means three
  // DEPLOY_PROFILE reads instead of one, and dropping it returns the seeds to writing synthetic rows
  // into an INSERT-only audit table under any profile.
  //
  // The caller set is closed by `packages/db/test/non-prod-guard.spec.ts` instead — a declared list
  // asserted against the source, the same way `RAW_SQL_AUDIT_WRITERS` closes the set of raw audit
  // writers. A new caller fails that test by name, which is the enforcement this rule structurally
  // cannot provide.
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

import { defineConfig } from 'vitest/config'

/**
 * Vitest config used ONLY by the mutation-testing gate (HARNESS-04, `pnpm test:mutation`).
 * The workspace's `unit` project also pulls in portal/.tsx + every package suite; Stryker only
 * needs the BFF unit specs that cover the mutated security core (rbac/auth/approvals), and must
 * never touch the `integration` project (it needs a live Postgres). So this is a deliberately
 * narrow, node-env, DB-free config — fast and hermetic per mutant.
 */
export default defineConfig({
  test: {
    include: ['services/bff/test/**/*.spec.ts'],
    exclude: ['**/*.int.spec.ts', '**/node_modules/**'],
    environment: 'node'
  }
})

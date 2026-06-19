import { defineConfig } from 'vitest/config'

/**
 * Root config — projects live in vitest.workspace.ts; this supplies the global options
 * that vitest only honours at the root, namely the coverage gate.
 *
 * Enforced coverage is scoped to the BFF business logic (`services/bff/src`) — the
 * regulated surface the UNIT suite actually exercises. We deliberately do NOT gate:
 *   • packages/db Pg stores — exercised by the integration suite (would read false-0% here),
 *   • apps/portal pages/actions — exercised by the Playwright E2E suite,
 *   • worker.ts — the Cloudflare deploy entry (integration/deploy), and generated code.
 * Each of those is gated by its own suite. Run with `pnpm test --coverage`.
 */
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['services/bff/src/**'],
      exclude: ['services/bff/src/worker.ts', '**/*.generated.ts'],
      thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 }
    }
  }
})

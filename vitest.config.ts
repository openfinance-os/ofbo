import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

/**
 * Root config — the single source for BOTH the suite projects and the global options
 * vitest only honours at the root (the coverage gate).
 *
 * HARNESS-12: projects moved here from vitest.workspace.ts. Vitest 3.2 deprecates
 * workspace files (removed in 4) in favour of `test.projects`, and consolidating also
 * retires the split that forced coverage config to live apart from the projects it gates.
 *
 * Enforced coverage is scoped to the BFF business logic (`services/bff/src`) — the
 * regulated surface the UNIT suite actually exercises. We deliberately do NOT gate:
 *   • packages/db Pg stores — exercised by the integration suite (would read false-0% here),
 *   • apps/portal pages/actions — exercised by the Playwright E2E suite,
 *   • worker.ts — the Cloudflare deploy entry (integration/deploy), and generated code.
 * Each of those is gated by its own suite. Q1 runs it via `pnpm test:coverage` (HARNESS-09).
 */
export default defineConfig({
  test: {
    projects: [
      {
        // The portal (apps/*) ships .tsx component tests; the React plugin supplies
        // the JSX transform. Component test files opt into jsdom per-file with a
        // `// @vitest-environment jsdom` docblock — the default stays node so the
        // package/service suites are unaffected.
        plugins: [react()],
        test: {
          name: 'unit',
          include: [
            'packages/**/test/**/*.spec.ts',
            'services/**/test/**/*.spec.ts',
            'apps/**/test/**/*.spec.{ts,tsx}',
            'infra/**/test/**/*.spec.ts'
          ],
          exclude: ['**/*.int.spec.ts', '**/node_modules/**']
        }
      },
      {
        test: {
          name: 'integration',
          include: [
            'packages/**/test/**/*.int.spec.ts',
            'services/**/test/**/*.int.spec.ts',
            'apps/**/test/**/*.int.spec.ts'
          ],
          exclude: ['**/node_modules/**'],
          // Integration suites share one database — run everything in one worker, sequentially.
          pool: 'threads',
          poolOptions: { threads: { singleThread: true } },
          // Real-store flows over a remote pooled Postgres (Supabase session pooler) routinely
          // round-trip 6–14s for multi-step write+lineage flows — far above vitest's 5s default,
          // which silently failed the whole suite locally. CI's local Postgres is sub-ms, but the
          // gate must be runnable against the remote DB too. Generous, suite-wide.
          testTimeout: 60_000,
          hookTimeout: 60_000
        }
      },
      {
        test: {
          name: 'smoke',
          // Runs against the DEPLOYED demo environment (deploy workflow, post-deploy).
          include: ['tests/smoke/**/*.smoke.spec.ts'],
          exclude: ['**/node_modules/**'],
          testTimeout: 15_000
        }
      }
    ],
    coverage: {
      provider: 'v8',
      include: ['services/bff/src/**'],
      exclude: ['services/bff/src/worker.ts', '**/*.generated.ts'],
      thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 }
    }
  }
})

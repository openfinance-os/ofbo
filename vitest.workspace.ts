import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  {
    test: {
      name: 'unit',
      include: ['packages/**/test/**/*.spec.ts', 'services/**/test/**/*.spec.ts'],
      exclude: ['**/*.int.spec.ts', '**/node_modules/**']
    }
  },
  {
    test: {
      name: 'integration',
      include: ['packages/**/test/**/*.int.spec.ts', 'services/**/test/**/*.int.spec.ts'],
      exclude: ['**/node_modules/**'],
      // Integration suites share one database — run everything in one worker, sequentially.
      pool: 'threads',
      poolOptions: { threads: { singleThread: true } }
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
])

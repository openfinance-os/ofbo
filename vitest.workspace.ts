import { defineWorkspace } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineWorkspace([
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

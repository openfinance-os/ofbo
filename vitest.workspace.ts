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
      exclude: ['**/node_modules/**']
    }
  }
])

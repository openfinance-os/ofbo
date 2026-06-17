import type { Config } from 'tailwindcss'
import { color, ext, borderRadius, spacing, fontFamily } from './design/tokens'

/**
 * UI-00b — the portal Tailwind preset, generated from the repo-canonical design
 * tokens (apps/portal/design/tokens.ts), which mirror the Stitch "Open Finance Back
 * Office" Material 3 system verbatim. Components reference token-named utilities
 * (e.g. bg-primary-container, text-on-surface, bg-demo) — never raw hex/px.
 */
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ...color,
        // OFBO semantic layer (Stitch base ships only `error`).
        breach: ext.status.breach,
        break: ext.status.break,
        reconciled: ext.status.reconciled,
        demo: ext.demo
      },
      borderRadius: { ...borderRadius },
      spacing: { ...spacing },
      fontFamily: {
        sans: [...fontFamily.sans],
        mono: [...fontFamily.mono],
        symbols: [...fontFamily.symbols]
      }
    }
  },
  plugins: []
} satisfies Config

import type { Config } from 'tailwindcss'
import { color, ext, borderRadius, spacing, fontFamily } from './design/tokens'

/**
 * The portal Tailwind preset, generated from the design tokens
 * (apps/portal/design/tokens.ts) — which are THE source of appearance truth as of
 * ADR 0026, not a mirror of an external tool. Components reference token-named
 * utilities (e.g. bg-primary-container, text-on-surface, bg-demo) — never raw hex/px.
 * design-conformance.spec.ts enforces that.
 */
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ...color,
        // OFBO semantic layer — four states (ADR 0026). The accent (`secondary`)
        // is never a status; `awaiting` is slate so "waiting" cannot read as "act here".
        breach: ext.status.breach,
        aging: ext.status.aging,
        awaiting: ext.status.awaiting,
        reconciled: ext.status.reconciled,
        /** @deprecated ADR 0026 — use `aging`. Kept one minor release so the rename
         *  of ~71 call sites lands in its own reviewable commit. */
        break: ext.status.break,
        demo: ext.demo,
        training: ext.training,
        // The dark "institutional shell" navy chrome — kept, not inverted (ADR 0026).
        nav: ext.nav.surface,
        'on-nav': ext.nav.on,
        'nav-elevated': ext.nav.elevated,
        'nav-active': ext.nav.active
      },
      borderRadius: { ...borderRadius },
      spacing: { ...spacing },
      fontFamily: {
        sans: [...fontFamily.sans],
        display: [...fontFamily.display],
        mono: [...fontFamily.mono],
        symbols: [...fontFamily.symbols]
      }
    }
  },
  plugins: []
} satisfies Config

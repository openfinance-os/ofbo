import type { Config } from 'tailwindcss'
import { color, ext, borderRadius, spacing, fontFamily } from './design/tokens'

/**
 * The portal Tailwind preset, generated from the design tokens
 * (apps/portal/design/tokens.ts) — which are THE source of appearance truth as of
 * ADR 0033, not a mirror of an external tool. Components reference token-named
 * utilities (e.g. bg-primary-container, text-on-surface, bg-demo) — never raw hex/px.
 * design-conformance.spec.ts enforces that.
 */
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ...color,
        // OFBO semantic layer — four states (ADR 0033). The accent (`secondary`)
        // is never a status; `awaiting` is slate so "waiting" cannot read as "act here".
        breach: ext.status.breach,
        aging: ext.status.aging,
        awaiting: ext.status.awaiting,
        reconciled: ext.status.reconciled,
        demo: ext.demo,
        training: ext.training,
        // The dark "institutional shell" navy chrome — kept, not inverted (ADR 0033).
        nav: ext.nav.surface,
        'on-nav': ext.nav.on,
        'nav-elevated': ext.nav.elevated,
        'nav-active': ext.nav.active,
        // The two markers as painted ON the shell. A marker is only legible on the ground it
        // was solved for, so the `-on-nav` suffix is the ground, not a variant of the colour.
        'demo-on-nav': ext.nav.demo,
        'training-on-nav': ext.nav.training,
        // HOST-01 scaffold (ADR 0028) — per-tenant brand accent. The value is a CSS variable set
        // per `data-tenant` in globals.css, so no raw hex lives in any component (token-only).
        brand: 'var(--brand-accent)'
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

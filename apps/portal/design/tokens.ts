/**
 * OFBO portal design tokens — THE source of appearance truth (ADR 0026).
 *
 * "Institutional Blue", the MiddleLeap design system for the Open Finance Back
 * Office. ADR 0026 retired the external Stitch project as the appearance
 * authority: this file is now the source, not a mirror of one.
 *
 * Division of truth:
 *   this file                       = design tokens
 *   the OFBO Design System project  = component + pattern specs
 *   apps/portal/design/design.md    = human-readable mirror
 *   specs/backoffice-openapi.yaml   = behaviour + data
 *
 * Role NAMES are deliberately colour-neutral (`primary`, `surface`, `outline`)
 * and were preserved verbatim through the palette change — which is why the
 * migration touched values, not 1,809 call sites. Never name a token for its hue.
 *
 * Framework-agnostic data (no Tailwind/React import) so it stays usable for the
 * Tailwind preset, CSS variables, or tests.
 */

/** DM Sans (UI + summary figures), Instrument Serif (display/titles only — one
 *  weight, so scale carries hierarchy), JetBrains Mono (ids, exact amounts, trace
 *  ids), Material Symbols Outlined (icons, variable axes opsz 24 / wght 300). */
export const fontFamily = {
  sans: ['DM Sans', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
  display: ['Instrument Serif', 'Georgia', 'Times New Roman', 'serif'],
  mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
  symbols: ['Material Symbols Outlined']
} as const

/**
 * Colour roles (light theme). The M3 role names are retained as the public API of
 * this token set — components address `surface`, `on-surface`, `outline` and never
 * a hue. Values are Institutional Blue; every foreground/background pair used by
 * the portal is asserted at WCAG 2.1 AA in design-tokens.spec.ts.
 */
export const color = {
  primary: '#121826',
  'primary-container': '#141b2d',
  'on-primary': '#ffffff',
  'on-primary-container': '#8f9ab1',
  'primary-fixed': '#e6edfb',
  'primary-fixed-dim': '#c2d3f3',
  'on-primary-fixed': '#141b2d',
  'on-primary-fixed-variant': '#46506a',
  'inverse-primary': '#6ba1f5',
  secondary: '#2c5fc4',
  'secondary-container': '#1f4796',
  'on-secondary': '#ffffff',
  'on-secondary-container': '#ffffff',
  'secondary-fixed': '#e6edfb',
  'secondary-fixed-dim': '#c2d3f3',
  'on-secondary-fixed': '#17356f',
  'on-secondary-fixed-variant': '#1f4796',
  tertiary: '#121826',
  'tertiary-fixed': '#edf0f6',
  'tertiary-fixed-dim': '#d5dbe7',
  'on-tertiary': '#ffffff',
  'on-tertiary-container': '#646e88',
  'on-tertiary-fixed': '#141b2d',
  'on-tertiary-fixed-variant': '#46506a',
  error: '#c4342f',
  'error-container': '#fbeae8',
  'on-error': '#ffffff',
  'on-error-container': '#a02d26',
  background: '#f4f6fa',
  'on-background': '#121826',
  surface: '#f4f6fa',
  'surface-dim': '#d5dbe7',
  'surface-bright': '#ffffff',
  'surface-variant': '#e4e8f0',
  'surface-tint': '#2c5fc4',
  'surface-container-lowest': '#ffffff',
  'surface-container-low': '#f8fafc',
  'surface-container': '#edf0f6',
  'surface-container-high': '#e4e8f0',
  'surface-container-highest': '#d5dbe7',
  'on-surface': '#121826',
  'on-surface-variant': '#55607a',
  'inverse-surface': '#141b2d',
  'inverse-on-surface': '#f1f4fa',
  outline: '#858da5',
  'outline-variant': '#d5dbe7'
} as const

/**
 * OFBO semantic extensions. The operational status set is load-bearing across every
 * console (PRD §7). ADR 0026 made it FOUR states, not three: "parked on a
 * counterparty" and "running out of clock" are different problems with different
 * owners, and conflating them in one amber was a modelling error.
 *
 * THE ACCENT RULE: `secondary` (the accent blue) is never a status. It marks the one
 * primary action per screen, the active nav item, and the focus ring. `awaiting` is
 * slate precisely so nothing meaning "waiting" can be mistaken for "act here".
 *
 * `demo` is the mandatory persistent DEMO marker (regulatory hard-stop).
 */
export const ext = {
  /**
   * These are TEXT colours, not just dot fills: status-badge.tsx renders
   * `text-<status>` at text-xs on a 10% tint of the same hue. So every value below is
   * solved to >= 4.5:1 against `surface` (the page ground — the harder of ground vs
   * white card), and the AA block in design-tokens.spec.ts asserts it on every build.
   */
  status: {
    breach: '#c4342f', // red — SLA missed, liability threshold crossed
    aging: '#98640c', // amber — open, approaching its clock
    // Near-neutral slate. It sits on the accent's own hue, so its CHROMA is what keeps
    // it distinguishable — saturation is held at/below the "reads as grey" threshold so
    // a parked break can never be mistaken for the blue that means "act here".
    awaiting: '#68707e',
    reconciled: '#1d7f54', // green — matched / settled
    /** @deprecated ADR 0026 — renamed to `aging`. Kept one minor release; remove next major. */
    break: '#98640c'
  },
  /**
   * The persistent DEMO marker (regulatory hard-stop, CLAUDE.md). demo-banner.tsx renders
   * it as `text-demo` at text-xs, so it must be legible as TEXT.
   *
   * MiddleLeap's mark orange is #e65c2d; at 3.27:1 on the ground it failed AA and made the
   * mandated non-prod marker the least readable thing on the page. This token is the
   * darkened text-safe form (4.61:1). The brand orange stays the MARK colour in the design
   * system — if the banner ever becomes a filled pill (ink on orange, as designed), this
   * token can go back to #e65c2d.
   */
  demo: '#c54418',
  // BACKOFFICE-59 — the persistent TRAINING-environment marker colour. A distinct violet,
  // deliberately apart from the orange `demo`, amber `aging`, red `breach` and navy nav, so a
  // trainee can tell a training session from production/demo at a glance.
  training: '#6d28d9',
  /**
   * The dark "institutional shell" navy chrome — sidebar and sign-in panel.
   * ADR 0026 keeps this shell rather than inverting it, which is the single
   * biggest reason the Institutional Blue migration is a values-only swap:
   * all 82 `nav*` utility uses across the portal are unaffected.
   * The top bar + content stay on the light surface tokens.
   * Contrast ratios below are measured against `nav.surface` and gated by
   * the AA assertions in design-tokens.spec.ts.
   */
  nav: {
    surface: '#141b2d', // navy shell surface
    on: '#c3ccde', // 10.6:1 on surface — default nav text
    elevated: '#1e2740', // hover bg + shell border
    active: '#6ba1f5' // 6.6:1 on surface — active item accent
  }
} as const

/** Radius scale. `full` must stay a true pill — status badges depend on it. */
export const borderRadius = {
  sm: '0.125rem',
  DEFAULT: '0.25rem', // soft — inputs/buttons
  md: '0.375rem',
  lg: '0.5rem', // data containers / cards
  xl: '0.75rem',
  full: '9999px' // status badges — fully pill-shaped
} as const

/** 4px base unit + named layout tokens. Numeric spacing + type scales come from
 *  Tailwind defaults (also 4px-based). Density changes geometry only, never type. */
export const spacing = {
  unit: '4px',
  gutter: '16px',
  'container-padding': '24px',
  'row-height-standard': '48px', // density: comfortable
  'row-height-dense': '32px' // density: compact
} as const

export const tokens = { fontFamily, color, ext, borderRadius, spacing } as const
export type DesignTokens = typeof tokens

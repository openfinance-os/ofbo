/**
 * UI-00 — OFBO portal design tokens (repo-canonical source of truth).
 *
 * Codified from the Stitch "Regulated Institutional Interface" design system
 * (project 8050269076066130289). Stitch = appearance source of truth; this file is
 * the repo mirror that the Tailwind preset (UI-00b) consumes. Framework-agnostic
 * data — no Tailwind/React import — so it stays usable whether tokens feed Tailwind,
 * CSS variables, or tests.
 *
 * RECONCILE against the live Stitch `design.md` once the Stitch MCP connection is
 * restored (it was unreachable when this was authored); values below are the
 * documented spec (PRD/backlog UI-00 note).
 */

/** Typography — Inter for UI text, JetBrains Mono for ids/amounts/code. */
export const fontFamily = {
  sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
  mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace']
} as const

/** Modular type scale (rem). */
export const fontSize = {
  xs: '0.75rem',
  sm: '0.875rem',
  base: '1rem',
  lg: '1.125rem',
  xl: '1.25rem',
  '2xl': '1.5rem',
  '3xl': '1.875rem'
} as const

/** 4px spacing base — keys are the 4px multiple. */
export const space = {
  0: '0',
  1: '0.25rem', // 4px
  2: '0.5rem', // 8px
  3: '0.75rem', // 12px
  4: '1rem', // 16px
  5: '1.25rem', // 20px
  6: '1.5rem', // 24px
  8: '2rem', // 32px
  10: '2.5rem', // 40px
  12: '3rem' // 48px
} as const

export const radius = {
  none: '0',
  sm: '0.25rem',
  md: '0.5rem',
  lg: '0.75rem',
  full: '9999px'
} as const

/**
 * Colour palette. `primary` is the Regulated Institutional navy (#0F172A). The
 * `status` ramp is load-bearing semantics used across every console:
 *   breach = red, break = amber, reconciled = green (PRD §7 / backlog UI-00).
 */
export const color = {
  primary: {
    DEFAULT: '#0F172A', // navy — primary brand ink / nav
    fg: '#FFFFFF',
    muted: '#334155',
    subtle: '#64748B'
  },
  accent: '#0A6CFF',
  surface: {
    DEFAULT: '#FFFFFF',
    raised: '#F8FAFC',
    sunken: '#F1F5F9',
    border: '#E2E8F0'
  },
  ink: {
    DEFAULT: '#0B1F33',
    muted: '#475569',
    inverse: '#FFFFFF'
  },
  /** Operational status semantics — the same triad everywhere. */
  status: {
    breach: '#DC2626', // red — SLA/limit breach
    break: '#D97706', // amber — reconciliation break / warning
    reconciled: '#16A34A', // green — matched / healthy
    info: '#0A6CFF'
  },
  /** The persistent DEMO banner colour (regulatory: every screen). */
  demo: '#B54708'
} as const

/** Density toggles — comfortable (default) and compact, as a row-height + padding pair. */
export const density = {
  comfortable: { rowHeight: '2.75rem', padY: space[3] },
  compact: { rowHeight: '2rem', padY: space[1] }
} as const

export const tokens = { fontFamily, fontSize, space, radius, color, density } as const
export type DesignTokens = typeof tokens

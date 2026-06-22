/**
 * UI-00 — OFBO portal design tokens (repo-canonical source of truth).
 *
 * RECONCILED 2026-06-17 against the live Stitch project (8050269076066130289,
 * "Open Finance Back Office"). `color`, `borderRadius`, and `spacing` below are
 * codified VERBATIM from the Stitch screens' `tailwind-config` (cross-checked across
 * the Customer Care Console + Reconciliation Console — identical Material 3 base).
 * Fonts confirmed from the screens' Google-Fonts links. Framework-agnostic data
 * (no Tailwind/React import) so it stays usable for the Tailwind preset (UI-00b),
 * CSS variables, or tests. Stitch = appearance source of truth; OpenAPI = behaviour.
 */

/** Confirmed from the Stitch font links: Inter (UI), JetBrains Mono (ids/amounts),
 *  Material Symbols Outlined (icons). */
export const fontFamily = {
  sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
  mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
  symbols: ['Material Symbols Outlined']
} as const

/**
 * Material 3 colour roles — verbatim from the Stitch design system (light theme).
 * Keys keep the M3 role names so the Tailwind preset maps 1:1 to the Stitch screens.
 */
export const color = {
  primary: '#000000',
  'primary-container': '#131b2e',
  'on-primary': '#ffffff',
  'on-primary-container': '#7c839b',
  'primary-fixed': '#dae2fd',
  'primary-fixed-dim': '#bec6e0',
  'on-primary-fixed': '#131b2e',
  'on-primary-fixed-variant': '#3f465c',
  'inverse-primary': '#bec6e0',
  secondary: '#0058be',
  'secondary-container': '#2170e4',
  'on-secondary': '#ffffff',
  'on-secondary-container': '#fefcff',
  'secondary-fixed': '#d8e2ff',
  'secondary-fixed-dim': '#adc6ff',
  'on-secondary-fixed': '#001a42',
  'on-secondary-fixed-variant': '#004395',
  tertiary: '#000000',
  'tertiary-fixed': '#d3e4fe',
  'tertiary-fixed-dim': '#b7c8e1',
  'on-tertiary': '#ffffff',
  'on-tertiary-container': '#75859d',
  'on-tertiary-fixed': '#0b1c30',
  'on-tertiary-fixed-variant': '#38485d',
  error: '#ba1a1a',
  'error-container': '#ffdad6',
  'on-error': '#ffffff',
  'on-error-container': '#93000a',
  background: '#f7f9fb',
  'on-background': '#191c1e',
  surface: '#f7f9fb',
  'surface-dim': '#d8dadc',
  'surface-bright': '#f7f9fb',
  'surface-variant': '#e0e3e5',
  'surface-tint': '#565e74',
  'surface-container-lowest': '#ffffff',
  'surface-container-low': '#f2f4f6',
  'surface-container': '#eceef0',
  'surface-container-high': '#e6e8ea',
  'surface-container-highest': '#e0e3e5',
  'on-surface': '#191c1e',
  'on-surface-variant': '#45464d',
  'inverse-surface': '#2d3133',
  'inverse-on-surface': '#eff1f3',
  outline: '#76777d',
  'outline-variant': '#c6c6cd'
} as const

/**
 * OFBO semantic extensions layered on the Stitch base (the M3 config ships only
 * `error`). The operational status triad is load-bearing across every console
 * (PRD §7): breach = the Stitch error red; break = amber; reconciled = green.
 * `demo` is the mandatory persistent DEMO-banner colour (regulatory hard-stop).
 * NOTE: break/reconciled are OFBO additions (Stitch screens colour these with
 * Tailwind defaults) — keep aligned with the Recon/Risk consoles.
 */
export const ext = {
  status: {
    breach: '#ba1a1a', // = Stitch `error`
    break: '#b26a00', // amber — reconciliation break / warning
    reconciled: '#146c2e' // green — matched / healthy
  },
  demo: '#b54708',
  /**
   * UI-01 — the dark "institutional shell" navy chrome, codified from the Stitch
   * "OFBO - Operations Console (Synchronized)" screen (project 8050269076066130289):
   * a navy sidebar with light-slate nav text. The design system always intended this
   * ("Primary Navy #0F172A: used for global navigation") — the shell now adopts it.
   * The top bar + content stay on the light surface tokens. Active items reuse
   * `secondary` (the Stitch active-selection blue) at low opacity + a blue-400 accent.
   */
  nav: {
    surface: '#0f172a', // navy sidebar surface (Stitch bg-[#0f172a])
    on: '#cbd5e1', // slate-300 — default nav text
    elevated: '#1e293b', // slate-800 — hover bg + sidebar border
    active: '#60a5fa' // blue-400 — active item accent text
  }
} as const

/**
 * Verbatim from the Stitch design system `rounded` scale. Re-reconciled 2026-06-19
 * against the live project's designMd (the 2026-06-17 codification had the scale shifted
 * one step too small and `full` set to 0.75rem instead of a pill — status badges using
 * `rounded-full` rendered as 12px rects rather than the spec's "fully pill-shaped").
 */
export const borderRadius = {
  sm: '0.125rem',
  DEFAULT: '0.25rem', // soft 0.25rem — inputs/buttons (Stitch "Shapes")
  md: '0.375rem',
  lg: '0.5rem', // data containers / cards
  xl: '0.75rem',
  full: '9999px' // status badges — fully pill-shaped
} as const

/** Verbatim from the Stitch config — 4px base unit + named layout tokens. The numeric
 *  spacing + type scales come from Tailwind defaults (also 4px-based). */
export const spacing = {
  unit: '4px',
  gutter: '16px',
  'container-padding': '24px',
  'row-height-standard': '48px', // density: comfortable
  'row-height-dense': '32px' // density: compact
} as const

export const tokens = { fontFamily, color, ext, borderRadius, spacing } as const
export type DesignTokens = typeof tokens

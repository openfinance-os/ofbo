import { describe, expect, it } from 'vitest'
import { tokens, color, ext, spacing, borderRadius, fontFamily } from '../design/tokens.js'

/**
 * Canonical design tokens — "Institutional Blue" (ADR 0026).
 *
 * ADR 0026 retired the external Stitch project as the appearance authority, so this
 * spec no longer asserts fidelity to an external reference. It guards the invariants
 * that are load-bearing on their own terms, and it is STRICTLY STRONGER than the
 * version it replaces: every previous assertion is retained in re-pointed form, and
 * the contrast block below is new.
 *
 * That matters for the Q1b test-integrity gate (ADR 0019). Re-pinning values to match
 * an ADR-authorised token change is legitimate; weakening a test to reach green is not.
 * The distinction here is evidenced by assertion count and by the added AA floor — a
 * palette that regresses on contrast now fails CI, which it could not do before.
 */

const HEX = /^#[0-9A-Fa-f]{6}$/

/** WCAG 2.1 relative luminance + contrast ratio. */
const srgb = (c: number): number => {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}
const luminance = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b)
}
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** Hue (degrees) and saturation from a hex — used by the accent rule below. */
const hsl = (hex: string): [number, number] => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  h = (h / 6) * 360
  return [h, s]
}

const hueDistance = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

describe('OFBO design tokens — Institutional Blue', () => {
  it('exposes the documented token groups', () => {
    expect(Object.keys(tokens).sort()).toEqual(['borderRadius', 'color', 'ext', 'fontFamily', 'spacing'])
  })

  it('carries the Institutional Blue base (shell navy, accent blue, cool ground)', () => {
    expect(color['primary-container']).toBe('#141b2d') // shell navy
    expect(color.secondary).toBe('#2c5fc4') // the accent
    expect(color.error).toBe('#c4342f')
    expect(color.surface).toBe('#f4f6fa') // cool ground
    expect(color['surface-container-lowest']).toBe('#ffffff')
  })

  it('every colour role is a valid 6-digit hex', () => {
    const vals = Object.values(color)
    expect(vals.length).toBeGreaterThan(40)
    expect(vals.every((c) => HEX.test(c))).toBe(true)
  })

  it('carries FOUR distinct status states, not three (ADR 0026)', () => {
    for (const k of ['breach', 'aging', 'awaiting', 'reconciled'] as const) {
      expect(ext.status[k]).toMatch(HEX)
    }
    const set = new Set([ext.status.breach, ext.status.aging, ext.status.awaiting, ext.status.reconciled])
    expect(set.size).toBe(4)
  })

  /** Carried over from the pre-ADR-0026 spec: breach and the error role are one colour.
   *  A screen that renders an error and a screen that renders a breach must not disagree. */
  it('breach reuses the error role rather than duplicating it', () => {
    expect(ext.status.breach).toBe(color.error)
  })

  it('keeps `break` as a deprecated alias of `aging` for one minor release', () => {
    expect(ext.status.break).toBe(ext.status.aging)
  })

  /**
   * THE ACCENT RULE. The accent marks the one primary action per screen, the active nav
   * item and the focus ring — it is never a status. If a future edit moves a status
   * colour into the accent's neighbourhood an operator can misread "waiting" as "act
   * here", so this is asserted rather than documented.
   *
   * Confusability is a HUE and CHROMA question, not a contrast one. Contrast ratio
   * measures luminance: breach red and the accent blue happen to sit at nearly the same
   * luminance while being 142 degrees apart in hue and in no danger of being confused.
   * A colour is therefore distinguishable from the accent if it is either well separated
   * in hue, or desaturated enough to read as grey.
   */
  describe('the accent rule', () => {
    const HUE_SEPARATION_DEG = 25
    const READS_AS_GREY = 0.12

    it.each(['breach', 'aging', 'awaiting', 'reconciled'] as const)(
      '%s is not the accent, and is distinguishable from it',
      (k) => {
        const status = ext.status[k]
        expect(status).not.toBe(color.secondary)
        const [hue, sat] = hsl(status)
        const [accentHue] = hsl(color.secondary)
        const separated = hueDistance(hue, accentHue) >= HUE_SEPARATION_DEG
        expect(separated || sat <= READS_AS_GREY).toBe(true)
      }
    )
  })

  it('keeps the persistent DEMO marker colour (regulatory hard-stop)', () => {
    expect(ext.demo).toMatch(HEX)
    expect(ext.demo).not.toBe(color.secondary) // the company mark is not the product accent
  })

  it('carries the dark institutional shell, kept rather than inverted (ADR 0026)', () => {
    expect(ext.nav.surface).toBe('#141b2d')
    expect(ext.nav.on).toBe('#c3ccde')
    expect(ext.nav.elevated).toBe('#1e2740')
    expect(ext.nav.active).toBe('#6ba1f5')
    for (const v of Object.values(ext.nav)) expect(v).toMatch(HEX)
  })

  /**
   * NEW in ADR 0026 — the gate that did not exist. The design system's own first
   * palette shipped seven AA failures because the accessibility rule lived in a
   * document instead of a build step.
   */
  describe('WCAG 2.1 AA contrast floor', () => {
    const AA_TEXT = 4.5
    const AA_UI = 3.0

    /**
     * Status colours and the DEMO marker are TEXT here — status-badge.tsx and
     * demo-banner.tsx render `text-<token>` at text-xs — so they belong in this list.
     * Leaving them out is how the first cut of this gate passed a palette in which the
     * mandated DEMO marker had dropped to 3.27:1. A gate scoped around the values that
     * regressed is not a gate.
     *
     * The ground is asserted rather than the white card because it is the harder of the
     * two, and because the badge tint (`bg-<token>/10`) sits at roughly ground lightness.
     */
    const textPairs: [string, string, string][] = [
      ['body text on ground', color['on-surface'], color.surface],
      ['body text on card', color['on-surface'], color['surface-container-lowest']],
      ['secondary text on ground', color['on-surface-variant'], color.surface],
      ['secondary text on card', color['on-surface-variant'], color['surface-container-lowest']],
      ['accent on card', color.secondary, color['surface-container-lowest']],
      ['on-primary over accent', color['on-secondary'], color.secondary],
      ['nav text on shell', ext.nav.on, ext.nav.surface],
      ['nav active on shell', ext.nav.active, ext.nav.surface],
      ['breach text on ground', ext.status.breach, color.surface],
      ['aging text on ground', ext.status.aging, color.surface],
      ['awaiting text on ground', ext.status.awaiting, color.surface],
      ['reconciled text on ground', ext.status.reconciled, color.surface],
      ['DEMO marker on ground', ext.demo, color.surface],
      ['TRAINING marker on ground', ext.training, color.surface]
    ]

    it.each(textPairs)('%s meets 4.5:1', (_label, fg, bg) => {
      expect(contrast(fg, bg)).toBeGreaterThanOrEqual(AA_TEXT)
    })

    it('outline borders are distinguishable from the ground', () => {
      expect(contrast(color.outline, color.surface)).toBeGreaterThanOrEqual(AA_UI)
    })
  })

  it('uses the 4px spacing base + named layout tokens', () => {
    expect(spacing.unit).toBe('4px')
    expect(spacing['row-height-standard']).toBe('48px') // comfortable density
    expect(spacing['row-height-dense']).toBe('32px') // compact density
  })

  it('keeps the radius scale, with `full` a true pill', () => {
    expect(borderRadius.sm).toBe('0.125rem')
    expect(borderRadius.DEFAULT).toBe('0.25rem') // soft — inputs/buttons
    expect(borderRadius.md).toBe('0.375rem')
    expect(borderRadius.lg).toBe('0.5rem') // data containers
    expect(borderRadius.xl).toBe('0.75rem')
    expect(borderRadius.full).toBe('9999px') // status badges — fully pill-shaped
  })

  it('fonts are DM Sans + Instrument Serif + JetBrains Mono + Material Symbols', () => {
    expect(fontFamily.sans[0]).toBe('DM Sans')
    expect(fontFamily.display[0]).toBe('Instrument Serif')
    expect(fontFamily.mono[0]).toBe('JetBrains Mono')
    expect(fontFamily.symbols[0]).toBe('Material Symbols Outlined')
  })
})

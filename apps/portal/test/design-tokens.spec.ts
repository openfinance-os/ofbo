import { describe, expect, it } from 'vitest'
import { tokens, color, ext, spacing, borderRadius, fontFamily } from '../design/tokens.js'

/**
 * UI-00 — canonical design tokens, reconciled VERBATIM against the live Stitch
 * "Open Finance Back Office" design system (Material 3). Guards the load-bearing
 * invariants so a future edit can't silently drift the brand/status semantics.
 */

const HEX = /^#[0-9A-Fa-f]{6}$/

describe('OFBO design tokens (reconciled to Stitch)', () => {
  it('exposes the documented token groups', () => {
    expect(Object.keys(tokens).sort()).toEqual(['borderRadius', 'color', 'ext', 'fontFamily', 'spacing'])
  })

  it('mirrors the Stitch Material 3 base verbatim (primary-container navy, error red, surface)', () => {
    expect(color['primary-container']).toBe('#131b2e')
    expect(color.error).toBe('#ba1a1a')
    expect(color.surface).toBe('#f7f9fb')
    expect(color.secondary).toBe('#0058be')
  })

  it('every M3 colour role is a valid 6-digit hex', () => {
    const vals = Object.values(color)
    expect(vals.length).toBeGreaterThan(40)
    expect(vals.every((c) => HEX.test(c))).toBe(true)
  })

  it('carries the load-bearing OFBO status triad (breach=Stitch error, break=amber, reconciled=green), all distinct hex', () => {
    expect(ext.status.breach).toBe(color.error) // breach reuses the Stitch error red
    for (const k of ['breach', 'break', 'reconciled'] as const) expect(ext.status[k]).toMatch(HEX)
    const set = new Set([ext.status.breach, ext.status.break, ext.status.reconciled])
    expect(set.size).toBe(3)
  })

  it('keeps the persistent DEMO banner colour (regulatory)', () => {
    expect(ext.demo).toMatch(HEX)
  })

  it('uses the Stitch 4px spacing base + named layout tokens', () => {
    expect(spacing.unit).toBe('4px')
    expect(spacing['row-height-standard']).toBe('48px') // comfortable density
    expect(spacing['row-height-dense']).toBe('32px') // compact density
  })

  it('mirrors the Stitch radii (rem)', () => {
    expect(borderRadius.DEFAULT).toBe('0.125rem')
    expect(borderRadius.full).toBe('0.75rem')
  })

  it('fonts are Inter (sans) + JetBrains Mono (mono) + Material Symbols (icons)', () => {
    expect(fontFamily.sans[0]).toBe('Inter')
    expect(fontFamily.mono[0]).toBe('JetBrains Mono')
    expect(fontFamily.symbols[0]).toBe('Material Symbols Outlined')
  })
})

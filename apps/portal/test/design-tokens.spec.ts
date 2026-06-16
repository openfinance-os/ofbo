import { describe, expect, it } from 'vitest'
import { tokens, color, space, fontFamily } from '../design/tokens.js'

/**
 * UI-00 — canonical design tokens (codified from the Stitch "Regulated Institutional
 * Interface" system). Guards the load-bearing invariants the console depends on so a
 * future edit can't silently drift the brand/status semantics.
 */

const HEX = /^#[0-9A-Fa-f]{6}$/

describe('OFBO design tokens', () => {
  it('exposes the documented token groups', () => {
    expect(Object.keys(tokens).sort()).toEqual(['color', 'density', 'fontFamily', 'fontSize', 'radius', 'space'])
  })

  it('primary is the Regulated Institutional navy', () => {
    expect(color.primary.DEFAULT).toBe('#0F172A')
  })

  it('carries the load-bearing status triad (breach=red, break=amber, reconciled=green) as valid hex', () => {
    for (const k of ['breach', 'break', 'reconciled', 'info'] as const) {
      expect(color.status[k]).toMatch(HEX)
    }
    expect(color.status.breach).not.toBe(color.status.reconciled)
    expect(color.status.break).not.toBe(color.status.reconciled)
  })

  it('keeps the persistent DEMO banner colour (regulatory)', () => {
    expect(color.demo).toMatch(HEX)
  })

  it('uses a 4px spacing base (space[1] = 0.25rem) on a monotonic scale', () => {
    expect(space[1]).toBe('0.25rem')
    const rem = [space[1], space[2], space[3], space[4]].map((s) => parseFloat(s))
    expect(rem).toEqual([...rem].sort((a, b) => a - b))
    expect(parseFloat(space[2])).toBeCloseTo(parseFloat(space[1]) * 2) // 8px = 2×4px
  })

  it('every colour leaf is a valid 6-digit hex (no raw/partial values)', () => {
    const leaves: string[] = []
    const walk = (v: unknown) => (typeof v === 'string' ? leaves.push(v) : Object.values(v as object).forEach(walk))
    walk(color)
    expect(leaves.length).toBeGreaterThan(0)
    expect(leaves.every((c) => HEX.test(c))).toBe(true)
  })

  it('fonts are Inter (sans) + JetBrains Mono (mono)', () => {
    expect(fontFamily.sans[0]).toBe('Inter')
    expect(fontFamily.mono[0]).toBe('JetBrains Mono')
  })
})

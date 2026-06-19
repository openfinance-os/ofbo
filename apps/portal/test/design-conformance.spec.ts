import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

/**
 * BACKOFFICE-26 — console design-system + Al Tareq brand conformance.
 *
 * Operationalises the binding UI-00b rule ("token-only: no raw hex/px in
 * components — CI enforces") and the PRD acceptance "no critical design findings":
 * every portal screen must use the design-system token utilities (from the Stitch
 * Material 3 preset, apps/portal/design/tokens.ts) — never raw hex, Tailwind
 * arbitrary px/rem/em or #hex values, inline style props, or the retired M1
 * `--ofbo-*` palette. This test IS the enforcing gate, run in the Q1 unit suite.
 *
 * The token VALUES (Al Tareq/M3 roles, status triad, DEMO banner) are guarded
 * separately by design-tokens.spec.ts; this guards their USE across the consoles.
 */

const here = dirname(fileURLToPath(import.meta.url))
const SRC = join(here, '..', 'src')

/** Strip comments so documentation like "Stitch: w-60 = 240px" is never flagged. */
function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments + JSX {/* … */}
    .replace(/(^|[^:])\/\/.*$/gm, '$1') // line comments (but not the // in URLs)
}

const RULES: { name: string; re: RegExp }[] = [
  { name: 'raw hex colour', re: /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b/ },
  { name: 'arbitrary px/rem/em/hex value', re: /\[[^\]]*(?:\d(?:px|rem|em)\b|#[0-9a-fA-F]{3,6})[^\]]*\]/ },
  { name: 'inline style prop', re: /style=\{\{/ },
  { name: 'retired --ofbo-* palette', re: /--ofbo-/ }
]

function violations(code: string): string[] {
  const stripped = stripComments(code)
  return RULES.filter((r) => r.re.test(stripped)).map((r) => r.name)
}

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    if (e.isDirectory()) return tsxFiles(p)
    return e.name.endsWith('.tsx') ? [p] : []
  })
}

describe('BACKOFFICE-26 — design-conformance detector (proves the gate bites)', () => {
  it('flags raw hex, arbitrary px/hex, inline styles, and the retired palette', () => {
    expect(violations('<div className="text-[#ffffff]" />')).toContain('arbitrary px/rem/em/hex value')
    expect(violations('<div className="w-[240px]" />')).toContain('arbitrary px/rem/em/hex value')
    expect(violations('<div style={{ color: "red" }} />')).toContain('inline style prop')
    expect(violations('const navy = "#131b2e"')).toContain('raw hex colour')
    expect(violations('background: var(--ofbo-navy)')).toContain('retired --ofbo-* palette')
  })

  it('does NOT flag token utilities, unit-less arbitrary values, or px in comments', () => {
    expect(violations('<aside className="w-60 py-container-padding bg-surface" /> // Stitch: w-60 = 240px')).toEqual([])
    expect(violations('/* A 240px sidebar, 64px top bar */\n<div className="bg-primary-container text-on-surface" />')).toEqual([])
    expect(violations('<div className="grid grid-cols-[1fr_2fr] rounded-lg gap-gutter" />')).toEqual([])
  })
})

describe('BACKOFFICE-26 — console design-system conformance (every screen)', () => {
  const files = tsxFiles(SRC)

  it('scans the whole portal component + page tree', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  for (const f of files) {
    it(`${relative(SRC, f)} → token-only (no critical design findings)`, () => {
      expect(violations(readFileSync(f, 'utf8'))).toEqual([])
    })
  }
})

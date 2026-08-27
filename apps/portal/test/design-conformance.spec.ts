import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

/**
 * BACKOFFICE-26 — console design-system + Al Tareq brand conformance.
 *
 * Operationalises the binding UI-00b rule ("token-only: no raw hex/px in
 * components — CI enforces") and the PRD acceptance "no critical design findings":
 * every portal screen must use the design-system token utilities (from
 * apps/portal/design/tokens.ts) — never raw hex, Tailwind
 * arbitrary px/rem/em or #hex values, inline style props, or the retired M1
 * `--ofbo-*` palette. This test IS the enforcing gate, run in the Q1 unit suite.
 *
 * The token VALUES (colour roles, the four status states, DEMO marker) are guarded
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

/**
 * BACKOFFICE-83 — the marker's two placements are coupled across THREE files: the root layout
 * mounts the floating fallback, the app shell docks the inline one, and globals.css hides the
 * fallback wherever the shell is present. Nothing in the type system ties those together, and
 * the failure modes are asymmetric:
 *
 *   rule missing / selector drifts  → two markers on every authenticated screen (ugly, safe)
 *   layout mount removed           → NO marker on sign-in and the error boundaries (a hard-stop
 *                                    breach, and invisible until someone audits a screenshot)
 *
 * So assert the wiring, not the appearance. These are cheap and they fail loudly the moment a
 * testid is renamed or the root mount is "tidied up".
 */
describe('BACKOFFICE-83 — the non-prod marker is mounted exactly once, everywhere', () => {
  const read = (p: string) => readFileSync(join(SRC, p), 'utf8')

  it('the root layout mounts the floating fallback, so no new page can forget the marker', () => {
    const layout = read(join('app', 'layout.tsx'))
    expect(layout).toMatch(/<DemoPill/)
    expect(layout).toMatch(/<TrainingPill/)
  })

  it('the app shell docks the inline marker in its top bar', () => {
    const shell = read(join('components', 'app-shell.tsx'))
    expect(shell).toMatch(/<DemoMarker/)
    expect(shell).toMatch(/<TrainingMarker/)
  })

  it('globals.css suppresses the floating fallback wherever the shell is mounted', () => {
    const css = read(join('app', 'globals.css'))
    // The selector must name BOTH the shell and each floating marker, or a duplicate ships.
    expect(css).toMatch(/body:has\(\[data-testid='app-shell'\]\)[\s\S]*?\[data-testid='demo-banner'\]/)
    expect(css).toMatch(/body:has\(\[data-testid='app-shell'\]\)[\s\S]*?\[data-testid='training-banner'\]/)
    expect(css).toMatch(/display:\s*none/)
  })

  it('the shell carries the testid that suppression selector depends on', () => {
    // If this id is renamed the CSS silently stops matching and two markers ship — the
    // selector's contract, asserted from the other side.
    expect(read(join('components', 'app-shell.tsx'))).toMatch(/data-testid="app-shell"/)
  })
})

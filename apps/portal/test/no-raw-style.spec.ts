import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * UI-00b — token-only enforcement (CLAUDE.md UI/UX rule): portal components must not
 * carry raw colours or pixel sizes — everything routes through the Stitch design
 * tokens via Tailwind utilities. This is the repo's "CI lint fails on raw hex/px in
 * components" guard. Scans the src tree (ts + tsx); the design tokens
 * (apps/portal/design) are the one place raw values are allowed and live OUTSIDE src.
 */

const srcDir = fileURLToPath(new URL('../src', import.meta.url))

function tsxFiles(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...tsxFiles(p))
    else if (/\.(tsx|ts)$/.test(e.name)) out.push(p)
  }
  return out
}

// 3- or 6-digit hex, and rgb()/hsl() colour literals.
const RAW_HEX = /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b|\b(?:rgba?|hsla?)\(/
const RAW_PX = /\b\d+px\b/

/** Strip comments — prose may legitimately mention px/hex; the rule targets code. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}
const read = (f: string) => stripComments(readFileSync(f, 'utf8'))

describe('portal components are token-only (no raw hex/px)', () => {
  const files = tsxFiles(srcDir)

  it('finds component files to scan', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it('no raw 6-digit hex colour in any component', () => {
    const offenders = files.filter((f) => RAW_HEX.test(read(f))).map((f) => f.replace(srcDir, 'src'))
    expect(offenders, `raw hex found — use a Stitch design token utility instead: ${offenders.join(', ')}`).toEqual([])
  })

  it('no raw px size in any component', () => {
    const offenders = files.filter((f) => RAW_PX.test(read(f))).map((f) => f.replace(srcDir, 'src'))
    expect(offenders, `raw px found — use a token-based Tailwind utility instead: ${offenders.join(', ')}`).toEqual([])
  })
})

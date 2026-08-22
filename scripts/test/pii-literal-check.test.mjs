// Raised as FAIL 3 (twice) by the hard-stop review of PR #323, against
// `packages/ports/test/financial-system.spec.ts:28` and
// `services/bff/test/billing-payable-dispatch.spec.ts:260`.
//
// Both are IBAN-shaped literals in fixtures. Both are deliberate REDACTION CANARIES: their whole
// purpose is to assert that a value the redactor recognises never reaches an INSERT-only trail, and
// a redaction test whose input the redactor does not recognise proves nothing. The reviewer said so
// itself, and then made the point that actually matters:
//
//     "If the project's intent is that IBAN-shaped canaries are permitted where a redaction control
//      is being asserted, that exemption is not written down anywhere I could find, and this is
//      where it should be recorded."
//
// That is correct, and the gap was real: the repo had a convention (synthetic IBANs use the
// unallocated bank code 000; synthetic national identifiers use prefix 999, never the real 784),
// every fixture in the tree already followed it, and NOTHING enforced it. A convention held only by
// everyone remembering is one bad afternoon from being broken silently.
//
// So the exemption is now written down — in CLAUDE.md's hard stops — and bounded here. Shape-based
// canaries are permitted; real-range identifiers are not, anywhere, in any file.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** The same pattern the redactor itself uses (packages/redaction/src/index.ts), so the guard and
 *  the control agree on what "IBAN-shaped" means. */
const IBAN = /\bAE\d{2}(?:[ ._-]?\d){19}\b/gi
/** UAE Emirates ID. 784 is the REAL issuer prefix; 999 is this repo's synthetic stand-in. */
const REAL_EID = /\b784[-\s]?\d{4}[-\s]?\d{7}[-\s]?\d\b/g

const SCANNED = /\.(ts|tsx|mjs|js|json|sql|yaml|yml)$/

function repoFiles() {
  return execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter((f) => f && SCANNED.test(f))
}

function read(f) {
  try {
    return readFileSync(join(root, f), 'utf8')
  } catch {
    return ''
  }
}

test('every IBAN-shaped literal uses the unallocated synthetic bank code 000', () => {
  // Bank code is characters 5-7 (AE + 2 check digits + 3 bank). 000 is unallocated, so the value
  // cannot name a real institution's account no matter how it is read. This is what makes a
  // redaction canary safe to write down: it is recognisable to the redactor AND unusable.
  const offenders = []
  for (const f of repoFiles()) {
    for (const hit of read(f).match(IBAN) ?? []) {
      const bank = hit.replace(/[ ._-]/g, '').slice(4, 7)
      if (bank !== '000') offenders.push(`${f}: ${hit} (bank code ${bank})`)
    }
  }
  assert.deepEqual(
    offenders, [],
    'IBAN-shaped literals are permitted ONLY in the synthetic 000 bank-code range. A shape-matching '
    + 'literal outside it could name a real account, and these files are committed forever:\n  '
    + offenders.join('\n  ')
  )
})

test('no literal uses the REAL Emirates ID prefix 784 — synthetic identifiers use 999', () => {
  const offenders = []
  for (const f of repoFiles()) {
    for (const hit of read(f).match(REAL_EID) ?? []) offenders.push(`${f}: ${hit}`)
  }
  assert.deepEqual(
    offenders, [],
    '784 is the real UAE Emirates ID issuer prefix. Synthetic identifiers use 999 so that no '
    + 'fixture, seed or test name can collide with a real person:\n  ' + offenders.join('\n  ')
  )
})

test('identifier-shaped canaries stay in tests and fixtures, never in shipped source', () => {
  // The exemption is for tests that ASSERT a redaction control. Production source has no reason to
  // carry an identifier-shaped literal at all, and one appearing there would be a value in the
  // running system rather than a probe of it.
  const isTestOrFixture = (f) =>
    /(^|\/)(test|tests|fixtures|__tests__)\//.test(f)
    || /\.(spec|test)\.[cm]?[jt]sx?$/.test(f)
    || f.startsWith('scripts/test/')
  const offenders = []
  for (const f of repoFiles()) {
    if (isTestOrFixture(f)) continue
    if ((read(f).match(IBAN) ?? []).length) offenders.push(f)
  }
  assert.deepEqual(
    offenders, [],
    'IBAN-shaped literals outside tests/fixtures:\n  ' + offenders.join('\n  ')
  )
})

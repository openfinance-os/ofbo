// HARNESS-15 — re-verify a sealed evidence bundle from disk.
//
// verifyEvidenceBundle() existed, was exported and was unit-tested, but nothing ever called it:
// the digest was computed at write time and never checked again, so tampering was DETECTABLE
// but not DETECTED. This is the caller. The release workflow runs it between assembling the
// bundle and committing it, so a bundle whose seal does not recompute never reaches git; it
// also verifies any bundle already committed under releases/, which is what an auditor
// re-running the check months later actually needs.
//
//   pnpm --filter @ofbo/release-evidence exec tsx scripts/verify-bundle.ts <bundle.json>...
//
// Exit 0 when every named bundle verifies, 1 otherwise. Naming no bundle is an error rather
// than a vacuous pass — "verified nothing" must not look like "verified everything".
import { readFileSync } from 'node:fs'
import process from 'node:process'
import { verifyEvidenceBundle, type EvidenceBundle } from '../src/index.js'

const paths = process.argv.slice(2).filter((a) => !a.startsWith('--'))

if (paths.length === 0) {
  process.stderr.write('verify-bundle: no bundle paths given (refusing to report a vacuous pass)\n')
  process.exit(1)
}

let failed = 0
for (const path of paths) {
  let ok = false
  try {
    const bundle = JSON.parse(readFileSync(path, 'utf8')) as EvidenceBundle
    ok = verifyEvidenceBundle(bundle)
  } catch (e) {
    process.stderr.write(`verify-bundle: ${path}: unreadable — ${e instanceof Error ? e.message : String(e)}\n`)
  }
  if (ok) {
    process.stdout.write(`verified: ${path}\n`)
  } else {
    failed += 1
    process.stderr.write(`TAMPERED OR CORRUPT: ${path} — recomputed digest does not match the seal\n`)
  }
}

if (failed > 0) {
  process.stderr.write(`verify-bundle: ${failed} of ${paths.length} bundle(s) failed verification\n`)
  process.exit(1)
}
process.stdout.write(`verify-bundle: ${paths.length} bundle(s) verified\n`)

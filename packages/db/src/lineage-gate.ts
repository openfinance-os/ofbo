import process from 'node:process'
import { validateLineageCoverage, evaluateLineageGate, KNOWN_LINEAGE_GAPS } from './lineage.js'

/**
 * BACKOFFICE-56 — the Q4.5 BCBS 239 lineage gate (CI). Validates that every Back
 * Office table with rows emits column-level lineage to P7, tolerating only the
 * documented known-pending gaps. Exits non-zero on any unexpected gap, so a
 * write-path table that stops emitting lineage blocks merge.
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL
  if (!url) {
    process.stderr.write('DATABASE_URL is required for the Q4.5 lineage gate\n')
    process.exit(1)
  }
  const report = await validateLineageCoverage(url)
  const result = evaluateLineageGate(report)

  process.stdout.write(`Q4.5 BCBS 239 lineage gate\n`)
  process.stdout.write(`  covered:        ${result.covered.join(', ') || '(none with rows yet)'}\n`)
  process.stdout.write(
    `  allowed gaps:   ${result.allowedGaps.map((t) => `${t} [${KNOWN_LINEAGE_GAPS[t]}]`).join(', ') || 'none'}\n`
  )
  process.stdout.write(`  unexpected:     ${result.unexpectedGaps.join(', ') || 'none'}\n`)
  if (result.staleAllowlist.length > 0) {
    process.stdout.write(
      `  note: allowlisted tables now covered — remove from KNOWN_LINEAGE_GAPS: ${result.staleAllowlist.join(', ')}\n`
    )
  }

  if (!result.ok) {
    process.stderr.write(
      `Q4.5 FAILED — tables with rows but no lineage (BCBS 239): ${result.unexpectedGaps.join(', ')}\n`
    )
    process.exit(1)
  }
  process.stdout.write('Q4.5 PASSED\n')
}

main().catch((e) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`)
  process.exit(1)
})

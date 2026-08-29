#!/usr/bin/env node
/**
 * Rebuild the demo dataset from scratch: truncate, re-apply migrations, re-seed.
 *
 * WHY THIS EXISTS. Both seeds are additive-only — every insert is `ON CONFLICT DO NOTHING` or
 * `WHERE NOT EXISTS`, and neither contains a single DELETE. That is correct for a seed (running it
 * twice must not duplicate a book of business) but it means a seed can only ever ADD. Rows written
 * by a retired seed stay for ever.
 *
 * They did. The hosted demo carried three `Fictional fintech 0N` counterparties that exist nowhere
 * in this repository — orphans of a seed replaced months earlier — sitting at the top of the TPP
 * registry because the screen sorts by directory sync time. Re-seeding could never remove them;
 * only a truncate can. This is that operation, as one auditable command instead of four remembered
 * ones.
 *
 * NON-PROD ONLY. `resetDatabase` refuses to run under DEPLOY_PROFILE=enterprise or
 * NODE_ENV=production, because regulated data has no deletion path (CLAUDE.md hard stop). The OFBO
 * demo environment is permanently non-prod and holds zero real PSU data, which is the only reason
 * truncating it is a legitimate operation at all.
 *
 *   DATABASE_URL=postgres://… pnpm demo:refresh
 *   DATABASE_URL=postgres://… pnpm demo:refresh --yes    # skip the confirmation prompt (CI)
 */
import { execFileSync } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import process from 'node:process'
import { URL } from 'node:url'

const out = (line) => process.stdout.write(`${line}\n`)
const err = (line) => process.stderr.write(`${line}\n`)

const url = process.env.DATABASE_URL
if (!url) {
  err('DATABASE_URL is required.\n  DATABASE_URL=postgres://… pnpm demo:refresh')
  process.exit(2)
}
// The non-prod guard is NOT duplicated here. `resetDatabase` calls it — it lives in
// packages/db/src/non-prod-guard.ts, the one file the profile-branching lint rule exempts — and a
// second copy in a wrapper is just a second thing to keep in step with the first. It refuses under
// DEPLOY_PROFILE=enterprise or NODE_ENV=production before it truncates anything.
//
// (This used to say `resetDatabase` OWNS the guard, in packages/db/src/reset.ts. Both halves went
// stale when the guard was split into its own module, so that importing a seed no longer dragged
// `resetDatabase` — and its TRUNCATE — into the request-path module graph. See ADR 0035.)

/** Show WHICH database, without printing the password. */
function describe(connectionString) {
  try {
    const u = new URL(connectionString)
    return `${u.hostname}${u.port ? `:${u.port}` : ''}${u.pathname}`
  } catch {
    return '(unparseable connection string)'
  }
}

const steps = [
  ['db:reset', 'truncate every data table (migrations + policy config preserved)'],
  ['db:apply', 're-apply migrations (a no-op when the ledger survived)'],
  ['db:seed', 'base synthetic dataset'],
  ['db:seed:demo', 'operating-state depth: book of business, breaks, approvals, notices']
]

out(`\nDemo refresh → ${describe(url)}\n`)
for (const [script, what] of steps) out(`  pnpm ${script.padEnd(14)} ${what}`)
out('\nThis DESTROYS all data in that database. Synthetic only — but it is not reversible.\n')

if (!process.argv.includes('--yes')) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await rl.question('Type the database name to continue: ')
  rl.close()
  const dbName = describe(url).split('/').pop()
  if (answer.trim() !== dbName) {
    err(`\nAborted — expected "${dbName}".`)
    process.exit(1)
  }
}

for (const [script] of steps) {
  out(`\n── pnpm ${script} ─────────────────────────────`)
  execFileSync('pnpm', [script], { stdio: 'inherit', env: process.env })
}
out('\nDemo refresh complete.\n')

// Agent-callable contract self-correction tool (`pnpm verify:contract`). The spec-first
// loop has unit/integration contract tests, plus two LLM reviewer subagents at PR time —
// but the agent only learns about LIVE response drift late (CI or review). This is the
// Specmatic "self-correcting contract loop" pattern: a single deterministic command the
// agent runs each iteration against the running BFF, validating real HTTP responses against
// specs/backoffice-openapi.yaml. It iterates to CONFORMANT before opening a PR, instead of
// waiting for a fallible reviewer to bounce it.
//
// Deterministic, no model judgement: every implemented, parameter-less GET is probed and its
// body validated against the spec response schema for whatever status comes back (a 200 data
// envelope or a 4xx/5xx error envelope both have schemas in the contract). Plus two negative
// probes that exercise the error envelope (missing FAPI header → 400, no bearer → 401).
//
// Usage (BFF must be running — see the run-ofbo skill; `smoke.sh --keep` leaves it up):
//   BASE_URL=http://localhost:8787 pnpm verify:contract
//   pnpm verify:contract                       # defaults to http://localhost:8787
//   pnpm verify:contract --against-demo         # validate the deployed demo BFF
import { randomUUID } from 'node:crypto'
import process from 'node:process'
import { ROUTES } from '@ofbo/contracts'
import { buildResponseValidator } from '@ofbo/contracts/testing'
import { IMPLEMENTED_ROUTES } from '@ofbo/bff'
import { SCOPE_MATRIX, mintScopes, ALL_PERSONAS } from '@ofbo/bff/auth'

const DEMO_BFF = 'https://ofbo-bff.michartmann.workers.dev'
const baseUrl = process.argv.includes('--against-demo')
  ? DEMO_BFF
  : (process.env.BASE_URL ?? 'http://localhost:8787').replace(/\/$/, '')

/** Lowest-privilege persona that holds the route's required scope — maximises 200s so the
 *  richest data-envelope schemas get exercised, not just the error envelope. Falls back to
 *  the super-admin (union of all scopes) for dynamic/unmatched scopes; a wrong guess only
 *  yields a 403, whose body is itself a spec-defined envelope we still validate. */
function personaForScope(scope: string | null): string {
  if (!scope) return 'operations-analyst'
  for (const persona of ALL_PERSONAS) {
    if (persona === 'platform-super-admin') continue
    if (mintScopes(persona).includes(scope)) return persona
  }
  return 'platform-super-admin'
}

interface Probe {
  method: 'get'
  path: string
  persona: string | null // null = unauthenticated negative probe
  fapi: boolean
  label: string
}

// Implemented, parameter-less GETs (no `{id}` path params, no `:action` query forms) — these
// need no seed-specific identifiers, so they probe cleanly on an empty or seeded store alike.
const positiveProbes: Probe[] = ROUTES.filter(
  (r) => r.method === 'get' && IMPLEMENTED_ROUTES.has(`get ${r.path}`) && !r.path.includes('{') && !r.path.includes(':')
).map((r) => ({ method: 'get', path: r.path, persona: personaForScope(r.scope), fapi: true, label: r.path }))

// Negative probes: the middleware chain's error envelopes are part of the contract too.
const negativeProbes: Probe[] = [
  { method: 'get', path: '/approvals/pending', persona: 'customer-care-agent', fapi: false, label: 'missing x-fapi-interaction-id → 400' },
  { method: 'get', path: '/approvals/pending', persona: null, fapi: true, label: 'no bearer token → 401' }
]

async function main(): Promise<void> {
  if (Object.keys(SCOPE_MATRIX).length === 0) throw new Error('empty persona matrix — wiring is broken')
  const validator = buildResponseValidator()
  process.stdout.write(`contract-verify: ${baseUrl}\n\n`)

  let conformant = 0
  let drift = 0
  let unreachable = 0
  const driftDetail: string[] = []

  for (const probe of [...positiveProbes, ...negativeProbes]) {
    const headers: Record<string, string> = {}
    if (probe.fapi) headers['x-fapi-interaction-id'] = randomUUID()
    if (probe.persona) headers['Authorization'] = `Bearer demo-token:${probe.persona}`

    let status: number
    let body: unknown
    try {
      const res = await fetch(`${baseUrl}${probe.path}`, { headers })
      status = res.status
      const text = await res.text()
      body = text ? JSON.parse(text) : null
    } catch (e) {
      unreachable += 1
      process.stdout.write(`  ?? UNREACHABLE  ${probe.label} (${e instanceof Error ? e.message : String(e)})\n`)
      continue
    }

    const check = validator.validate(probe.method, probe.path, status, body)
    if (check.skipped) {
      // Contract defines no JSON schema for this (method, path, status) — nothing to assert.
      process.stdout.write(`  ·· no-schema   ${probe.label} [${status}]\n`)
      continue
    }
    if (check.ok) {
      conformant += 1
      process.stdout.write(`  ✓ CONFORMANT  ${probe.label} [${status}]\n`)
    } else {
      drift += 1
      process.stdout.write(`  ✗ DRIFT       ${probe.label} [${status}]\n`)
      for (const err of check.errors) {
        process.stdout.write(`      ${err}\n`)
        driftDetail.push(`${probe.label} [${status}] — ${err}`)
      }
    }
  }

  process.stdout.write(`\ncontract-verify: ${conformant} conformant, ${drift} drift, ${unreachable} unreachable\n`)
  if (unreachable > 0 && conformant === 0) {
    process.stderr.write('BFF appears to be down — start it first (run-ofbo skill: smoke.sh --keep).\n')
    process.exit(2)
  }
  if (drift > 0) {
    process.stderr.write('\nLIVE RESPONSES DRIFT FROM specs/backoffice-openapi.yaml. Make the implementation match the\n')
    process.stderr.write('contract (the spec is ground truth — if the spec is wrong, use the spec-change skill first).\n')
    process.exit(1)
  }
  process.exit(0)
}

main().catch((e) => {
  process.stderr.write(`${e instanceof Error ? e.stack ?? e.message : String(e)}\n`)
  process.exit(1)
})

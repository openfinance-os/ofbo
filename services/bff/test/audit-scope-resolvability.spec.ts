import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ROUTES } from '@ofbo/contracts'
import { describe, expect, it } from 'vitest'
import { SYSTEM_ACTOR_RESPONSE_STATUS, SYSTEM_ACTOR_SCOPE } from '../src/high-class-audit.js'

/**
 * CODE-03 — every `scope_used` written to audit_high_sensitivity must resolve.
 *
 * The defect this closes is an audit-trail one, not an authorisation one: none of the invented
 * tokens was ever passed to assertScope, so no privilege was granted anywhere. What they did do was
 * name a scope an auditor cannot resolve against the contract, in an INSERT-only table with a 5-year
 * retention obligation and no deletion path — so unresolvable rows are permanent.
 *
 * `AuditEvent.scope_used` is an unconstrained string in the spec, so nothing was literally
 * contradicted. That is exactly why this check lives in code: the contract could not catch it, and
 * six tokens across fourteen sites accumulated over several stories precisely because each one
 * looked reasonable on its own.
 */

/**
 * Both trees that write to `audit_high_sensitivity`, not just the BFF.
 *
 * Scoping this to `services/bff/src` was the first version's blind spot: `packages/db` emits through
 * the same sink into the same INSERT-only table, so four emitters sat outside a check whose whole
 * purpose is that none can.
 */
const ROOTS = [
  join(import.meta.dirname, '../src'),
  join(import.meta.dirname, '../../../packages/db/src')
]

/**
 * The declared inventory, read from the generated route table rather than re-parsed from the YAML.
 * That table IS the spec's `x-required-scope` set — it is what rbac.ts enforces against — so the
 * check cannot drift from the contract by reading it a second, different way.
 */
function declaredScopes(): Set<string> {
  const out = new Set<string>()
  for (const route of ROUTES) if (route.scope) out.add(route.scope)
  return out
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return full.endsWith('.ts') ? [full] : []
  })
}

/**
 * Every `scope_used:` emission, resolved to a literal.
 *
 * Constants are resolved across the WHOLE tree, not just the declaring file. The first version
 * resolved same-file constants only and silently dropped the rest — which excluded every
 * `SYSTEM_ACTOR_SCOPE` site the CODE-03 fix had just created, i.e. the exact pattern the check exists
 * to police. An emission that cannot be resolved is now reported as UNRESOLVED rather than skipped,
 * because a value the check cannot read is precisely what it must not wave through.
 */
function emittedScopeLiterals(): Array<{ file: string; value: string }> {
  const files = ROOTS.flatMap((root) => sourceFiles(root).map((f) => ({ root, path: f })))

  // Pass one: every `const NAME = 'literal'` anywhere in either tree.
  const constants = new Map<string, string>()
  for (const { path } of files) {
    for (const m of readFileSync(path, 'utf8').matchAll(/(?:export\s+)?const\s+([A-Z0-9_]+)\s*(?::\s*string)?\s*=\s*'([^']+)'/g)) {
      constants.set(m[1]!, m[2]!)
    }
  }

  // Pass two: resolve each emission against that table.
  //
  // Two things are deliberately NOT emissions and are skipped: a TYPE position (`scope_used: string`
  // in an interface) and a read-back (`row.scope_used` when serving stored rows outward). Everything
  // else that cannot be resolved is reported, so a new dynamic site fails until it is justified.
  const out: Array<{ file: string; value: string }> = []
  for (const { root, path } of files) {
    for (const m of readFileSync(path, 'utf8').matchAll(/scope_used:\s*(?:'([^']+)'|([A-Za-z0-9_.?\s|]+?))\s*[,\n]/g)) {
      const name = m[2]?.trim()
      if (name && /^(string|number)(\s*\|\s*null)?$/.test(name)) continue
      if (name && /\.scope_used(\s+as\s+\w+)?$/.test(name)) continue
      const literal = m[1] ?? (name ? constants.get(name) : undefined)
      out.push({
        file: path.slice(root.length + 1),
        value: literal ?? `UNRESOLVED(${name ?? '?'})`
      })
    }
  }
  return out
}

/**
 * Emissions whose scope is only known at runtime, each acknowledged with a reason.
 *
 * Not a suppression list: an unlisted dynamic site FAILS. The point is that adding one has to be a
 * deliberate act with a justification attached, which is what stops the next undeclared value landing
 * quietly — the failure mode CODE-03 was raised for.
 */
const ACKNOWLEDGED_DYNAMIC: ReadonlyArray<{ file: string; value: string; because: string }> = [
  {
    file: 'analytics/exports.ts',
    value: 'UNRESOLVED(scope)',
    because: 'the caller\'s own asserted scope, taken from the principal that passed assertScope'
  },
  {
    file: 'governed-aggregate.ts',
    value: 'UNRESOLVED(ctx.scopeUsed ?? SYSTEM_ACTOR_SCOPE)',
    because: 'the caller\'s scope when the bypass was initiated by a principal, else the sentinel — '
      + 'both arms resolve, and the purpose code is carried in request_body rather than here'
  }
]

describe('CODE-03 audit scope resolvability', () => {
  it('finds the emission sites at all, so the check cannot pass by scanning nothing', () => {
    // Counts EVERY emission, resolved or not. The first version counted only resolved ones, so it sat
    // comfortably above its own threshold while a quarter of the sites went unexamined.
    expect(emittedScopeLiterals().length).toBeGreaterThan(60)
  })

  it('every emitted scope_used resolves against the declared inventory or the system sentinel', () => {
    const declared = declaredScopes()
    expect(declared.size).toBeGreaterThan(15)
    const allowed = new Set([...declared, SYSTEM_ACTOR_SCOPE])

    const acknowledged = new Set(ACKNOWLEDGED_DYNAMIC.map((e) => `${e.file}|${e.value}`))
    const unresolvable = emittedScopeLiterals()
      .filter((entry) => !allowed.has(entry.value))
      .filter((entry) => !acknowledged.has(`${entry.file}|${entry.value}`))
    const detail = unresolvable.map((e) => `${e.file}: ${e.value}`).sort().join('\n')
    expect(unresolvable, `unresolvable scope_used values:\n${detail}`).toEqual([])
  })

  it('declares the system sentinel and the non-HTTP response sentinel', () => {
    // Named constants rather than bare strings at fourteen call sites, so the convention is one
    // decision rather than fourteen chances to diverge again.
    expect(SYSTEM_ACTOR_SCOPE).toBe('system')
    expect(SYSTEM_ACTOR_RESPONSE_STATUS).toBe(0)
  })
})

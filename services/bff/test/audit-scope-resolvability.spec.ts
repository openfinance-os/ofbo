import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ROUTES } from '@ofbo/contracts'
import { describe, expect, it } from 'vitest'
import { SEED_ACTOR_SCOPE, UNSCOPED_AUTH_EVENT_SCOPE } from '@ofbo/db'
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
 * Read exactly one property value, from just after `scope_used:` to where that value ends.
 *
 * A pattern cannot do this. Matching to end-of-line over-reads a single-line `emit({ ... })` and
 * swallows the five properties that follow; matching a character class under-reads and goes BLIND on
 * anything containing a character the class forgot — which is the bug this file is fixing. A scanner
 * that tracks nesting and quotes reads the same value in both layouts and has nothing to forget.
 */
function scopeExpression(text: string, from: number): string {
  let depth = 0
  let quote: string | null = null
  for (let i = from; i < text.length; i += 1) {
    const ch = text[i]!
    if (quote) {
      if (ch === '\\') i += 1
      else if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch
    else if (ch === '(' || ch === '[' || ch === '{') depth += 1
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) return text.slice(from, i).trim()
      depth -= 1
    } else if (depth === 0 && (ch === ',' || ch === '\n')) return text.slice(from, i).trim()
  }
  return text.slice(from).trim()
}

/**
 * Split one `scope_used:` expression into the values it can actually produce.
 *
 * The first version matched the expression with a character class containing neither `:` nor `'`, so
 * a ternary and a `??`-with-literal produced NO MATCH AT ALL — they were not reported as UNRESOLVED,
 * they were invisible. That is how `scope_used: event.attempted_scope ?? 'none'` — the one undeclared
 * literal left in the repo — survived a check written to find exactly that, while the count guard sat
 * comfortably above its threshold because 92 of 94 sites still matched.
 *
 * String literals are masked before splitting, so a `:` inside `'billing:write'` cannot be mistaken
 * for a ternary arm. A ternary's CONDITION is dropped (it is not a value); both sides of `??` are
 * kept, because either can be written.
 */
function possibleValues(expression: string, constants: ReadonlyMap<string, string>): string[] {
  const literals: string[] = []
  let masked = expression.replace(/'([^']*)'/g, (_match, value: string) => {
    literals.push(value)
    return `@@LIT${literals.length - 1}@@`
  })

  // A `?` that is neither `??` nor `?.` opens a ternary; everything before it is the condition.
  const ternary = masked.search(/(?<!\?)\?(?![?.])/)
  if (ternary >= 0) masked = masked.slice(ternary + 1)

  return masked
    .split(/\?\?|:/)
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((part) => {
      const literal = part.match(/^@@LIT(\d+)@@$/)
      if (literal) return literals[Number(literal[1])]!
      return constants.get(part) ?? `UNRESOLVED(${part})`
    })
}

/**
 * Every value any `scope_used:` emission can write, across both trees.
 *
 * Constants resolve tree-wide, not per-file: resolving same-file only silently dropped every
 * `SYSTEM_ACTOR_SCOPE` site the CODE-03 fix had just created — the exact pattern this exists to
 * police. Anything that still cannot be resolved is REPORTED as UNRESOLVED rather than skipped,
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

  // Pass two: read each emission's expression with a scanner rather than a pattern, and decompose
  // it. Two forms are deliberately not emissions: a TYPE position (`scope_used: string` in an
  // interface) and a read-back (`row.scope_used`, serving stored rows outward).
  const out: Array<{ file: string; value: string }> = []
  for (const { root, path } of files) {
    const text = readFileSync(path, 'utf8')
    for (const m of text.matchAll(/\bscope_used:\s*/g)) {
      const expression = scopeExpression(text, m.index + m[0].length)
      if (/^(string|number)(\s*\|\s*null)?$/.test(expression)) continue
      if (/\.scope_used(\s+as\s+\w+)?$/.test(expression)) continue
      for (const value of possibleValues(expression, constants)) {
        out.push({ file: path.slice(root.length + 1), value })
      }
    }
  }
  return out
}

/**
 * Files that INSERT into audit_high_sensitivity with raw SQL, where no `scope_used:` object literal
 * exists for the scan above to read.
 *
 * The seed writers sat outside CODE-03's inventory for exactly this reason — a seventh token, in the
 * same regulated table, invisible to a check that only reads TypeScript object literals. This does
 * not parse SQL. It asserts the set of raw writers is CLOSED, so a new one has to be brought under
 * the convention deliberately rather than landing unexamined.
 */
const RAW_SQL_AUDIT_WRITERS: readonly string[] = ['audit.ts', 'seed-tenants.ts', 'seed.ts']

function rawSqlAuditWriters(): string[] {
  const found = new Set<string>()
  for (const root of ROOTS) {
    for (const path of sourceFiles(root)) {
      if (/INSERT\s+INTO\s+audit_high_sensitivity/i.test(readFileSync(path, 'utf8'))) {
        found.add(path.slice(root.length + 1))
      }
    }
  }
  return [...found].sort()
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
    because: "the caller's own asserted scope, taken from the principal that passed assertScope"
  },
  {
    file: 'governed-aggregate.ts',
    value: 'UNRESOLVED(ctx.scopeUsed)',
    because: "the caller's scope when the RLS bypass was initiated by a principal; the other arm of "
      + 'the ?? is the system sentinel, and both arms are now examined separately'
  },
  {
    file: 'tenant-billing-service-store.ts',
    value: 'UNRESOLVED(input.scopeUsed)',
    because: "the calling principal's scope on a human-initiated cross-tenant aggregate read — "
      + 'required, not optional, so there is no fallback left that could fabricate one'
  },
  {
    file: 'audit.ts',
    value: 'UNRESOLVED(event.attempted_scope)',
    because: 'the scope the caller was DENIED, set only by rbac.ts from the generated route table, '
      + 'so it is a declared scope by construction; the other arm is the auth-event sentinel'
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
    // Three declared non-route values, each with a DISTINCT meaning — a headless actor, a human
    // auth event no scope mediated, demo seed provenance. Not one token stretched over three
    // situations, which is the overloading CODE-03 was raised about.
    const allowed = new Set([
      ...declared, SYSTEM_ACTOR_SCOPE, UNSCOPED_AUTH_EVENT_SCOPE, SEED_ACTOR_SCOPE
    ])

    const acknowledged = new Set(ACKNOWLEDGED_DYNAMIC.map((e) => `${e.file}|${e.value}`))
    const unresolvable = emittedScopeLiterals()
      .filter((entry) => !allowed.has(entry.value))
      .filter((entry) => !acknowledged.has(`${entry.file}|${entry.value}`))
    const detail = unresolvable.map((e) => `${e.file}: ${e.value}`).sort().join('\n')
    expect(unresolvable, `unresolvable scope_used values:\n${detail}`).toEqual([])
  })

  it('leaves no raw-SQL writer into audit_high_sensitivity outside the known set', () => {
    // The scan above reads TypeScript object literals. A raw INSERT writes the same regulated column
    // and is invisible to it — which is how the seed writers' token stayed outside the inventory.
    expect(rawSqlAuditWriters()).toEqual([...RAW_SQL_AUDIT_WRITERS].sort())
  })

  it('declares the system sentinel and the non-HTTP response sentinel', () => {
    // Named constants rather than bare strings at fourteen call sites, so the convention is one
    // decision rather than fourteen chances to diverge again.
    expect(SYSTEM_ACTOR_SCOPE).toBe('system')
    expect(SYSTEM_ACTOR_RESPONSE_STATUS).toBe(0)
  })
})

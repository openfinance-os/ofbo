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
    // `;` terminates too: in an interface, `scope_used: string;` ends there. Omitting it made the
    // scan depend on SOURCE FORMATTING — the type position resolved as `string` in this repo's
    // semicolon-free style and as `string;` once Stryker re-printed the file for mutation
    // testing, which is how a green local run and a red CI run disagreed about the same source.
    } else if (depth === 0 && (ch === ',' || ch === ';' || ch === '\n')) return text.slice(from, i).trim()
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
/**
 * Both trees, read ONCE.
 *
 * The three scans in this file each walked and re-read every source file, and each is called from
 * more than one test — roughly six full reads of two trees per execution. That is invisible in the
 * unit suite (tens of milliseconds) and expensive under Stryker, which re-runs the covering tests
 * for every one of ~479 mutants; the mutation job crept 23m44s → 24m47s → past its 25-minute cap as
 * scans were added. Hoisting the I/O to module scope changes nothing about what is asserted.
 */
const SOURCES: ReadonlyArray<{ root: string; path: string; text: string }> = ROOTS.flatMap((root) =>
  sourceFiles(root).map((path) => ({ root, path, text: readFileSync(path, 'utf8') })))

/** Every `const NAME = 'literal'` in either tree, resolved once from the cached sources. */
const DECLARED_CONSTANTS: ReadonlyMap<string, string> = (() => {
  const constants = new Map<string, string>()
  for (const { text } of SOURCES) {
    for (const m of text.matchAll(/(?:export\s+)?const\s+([A-Z0-9_]+)\s*(?::\s*string)?\s*=\s*'([^']+)'/g)) {
      constants.set(m[1]!, m[2]!)
    }
  }
  return constants
})()

function emittedScopeLiterals(): Array<{ file: string; value: string }> {
  const constants = DECLARED_CONSTANTS

  // Pass two: read each emission's expression with a scanner rather than a pattern, and decompose
  // it. Two forms are deliberately not emissions: a TYPE position (`scope_used: string` in an
  // interface) and a read-back (`row.scope_used`, serving stored rows outward).
  const out: Array<{ file: string; value: string }> = []
  for (const { root, path, text } of SOURCES) {
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
 * Every emission by a HEADLESS actor, paired with the scope it stamps.
 *
 * Resolvability is not the whole control, and believing it was is what let a real defect through.
 * The check above asks whether a value resolves against the declared inventory — so an invented
 * token like `billing:rate` fails, but a scheduled job BORROWING a real human scope passes
 * perfectly. `analytics/ingestion.ts` did exactly that: `system:nebras-ingestion` stamped
 * `reconciliation:read`, a scope held by a Finance persona that no principal held on that run.
 *
 * Borrowing is the harder half of the defect. An invented token at least looks wrong to an auditor;
 * a borrowed one reads as though a human authorised the job.
 *
 * The window is the enclosing emit block, found by scanning back to the `event_type:` that starts it
 * — every emitter in both trees writes that property first. State the reach plainly: this sees
 * literal `acting_principal` / `acting_persona` values, not ones passed through a variable, so it is
 * a floor rather than a proof. It catches the shape that has actually occurred twice.
 */
function headlessEmissions(): Array<{ file: string; scope: string; principal: string }> {
  const constants = DECLARED_CONSTANTS
  const out: Array<{ file: string; scope: string; principal: string }> = []

  for (const { root, path, text } of SOURCES) {
    for (const m of text.matchAll(/\bscope_used:\s*/g)) {
      const blockStart = text.lastIndexOf('event_type:', m.index)
      if (blockStart < 0) continue
      const block = text.slice(blockStart, m.index)
      // `acting_principal`, NOT `acting_persona` — the discriminator CODE-03 ratified. Keying on
      // the persona produces a false positive on tpp-billing/invoicing.ts:89, which records persona
      // `system` for a four-eyes execution running on a HUMAN initiator's behalf: acting_principal
      // is that person, and the scope is the one they actually held, so it correctly keeps both.
      // A check that flagged it would push a correct emitter towards a false sentinel.
      //
      // Resolved through the SAME constant table as the scope, because the first version of this
      // matched a quoted literal only — and `analytics/ingestion.ts` writes
      // `acting_principal: RUN_PRINCIPAL`. So the check missed the exact site that motivated it,
      // which is the failure mode this whole file exists to stop.
      const principalExpression = scopeExpression(block, block.lastIndexOf('acting_principal:') >= 0
        ? block.lastIndexOf('acting_principal:') + 'acting_principal:'.length
        : block.length)
      const principal = possibleValues(principalExpression, constants)
        .find((value) => value.startsWith('system:'))
      if (!principal) continue

      const expression = scopeExpression(text, m.index + m[0].length)
      for (const scope of possibleValues(expression, constants)) {
        out.push({ file: path.slice(root.length + 1), scope, principal })
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
  for (const { root, path, text } of SOURCES) {
    if (/INSERT\s+INTO\s+audit_high_sensitivity/i.test(text)) found.add(path.slice(root.length + 1))
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

  it('never lets a HEADLESS actor borrow a human persona scope', () => {
    // The half the resolvability check cannot see. A scheduled job holds no scope, so the only
    // honest value is a declared sentinel — a real scope stamped by `system:*` records that a
    // Finance (or Risk, or Care) persona authorised a run no person touched, permanently, in a
    // table with no correction path.
    const sentinels = new Set<string>([SYSTEM_ACTOR_SCOPE, UNSCOPED_AUTH_EVENT_SCOPE, SEED_ACTOR_SCOPE])
    const borrowed = headlessEmissions().filter((entry) => !sentinels.has(entry.scope))
    const detail = borrowed.map((e) => `${e.file}: ${e.principal} stamps ${e.scope}`).sort().join('\n')

    expect(borrowed, `headless actors borrowing a declared human scope:\n${detail}`).toEqual([])
  })

  it('finds the headless emissions at all, so that check cannot pass by scanning nothing', () => {
    expect(headlessEmissions().length).toBeGreaterThan(10)
  })

  it('leaves no raw-SQL writer into audit_high_sensitivity outside the known set', () => {
    // The scan above reads TypeScript object literals. A raw INSERT writes the same regulated column
    // and is invisible to it — which is how the seed writers' token stayed outside the inventory.
    expect(rawSqlAuditWriters()).toEqual([...RAW_SQL_AUDIT_WRITERS].sort())
  })

  it('reads a type position the same way however the source is punctuated', () => {
    // Not decoration. Stryker re-prints the files it instruments, so `scope_used: string` becomes
    // `scope_used: string;` — and the first version of this scan, which stopped only at `,` and a
    // newline, then read the value as `string;`, matched no type pattern, and reported the interface
    // declaration in high-class-audit.ts as an unresolvable EMISSION. A guard whose verdict depends
    // on trailing punctuation is a guard that disagrees with itself between two runs of one commit.
    const constants = new Map<string, string>([['BILLING_WRITE_SCOPE', 'billing:write']])
    for (const [label, source] of [
      ['bare', 'scope_used: string'],
      ['semicolon', 'scope_used: string;'],
      ['union', 'scope_used: string | null;'],
      ['comma', 'scope_used: string,']
    ] as const) {
      expect(scopeExpression(source, source.indexOf(':') + 2), label)
        .toMatch(/^string(\s*\|\s*null)?$/)
    }
    // And a real emission is unaffected by the same terminator.
    expect(possibleValues(scopeExpression('scope_used: BILLING_WRITE_SCOPE,', 12), constants))
      .toEqual(['billing:write'])
  })

  it('declares every sentinel it allows in the CONTRACT, not just in code', () => {
    // The half that was missing, and it was the CODE-03 defect reproduced inside the CODE-03 fix.
    // The allow-list above admits three non-scope literals; the spec's own `scope_used` description
    // named only `system`. So the check was deliberately WIDER than the contract it polices, and two
    // of the three values remained exactly what the ticket set out to eliminate — a value an auditor
    // cannot resolve against the contract, written permanently into an INSERT-only table.
    //
    // Reading the spec text rather than a copy of it is the point: the constants are declared once in
    // packages/db/src/audit.ts, the allow-list is built from them, and this asserts the contract
    // describes the same set. Add a fourth constant without amending the spec and this fails.
    const spec = readFileSync(join(import.meta.dirname, '../../../specs/backoffice-openapi.yaml'), 'utf8')
    const start = spec.indexOf('        scope_used:')
    const end = spec.indexOf('        target_psu_identifier:', start)
    expect(start, 'AuditEvent.scope_used not found in the spec').toBeGreaterThan(-1)
    expect(end, 'could not bound the scope_used description').toBeGreaterThan(start)
    const description = spec.slice(start, end)

    for (const sentinel of [SYSTEM_ACTOR_SCOPE, UNSCOPED_AUTH_EVENT_SCOPE, SEED_ACTOR_SCOPE]) {
      expect(description, `\`${sentinel}\` is written to scope_used but the contract does not declare it`)
        .toContain(`\`${sentinel}\``)
    }
  })

  it('declares the system sentinel and the non-HTTP response sentinel', () => {
    // Named constants rather than bare strings at fourteen call sites, so the convention is one
    // decision rather than fourteen chances to diverge again.
    expect(SYSTEM_ACTOR_SCOPE).toBe('system')
    expect(SYSTEM_ACTOR_RESPONSE_STATUS).toBe(0)
  })
})

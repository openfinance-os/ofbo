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

const SRC = join(import.meta.dirname, '../src')

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

/** Resolve a `scope_used:` value to a literal wherever the source makes that possible. */
function emittedScopeLiterals(): Array<{ file: string; value: string }> {
  const out: Array<{ file: string; value: string }> = []
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8')
    // Same-file constant declarations, so `scope_used: FOO_SCOPE` resolves to its literal.
    const constants = new Map<string, string>()
    for (const m of text.matchAll(/(?:export\s+)?const\s+([A-Z0-9_]+)\s*(?::\s*string)?\s*=\s*'([^']+)'/g)) {
      constants.set(m[1]!, m[2]!)
    }
    for (const m of text.matchAll(/scope_used:\s*(?:'([^']+)'|([A-Z0-9_]+))/g)) {
      const literal = m[1] ?? (m[2] ? constants.get(m[2]) : undefined)
      if (literal) out.push({ file: file.slice(SRC.length + 1), value: literal })
    }
  }
  return out
}

describe('CODE-03 audit scope resolvability', () => {
  it('finds the emission sites at all, so the check cannot pass by scanning nothing', () => {
    expect(emittedScopeLiterals().length).toBeGreaterThan(20)
  })

  it('every emitted scope_used resolves against the declared inventory or the system sentinel', () => {
    const declared = declaredScopes()
    expect(declared.size).toBeGreaterThan(15)
    const allowed = new Set([...declared, SYSTEM_ACTOR_SCOPE])

    const unresolvable = emittedScopeLiterals().filter((entry) => !allowed.has(entry.value))
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

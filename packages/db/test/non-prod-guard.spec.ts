import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { assertNonProdBulkMutation } from '../src/reset.js'

/**
 * The closed set of modules that branch on the deployment profile.
 *
 * CLAUDE.md's rule is that application code never branches on profile, enforced by an ESLint rule
 * that matches READS of `DEPLOY_PROFILE` — and `packages/db/src/reset.ts` is the one non-ports file
 * exempted, so the guard lives there. Once it is exported, a caller becomes profile-conditional
 * WITHOUT reading the variable, which makes it invisible to that rule. The exemption's real scope
 * was then recorded only in a comment, and a comment stops nobody.
 *
 * So the caller set is closed here instead, the same way `RAW_SQL_AUDIT_WRITERS` closes the set of
 * raw audit writers: adding a module has to be a decision someone makes in this file, not a drift
 * that lands unexamined. That pattern is already this repository's answer to "a control the lint
 * gate cannot see".
 *
 * Every entry is a non-prod DATA TOOL — it destroys or bulk-mutates demo rows, and refusing under
 * the enterprise/production profile is the whole point. A request-path module appearing here would
 * be the actual rule-7 violation.
 */
const PROFILE_GUARDED_MODULES: readonly string[] = ['reset.ts', 'seed-demo.ts', 'seed-tenants.ts', 'seed.ts']

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/**
 * Every module that CALLS the guard, anywhere in the workspace.
 *
 * The first cut scanned one flat directory non-recursively and matched
 * `/assertNonProdBulkMutation\s*\(/` — which also matches the function's own DECLARATION, so
 * `reset.ts` satisfied membership even if it stopped calling the guard, and no caller outside
 * `packages/db/src` was visible at all. The ESLint comment nominates this test as the enforcement
 * the lint rule "structurally cannot provide"; that claim only holds if the scan covers where a
 * caller could actually appear.
 */
function callers(): string[] {
  const found = new Set<string>()
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!entry.name.endsWith('.ts') || entry.name.endsWith('.spec.ts')) continue
      const text = readFileSync(full, 'utf8')
      // A CALL, not the declaration — `export function assertNonProdBulkMutation(` must not count
      // its own definition as a caller.
      if (/(?<!function\s)assertNonProdBulkMutation\s*\(/.test(text.replace(/export function assertNonProdBulkMutation\s*\(/g, ''))) {
        found.add(entry.name)
      }
    }
  }
  walk(join(REPO, 'packages'))
  walk(join(REPO, 'services'))
  walk(join(REPO, 'apps'))
  return [...found].sort()
}

describe('the non-prod guard', () => {
  it('is called from a closed, declared set of modules', () => {
    expect(callers()).toEqual([...PROFILE_GUARDED_MODULES].sort())
  })

  it('finds callers at all, so the check cannot pass by scanning nothing', () => {
    expect(callers().length).toBeGreaterThan(1)
  })

  it('refuses under the enterprise profile and under NODE_ENV=production', () => {
    const prior = { profile: process.env.DEPLOY_PROFILE, node: process.env.NODE_ENV }
    try {
      process.env.DEPLOY_PROFILE = 'enterprise'
      expect(() => assertNonProdBulkMutation('probe')).toThrow(/non-prod only/)
      delete process.env.DEPLOY_PROFILE
      process.env.NODE_ENV = 'production'
      expect(() => assertNonProdBulkMutation('probe')).toThrow(/non-prod only/)
    } finally {
      if (prior.profile === undefined) delete process.env.DEPLOY_PROFILE
      else process.env.DEPLOY_PROFILE = prior.profile
      if (prior.node === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = prior.node
    }
  })

  /**
   * It FAILS CLOSED on a value it does not recognise.
   *
   * The first version was a denylist — `=== 'enterprise' || NODE_ENV === 'production'` — so
   * `DEPLOY_PROFILE=production`, `Enterprise`, or any typo passed straight through to a bulk
   * lifecycle UPDATE over retained records. Unset still means `demo`, matching `profileFromConfig`
   * in packages/ports, so local dev and CI are unaffected; an unrecognised value is a configuration
   * error, not a silent permit.
   */
  it('refuses a profile it does not recognise, and still permits unset', () => {
    const prior = process.env.DEPLOY_PROFILE
    try {
      for (const bad of ['production', 'Enterprise', 'prod', '']) {
        process.env.DEPLOY_PROFILE = bad
        expect(() => assertNonProdBulkMutation('probe'), `'${bad}' must not pass`).toThrow()
      }
      delete process.env.DEPLOY_PROFILE
      expect(() => assertNonProdBulkMutation('probe')).not.toThrow() // unset === demo
      process.env.DEPLOY_PROFILE = 'demo'
      expect(() => assertNonProdBulkMutation('probe')).not.toThrow()
    } finally {
      if (prior === undefined) delete process.env.DEPLOY_PROFILE
      else process.env.DEPLOY_PROFILE = prior
    }
  })

  it('names the operation it refused, so the message says what was blocked', () => {
    const prior = process.env.DEPLOY_PROFILE
    process.env.DEPLOY_PROFILE = 'enterprise'
    try {
      expect(() => assertNonProdBulkMutation('db:seed:demo')).toThrow(/db:seed:demo/)
    } finally {
      if (prior === undefined) delete process.env.DEPLOY_PROFILE
      else process.env.DEPLOY_PROFILE = prior
    }
  })
})

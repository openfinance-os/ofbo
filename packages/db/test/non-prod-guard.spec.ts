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
const PROFILE_GUARDED_MODULES: readonly string[] = ['reset.ts', 'seed-demo.ts', 'seed.ts']

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')

function callers(): string[] {
  const found = new Set<string>()
  for (const entry of readdirSync(SRC, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue
    if (/assertNonProdBulkMutation\s*\(/.test(readFileSync(join(SRC, entry.name), 'utf8'))) found.add(entry.name)
  }
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

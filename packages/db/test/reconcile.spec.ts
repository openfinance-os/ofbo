import { afterEach, describe, expect, it } from 'vitest'
import { reconcileSeededSet } from '../src/reconcile.js'
import { assertDestructiveAllowed } from '../src/reset.js'

/**
 * DEMO — the guards on the one operation in the seed path that DELETES.
 *
 * `reconcileSeededSet` is what lets a seed state a complete set rather than merely a present one.
 * It is also the only DELETE anywhere in the seeds, so its refusals matter more than its successes:
 * a bug here removes real rows rather than failing to remove stale ones. These pin the three cases
 * where it must refuse to run at all, and none of them needs a database — which is the point of
 * checking them before any query is built.
 */

const original = { profile: process.env.DEPLOY_PROFILE, node: process.env.NODE_ENV }
afterEach(() => {
  process.env.DEPLOY_PROFILE = original.profile
  process.env.NODE_ENV = original.node
  if (original.profile === undefined) delete process.env.DEPLOY_PROFILE
  if (original.node === undefined) delete process.env.NODE_ENV
})

/** A pool that fails loudly if anything reaches it — every case here must refuse before querying. */
const noQuery = {
  query: () => {
    throw new Error('reconcileSeededSet reached the database when it should have refused first')
  }
} as never

const spec = { table: 'tpp_counterparty', keyColumn: 'organisation_id', bankId: 'bank-1', keep: ['org-a'] }

describe('assertDestructiveAllowed — the single guard', () => {
  it('refuses under the enterprise profile', () => {
    process.env.DEPLOY_PROFILE = 'enterprise'
    expect(() => assertDestructiveAllowed('db:reset')).toThrow(/non-prod only/)
  })

  it('refuses under NODE_ENV=production', () => {
    process.env.NODE_ENV = 'production'
    expect(() => assertDestructiveAllowed('db:reset')).toThrow(/regulated data has no deletion path/)
  })

  it('names the operation, so the refusal says what was refused', () => {
    process.env.DEPLOY_PROFILE = 'enterprise'
    expect(() => assertDestructiveAllowed('seed set reconciliation on tpp_counterparty')).toThrow(
      /seed set reconciliation on tpp_counterparty/
    )
  })
})

describe('reconcileSeededSet — refuses before it deletes', () => {
  it('inherits the non-prod guard rather than carrying its own copy', async () => {
    process.env.DEPLOY_PROFILE = 'enterprise'
    await expect(reconcileSeededSet(noQuery, spec)).rejects.toThrow(/non-prod only/)
  })

  /**
   * An empty keep-set is never a seed stating its set — it is a caller that computed the set
   * wrongly, and obeying it would delete every row for the tenant. The blast radius is why this
   * refuses instead of doing exactly what it was told.
   */
  it('refuses an EMPTY keep-set rather than emptying the table', async () => {
    await expect(reconcileSeededSet(noQuery, { ...spec, keep: [] })).rejects.toThrow(/EMPTY keep-set/)
  })

  /**
   * `table` and `keyColumn` are interpolated, because SQL identifiers cannot be bound as
   * parameters. Today's callers pass literals — but "it is only ever called with constants" is a
   * property of the callers, not of this function, and the caller list changes.
   */
  it.each([
    ['table', { ...spec, table: 'tpp_counterparty; DROP TABLE audit_high_sensitivity' }],
    ['table', { ...spec, table: 'TppCounterparty' }],
    ['keyColumn', { ...spec, keyColumn: 'organisation_id" --' }]
  ])('refuses a %s that is not a plain identifier', async (_label, bad) => {
    await expect(reconcileSeededSet(noQuery, bad)).rejects.toThrow(/not a plain identifier/)
  })
})

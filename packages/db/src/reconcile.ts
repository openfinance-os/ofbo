import type pg from 'pg'
import { assertDestructiveAllowed } from './reset.js'

/**
 * Make a seeded set COMPLETE, not merely present — remove demo rows the seed no longer declares.
 *
 * WHY THIS EXISTS. Both seeds are additive-only: every insert is `ON CONFLICT DO NOTHING` or
 * `WHERE NOT EXISTS`, and neither contains a DELETE. That is right for the half of the contract
 * everyone remembers — running a seed twice must not duplicate a book of business — and it quietly
 * fails the other half. A seed that can only ADD cannot express "this is the set". Rows written by
 * a seed that was later retired stay for ever, and re-running the current seed can never remove
 * them, because from its point of view there is nothing to do.
 *
 * That is not hypothetical. The hosted demo carried three `Fictional fintech 0N` counterparties
 * that exist NOWHERE in this repository — orphans of a seed replaced months earlier — sitting at
 * the top of the TPP registry (the screen sorts by directory sync time) above Lean, Tabby and
 * Tarabut, and counting toward the registration-state mix in the KPI strip. Three placeholder
 * names led the registry on the demo URL, and every deploy re-seeded and left them exactly where
 * they were.
 *
 * `pnpm demo:refresh` (truncate, re-apply, re-seed) removes them, but it is an operator remembering
 * to run a destructive command, and the deploy workflow runs `db:apply && db:seed:demo` — additive.
 * So the orphans survived every merge. This closes it at the source: the seed states the set, and
 * the set is what the database holds afterwards.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It is not a general "make the database match the seed" sweep.
 * It reconciles ONE table's key set for ONE bank, because that is a claim the seed can actually
 * make. Point it at a table the seed does not own completely and it will delete real rows — which
 * is why `keep` comes from the same literal the seed inserts from, never from a second list
 * maintained alongside it.
 *
 * A CONSEQUENCE WORTH KNOWING. For a reconciled table, the seed is the authority. A counterparty
 * created through the demo UI (a directory sync, say) is not in `keep`, so the next deploy removes
 * it. That is the intended behaviour for a deterministic demo dataset — the registry should match
 * the book — but it is a real change in what re-seeding means, so it is stated rather than
 * discovered.
 *
 * NON-PROD ONLY, through the same guard `db:reset` uses. Deleting rows is legitimate only because
 * the demo environment is permanently non-prod with zero real PSU data; regulated production data
 * has no deletion path (CLAUDE.md hard stop).
 */
export interface ReconcileSpec {
  /** Table to reconcile. A trusted identifier from calling code — never user input. */
  table: string
  /** The natural key the seed declares its set by (e.g. `organisation_id`). */
  keyColumn: string
  /** Tenant scope. Reconciliation never reaches beyond the bank whose set is being stated. */
  bankId: string
  /** Every key the seed declares. Anything else under `bankId` is an orphan and is removed. */
  keep: readonly string[]
}

/**
 * Delete rows for `bankId` whose `keyColumn` is not in `keep`. Returns the keys removed, so a
 * caller can report what it took out — a silent DELETE in a seed is exactly the kind of thing that
 * should never be inferred from a row count changing.
 */
export async function reconcileSeededSet(pool: pg.Pool, spec: ReconcileSpec): Promise<string[]> {
  assertDestructiveAllowed(`seed set reconciliation on ${spec.table}`)

  // An empty `keep` would delete the whole table for this bank. That is never a seed stating its
  // set — it is a caller that computed the set wrongly, and the blast radius is the entire tenant.
  // Refuse rather than obey.
  if (spec.keep.length === 0) {
    throw new Error(
      `refusing to reconcile ${spec.table} against an EMPTY keep-set — that would delete every row `
      + `for bank ${spec.bankId}. A seed with nothing to declare should not be reconciling at all.`
    )
  }

  // `table` and `keyColumn` are interpolated because identifiers cannot be bound as parameters.
  // Both come from a literal `ReconcileSpec` in seed code, never from a request — but "it is only
  // ever called with constants" is a property of today's callers, not of this function, so the
  // shape is checked here where the interpolation happens.
  for (const [label, identifier] of [['table', spec.table], ['keyColumn', spec.keyColumn]] as const) {
    if (!/^[a-z_][a-z0-9_]*$/.test(identifier)) {
      throw new Error(`reconcileSeededSet: ${label} '${identifier}' is not a plain identifier`)
    }
  }

  const { rows } = await pool.query<{ key: string }>(
    `DELETE FROM "${spec.table}"
      WHERE bank_id = $1 AND "${spec.keyColumn}" <> ALL($2::text[])
      RETURNING "${spec.keyColumn}" AS key`,
    [spec.bankId, [...spec.keep]]
  )
  return rows.map((r) => r.key).sort()
}

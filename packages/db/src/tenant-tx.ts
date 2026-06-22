const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * One-round-trip RLS transaction preamble. Opens the transaction, assumes the unprivileged
 * `ofbo_app` role, and pins `app.bank_id` for the row-level-security policies — all in a single
 * simple-query call instead of three sequential round-trips (`BEGIN`, `SET LOCAL ROLE`,
 * `set_config`). Over a remote DB (the deployed Worker → Supabase) that removed two edge→origin
 * round-trips per store operation; locally it's a no-op win.
 *
 * `bankId` is trusted server config (the tenancy bank id, never user input), but because it is
 * string-interpolated into a multi-statement simple query (the extended/parameterised protocol
 * can't batch statements) we HARD-VALIDATE it is a UUID first — defence in depth against any
 * future caller passing something unexpected.
 */
export function beginAppTx(bankId: string): string {
  if (!UUID_RE.test(bankId)) throw new Error(`invalid bank_id (must be a UUID v4): ${bankId}`)
  return `BEGIN; SET LOCAL ROLE ofbo_app; SELECT set_config('app.bank_id', '${bankId}', true)`
}

/**
 * BACKOFFICE-33 (ADR 0015) — cross-fintech aggregation preamble. Assumes the SELECT-only
 * `bank_internal_view` role and DELIBERATELY does NOT pin `app.bank_id`: the `internal_view_select`
 * policies (`USING (true)`) let this role read the aggregate MVs ACROSS every tenant. This is the
 * platform's single highest-sensitivity data path — the one place per-tenant RLS is bypassed — so
 * it is ONLY ever reached through `runGovernedAggregate`, which first verifies a registered+approved
 * `query_purpose_registry` purpose and High-class logs the bypass. Never call this directly.
 */
export function beginInternalViewTx(): string {
  return `BEGIN; SET LOCAL ROLE bank_internal_view`
}

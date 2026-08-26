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
 * `bank_internal_view` role, the one place per-tenant RLS is bypassed. It is ONLY ever reached
 * through `runGovernedAggregate`, which first verifies a registered+approved
 * `query_purpose_registry` purpose and High-class logs the bypass. Never call this directly.
 *
 * HOST-02 (ADR 0028) — `tenantGroupId` scopes the bypass to ONE customer's tenant group. When
 * provided it pins `app.tenant_group`, and the re-scoped `internal_view_select` policies
 * (migration 0030) read only the bank_ids in that group — so a hosted deployment can never read
 * across CUSTOMER boundaries. When omitted (single-tenant default / legacy callers) no group is
 * pinned and the policy's fallback reads as before (the demo bank is the only bank).
 */
export function beginInternalViewTx(tenantGroupId?: string): string {
  if (tenantGroupId !== undefined) {
    if (!UUID_RE.test(tenantGroupId)) throw new Error(`invalid tenant_group_id (must be a UUID v4): ${tenantGroupId}`)
    return `BEGIN; SET LOCAL ROLE bank_internal_view; SELECT set_config('app.tenant_group', '${tenantGroupId}', true)`
  }
  return `BEGIN; SET LOCAL ROLE bank_internal_view`
}

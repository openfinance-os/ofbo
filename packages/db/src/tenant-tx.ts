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

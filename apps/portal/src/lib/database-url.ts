import { getCloudflareContext } from '@opennextjs/cloudflare'

/**
 * The connection string for the portal's direct store I/O (the sign-in audit write, the dashboard's
 * audit panel).
 *
 * Deployed, the portal runs at the edge and the database sits in one region; over DATABASE_URL
 * every render paid a fresh TCP + TLS handshake to it. The BFF already solved this with the
 * Hyperdrive binding (services/bff/wrangler.toml) — the portal now binds the same config and uses
 * it when present. Outside a Worker request (local dev, tests) `getCloudflareContext()` throws,
 * and DATABASE_URL is the connection, as before.
 *
 * Hyperdrive changes the transport, not the lifetime rule: clients are still constructed per unit
 * of work and closed in `finally` (see withAuditSink in ./portal.ts) — a socket must never outlive
 * the request that opened it on this runtime.
 */
export function databaseUrl(): string | undefined {
  try {
    const env = getCloudflareContext().env as unknown as { HYPERDRIVE?: { connectionString?: string } }
    const pooled = env?.HYPERDRIVE?.connectionString
    if (pooled) return pooled
  } catch {
    // not in a Cloudflare request context — use DATABASE_URL
  }
  return process.env.DATABASE_URL || undefined
}

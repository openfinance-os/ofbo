import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import pg from 'pg'

/**
 * Dev/test convenience: truncate the demo dataset so a full integration run starts clean
 * (rows otherwise accumulate across runs and can trip count-based assertions). It TRUNCATEs
 * every base table in `public` EXCEPT the migration ledger and the migration-seeded policy
 * config, then refreshes materialized views. Schema, roles, and RLS policies are untouched —
 * this only clears data. Re-seed with `pnpm db:seed` afterwards.
 *
 * NON-PROD ONLY. The OFBO demo environment is permanently non-prod (zero real PSU data,
 * CLAUDE.md hard stop); regulated production data has no deletion path and must never be
 * truncated. The guard below refuses to run under the enterprise profile.
 */

// Preserved: the migration ledger (so migrations don't re-run) + migration-seeded config.
const PRESERVE = new Set(['_migrations', 'retention_policy', 'classification_policy'])

export async function resetDatabase(databaseUrl: string): Promise<{ truncated: string[]; refreshed: string[] }> {
  if (process.env.DEPLOY_PROFILE === 'enterprise' || process.env.NODE_ENV === 'production') {
    throw new Error('db:reset is non-prod only and refuses to run under the enterprise/production profile (regulated data has no deletion path).')
  }
  const pool = new pg.Pool({ connectionString: databaseUrl })
  try {
    const tables = (
      await pool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
      )
    ).rows
      .map((r) => r.table_name)
      .filter((t) => !PRESERVE.has(t))
      .sort()

    if (tables.length) {
      // One statement, CASCADE for FKs, RESTART IDENTITY for serial PKs.
      await pool.query(`TRUNCATE TABLE ${tables.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`)
    }

    const matviews = (
      await pool.query<{ matviewname: string }>(`SELECT matviewname FROM pg_matviews WHERE schemaname = 'public'`)
    ).rows.map((r) => r.matviewname)
    const refreshed: string[] = []
    for (const mv of matviews) {
      try {
        await pool.query(`REFRESH MATERIALIZED VIEW "${mv}"`)
        refreshed.push(mv)
      } catch {
        /* a matview over now-empty tables may decline a concurrent refresh — non-fatal */
      }
    }
    return { truncated: tables, refreshed }
  } finally {
    await pool.end()
  }
}

const isCli =
  typeof import.meta.url === 'string' &&
  typeof process !== 'undefined' &&
  process.argv?.[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isCli) {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('DATABASE_URL is required')
    process.exit(1)
  }
  // Surface the target so an operator can see which database is about to be cleared.
  const host = (() => {
    try {
      return new URL(url).host
    } catch {
      return '(unparseable host)'
    }
  })()
  console.log(`db:reset → truncating demo data on ${host} …`)
  const { truncated, refreshed } = await resetDatabase(url)
  console.log(`truncated ${truncated.length} tables; refreshed ${refreshed.length} matviews (preserved: ${[...PRESERVE].join(', ')})`)
}

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import pg from 'pg'

// Resolved lazily: this module rides into non-node bundles (the BFF worker
// re-exports @ofbo/db) where import.meta.url does not exist at module scope.
const migrationsDir = () => resolve(dirname(fileURLToPath(import.meta.url)), '../migrations')

/** Ordered, transactional, idempotent migration runner. */
export async function applyMigrations(databaseUrl: string): Promise<string[]> {
  const pool = new pg.Pool({ connectionString: databaseUrl })
  const applied: string[] = []
  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`
    )
    const dir = migrationsDir()
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
    for (const file of files) {
      const done = await pool.query(`SELECT 1 FROM _migrations WHERE name = $1`, [file])
      if (done.rowCount) continue
      const sql = readFileSync(resolve(dir, file), 'utf8')
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query(sql)
        await client.query(`INSERT INTO _migrations (name) VALUES ($1)`, [file])
        await client.query('COMMIT')
        applied.push(file)
      } catch (e) {
        await client.query('ROLLBACK')
        throw new Error(`migration ${file} failed: ${(e as Error).message}`)
      } finally {
        client.release()
      }
    }
    return applied
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
  const applied = await applyMigrations(url)
  console.log(applied.length ? `applied: ${applied.join(', ')}` : 'up to date')
}

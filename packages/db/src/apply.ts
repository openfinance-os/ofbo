import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import pg from 'pg'

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../migrations')

/** Ordered, transactional, idempotent migration runner. */
export async function applyMigrations(databaseUrl: string): Promise<string[]> {
  const pool = new pg.Pool({ connectionString: databaseUrl })
  const applied: string[] = []
  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`
    )
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
    for (const file of files) {
      const done = await pool.query(`SELECT 1 FROM _migrations WHERE name = $1`, [file])
      if (done.rowCount) continue
      const sql = readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8')
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

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isCli) {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('DATABASE_URL is required')
    process.exit(1)
  }
  const applied = await applyMigrations(url)
  console.log(applied.length ? `applied: ${applied.join(', ')}` : 'up to date')
}

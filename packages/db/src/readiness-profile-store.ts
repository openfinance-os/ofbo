import pg from 'pg'
import { beginAppTx } from './tenant-tx.js'

/**
 * ADR 0022 — readiness_profile persistence for the public Integration Readiness Wizard.
 * NON-REGULATED, NO PII: bank system-metadata self-assessments only. No lineage (not a regulated
 * figure), no audit_high_sensitivity. Profiles are immutable once saved (reopen-by-slug). Runs as
 * ofbo_app; the table's RLS policy is PUBLIC (USING (true)) so the tenancy GUC is irrelevant here,
 * but we reuse beginAppTx to assume the unprivileged role. Structurally satisfies the BFF
 * ReadinessProfileStore interface — a drop-in for InMemoryReadinessProfileStore in the worker.
 */

export interface StoredReadinessProfile {
  slug: string
  name: string
  created_at: string
  input: { ports: Record<string, string>; decisions?: Record<string, string> }
}

interface Row {
  slug: string
  name: string
  created_at: Date
  input: StoredReadinessProfile['input']
}

export class PgReadinessProfileStore {
  private readonly pool: pg.Pool
  constructor(
    databaseUrl: string,
    private readonly config: { bankId: string; channel: string }
  ) {
    this.pool = new pg.Pool({ connectionString: databaseUrl })
  }

  private async asApp<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect()
    try {
      await c.query(beginAppTx(this.config.bankId))
      const out = await fn(c)
      await c.query('COMMIT')
      return out
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined)
      throw e
    } finally {
      c.release()
    }
  }

  async create(name: string, input: StoredReadinessProfile['input']): Promise<StoredReadinessProfile> {
    const slug = `rdy-${crypto.randomUUID()}`
    const row = await this.asApp(async (c) => {
      const res = await c.query<Row>(
        `INSERT INTO readiness_profile (slug, name, input)
         VALUES ($1, $2, $3::jsonb)
         RETURNING slug, name, created_at, input`,
        [slug, name, JSON.stringify(input)]
      )
      return res.rows[0]!
    })
    return { slug: row.slug, name: row.name, created_at: row.created_at.toISOString(), input: row.input }
  }

  async get(slug: string): Promise<StoredReadinessProfile | null> {
    const rows = await this.asApp(async (c) => {
      const res = await c.query<Row>(
        `SELECT slug, name, created_at, input FROM readiness_profile WHERE slug = $1`,
        [slug]
      )
      return res.rows
    })
    const row = rows[0]
    return row ? { slug: row.slug, name: row.name, created_at: row.created_at.toISOString(), input: row.input } : null
  }
}

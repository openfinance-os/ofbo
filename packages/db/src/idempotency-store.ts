import pg from 'pg'

/**
 * M1-DEMO-DEPLOY: durable Idempotency-Key replay store (binding convention:
 * 24h dedup window on every mutating endpoint) over the idempotency_key table.
 * Structural match for the BFF's IdempotencyStore. First write wins (the
 * original response replays verbatim); expired entries are pruned on write —
 * the table is an operational cache, the one deletion path in the schema.
 */

const WINDOW_MS = 24 * 60 * 60 * 1000

export interface CachedIdempotentResponse {
  status: number
  body: unknown
}

export class PgIdempotencyStore {
  private readonly pool: pg.Pool

  constructor(
    databaseUrl: string,
    private readonly config: { bankId: string; channel: string },
    private readonly now: () => number = () => Date.now()
  ) {
    this.pool = new pg.Pool({ connectionString: databaseUrl })
  }

  /** Runs fn as ofbo_app with the tenancy context set — RLS binds every statement. */
  private async asApp<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect()
    try {
      await c.query('BEGIN')
      await c.query('SET LOCAL ROLE ofbo_app')
      await c.query(`SELECT set_config('app.bank_id', $1, true)`, [this.config.bankId])
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

  async get(key: string): Promise<CachedIdempotentResponse | null> {
    const cutoff = new Date(this.now() - WINDOW_MS).toISOString()
    const rows = await this.asApp(async (c) => {
      const res = await c.query<{ response_status: number; response_body: unknown }>(
        `SELECT response_status, response_body FROM idempotency_key
          WHERE cache_key = $1 AND created_at >= $2`,
        [key, cutoff]
      )
      return res.rows
    })
    return rows[0] ? { status: rows[0].response_status, body: rows[0].response_body } : null
  }

  async set(key: string, status: number, body: unknown): Promise<void> {
    const cutoff = new Date(this.now() - WINDOW_MS).toISOString()
    await this.asApp(async (c) => {
      // prune expired entries opportunistically — keeps the window honest without a scheduler
      await c.query(`DELETE FROM idempotency_key WHERE created_at < $1`, [cutoff])
      // first write wins: a concurrent duplicate replays the original outcome
      await c.query(
        `INSERT INTO idempotency_key (bank_id, channel, cache_key, response_status, response_body, created_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)
         ON CONFLICT (bank_id, cache_key) DO NOTHING`,
        [this.config.bankId, this.config.channel, key, status, JSON.stringify(body), new Date(this.now()).toISOString()]
      )
    })
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}

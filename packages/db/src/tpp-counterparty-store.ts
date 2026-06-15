import pg from 'pg'
import type { LineageSink } from './lineage.js'

/**
 * BACKOFFICE-71 — consuming-TPP registry. The bank-side master list of TPPs
 * consuming the bank's LFI APIs, synced from the Trust Framework Directory (via
 * the P6 egress gateway). Writes run as ofbo_app with the tenancy context set
 * (RLS binds); tpp_counterparty is a mutable workflow table. Column-level BCBS
 * 239 lineage at write time — this is the write path that closes the
 * tpp_counterparty lineage gap (Q4.5 / KNOWN_LINEAGE_GAPS).
 */

export interface Money {
  amount: number
  currency: string
}

export interface StoredTppCounterparty {
  organisation_id: string
  legal_name: string
  registration_number: string | null
  directory_contacts: unknown[]
  directory_synced_at: string | null
  production_status: string
  first_traffic_at: string | null
  registration_state: string
  financial_system_ref: string | null
  unbilled_traffic: boolean
  mtd_fee_accrual: Money | null
  channel: string
  created_at: string
}

export interface TppCounterpartyUpsertInput {
  organisation_id: string
  legal_name: string
  registration_number?: string | null
  directory_contacts?: unknown[]
}

export interface TppCounterpartyListQuery {
  cursor?: string
  limit?: number
  production_status?: string
  registration_state?: string
  unbilled_traffic?: boolean
}

export interface TppCounterpartyPage {
  rows: StoredTppCounterparty[]
  next_cursor: string | null
}

export interface DirectorySyncResult {
  synced: number
  added: string[]
  changed: string[]
  decommissioned: string[]
}

const SELECT_COLUMNS = `organisation_id, legal_name, registration_number, directory_contacts,
  directory_synced_at, production_status, first_traffic_at, registration_state, financial_system_ref,
  unbilled_traffic, mtd_fee_accrual_amount, mtd_fee_accrual_currency, channel, created_at`

const LINEAGE_COLUMNS = [
  'bank_id', 'channel', 'organisation_id', 'legal_name', 'registration_number',
  'directory_contacts', 'directory_synced_at', 'production_status', 'registration_state'
]

const MAX_LIMIT = 200
const DEFAULT_LIMIT = 50
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v))

function toRow(r: Record<string, unknown>): StoredTppCounterparty {
  return {
    organisation_id: r.organisation_id as string,
    legal_name: r.legal_name as string,
    registration_number: (r.registration_number as string) ?? null,
    directory_contacts: (r.directory_contacts as unknown[]) ?? [],
    directory_synced_at: r.directory_synced_at ? iso(r.directory_synced_at) : null,
    production_status: r.production_status as string,
    first_traffic_at: r.first_traffic_at ? iso(r.first_traffic_at) : null,
    registration_state: r.registration_state as string,
    financial_system_ref: (r.financial_system_ref as string) ?? null,
    unbilled_traffic: Boolean(r.unbilled_traffic),
    mtd_fee_accrual:
      r.mtd_fee_accrual_amount !== null && r.mtd_fee_accrual_amount !== undefined
        ? { amount: Number(r.mtd_fee_accrual_amount), currency: r.mtd_fee_accrual_currency as string }
        : null,
    channel: r.channel as string,
    created_at: iso(r.created_at)
  }
}

const encodeCursor = (createdAt: string, org: string) => Buffer.from(`${createdAt}|${org}`, 'utf8').toString('base64url')
function decodeCursor(cursor: string): { createdAt: string; org: string } | null {
  try {
    const [createdAt, org] = Buffer.from(cursor, 'base64url').toString('utf8').split('|')
    return createdAt && org ? { createdAt, org } : null
  } catch {
    return null
  }
}

export class PgTppCounterpartyStore {
  private readonly pool: pg.Pool
  constructor(
    databaseUrl: string,
    private readonly config: { bankId: string; channel: string },
    private readonly lineage?: LineageSink
  ) {
    this.pool = new pg.Pool({ connectionString: databaseUrl })
  }

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

  private async emitLineage(traceId: string): Promise<void> {
    try {
      await this.lineage?.emitLineage({ table: 'tpp_counterparty', columns: LINEAGE_COLUMNS, source: 'tpp-directory-sync', trace_id: traceId })
    } catch {
      /* catalogue unavailable — the regulated write stands; Q4.5 surfaces persistent gaps */
    }
  }

  /**
   * Sync the directory participant set into the registry: upsert each (new → added,
   * legal_name change → changed), and any registry org absent from the directory
   * → decommissioned. Returns the change classification for the Ops Console.
   */
  async syncDirectory(participants: { organisation_id: string; legal_name: string; registration_number?: string | null; directory_contacts?: unknown[] }[], traceId: string): Promise<DirectorySyncResult> {
    const result = await this.asApp(async (c) => {
      const added: string[] = []
      const changed: string[] = []
      for (const p of participants) {
        // Read the prior row to classify added vs changed (EXCLUDED is not available
        // in a RETURNING clause), then upsert.
        const prior = await c.query(`SELECT legal_name FROM tpp_counterparty WHERE bank_id = $1 AND organisation_id = $2`, [this.config.bankId, p.organisation_id])
        await c.query(
          `INSERT INTO tpp_counterparty (bank_id, channel, organisation_id, legal_name, registration_number, directory_contacts, directory_synced_at)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, now())
           ON CONFLICT (bank_id, organisation_id) DO UPDATE
             SET legal_name = EXCLUDED.legal_name,
                 registration_number = EXCLUDED.registration_number,
                 directory_contacts = EXCLUDED.directory_contacts,
                 directory_synced_at = now(),
                 -- a previously decommissioned org reappearing in the directory is reinstated
                 production_status = CASE WHEN tpp_counterparty.production_status = 'decommissioned' THEN 'directory_only' ELSE tpp_counterparty.production_status END`,
          [this.config.bankId, this.config.channel, p.organisation_id, p.legal_name, p.registration_number ?? null, JSON.stringify(p.directory_contacts ?? [])]
        )
        if (prior.rows.length === 0) added.push(p.organisation_id)
        else if (prior.rows[0].legal_name !== p.legal_name) changed.push(p.organisation_id)
      }
      // Decommission registry orgs no longer present in the directory.
      const present = participants.map((p) => p.organisation_id)
      const dec = await c.query(
        `UPDATE tpp_counterparty SET production_status = 'decommissioned'
          WHERE production_status <> 'decommissioned'
            AND NOT (organisation_id = ANY($1::text[]))
          RETURNING organisation_id`,
        [present]
      )
      return { synced: participants.length, added, changed, decommissioned: dec.rows.map((r) => r.organisation_id as string) }
    })
    await this.emitLineage(traceId)
    return result
  }

  async get(organisationId: string): Promise<StoredTppCounterparty | null> {
    const row = await this.asApp(async (c) => {
      const res = await c.query(`SELECT ${SELECT_COLUMNS} FROM tpp_counterparty WHERE organisation_id = $1`, [organisationId])
      return res.rows[0] ?? null
    })
    return row ? toRow(row) : null
  }

  async list(query: TppCounterpartyListQuery = {}): Promise<TppCounterpartyPage> {
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
    const after = query.cursor ? decodeCursor(query.cursor) : null
    const rows = await this.asApp(async (c) => {
      const params: unknown[] = []
      const where: string[] = []
      if (query.production_status) {
        params.push(query.production_status)
        where.push(`production_status = $${params.length}`)
      }
      if (query.registration_state) {
        params.push(query.registration_state)
        where.push(`registration_state = $${params.length}`)
      }
      if (query.unbilled_traffic !== undefined) {
        params.push(query.unbilled_traffic)
        where.push(`unbilled_traffic = $${params.length}`)
      }
      if (after) {
        params.push(after.createdAt, after.org)
        where.push(`(date_trunc('milliseconds', created_at), organisation_id) > ($${params.length - 1}::timestamptz, $${params.length})`)
      }
      const res = await c.query(
        `SELECT ${SELECT_COLUMNS} FROM tpp_counterparty
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY date_trunc('milliseconds', created_at), organisation_id
         LIMIT ${limit + 1}`,
        params
      )
      return res.rows
    })
    const hasMore = rows.length > limit
    const page = (hasMore ? rows.slice(0, limit) : rows).map(toRow)
    const last = page[page.length - 1]
    return { rows: page, next_cursor: hasMore && last ? encodeCursor(last.created_at, last.organisation_id) : null }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}

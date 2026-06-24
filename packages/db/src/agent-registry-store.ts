import pg from 'pg'
import { beginAppTx } from './tenant-tx.js'
import type { LineageSink } from './lineage.js'

/**
 * BACKOFFICE-60 — agent_registry persistence (ADR 0017). Writes run as ofbo_app with
 * the tenancy context set (RLS binds). agent_registry is a mutable workflow table
 * (active → revoked). Column-level BCBS 239 lineage at write time. No PSU PII — the row
 * is service-account metadata. Structurally satisfies the BFF AgentStore interface so it
 * is a drop-in for InMemoryAgentStore in the worker.
 */

export interface StoredAgent {
  agent_id: string
  client_id: string
  display_name: string
  persona: string
  derived_from: string
  scopes: string[]
  status: 'pending' | 'active' | 'revoked'
  allow_mutations: boolean
  spend_budget: number
  registered_by: string
  approved_by: string | null
  created_at: string
  revoked_at: string | null
  revoke_reason: string | null
}

export interface AgentListQuery {
  cursor?: string
  limit?: number
}
export interface AgentPage {
  rows: StoredAgent[]
  next_cursor: string | null
}

const SELECT_COLUMNS = `id, client_id, display_name, persona, derived_from, scopes, status,
  allow_mutations, spend_budget, registered_by, approved_by, created_at, revoked_at, revoke_reason`

const LINEAGE_COLUMNS = [
  'bank_id', 'channel', 'client_id', 'persona', 'derived_from', 'scopes', 'status',
  'allow_mutations', 'spend_budget'
]

const MAX_LIMIT = 200
const DEFAULT_LIMIT = 50

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v))
const isoOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : iso(v))

function toRecord(r: Record<string, unknown>): StoredAgent {
  return {
    agent_id: r.id as string,
    client_id: r.client_id as string,
    display_name: r.display_name as string,
    persona: r.persona as string,
    derived_from: r.derived_from as string,
    scopes: (r.scopes as string[]) ?? [],
    status: r.status as StoredAgent['status'],
    allow_mutations: Boolean(r.allow_mutations),
    spend_budget: Number(r.spend_budget),
    registered_by: r.registered_by as string,
    approved_by: (r.approved_by as string) ?? null,
    created_at: iso(r.created_at),
    revoked_at: isoOrNull(r.revoked_at),
    revoke_reason: (r.revoke_reason as string) ?? null
  }
}

const encodeCursor = (createdAt: string, id: string) =>
  Buffer.from(`${createdAt}|${id}`, 'utf8').toString('base64url')
function decodeCursor(cursor: string): { createdAt: string; id: string } | null {
  try {
    const [createdAt, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|')
    return createdAt && id ? { createdAt, id } : null
  } catch {
    return null
  }
}

export class PgAgentStore {
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

  private async emitLineage(traceId: string): Promise<void> {
    try {
      await this.lineage?.emitLineage({
        table: 'agent_registry',
        columns: LINEAGE_COLUMNS,
        source: 'bff-agent-registry-store',
        trace_id: traceId
      })
    } catch {
      /* catalogue unavailable — the regulated write stands; Q4.5 surfaces persistent gaps */
    }
  }

  /** Persist an approved agent. The id/client_id/created_at are set by the BFF operation. */
  async create(agent: StoredAgent, traceId: string): Promise<StoredAgent> {
    const row = await this.asApp(async (c) => {
      const res = await c.query(
        `INSERT INTO agent_registry
           (id, bank_id, channel, client_id, display_name, persona, derived_from, scopes,
            status, allow_mutations, spend_budget, registered_by, approved_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         RETURNING ${SELECT_COLUMNS}`,
        [
          agent.agent_id,
          this.config.bankId,
          this.config.channel,
          agent.client_id,
          agent.display_name,
          agent.persona,
          agent.derived_from,
          agent.scopes,
          agent.status,
          agent.allow_mutations,
          agent.spend_budget,
          agent.registered_by,
          agent.approved_by,
          agent.created_at
        ]
      )
      return res.rows[0]
    })
    await this.emitLineage(traceId)
    return toRecord(row)
  }

  async get(agentId: string): Promise<StoredAgent | null> {
    const row = await this.asApp(async (c) => {
      const res = await c.query(`SELECT ${SELECT_COLUMNS} FROM agent_registry WHERE id = $1`, [agentId])
      return res.rows[0] ?? null
    })
    return row ? toRecord(row) : null
  }

  /** Revoke / update an agent. agent_registry is a mutable workflow table (RLS UPDATE). */
  async update(agentId: string, patch: Partial<StoredAgent>, traceId: string): Promise<StoredAgent | null> {
    const row = await this.asApp(async (c) => {
      const res = await c.query(
        `UPDATE agent_registry
            SET status        = COALESCE($2, status),
                revoked_at    = COALESCE($3, revoked_at),
                revoke_reason = COALESCE($4, revoke_reason)
          WHERE id = $1
          RETURNING ${SELECT_COLUMNS}`,
        [agentId, patch.status ?? null, patch.revoked_at ?? null, patch.revoke_reason ?? null]
      )
      return res.rows[0] ?? null
    })
    if (row) await this.emitLineage(traceId)
    return row ? toRecord(row) : null
  }

  async list(query: AgentListQuery = {}): Promise<AgentPage> {
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
    const after = query.cursor ? decodeCursor(query.cursor) : null
    const rows = await this.asApp(async (c) => {
      const params: unknown[] = []
      const where: string[] = []
      if (after) {
        params.push(after.createdAt, after.id)
        where.push(`(date_trunc('milliseconds', created_at), id) > ($${params.length - 1}::timestamptz, $${params.length}::uuid)`)
      }
      const res = await c.query(
        `SELECT ${SELECT_COLUMNS} FROM agent_registry
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY date_trunc('milliseconds', created_at), id
         LIMIT ${limit + 1}`,
        params
      )
      return res.rows
    })
    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    const last = page[page.length - 1] as Record<string, unknown> | undefined
    return {
      rows: page.map(toRecord),
      next_cursor: hasMore && last ? encodeCursor(iso(last.created_at), last.id as string) : null
    }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}

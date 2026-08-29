import pg from 'pg'
import { beginAppTx } from './tenant-tx.js'
import type { LineageSink } from './lineage.js'
import { decodeCursor, encodeCursor, keysetClause } from './keyset.js'
import type { components } from '@ofbo/contracts'

/**
 * The contract's enums, not `string`.
 *
 * `toWire` in services/bff/src/tpp-billing/routes.ts is a pass-through, so whatever this store holds
 * is what the client receives on three spec-enum fields. I typed the in-memory sibling's channel to
 * `Channel` last round with the stated reason "a non-member must not reach a spec-enum response
 * field", and left THIS store — the one that serves the deployed demo — as bare `string`. Same
 * one-sided parity the rest of that PR was fixing.
 *
 * The database has enum constraints, so a bad value is caught at the write path; this closes it at
 * the type level, where the divergence between the two adapters actually lived.
 */
type Channel = components['schemas']['Channel']
type ProductionStatus = NonNullable<components['schemas']['TppCounterparty']['production_status']>
type RegistrationState = NonNullable<components['schemas']['TppCounterparty']['registration_state']>

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
  production_status: ProductionStatus
  first_traffic_at: string | null
  registration_state: RegistrationState
  financial_system_ref: string | null
  unbilled_traffic: boolean
  mtd_fee_accrual: Money | null
  channel: Channel
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

/**
 * Narrow a database string to a contract enum, or throw.
 *
 * A bare `as ProductionStatus` would silence the compiler while asserting exactly the thing that is
 * not checked — the DB column constraint is the only reason the value IS a member, and a constraint
 * this code never reads is not something this code knows. That is the shape of claim this branch has
 * been removing all week, so it is not the shape to end on.
 *
 * Throwing is the right failure: `toWire` is a pass-through, so an unrecognised value would otherwise
 * reach a spec-enum response field and the client would receive a member the contract does not
 * define. Failing the read is louder and closer to the cause than shipping it.
 */
function enumOr<T extends string>(field: string, value: unknown, members: readonly T[]): T {
  if (typeof value === 'string' && (members as readonly string[]).includes(value)) return value as T
  throw new Error(
    `tpp_counterparty.${field} holds ${JSON.stringify(value)}, which is not a member of the contract enum ` +
      `[${members.join(', ')}] — the column constraint and specs/backoffice-openapi.yaml disagree`
  )
}

// Runtime copies of contract enums — the generated types are types only, so the members have to be
// written down somewhere to be checked at runtime. `packages/db/test/enum-members.spec.ts` reads
// specs/backoffice-openapi.yaml and fails if any of the three drifts from it. Written down here and
// bound there, rather than written down here and trusted: I hand-wrote two of these three wrong on
// the first pass, and only the DB CHECK constraint caught it.
export const CHANNELS = ['internal_retail', 'internal_sme', 'internal_corporate', 'external_direct', 'external_tpp_aas'] as const
export const PRODUCTION_STATUSES = ['directory_only', 'active_traffic', 'dormant', 'decommissioned'] as const
export const REGISTRATION_STATES = ['unregistered', 'onboarding', 'registered', 'suspended'] as const

function toRow(r: Record<string, unknown>): StoredTppCounterparty {
  return {
    organisation_id: r.organisation_id as string,
    legal_name: r.legal_name as string,
    registration_number: (r.registration_number as string) ?? null,
    directory_contacts: (r.directory_contacts as unknown[]) ?? [],
    directory_synced_at: r.directory_synced_at ? iso(r.directory_synced_at) : null,
    production_status: enumOr('production_status', r.production_status, PRODUCTION_STATUSES),
    first_traffic_at: r.first_traffic_at ? iso(r.first_traffic_at) : null,
    registration_state: enumOr('registration_state', r.registration_state, REGISTRATION_STATES),
    financial_system_ref: (r.financial_system_ref as string) ?? null,
    unbilled_traffic: Boolean(r.unbilled_traffic),
    mtd_fee_accrual:
      r.mtd_fee_accrual_amount !== null && r.mtd_fee_accrual_amount !== undefined
        ? { amount: Number(r.mtd_fee_accrual_amount), currency: r.mtd_fee_accrual_currency as string }
        : null,
    channel: enumOr('channel', r.channel, CHANNELS),
    created_at: iso(r.created_at)
  }
}


export class PgTppCounterpartyStore {
  private readonly pool: pg.Pool
  constructor(
    databaseUrl: string,
    private readonly config: { bankId: string; channel: Channel },
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
                 -- PRESERVE what the participant does not carry, rather than overwriting it with
                 -- nothing. The P6 port's participant shape is { organisation_id, legal_name }
                 -- only, so every directory sync bound registration_number to NULL and
                 -- directory_contacts to '[]' and wrote them over the whole registry — two
                 -- spec-defined TppCounterparty fields emptied by the act of syncing. Both are
                 -- schema-valid empty, so no contract test objected.
                 --
                 -- A directory sync answers "who is present and what are they called". It has no
                 -- opinion on the other columns, and a write that has no opinion should not have
                 -- an effect.
                 registration_number = COALESCE(EXCLUDED.registration_number, tpp_counterparty.registration_number),
                 directory_contacts = CASE
                   WHEN EXCLUDED.directory_contacts = '[]'::jsonb THEN tpp_counterparty.directory_contacts
                   ELSE EXCLUDED.directory_contacts
                 END,
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
      // The bank_id predicate is REDUNDANT with RLS, and that is the point.
      //
      // `beginAppTx` pins `app.bank_id` and the `tenancy_update` policy on this table binds under
      // FORCE ROW LEVEL SECURITY, so cross-tenant rows were already unreachable — the advisory
      // reviewer verified the RLS layer fails closed (an unset setting matches no row). But this
      // statement is now reached from a bulk seed path rather than only per-request, so it mutates a
      // whole tenant's registry in one shot, and CLAUDE.md's posture for exactly that situation is
      // two layers rather than one good one. The predicate is the second.
      const dec = await c.query(
        `UPDATE tpp_counterparty SET production_status = 'decommissioned'
          WHERE bank_id = $2::uuid
            AND production_status <> 'decommissioned'
            AND NOT (organisation_id = ANY($1::text[]))
          RETURNING organisation_id`,
        [present, this.config.bankId]
      )
      return { synced: participants.length, added, changed, decommissioned: dec.rows.map((r) => r.organisation_id as string) }
    })
    await this.emitLineage(traceId)
    return result
  }

  /**
   * BACKOFFICE-72 — record the P9 financial-system registration: registered +
   * financial_system_ref, and clear the unbilled-traffic alert. Returns null if
   * the org is not in the registry.
   */
  async registerFinancialSystem(organisationId: string, financialSystemRef: string, traceId: string): Promise<StoredTppCounterparty | null> {
    const row = await this.asApp(async (c) => {
      const res = await c.query(
        `UPDATE tpp_counterparty
            SET registration_state = 'registered', financial_system_ref = $2, unbilled_traffic = false
          WHERE organisation_id = $1
          RETURNING ${SELECT_COLUMNS}`,
        [organisationId, financialSystemRef]
      )
      return res.rows[0] ?? null
    })
    if (row) await this.emitLineage(traceId)
    return row ? toRow(row) : null
  }

  /**
   * BACKOFFICE-72 — observe production traffic for a TPP: → active_traffic, stamp
   * first_traffic_at once, and raise the unbilled-traffic flag when the TPP has no
   * completed financial-system registration. Returns null if not in the registry.
   */
  async observeTraffic(organisationId: string, traceId: string): Promise<StoredTppCounterparty | null> {
    const row = await this.asApp(async (c) => {
      const res = await c.query(
        `UPDATE tpp_counterparty
            SET production_status = 'active_traffic',
                first_traffic_at = COALESCE(first_traffic_at, now()),
                unbilled_traffic = (registration_state <> 'registered')
          WHERE organisation_id = $1
          RETURNING ${SELECT_COLUMNS}`,
        [organisationId]
      )
      return res.rows[0] ?? null
    })
    if (row) await this.emitLineage(traceId)
    return row ? toRow(row) : null
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
        where.push(keysetClause(params, after, { column: 'organisation_id', cast: null }))
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
    return { rows: page, next_cursor: hasMore && last ? encodeCursor({ createdAt: last.created_at, id: last.organisation_id }) : null }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}

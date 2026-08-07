import pg from 'pg'
import { beginAppTx } from './tenant-tx.js'
import type { AuditEmitterConfig } from './audit.js'
import { decodeCursor, encodeCursor, keysetClause, type Keyset } from './keyset.js'

// Re-exported: consent-events was the only module that published these, and the BFF imports
// them from here. CODE-01 moved the implementation to ./keyset.js; the public surface is unchanged.
export { encodeCursor, type Keyset }

/**
 * BACKOFFICE-19 — read the 24-month consent lifecycle timeline from the
 * High-class audit store. Read-only (SELECT under the ofbo_app role with the
 * tenancy context set, so RLS binds exactly as the write path does — the
 * INSERT-only guarantee is untouched). Keyset cursor on (created_at, id) so the
 * chronological timeline pages stably even when events share a timestamp.
 */

export interface ConsentTimelineEvent {
  id: string
  consent_id: string | null
  psu_identifier: string | null
  event_type: 'granted' | 'accessed' | 'modified' | 'revoked'
  event_subtype: string | null
  event_data: unknown
  acting_principal: string | null
  created_at: string
}

export interface ConsentEventPage {
  events: ConsentTimelineEvent[]
  next_cursor: string | null
}

export interface ConsentEventQuery {
  cursor?: string
  limit?: number
}

const CONSENT_EVENT_TYPES = ['consent_granted', 'consent_accessed', 'consent_modified', 'consent_revoked']
const MAX_LIMIT = 200
const DEFAULT_LIMIT = 50



const stripPrefix = (t: string): ConsentTimelineEvent['event_type'] =>
  t.replace(/^consent_/, '') as ConsentTimelineEvent['event_type']

export class PgConsentEventReader {
  private readonly pool: pg.Pool
  constructor(
    databaseUrl: string,
    private readonly config: AuditEmitterConfig
  ) {
    this.pool = new pg.Pool({ connectionString: databaseUrl })
  }

  private async page(
    filterCol: 'target_consent_id' | 'target_psu_identifier',
    value: string,
    query: ConsentEventQuery
  ): Promise<ConsentEventPage> {
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
    const after = query.cursor ? decodeCursor(query.cursor) : null
    const c = await this.pool.connect()
    try {
      await c.query(beginAppTx(this.config.bankId))
      const params: unknown[] = [value, ...CONSENT_EVENT_TYPES]
      const typePlaceholders = CONSENT_EVENT_TYPES.map((_, i) => `$${i + 2}`).join(', ')
      // Keyset on (created_at, id) — see ./keyset.ts for why created_at is truncated to
      // milliseconds on BOTH sides. This call site is the reason keysetClause appends its own
      // binds: it builds over a variable-length prefix (the event-type placeholders), so its
      // old hand-rolled arithmetic was `params.length + 1/+2` while every other store used
      // `- 1/length`. Neither survived being copied into the other; now neither exists.
      const keysetPredicate = keysetClause(params, after)
      const keyset = keysetPredicate ? `AND ${keysetPredicate}` : ''
      // 24-month window (PRD §7) — the regulated hot tier.
      const { rows } = await c.query(
        `SELECT id, target_consent_id, target_psu_identifier, event_type,
                acting_principal, request_body_redacted, created_at
           FROM audit_high_sensitivity
          WHERE ${filterCol} = $1
            AND event_type IN (${typePlaceholders})
            AND created_at >= now() - interval '24 months'
            ${keyset}
          ORDER BY date_trunc('milliseconds', created_at), id
          LIMIT ${limit + 1}`,
        params
      )
      await c.query('COMMIT')
      const hasMore = rows.length > limit
      const page = hasMore ? rows.slice(0, limit) : rows
      const events: ConsentTimelineEvent[] = page.map((r) => ({
        id: r.id,
        consent_id: r.target_consent_id,
        psu_identifier: r.target_psu_identifier,
        event_type: stripPrefix(r.event_type),
        event_subtype: null,
        event_data: r.request_body_redacted ?? {},
        acting_principal: r.acting_principal,
        created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at)
      }))
      const last = page[page.length - 1]
      const next_cursor =
        hasMore && last
          ? encodeCursor({ createdAt: events[events.length - 1]!.created_at, id: last.id })
          : null
      return { events, next_cursor }
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined)
      throw e
    } finally {
      c.release()
    }
  }

  byConsent(consentId: string, query: ConsentEventQuery = {}): Promise<ConsentEventPage> {
    return this.page('target_consent_id', consentId, query)
  }

  byPsu(psuIdentifier: string, query: ConsentEventQuery = {}): Promise<ConsentEventPage> {
    return this.page('target_psu_identifier', psuIdentifier, query)
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}

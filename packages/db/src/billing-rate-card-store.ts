import pg from 'pg'
import { beginAppTx } from './tenant-tx.js'
import type { LineageSink } from './lineage.js'

export interface BillingRateCardVersionInput {
  version: string
  effectiveFrom: string
  sourceUrl: string
  configHash: string
  cardConfig: unknown
}

export interface StoredBillingRateCardVersion extends BillingRateCardVersionInput {
  id: string
  createdAt: string
}

export interface BillingSourceSnapshotInput {
  sourceName: string
  sourceUrl: string
  contentHash: string
  contentText: string
  httpStatus: number
  etag: string | null
  lastModified: string | null
  capturedAt: string
}

export interface StoredBillingSourceSnapshot extends BillingSourceSnapshotInput {
  id: string
}

export type BillingReviewAudience = 'Finance' | 'Compliance'

export interface BillingRateCardReviewInput {
  sourceName: string
  sourceUrl: string
  previousSnapshotId: string
  currentSnapshotId: string
  previousHash: string
  currentHash: string
  detectedAt: string
  changes: unknown[]
}

export interface StoredBillingRateCardReview extends BillingRateCardReviewInput {
  id: string
  classification: 'High'
  status: 'notification_pending' | 'notified'
  notifyAudiences: BillingReviewAudience[]
  financeTicketId: string | null
  complianceTicketId: string | null
}

const VERSION_COLUMNS = 'id, version, effective_from, source_url, config_hash, card_config, created_at'
const SNAPSHOT_COLUMNS = 'id, source_name, source_url, content_hash, content_text, http_status, etag, last_modified, captured_at'
const REVIEW_COLUMNS = `id, source_name, source_url, previous_snapshot_id, current_snapshot_id,
  previous_hash, current_hash, detected_at, changes, review_class, status, notify_audiences,
  finance_ticket_id, compliance_ticket_id`

const VERSION_LINEAGE = ['bank_id', 'channel', 'version', 'effective_from', 'source_url', 'config_hash']
const SNAPSHOT_LINEAGE = ['bank_id', 'channel', 'source_name', 'source_url', 'content_hash', 'content_text', 'http_status', 'captured_at']
const REVIEW_LINEAGE = ['bank_id', 'channel', 'source_name', 'source_url', 'previous_hash', 'current_hash', 'review_class', 'status', 'notify_audiences']

const iso = (value: unknown): string => value instanceof Date ? value.toISOString() : String(value)

function toVersion(row: Record<string, unknown>): StoredBillingRateCardVersion {
  return {
    id: row.id as string,
    version: row.version as string,
    effectiveFrom: iso(row.effective_from).slice(0, 10),
    sourceUrl: row.source_url as string,
    configHash: row.config_hash as string,
    cardConfig: row.card_config,
    createdAt: iso(row.created_at)
  }
}

function toSnapshot(row: Record<string, unknown>): StoredBillingSourceSnapshot {
  return {
    id: row.id as string,
    sourceName: row.source_name as string,
    sourceUrl: row.source_url as string,
    contentHash: row.content_hash as string,
    contentText: row.content_text as string,
    httpStatus: Number(row.http_status),
    etag: (row.etag as string | null) ?? null,
    lastModified: (row.last_modified as string | null) ?? null,
    capturedAt: iso(row.captured_at)
  }
}

function toReview(row: Record<string, unknown>): StoredBillingRateCardReview {
  return {
    id: row.id as string,
    sourceName: row.source_name as string,
    sourceUrl: row.source_url as string,
    previousSnapshotId: row.previous_snapshot_id as string,
    currentSnapshotId: row.current_snapshot_id as string,
    previousHash: row.previous_hash as string,
    currentHash: row.current_hash as string,
    detectedAt: iso(row.detected_at),
    changes: row.changes as unknown[],
    classification: row.review_class as 'High',
    status: row.status as 'notification_pending' | 'notified',
    notifyAudiences: row.notify_audiences as BillingReviewAudience[],
    financeTicketId: (row.finance_ticket_id as string | null) ?? null,
    complianceTicketId: (row.compliance_ticket_id as string | null) ?? null
  }
}

export class PgBillingRateCardStore {
  private readonly pool: pg.Pool

  constructor(
    databaseUrl: string,
    private readonly config: { bankId: string; channel: string },
    private readonly lineage?: LineageSink
  ) {
    this.pool = new pg.Pool({ connectionString: databaseUrl })
  }

  private async asApp<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    try {
      await client.query(beginAppTx(this.config.bankId))
      const result = await fn(client)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  private async emitLineage(table: string, columns: string[], traceId: string): Promise<void> {
    try {
      await this.lineage?.emitLineage({
        table,
        columns,
        source: 'bff-billing-rate-card-store',
        trace_id: traceId
      })
    } catch {
      /* Catalogue availability never rolls back the regulated write. */
    }
  }

  async ensureRateCardVersion(input: BillingRateCardVersionInput, traceId: string): Promise<StoredBillingRateCardVersion> {
    const result = await this.asApp(async (client) => {
      const inserted = await client.query(
        `INSERT INTO billing_rate_card_version
           (bank_id, channel, version, effective_from, source_url, config_hash, card_config)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
         ON CONFLICT (bank_id, version) DO NOTHING
         RETURNING ${VERSION_COLUMNS}`,
        [this.config.bankId, this.config.channel, input.version, input.effectiveFrom, input.sourceUrl, input.configHash, JSON.stringify(input.cardConfig)]
      )
      if (inserted.rows[0]) return { row: inserted.rows[0] as Record<string, unknown>, created: true }
      const existing = await client.query(
        `SELECT ${VERSION_COLUMNS} FROM billing_rate_card_version WHERE version = $1`,
        [input.version]
      )
      return { row: existing.rows[0] as Record<string, unknown> | undefined, created: false }
    })
    if (!result.row) throw new Error(`billing rate-card version ${input.version} could not be read after insert`)
    const version = toVersion(result.row)
    if (version.configHash !== input.configHash) {
      throw new Error(`billing rate-card version ${input.version} is immutable and already has a different config hash`)
    }
    if (result.created) await this.emitLineage('billing_rate_card_version', VERSION_LINEAGE, traceId)
    return version
  }

  async latestSnapshot(sourceUrl: string): Promise<StoredBillingSourceSnapshot | null> {
    const row = await this.asApp(async (client) => {
      const result = await client.query(
        `SELECT ${SNAPSHOT_COLUMNS} FROM billing_source_snapshot
          WHERE source_url = $1
          ORDER BY captured_at DESC, id DESC
          LIMIT 1`,
        [sourceUrl]
      )
      return result.rows[0] as Record<string, unknown> | undefined
    })
    return row ? toSnapshot(row) : null
  }

  async createSnapshot(input: BillingSourceSnapshotInput, traceId: string): Promise<StoredBillingSourceSnapshot> {
    const result = await this.asApp(async (client) => {
      const inserted = await client.query(
        `INSERT INTO billing_source_snapshot
           (bank_id, channel, source_name, source_url, content_hash, content_text, http_status, etag, last_modified, captured_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (bank_id, source_url, content_hash, captured_at) DO NOTHING
         RETURNING ${SNAPSHOT_COLUMNS}`,
        [this.config.bankId, this.config.channel, input.sourceName, input.sourceUrl, input.contentHash, input.contentText, input.httpStatus, input.etag, input.lastModified, input.capturedAt]
      )
      if (inserted.rows[0]) return { row: inserted.rows[0] as Record<string, unknown>, created: true }
      const existing = await client.query(
        `SELECT ${SNAPSHOT_COLUMNS} FROM billing_source_snapshot WHERE source_url = $1 AND content_hash = $2 AND captured_at = $3`,
        [input.sourceUrl, input.contentHash, input.capturedAt]
      )
      return { row: existing.rows[0] as Record<string, unknown> | undefined, created: false }
    })
    if (!result.row) throw new Error(`billing source snapshot ${input.contentHash} could not be read after insert`)
    if (result.created) await this.emitLineage('billing_source_snapshot', SNAPSHOT_LINEAGE, traceId)
    return toSnapshot(result.row)
  }

  async createReview(input: BillingRateCardReviewInput, traceId: string): Promise<{ review: StoredBillingRateCardReview; created: boolean }> {
    const result = await this.asApp(async (client) => {
      const inserted = await client.query(
        `INSERT INTO billing_rate_card_review
           (bank_id, channel, source_name, source_url, previous_snapshot_id, current_snapshot_id,
            previous_hash, current_hash, detected_at, changes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
         ON CONFLICT (bank_id, previous_snapshot_id, current_snapshot_id) DO NOTHING
         RETURNING ${REVIEW_COLUMNS}`,
        [
          this.config.bankId,
          this.config.channel,
          input.sourceName,
          input.sourceUrl,
          input.previousSnapshotId,
          input.currentSnapshotId,
          input.previousHash,
          input.currentHash,
          input.detectedAt,
          JSON.stringify(input.changes)
        ]
      )
      if (inserted.rows[0]) return { row: inserted.rows[0] as Record<string, unknown>, created: true }
      const existing = await client.query(
        `SELECT ${REVIEW_COLUMNS} FROM billing_rate_card_review
          WHERE previous_snapshot_id = $1 AND current_snapshot_id = $2`,
        [input.previousSnapshotId, input.currentSnapshotId]
      )
      return { row: existing.rows[0] as Record<string, unknown> | undefined, created: false }
    })
    if (!result.row) throw new Error('billing rate-card review could not be read after insert')
    if (result.created) await this.emitLineage('billing_rate_card_review', REVIEW_LINEAGE, traceId)
    return { review: toReview(result.row), created: result.created }
  }

  async reviewsAwaitingNotification(): Promise<StoredBillingRateCardReview[]> {
    const rows = await this.asApp(async (client) => {
      const result = await client.query(
        `SELECT ${REVIEW_COLUMNS} FROM billing_rate_card_review
          WHERE status = 'notification_pending'
          ORDER BY detected_at, id`
      )
      return result.rows as Record<string, unknown>[]
    })
    return rows.map(toReview)
  }

  async markReviewRecipientNotified(
    reviewId: string,
    audience: BillingReviewAudience,
    ticketId: string,
    traceId: string
  ): Promise<StoredBillingRateCardReview> {
    if (audience !== 'Finance' && audience !== 'Compliance') throw new Error(`unknown billing review audience ${audience}`)
    const finance = audience === 'Finance'
    const row = await this.asApp(async (client) => {
      const result = await client.query(
        `UPDATE billing_rate_card_review
            SET finance_ticket_id = CASE WHEN $2 THEN COALESCE(finance_ticket_id, $3) ELSE finance_ticket_id END,
                compliance_ticket_id = CASE WHEN NOT $2 THEN COALESCE(compliance_ticket_id, $3) ELSE compliance_ticket_id END,
                status = CASE
                  WHEN COALESCE(finance_ticket_id, CASE WHEN $2 THEN $3 ELSE NULL END) IS NOT NULL
                   AND COALESCE(compliance_ticket_id, CASE WHEN NOT $2 THEN $3 ELSE NULL END) IS NOT NULL
                  THEN 'notified'
                  ELSE 'notification_pending'
                END
          WHERE id = $1
          RETURNING ${REVIEW_COLUMNS}`,
        [reviewId, finance, ticketId]
      )
      return result.rows[0] as Record<string, unknown> | undefined
    })
    if (!row) throw new Error(`billing rate-card review ${reviewId} does not exist`)
    await this.emitLineage('billing_rate_card_review', REVIEW_LINEAGE, traceId)
    return toReview(row)
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}
